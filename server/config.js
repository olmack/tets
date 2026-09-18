'use strict';
// Chargement de la configuration : fichier .env + config/garage.json + config/pricing.json
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnv();

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'config', name), 'utf8'));
}

const garage = readJson('garage.json');
const pricing = readJson('pricing.json');

const env = process.env;
const config = {
  root: ROOT,
  port: Number(env.PORT) || 3000,
  siteUrl: (env.SITE_URL || `http://localhost:${Number(env.PORT) || 3000}`).replace(/\/$/, ''),
  ownerEmails: (env.OWNER_EMAIL || garage.email || '').split(',').map((s) => s.trim()).filter(Boolean),
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 587,
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || `${garage.name} <${garage.email}>`,
  },
  admin: {
    user: env.ADMIN_USER || 'admin',
    password: env.ADMIN_PASSWORD || '',
  },
  secretKey: env.SECRET_KEY || 'dev-secret-change-me',
  dbPath: env.DB_PATH || path.join(ROOT, 'data', 'dylan-auto.db'),
  uploadDir: env.UPLOAD_DIR || path.join(ROOT, 'data', 'uploads'),
  garage,
  pricing,
};

config.garage.fullAddress = `${garage.address.street}, ${garage.address.postalCode} ${garage.address.city}`;

module.exports = config;
