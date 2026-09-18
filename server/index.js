'use strict';
// Serveur HTTP du site DYLAN AUTO (Node.js sans dépendance externe)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { db } = require('./db');
const svc = require('./services');
const { parseBody, sendJson, sendHtml, rateLimit, clientIp } = require('./http-utils');
const { escapeHtml, formatDateFr } = require('./utils');

const PUBLIC_DIR = path.join(config.root, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.webmanifest': 'application/manifest+json' };

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-src https://www.google.com https://maps.google.com; script-src 'self'; connect-src 'self'; form-action 'self'",
};

// ---------- Authentification admin (HTTP Basic) ----------
function isAdmin(req) {
  if (!config.admin.password) return false;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [user, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
  const pass = rest.join(':');
  const a = Buffer.from(`${user}\0${pass}`);
  const b = Buffer.from(`${config.admin.user}\0${config.admin.password}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  if (!config.admin.password) {
    sendHtml(res, 503, '<h1>Espace administration désactivé</h1><p>Définissez ADMIN_PASSWORD dans le fichier .env puis redémarrez le serveur.</p>');
    return false;
  }
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Administration DYLAN AUTO", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Authentification requise');
  return false;
}

// ---------- Fichiers statiques ----------
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR) || rel.startsWith('/partials/')) { sendHtml(res, 403, 'Interdit'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      if (!path.extname(file) && fs.existsSync(file + '.html')) return streamFile(res, file + '.html', req);
      return notFound(res);
    }
    streamFile(res, file, req);
  });
}
const partialCache = new Map();
function partial(name) {
  // En production les partials sont mis en cache ; en dev (npm run dev) ils sont relus à chaque fois
  if (process.env.NODE_ENV === 'production' && partialCache.has(name)) return partialCache.get(name);
  const file = path.join(PUBLIC_DIR, 'partials', `${name}.html`);
  const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  partialCache.set(name, html);
  return html;
}
function streamFile(res, file, req) {
  const ext = path.extname(file).toLowerCase();
  const cache = ext === '.html' ? 'no-cache' : 'public, max-age=86400';
  if (ext === '.html') {
    // Injection de l'en-tête et du pied de page communs ({{header}} / {{footer}})
    const html = fs.readFileSync(file, 'utf8').replace(/\{\{(header|footer)\}\}/g, (_, n) => partial(n));
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': cache, 'Content-Length': Buffer.byteLength(html), ...SECURITY_HEADERS });
    return res.end(req.method === 'HEAD' ? undefined : html);
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache, ...SECURITY_HEADERS });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}
function notFound(res) {
  const p = path.join(PUBLIC_DIR, '404.html');
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
  if (fs.existsSync(p)) fs.createReadStream(p).pipe(res); else res.end('<h1>Page introuvable</h1>');
}

// ---------- Routes API ----------
async function handleApi(req, res, url) {
  const p = url.pathname;
  const ip = clientIp(req);

  // Config publique (infos garage + grille tarifaire)
  if (req.method === 'GET' && p === '/api/config') {
    const { name, legalName, siren, tagline, address, phone, mobile, email, googleMapsUrl, rating, openingHours, booking, fullAddress } = config.garage;
    return sendJson(res, 200, { garage: { name, legalName, siren, tagline, address, phone, mobile, email, googleMapsUrl, rating, openingHours, booking, fullAddress }, pricing: config.pricing }, { 'Cache-Control': 'public, max-age=300' });
  }

  // Calcul d'un devis (sans enregistrement)
  if (req.method === 'POST' && p === '/api/quotes/compute') {
    const { fields } = await parseBody(req);
    const r = svc.computeQuote(fields.vehicleType, fields.services);
    return sendJson(res, 200, { items: r.items, total_ht: r.total_ht, total_tva: r.total_tva, total_ttc: r.total_ttc });
  }

  // Envoi d'une demande de devis (avec photos éventuelles)
  if (req.method === 'POST' && p === '/api/quotes') {
    if (!rateLimit(ip, 'quote', 5, 3600000)) return sendJson(res, 429, { error: 'Trop de demandes. Réessayez dans une heure ou appelez-nous.' });
    const { fields, files } = await parseBody(req);
    if (fields.website) return sendJson(res, 200, { ok: true }); // pot de miel anti-robots
    const photos = files.filter((f) => f.field === 'photos' && /^image\//.test(f.contentType)).slice(0, 3);
    for (const ph of photos) if (ph.content.length > 5 * 1024 * 1024) return sendJson(res, 400, { error: 'Chaque photo doit faire moins de 5 Mo.', field: 'photos' });
    const r = await svc.createQuote(fields, photos, ip);
    return sendJson(res, 201, { ok: true, ...r });
  }

  // Disponibilités
  if (req.method === 'GET' && p === '/api/appointments/availability') {
    const date = url.searchParams.get('date');
    if (date) return sendJson(res, 200, svc.getAvailability(date));
    const year = Number(url.searchParams.get('year'));
    const month = Number(url.searchParams.get('month'));
    if (!year || !month || month < 1 || month > 12) return sendJson(res, 400, { error: 'Paramètres invalides' });
    return sendJson(res, 200, svc.getMonthAvailability(year, month));
  }

  // Prise de rendez-vous
  if (req.method === 'POST' && p === '/api/appointments') {
    if (!rateLimit(ip, 'appt', 5, 3600000)) return sendJson(res, 429, { error: 'Trop de demandes. Réessayez dans une heure ou appelez-nous.' });
    const { fields } = await parseBody(req);
    if (fields.website) return sendJson(res, 200, { ok: true });
    const r = await svc.createAppointment(fields, ip);
    return sendJson(res, 201, { ok: true, ...r });
  }

  // Annulation par le client (lien reçu par email)
  let m = /^\/api\/appointments\/([A-Z0-9-]+)\/cancel$/.exec(p);
  if (req.method === 'GET' && m) {
    const r = svc.cancelByClient(m[1], url.searchParams.get('token'));
    const body = r.ok
      ? `<h1>Rendez-vous ${r.already ? 'déjà ' : ''}annulé</h1><p>Votre rendez-vous du ${escapeHtml(formatDateFr(r.appointment.date))} à ${escapeHtml(r.appointment.time)} est annulé.</p><p><a href="/rendez-vous.html">Reprendre rendez-vous</a></p>`
      : `<h1>Lien invalide</h1><p>${escapeHtml(r.reason)} Contactez-nous au ${escapeHtml(config.garage.phone)}.</p>`;
    return sendHtml(res, r.ok ? 200 : 400, simplePage(body));
  }

  // Formulaire de contact
  if (req.method === 'POST' && p === '/api/contact') {
    if (!rateLimit(ip, 'contact', 5, 3600000)) return sendJson(res, 429, { error: 'Trop de messages envoyés. Réessayez plus tard ou appelez-nous.' });
    const { fields } = await parseBody(req);
    if (fields.website) return sendJson(res, 200, { ok: true });
    const r = await svc.createMessage(fields, ip);
    return sendJson(res, 201, { ok: true, ...r });
  }

  // ---------- ADMIN ----------
  if (p.startsWith('/api/admin/')) {
    if (!rateLimit(ip, 'admin', 300, 60000)) return sendJson(res, 429, { error: 'Trop de requêtes' });
    if (!requireAdmin(req, res)) return;
    return handleAdminApi(req, res, url);
  }

  sendJson(res, 404, { error: 'Route inconnue' });
}

async function handleAdminApi(req, res, url) {
  const p = url.pathname;
  if (req.method === 'GET' && p === '/api/admin/overview') {
    const today = new Date().toISOString().slice(0, 10);
    const appointments = db.prepare("SELECT * FROM appointments WHERE date >= ? OR status = 'en_attente' ORDER BY date, time LIMIT 500").all(today);
    const pastAppointments = db.prepare("SELECT * FROM appointments WHERE date < ? AND status != 'en_attente' ORDER BY date DESC, time DESC LIMIT 100").all(today);
    const quotes = db.prepare('SELECT * FROM quotes ORDER BY id DESC LIMIT 300').all().map((q) => ({ ...q, items: JSON.parse(q.items_json), photos: JSON.parse(q.photos_json || '[]'), items_json: undefined, photos_json: undefined }));
    const messages = db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 300').all();
    const closures = db.prepare('SELECT * FROM closures WHERE date >= ? ORDER BY date').all(today);
    const stats = {
      pendingAppointments: db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE status = 'en_attente'").get().n,
      todayAppointments: db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE date = ? AND status IN ('en_attente','confirme')").get(today).n,
      newQuotes: db.prepare("SELECT COUNT(*) AS n FROM quotes WHERE status = 'nouveau'").get().n,
      newMessages: db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'nouveau'").get().n,
      quotesTotal: db.prepare('SELECT COALESCE(SUM(total_ttc),0) AS s FROM quotes WHERE created_at >= date(\'now\',\'-30 days\')').get().s,
    };
    return sendJson(res, 200, { appointments, pastAppointments, quotes, messages, closures, stats, garage: config.garage, smtpConfigured: Boolean(config.smtp.host) });
  }
  let m;
  if ((m = /^\/api\/admin\/appointments\/(\d+)\/status$/.exec(p)) && req.method === 'POST') {
    const { fields } = await parseBody(req);
    return sendJson(res, 200, { ok: true, appointment: svc.setAppointmentStatus(Number(m[1]), fields.status) });
  }
  if ((m = /^\/api\/admin\/appointments\/(\d+)$/.exec(p)) && req.method === 'DELETE') {
    db.prepare('DELETE FROM appointments WHERE id = ?').run(Number(m[1]));
    return sendJson(res, 200, { ok: true });
  }
  if ((m = /^\/api\/admin\/quotes\/(\d+)\/status$/.exec(p)) && req.method === 'POST') {
    const { fields } = await parseBody(req);
    if (!['nouveau', 'traite', 'accepte', 'refuse'].includes(fields.status)) return sendJson(res, 400, { error: 'Statut invalide' });
    db.prepare('UPDATE quotes SET status = ? WHERE id = ?').run(fields.status, Number(m[1]));
    return sendJson(res, 200, { ok: true });
  }
  if ((m = /^\/api\/admin\/quotes\/(\d+)\/pdf$/.exec(p)) && req.method === 'GET') {
    const r = svc.quotePdfById(Number(m[1]));
    if (!r) return sendJson(res, 404, { error: 'Devis introuvable' });
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="devis-${r.reference}.pdf"`, 'Content-Length': r.pdf.length });
    return res.end(r.pdf);
  }
  if ((m = /^\/api\/admin\/quotes\/(\d+)$/.exec(p)) && req.method === 'DELETE') {
    db.prepare('DELETE FROM quotes WHERE id = ?').run(Number(m[1]));
    return sendJson(res, 200, { ok: true });
  }
  if ((m = /^\/api\/admin\/messages\/(\d+)\/status$/.exec(p)) && req.method === 'POST') {
    const { fields } = await parseBody(req);
    if (!['nouveau', 'lu', 'traite'].includes(fields.status)) return sendJson(res, 400, { error: 'Statut invalide' });
    db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(fields.status, Number(m[1]));
    return sendJson(res, 200, { ok: true });
  }
  if ((m = /^\/api\/admin\/messages\/(\d+)$/.exec(p)) && req.method === 'DELETE') {
    db.prepare('DELETE FROM messages WHERE id = ?').run(Number(m[1]));
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/admin/closures' && req.method === 'POST') {
    const { fields } = await parseBody(req);
    const from = String(fields.from || fields.date || '');
    const to = String(fields.to || from);
    if (!svc.isValidDateStr(from) || !svc.isValidDateStr(to) || to < from) return sendJson(res, 400, { error: 'Dates invalides' });
    const reason = String(fields.reason || 'Fermeture exceptionnelle').slice(0, 100);
    const ins = db.prepare('INSERT INTO closures (date, reason) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET reason = excluded.reason');
    let d = new Date(`${from}T00:00:00Z`);
    let count = 0;
    while (d.toISOString().slice(0, 10) <= to && count < 366) { ins.run(d.toISOString().slice(0, 10), reason); d = new Date(d.getTime() + 86400000); count++; }
    return sendJson(res, 200, { ok: true, count });
  }
  if ((m = /^\/api\/admin\/closures\/(\d+)$/.exec(p)) && req.method === 'DELETE') {
    db.prepare('DELETE FROM closures WHERE id = ?').run(Number(m[1]));
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/admin/test-email' && req.method === 'POST') {
    const { sendMail } = require('./smtp');
    try {
      const r = await sendMail({ to: config.ownerEmails, subject: `[${config.garage.name}] Test d’envoi d’email`, text: 'Si vous lisez ceci, la configuration email du site fonctionne.', html: '<p>Si vous lisez ceci, la configuration email du site <strong>fonctionne</strong>. ✔</p>' });
      return sendJson(res, 200, { ok: true, simulated: r.simulated });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }
  sendJson(res, 404, { error: 'Route admin inconnue' });
}

