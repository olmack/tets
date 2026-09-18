'use strict';
const crypto = require('crypto');
const config = require('./config');

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function formatDateFr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DAYS[dt.getDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}

function todayParis() {
  // Date/heure courante à Paris (le serveur peut être en UTC)
  const fmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const euro = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;

function sign(value) {
  return crypto.createHmac('sha256', config.secretKey).update(String(value)).digest('hex').slice(0, 32);
}

function isValidEmail(s) {
  return typeof s === 'string' && s.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}
function isValidPhone(s) {
  return typeof s === 'string' && /^[+\d][\d\s().-]{6,20}$/.test(s.trim());
}
function clean(s, max = 500) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

module.exports = { formatDateFr, todayParis, escapeHtml, euro, sign, isValidEmail, isValidPhone, clean, MONTHS, DAYS };
