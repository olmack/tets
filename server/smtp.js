'use strict';
// Client SMTP minimaliste (sans dépendance) : STARTTLS (587) ou TLS implicite (465), AUTH LOGIN / PLAIN.
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const config = require('./config');

function encodeHeader(str) {
  // Encodage MIME "encoded-word" pour les caractères non ASCII dans les en-têtes
  if (/^[\x20-\x7e]*$/.test(str)) return str;
  return `=?UTF-8?B?${Buffer.from(str, 'utf8').toString('base64')}?=`;
}

function formatAddress(addr) {
  const m = /^(.*)<([^>]+)>\s*$/.exec(addr);
  if (!m) return addr.trim();
  const name = m[1].trim().replace(/^"|"$/g, '');
  return name ? `${encodeHeader(name)} <${m[2].trim()}>` : m[2].trim();
}

function extractEmail(addr) {
  const m = /<([^>]+)>/.exec(addr);
  return (m ? m[1] : addr).trim();
}

function wrap76(b64) {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

/**
 * Construit un message MIME complet.
 * @param {{from:string,to:string[],replyTo?:string,subject:string,text:string,html?:string,attachments?:{filename:string,content:Buffer,contentType:string}[]}} msg
 */
function buildMime(msg) {
  const boundaryMixed = `----=_Mixed_${crypto.randomBytes(12).toString('hex')}`;
  const boundaryAlt = `----=_Alt_${crypto.randomBytes(12).toString('hex')}`;
  const headers = [
    `From: ${formatAddress(msg.from)}`,
    `To: ${msg.to.map(formatAddress).join(', ')}`,
    msg.replyTo ? `Reply-To: ${formatAddress(msg.replyTo)}` : null,
    `Subject: ${encodeHeader(msg.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${extractEmail(msg.from).split('@')[1] || 'localhost'}>`,
    'MIME-Version: 1.0',
  ].filter(Boolean);

  const alt = [
    `--${boundaryAlt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(msg.text, 'utf8').toString('base64')),
  ];
  if (msg.html) {
    alt.push(
      `--${boundaryAlt}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(Buffer.from(msg.html, 'utf8').toString('base64'))
    );
  }
  alt.push(`--${boundaryAlt}--`);

  const attachments = msg.attachments || [];
  if (attachments.length === 0) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundaryAlt}"`);
    return headers.join('\r\n') + '\r\n\r\n' + alt.join('\r\n') + '\r\n';
  }

  headers.push(`Content-Type: multipart/mixed; boundary="${boundaryMixed}"`);
  const parts = [
    `--${boundaryMixed}`,
    `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
    '',
    alt.join('\r\n'),
  ];
  for (const a of attachments) {
    parts.push(
      `--${boundaryMixed}`,
      `Content-Type: ${a.contentType}; name="${encodeHeader(a.filename)}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${encodeHeader(a.filename)}"`,
      '',
      wrap76(a.content.toString('base64'))
    );
  }
  parts.push(`--${boundaryMixed}--`);
  return headers.join('\r\n') + '\r\n\r\n' + parts.join('\r\n') + '\r\n';
}

class SmtpClient {
  constructor(opts) {
    this.opts = opts;
    this.socket = null;
    this.buffer = '';
    this.waiters = [];
  }

  _attach(socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      this._flush();
    });
    socket.on('error', (err) => this._fail(err));
    socket.on('close', () => this._fail(new Error('Connexion SMTP fermée')));
  }

  _fail(err) {
    const w = this.waiters.splice(0);
    for (const { reject } of w) reject(err);
  }

  _flush() {
    // Une réponse SMTP est complète quand la dernière ligne est "NNN texte" (espace après le code)
    const lines = this.buffer.split('\r\n');
    const complete = [];
    let idx = 0;
    for (; idx < lines.length - 1; idx++) {
      complete.push(lines[idx]);
      if (/^\d{3} /.test(lines[idx])) break;
    }
    if (idx >= lines.length - 1) return; // pas encore complet
    this.buffer = lines.slice(idx + 1).join('\r\n');
    const waiter = this.waiters.shift();
    const code = Number(complete[complete.length - 1].slice(0, 3));
    const text = complete.map((l) => l.slice(4)).join('\n');
    if (waiter) waiter.resolve({ code, text });
    if (this.buffer.includes('\r\n')) this._flush();
  }

  _read() {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      setTimeout(() => reject(new Error('Délai SMTP dépassé')), 20000).unref();
    });
  }

  async _cmd(line, expected) {
    if (line !== null) this.socket.write(line + '\r\n');
    const res = await this._read();
    if (!expected.includes(res.code)) {
      throw new Error(`SMTP ${line ? line.split(' ')[0] : 'greeting'} → ${res.code} ${res.text}`);
    }
    return res;
  }

  async connect() {
    const { host, port } = this.opts;
    const secure = port === 465;
    await new Promise((resolve, reject) => {
      const socket = secure
        ? tls.connect({ host, port, servername: host }, resolve)
        : net.connect({ host, port }, resolve);
      socket.once('error', reject);
      this._attach(socket);
    });
    await this._cmd(null, [220]);
    let ehlo = await this._cmd('EHLO dylanauto.local', [250]);
    if (!secure && /STARTTLS/i.test(ehlo.text)) {
      await this._cmd('STARTTLS', [220]);
      const plain = this.socket;
      plain.removeAllListeners('data');
      plain.removeAllListeners('close');
      this.buffer = '';
      await new Promise((resolve, reject) => {
        const secureSocket = tls.connect({ socket: plain, servername: host }, resolve);
        secureSocket.once('error', reject);
        this._attach(secureSocket);
      });
      ehlo = await this._cmd('EHLO dylanauto.local', [250]);
    }
    if (this.opts.user) {
      if (/AUTH[ =].*PLAIN/i.test(ehlo.text)) {
        const token = Buffer.from(`\0${this.opts.user}\0${this.opts.pass}`, 'utf8').toString('base64');
        await this._cmd(`AUTH PLAIN ${token}`, [235]);
      } else {
        await this._cmd('AUTH LOGIN', [334]);
        await this._cmd(Buffer.from(this.opts.user, 'utf8').toString('base64'), [334]);
        await this._cmd(Buffer.from(this.opts.pass, 'utf8').toString('base64'), [235]);
      }
    }
  }

  async send(from, recipients, data) {
    await this._cmd(`MAIL FROM:<${extractEmail(from)}>`, [250]);
    for (const r of recipients) await this._cmd(`RCPT TO:<${extractEmail(r)}>`, [250, 251]);
    await this._cmd('DATA', [354]);
    // Transparence : une ligne commençant par "." est doublée
    const body = data.replace(/\r\n\./g, '\r\n..');
    await this._cmd(body + '\r\n.', [250]);
  }

  async quit() {
    try { await this._cmd('QUIT', [221]); } catch (_) { /* ignore */ }
    this.socket.destroy();
  }
}

/**
 * Envoie un email. Si SMTP_HOST n'est pas configuré, l'email est affiché dans la console (mode test).
 */
async function sendMail(msg) {
  const message = { ...msg, from: msg.from || config.smtp.from, to: [].concat(msg.to) };
  if (!config.smtp.host) {
    console.log('\n──────── EMAIL (mode test, SMTP non configuré) ────────');
    console.log(`À      : ${message.to.join(', ')}`);
    console.log(`Sujet  : ${message.subject}`);
    console.log(message.text);
    if (message.attachments?.length) console.log(`Pièces jointes : ${message.attachments.map((a) => a.filename).join(', ')}`);
    console.log('────────────────────────────────────────────────────────\n');
    return { simulated: true };
  }
  const client = new SmtpClient(config.smtp);
  try {
    await client.connect();
    await client.send(message.from, message.to, buildMime(message));
    return { simulated: false };
  } finally {
    await client.quit();
  }
}

module.exports = { sendMail, buildMime };