function simplePage(body) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(config.garage.name)}</title><link rel="stylesheet" href="/css/style.css"></head><body><main class="container" style="padding:60px 16px;max-width:640px"><a href="/" class="logo">${escapeHtml(config.garage.name)}</a>${body}</main></body></html>`;
}

// ---------- Serveur ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
      return await handleApi(req, res, url);
    }
    if (url.pathname.startsWith('/admin')) {
      if (!requireAdmin(req, res)) return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    if (url.pathname.startsWith('/api/')) return sendJson(res, status, { error: status >= 500 ? 'Erreur interne, réessayez ou appelez-nous.' : err.message, field: err.field });
    sendHtml(res, status, simplePage(`<h1>Erreur</h1><p>${escapeHtml(err.message)}</p>`));
  }
});

if (require.main === module) {
  server.listen(config.port, () => {
    console.log(`\n🚗  ${config.garage.name} — site démarré sur http://localhost:${config.port}`);
    console.log(`    Emails du dirigeant : ${config.ownerEmails.join(', ') || '(non configuré)'}`);
    console.log(`    SMTP : ${config.smtp.host ? `${config.smtp.host}:${config.smtp.port}` : 'NON CONFIGURÉ (les emails s’affichent dans la console)'}`);
    console.log(`    Admin : ${config.admin.password ? `http://localhost:${config.port}/admin/` : 'DÉSACTIVÉ (définir ADMIN_PASSWORD dans .env)'}\n`);
  });
}

module.exports = { server };
