'use strict';
// Outils HTTP : lecture du corps, multipart, réponses, limitation de débit
const { StringDecoder } = require('string_decoder');

const MAX_JSON = 64 * 1024;
const MAX_MULTIPART = 16 * 1024 * 1024; // 3 photos de 5 Mo max

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Contenu trop volumineux'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseBody(req) {
  const type = req.headers['content-type'] || '';
  if (type.startsWith('application/json')) {
    const buf = await readBody(req, MAX_JSON);
    try { return { fields: JSON.parse(buf.toString('utf8') || '{}'), files: [] }; } catch { throw Object.assign(new Error('JSON invalide'), { status: 400 }); }
  }
  if (type.startsWith('application/x-www-form-urlencoded')) {
    const buf = await readBody(req, MAX_JSON);
    return { fields: Object.fromEntries(new URLSearchParams(buf.toString('utf8'))), files: [] };
  }
  if (type.startsWith('multipart/form-data')) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
    if (!m) throw Object.assign(new Error('Multipart invalide'), { status: 400 });
    const buf = await readBody(req, MAX_MULTIPART);
    return parseMultipart(buf, m[1] || m[2]);
  }
  return { fields: {}, files: [] };
}

function parseMultipart(buf, boundary) {
  const fields = {};
  const files = [];
  const delim = Buffer.from(`--${boundary}`);
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    pos += delim.length;
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break; // fin "--"
    const headerEnd = buf.indexOf('\r\n\r\n', pos);
    if (headerEnd === -1) break;
    const headers = buf.slice(pos, headerEnd).toString('utf8');
    const next = buf.indexOf(delim, headerEnd);
    if (next === -1) break;
    const content = buf.slice(headerEnd + 4, next - 2); // enlève le \r\n final
    const nameM = /name="([^"]*)"/i.exec(headers);
    const fileM = /filename="([^"]*)"/i.exec(headers);
    const ctM = /content-type:\s*([^\r\n]+)/i.exec(headers);
    const name = nameM ? nameM[1] : 'champ';
    if (fileM) {
      if (fileM[1]) files.push({ field: name, filename: sanitizeFilename(fileM[1]), contentType: (ctM ? ctM[1].trim() : 'application/octet-stream'), content });
    } else {
      fields[name] = new StringDecoder('utf8').end(content);
    }
    pos = next;
  }
  return { fields, files };
}

function sanitizeFilename(name) {
  return name.replace(/[^\w.\-àâäéèêëîïôöùûüç ]/gi, '_').slice(0, 80) || 'fichier';
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

// Limitation de débit en mémoire (anti-spam) : max N requêtes par fenêtre et par IP
const buckets = new Map();
function rateLimit(ip, key, max, windowMs) {
  const now = Date.now();
  const id = `${key}:${ip}`;
  let b = buckets.get(id);
  if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(id, b); }
  b.count += 1;
  if (buckets.size > 10000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  return b.count <= max;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

module.exports = { parseBody, sendJson, sendHtml, rateLimit, clientIp };
