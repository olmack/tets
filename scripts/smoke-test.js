'use strict';
// Test de bout en bout : démarre le serveur sur une base temporaire et vérifie toutes les fonctionnalités.
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dylan-auto-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.SMTP_HOST = '';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'test-password';
process.env.PORT = '0';

const { server } = require('../server/index.js');
const { buildMime } = require('../server/smtp.js');

const json = (method, url, body, headers = {}) => fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
const auth = { Authorization: 'Basic ' + Buffer.from('admin:test-password').toString('base64') };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const step = (name) => console.log(`  ✔ ${name}`);
  console.log('\nTests DYLAN AUTO\n');

  // Pages
  for (const p of ['/', '/services.html', '/devis.html', '/rendez-vous.html', '/contact.html', '/mentions-legales.html']) {
    const res = await fetch(base + p);
    const html = await res.text();
    assert.strictEqual(res.status, 200, p);
    assert(html.includes('class="header"') && html.includes('<footer class="footer">'), `${p} : en-tête/pied de page injectés`);
    assert(!html.includes('{{header}}'), `${p} : tokens remplacés`);
  }
  step('Pages publiques servies avec en-tête et pied de page');
  assert.strictEqual((await fetch(base + '/inexistante')).status, 404);
  assert.strictEqual((await fetch(base + '/partials/header.html')).status, 403);
  assert.strictEqual((await fetch(base + '/../package.json')).status, 404);
  step('404 et protections des chemins');

  // Config
  const cfg = await (await fetch(base + '/api/config')).json();
  assert(cfg.pricing.categories.length >= 4 && cfg.garage.name === 'DYLAN AUTO');
  step('API config');

  // Devis : calcul
  let r = await json('POST', base + '/api/quotes/compute', { vehicleType: 'suv', services: [{ id: 'vidange' }, { id: 'montage-pneu', quantity: 4 }] });
  let d = await r.json();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(d.items.length, 2);
  assert.strictEqual(d.items[0].unitPrice, 111.25); // 89 * 1.25
  assert.strictEqual(d.items[1].quantity, 4);
  assert.strictEqual(d.total_ttc, 111.25 + 22.5 * 4);
  assert(Math.abs(d.total_ht + d.total_tva - d.total_ttc) < 0.011);
  step('Calcul de devis (coefficient véhicule, quantités, TVA)');

  r = await json('POST', base + '/api/quotes/compute', { vehicleType: 'suv', services: [] });
  assert.strictEqual(r.status, 400);
  step('Devis sans prestation refusé');

  // Devis : envoi multipart avec photo
  const boundary = 'XXTESTBOUNDARY';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const field = (n, v) => `--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`;
  const body = Buffer.concat([
    Buffer.from(field('name', 'Jean Dupont') + field('email', 'jean@example.com') + field('phone', '06 12 34 56 78') + field('vehicleType', 'citadine') + field('brand', 'Renault') + field('model', 'Clio') + field('year', '2018') + field('plate', 'ab-123-cd') + field('km', '85000') + field('message', 'Rayure portière') + field('services', JSON.stringify([{ id: 'rayure', quantity: 2 }, { id: 'polissage' }]))),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="degat.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from('\r\n'),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  r = await fetch(base + '/api/quotes', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body });
  d = await r.json();
  assert.strictEqual(r.status, 201, JSON.stringify(d));
  assert(/^DEV-\d{4}-0001$/.test(d.reference));
  assert.strictEqual(d.total_ttc, 149 * 2 + 199);
  step(`Demande de devis enregistrée (${d.reference}) avec photo`);

  // Pot de miel
  r = await json('POST', base + '/api/contact', { name: 'Bot', email: 'bot@spam.com', message: 'spam spam spam', website: 'http://spam' });
  assert.strictEqual(r.status, 200);
  step('Pot de miel anti-spam');

  // Contact
  r = await json('POST', base + '/api/contact', { name: 'Marie Martin', email: 'marie@example.com', phone: '0612345678', subject: 'Question', message: 'Bonjour, faites-vous les pare-brise ?' });
  assert.strictEqual(r.status, 201);
  r = await json('POST', base + '/api/contact', { name: 'M', email: 'pas-un-email', message: 'court' });
  d = await r.json();
  assert.strictEqual(r.status, 400);
  assert.strictEqual(d.field, 'name');
  step('Formulaire de contact + validation');

  // Disponibilités : trouver le prochain jour ouvré
  const now = new Date();
  const month = await (await fetch(`${base}/api/appointments/availability?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)).json();
  let day = month.days.find((x) => !x.closed && !x.past && !x.tooFar && x.free > 0);
  if (!day) {
    const n2 = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const m2 = await (await fetch(`${base}/api/appointments/availability?year=${n2.getFullYear()}&month=${n2.getMonth() + 1}`)).json();
    day = m2.days.find((x) => !x.closed && !x.past && x.free > 0);
  }
  assert(day, 'un jour disponible existe');
  const avail = await (await fetch(`${base}/api/appointments/availability?date=${day.date}`)).json();
  const slot = avail.slots.find((s) => s.available);
  assert(slot);
  assert(avail.slots.every((s) => /^\d{2}:\d{2}$/.test(s.time)));
  step(`Disponibilités (${day.date}, ${avail.slots.length} créneaux, ${cfg.garage.booking.capacityPerSlot} places/créneau)`);

  // Jour férié et week-end fermés
  const { frenchHolidays } = require('../server/holidays.js');
  const y = now.getFullYear() + 1;
  const lundiPaques = [...frenchHolidays(y)].find((h) => new Date(h + 'T00:00:00Z').getUTCDay() === 1); // lundi de Pâques (ou de Pentecôte)
  const ferie = await (await fetch(`${base}/api/appointments/availability?date=${lundiPaques}`)).json();
  assert.strictEqual(ferie.closedReason, 'Jour férié', lundiPaques);
  const samedi = await (await fetch(`${base}/api/appointments/availability?date=${y}-12-25`)).json(); // 25/12/${y} : vérifie juste que c'est fermé
  assert(samedi.closedReason);
  step(`Jours fériés et week-ends fermés automatiquement (${lundiPaques})`);

  // Réservation jusqu'à saturation du créneau
  const book = (name) => json('POST', base + '/api/appointments', { date: day.date, time: slot.time, name, email: 'client@example.com', phone: '0612345678', service: 'Vidange / révision', vehicle: 'Peugeot 308', plate: 'cd-456-ef' });
  const refs = [];
  for (let i = 0; i < cfg.garage.booking.capacityPerSlot; i++) {
    r = await book(`Client ${i + 1}`); d = await r.json();
    assert.strictEqual(r.status, 201, JSON.stringify(d));
    refs.push(d.reference);
  }
  r = await book('Client de trop'); d = await r.json();
  assert.strictEqual(r.status, 400);
  assert.strictEqual(d.field, 'time');
  const after = await (await fetch(`${base}/api/appointments/availability?date=${day.date}`)).json();
  assert.strictEqual(after.slots.find((s) => s.time === slot.time).available, false);
  step(`Réservation, capacité par créneau respectée (${refs.join(', ')})`);

  // Admin : accès protégé
  assert.strictEqual((await fetch(base + '/admin/')).status, 401);
  assert.strictEqual((await fetch(base + '/api/admin/overview')).status, 401);
  assert.strictEqual((await fetch(base + '/admin/', { headers: { Authorization: 'Basic ' + Buffer.from('admin:mauvais').toString('base64') } })).status, 401);
  assert.strictEqual((await fetch(base + '/admin/', { headers: auth })).status, 200);
  step('Espace admin protégé par mot de passe');

  const ov = await (await fetch(base + '/api/admin/overview', { headers: auth })).json();
  assert.strictEqual(ov.appointments.length, cfg.garage.booking.capacityPerSlot);
  assert.strictEqual(ov.quotes.length, 1);
  assert.strictEqual(ov.quotes[0].photos.length, 1);
  assert.strictEqual(ov.messages.length, 1);
  assert.strictEqual(ov.stats.pendingAppointments, cfg.garage.booking.capacityPerSlot);
  step('Vue d’ensemble admin');

  // Confirmer, annuler (libère le créneau)
  const a1 = ov.appointments[0];
  r = await json('POST', `${base}/api/admin/appointments/${a1.id}/status`, { status: 'confirme' }, auth);
  assert.strictEqual((await r.json()).appointment.status, 'confirme');
  r = await json('POST', `${base}/api/admin/appointments/${ov.appointments[1].id}/status`, { status: 'annule' }, auth);
  assert.strictEqual(r.status, 200);
  const freed = await (await fetch(`${base}/api/appointments/availability?date=${day.date}`)).json();
  assert.strictEqual(freed.slots.find((s) => s.time === slot.time).available, true);
  step('Confirmation / annulation admin, créneau libéré');

  // Annulation client par lien
  const full = await (await fetch(base + '/api/admin/overview', { headers: auth })).json();
  const confirmed = full.appointments.find((a) => a.status === 'confirme');
  r = await fetch(`${base}/api/appointments/${confirmed.reference}/cancel?token=mauvais`);
  assert.strictEqual(r.status, 400);
  r = await fetch(`${base}/api/appointments/${confirmed.reference}/cancel?token=${confirmed.cancel_token}`);
  assert.strictEqual(r.status, 200);
  assert((await r.text()).includes('annulé'));
  step('Annulation par le client via lien sécurisé');

  // Fermetures
  r = await json('POST', base + '/api/admin/closures', { from: day.date, to: day.date, reason: 'Congés test' }, auth);
  assert.strictEqual(r.status, 200);
  const closed = await (await fetch(`${base}/api/appointments/availability?date=${day.date}`)).json();
  assert.strictEqual(closed.closedReason, 'Congés test');
  r = await book('Pendant congés');
  assert.strictEqual(r.status, 400);
  const cl = (await (await fetch(base + '/api/admin/overview', { headers: auth })).json()).closures[0];
  await fetch(`${base}/api/admin/closures/${cl.id}`, { method: 'DELETE', headers: auth });
  step('Fermetures exceptionnelles bloquent les réservations');

  // PDF du devis
  r = await fetch(`${base}/api/admin/quotes/${ov.quotes[0].id}/pdf`, { headers: auth });
  const pdf = Buffer.from(await r.arrayBuffer());
  assert.strictEqual(r.headers.get('content-type'), 'application/pdf');
  assert(pdf.slice(0, 5).toString() === '%PDF-' && pdf.includes('%%EOF') && pdf.length > 2000);
  fs.writeFileSync(path.join(tmp, 'devis.pdf'), pdf);
  step(`PDF du devis généré (${pdf.length} octets → ${path.join(tmp, 'devis.pdf')})`);

  // Statuts devis / messages + suppression
  r = await json('POST', `${base}/api/admin/quotes/${ov.quotes[0].id}/status`, { status: 'accepte' }, auth); assert.strictEqual(r.status, 200);
  r = await json('POST', `${base}/api/admin/messages/${ov.messages[0].id}/status`, { status: 'traite' }, auth); assert.strictEqual(r.status, 200);
  r = await fetch(`${base}/api/admin/messages/${ov.messages[0].id}`, { method: 'DELETE', headers: auth }); assert.strictEqual(r.status, 200);
  step('Statuts et suppression admin');

  // Test email (mode simulé)
  r = await json('POST', base + '/api/admin/test-email', {}, auth);
  assert.strictEqual((await r.json()).simulated, true);
  step('Email de test (mode simulé sans SMTP)');

  // MIME
  const mime = buildMime({ from: 'DYLAN AUTO <a@b.fr>', to: ['c@d.fr'], subject: 'Accents é à', text: 'Bonjour', html: '<p>Bonjour</p>', attachments: [{ filename: 'x.pdf', content: pdf, contentType: 'application/pdf' }] });
  assert(mime.includes('Subject: =?UTF-8?B?') && mime.includes('multipart/mixed') && mime.includes('Content-Disposition: attachment'));
  step('Construction MIME des emails');

  // Limitation de débit
  let last;
  for (let i = 0; i < 6; i++) last = await json('POST', base + '/api/contact', { name: 'Spam Bot', email: 's@s.fr', message: 'message répétitif spam' });
  assert.strictEqual(last.status, 429);
  step('Limitation de débit anti-spam');

  console.log('\n✅ Tous les tests passent.\n');
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((err) => { console.error('\n❌ ÉCHEC :', err); process.exit(1); });
