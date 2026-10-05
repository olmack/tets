'use strict';
// Serveur de vérification de documents PDF (Node.js seul, aucune dépendance à installer)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { stampPdf, UserError } = require('./pdf-stamp');
const { qrSvg } = require('./qrcode');
const { Store, normalizeId, formatId, sha256 } = require('./store');
const pages = require('./pages');

const ROOT = path.join(__dirname, '..');
if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}

const env = process.env;
const PORT = Number(env.PORT) || 3000;
const config = {
  port: PORT,
  // Adresse inscrite dans les QR codes : doit être joignable depuis le téléphone qui scanne
  baseUrl: (env.BASE_URL || `http://${lanAddress()}:${PORT}`).replace(/\/+$/, ''),
  baseUrlFromEnv: Boolean(env.BASE_URL),
  issuer: env.ISSUER_NAME || 'Mon organisme',
  adminUser: env.ADMIN_USER || 'admin',
  adminPassword: env.ADMIN_PASSWORD || '',
  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
};

const store = new Store(config.dataDir);
const MAX_PDF = 30 * 1024 * 1024;
const PUBLIC = path.join(ROOT, 'public');
const STATIC = {
  '/style.css': 'text/css; charset=utf-8',
  '/verify.js': 'text/javascript; charset=utf-8',
  '/admin.js': 'text/javascript; charset=utf-8',
  '/favicon.svg': 'image/svg+xml',
};

// ---------- Outils ----------

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new UserError('Fichier trop volumineux (30 Mo maximum).'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Limitation simple du nombre de requêtes par adresse IP
const hits = new Map();
function rateLimited(req, key, max, windowMs = 60_000) {
  const id = `${key}:${req.socket.remoteAddress}`;
  const now = Date.now();
  const entry = hits.get(id);
  if (!entry || now - entry.start > windowMs) { hits.set(id, { start: now, count: 1 }); return false; }
  entry.count++;
  return entry.count > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now - v.start > 120_000) hits.delete(k); }, 60_000).unref();

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isAdmin(req) {
  if (!config.adminPassword) return false;
  const m = /^Basic (.+)$/i.exec(req.headers.authorization || '');
  if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  const userOk = safeEqual(decoded.slice(0, sep), config.adminUser);
  const passOk = safeEqual(decoded.slice(sep + 1), config.adminPassword);
  return userOk && passOk;
}

function requireAdmin(req, res) {
  if (!config.adminPassword) {
    send(res, 503, pages.messagePage('Administration désactivée', 'Définissez ADMIN_PASSWORD dans le fichier .env puis redémarrez le serveur.', config));
    return false;
  }
  if (rateLimited(req, 'admin', 300)) { json(res, 429, { error: 'Trop de requêtes, patientez une minute.' }); return false; }
  if (!isAdmin(req)) {
    send(res, 401, 'Identifiant ou mot de passe incorrect.', 'text/plain; charset=utf-8', { 'WWW-Authenticate': 'Basic realm="Administration", charset="UTF-8"' });
    return false;
  }
  return true;
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function publicDoc(doc) {
  return { ...doc, code: formatId(doc.id), url: `${config.baseUrl}/v/${doc.id}`, state: pages.documentStatus(doc) };
}

// ---------- Administration ----------

async function createDocument(req, res, url) {
  const q = url.searchParams;
  const title = clean(q.get('title'), 200);
  const recipient = clean(q.get('recipient'), 200);
  const note = clean(q.get('note'), 500);
  const issuedAt = q.get('issuedAt') || new Date().toISOString().slice(0, 10);
  const expiresAt = q.get('expiresAt') || null;
  const position = ['bas-droite', 'bas-gauche', 'haut-droite', 'haut-gauche'].includes(q.get('position')) ? q.get('position') : 'bas-droite';
  const pagesOpt = ['premiere', 'derniere', 'toutes'].includes(q.get('pages')) ? q.get('pages') : 'premiere';
  const originalName = clean(q.get('filename'), 150).replace(/[\\/]/g, '_') || 'document.pdf';
  if (!title) return json(res, 400, { error: 'L\'intitulé du document est obligatoire.' });
  if (!isDate(issuedAt)) return json(res, 400, { error: 'Date d\'émission invalide.' });
  if (expiresAt && (!isDate(expiresAt) || expiresAt < issuedAt)) return json(res, 400, { error: 'Date d\'expiration invalide.' });

  const input = await readBody(req, MAX_PDF);
  if (!input.length) return json(res, 400, { error: 'Aucun fichier reçu.' });
  const id = store.newId();
  const { pdf, pageCount } = stampPdf(input, { url: `${config.baseUrl}/v/${id}`, code: formatId(id), position, pages: pagesOpt });
  const doc = {
    id,
    title,
    recipient,
    note,
    issuedAt,
    expiresAt,
    originalName,
    pageCount,
    size: pdf.length,
    sha256: sha256(pdf),
    originalSha256: sha256(input),
    baseUrl: config.baseUrl,
    status: 'valide',
    revokedAt: null,
    revokeReason: '',
    scans: 0,
    lastScanAt: null,
    createdAt: new Date().toISOString(),
  };
  store.add(doc, pdf);
  json(res, 201, publicDoc(doc));
}

async function handleAdminApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // api admin documents :id action
  if (url.pathname === '/api/admin/config' && req.method === 'GET') {
    return json(res, 200, { issuer: config.issuer, baseUrl: config.baseUrl, baseUrlFromEnv: config.baseUrlFromEnv, localOnly: /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(config.baseUrl) });
  }
  if (parts[2] !== 'documents') return json(res, 404, { error: 'Introuvable' });
  if (parts.length === 3) {
    if (req.method === 'GET') return json(res, 200, store.list().map(publicDoc));
    if (req.method === 'POST') return createDocument(req, res, url);
  }
  const doc = store.get(normalizeId(parts[3]));
  if (!doc) return json(res, 404, { error: 'Document introuvable.' });
  const action = parts[4];
  if (!action && req.method === 'DELETE') { store.remove(doc.id); return json(res, 200, { ok: true }); }
  if (action === 'pdf' && req.method === 'GET') {
    const name = doc.originalName.replace(/\.pdf$/i, '') + '-verifiable.pdf';
    return send(res, 200, fs.readFileSync(store.pdfPath(doc.id)), 'application/pdf', {
      'Content-Disposition': `attachment; filename="${name.replace(/[^\w.\- ]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
  }
  if (action === 'qr.svg' && req.method === 'GET') return send(res, 200, qrSvg(`${config.baseUrl}/v/${doc.id}`), 'image/svg+xml');
  if (req.method === 'POST' && (action === 'revoke' || action === 'restore')) {
    let reason = '';
    if (action === 'revoke') {
      const body = await readBody(req, 4096);
      try { reason = clean(JSON.parse(body.toString('utf8') || '{}').reason, 300); } catch { reason = ''; }
    }
    const changes = action === 'revoke'
      ? { status: 'revoque', revokedAt: new Date().toISOString(), revokeReason: reason }
      : { status: 'valide', revokedAt: null, revokeReason: '' };
    return json(res, 200, publicDoc(store.update(doc.id, changes)));
  }
  return json(res, 405, { error: 'Méthode non autorisée' });
}

// ---------- Routeur ----------

async function handle(req, res) {
  securityHeaders(res);
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'GET' && STATIC[p]) {
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, p.slice(1))), STATIC[p], { 'Cache-Control': 'public, max-age=300' });
  }
  if (req.method === 'GET' && p === '/') return send(res, 200, pages.homePage(config));

  // Page de vérification (cible des QR codes)
  if (req.method === 'GET' && p === '/v') {
    const id = normalizeId(url.searchParams.get('code'));
    return send(res, 302, '', 'text/plain', { Location: id ? `/v/${id}` : '/' });
  }
  const vm = /^\/v\/([^/]+)\/?$/.exec(p);
  if (req.method === 'GET' && vm) {
    if (rateLimited(req, 'verify', 60)) return send(res, 429, pages.messagePage('Trop de vérifications', 'Merci de patienter une minute avant de réessayer.', config));
    const id = normalizeId(decodeURIComponent(vm[1]));
    const doc = store.get(id);
    if (doc) store.update(id, { scans: (doc.scans || 0) + 1, lastScanAt: new Date().toISOString() });
    return send(res, doc ? 200 : 404, pages.verifyPage(doc, { issuer: config.issuer, code: vm[1], formatId }));
  }
  // Contrôle du fichier PDF : compare l'empreinte SHA-256 avec celle du document émis
  const fm = /^\/v\/([^/]+)\/fichier$/.exec(p);
  if (req.method === 'POST' && fm) {
    if (rateLimited(req, 'file', 20)) return json(res, 429, { error: 'Trop de vérifications, patientez une minute.' });
    const doc = store.get(normalizeId(fm[1]));
    if (!doc) return json(res, 404, { error: 'Document introuvable.' });
    const buf = await readBody(req, MAX_PDF);
    return json(res, 200, { identique: sha256(buf) === doc.sha256, etat: pages.documentStatus(doc) });
  }

  if (p === '/admin' || p === '/admin/') {
    if (!requireAdmin(req, res)) return;
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'admin.html')));
  }
  if (p.startsWith('/api/admin/')) {
    if (!requireAdmin(req, res)) return;
    return handleAdminApi(req, res, url);
  }
  send(res, 404, pages.messagePage('Page introuvable', 'Cette page n\'existe pas.', config));
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err.status || (err instanceof UserError ? 400 : 500);
    if (status === 500) console.error(err);
    const message = err instanceof UserError ? err.message : status === 500 ? 'Erreur interne du serveur. Le PDF est peut-être d\'un format non pris en charge.' : err.message;
    if (!res.headersSent) json(res, status, { error: message });
    else res.end();
  });
});

if (require.main === module) {
  server.listen(config.port, () => {
    console.log(`\n  Vérification de documents — ${config.issuer}`);
    console.log(`  Site public     : http://localhost:${config.port}`);
    console.log(`  Administration  : http://localhost:${config.port}/admin`);
    console.log(`  Adresse des QR  : ${config.baseUrl}`);
    if (!config.baseUrlFromEnv) {
      console.log('\n  ⚠  BASE_URL n\'est pas défini dans .env : les QR codes pointent vers l\'adresse de cet');
      console.log('     ordinateur sur votre réseau Wi-Fi. Un téléphone ne pourra les scanner que s\'il est');
      console.log('     connecté au même réseau. Pour de vrais documents, définissez BASE_URL (voir README).');
    }
    if (!config.adminPassword) console.log('\n  ⚠  ADMIN_PASSWORD n\'est pas défini dans .env : l\'administration est désactivée.');
    else if (config.adminPassword === 'changez-moi') console.log('\n  ⚠  Mot de passe d\'administration par défaut : changez ADMIN_PASSWORD dans .env.');
    console.log('');
  });
}

module.exports = { server, config, store };
