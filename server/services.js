'use strict';
// Logique métier : créneaux, rendez-vous, devis, messages
const crypto = require('crypto');
const config = require('./config');
const { db, nextReference } = require('./db');
const { isFrenchHoliday } = require('./holidays');
const { todayParis, formatDateFr, isValidEmail, isValidPhone, clean } = require('./utils');
const { buildQuotePdf } = require('./pdf');
const { buildIcs } = require('./ics');
const mailer = require('./mailer');

class ValidationError extends Error {
  constructor(message, field) { super(message); this.status = 400; this.field = field; }
}

const g = config.garage;
const booking = g.booking;

// ---------- CRÉNEAUX ----------
function toMinutes(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function toHHMM(min) { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }

function isValidDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function dayInfo(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const ranges = g.openingHours[String(weekday)] || [];
  const closure = db.prepare('SELECT reason FROM closures WHERE date = ?').get(dateStr);
  let closedReason = null;
  if (ranges.length === 0) closedReason = 'Fermé ce jour';
  else if (closure) closedReason = closure.reason || 'Fermeture exceptionnelle';
  else if (booking.closePublicHolidays && isFrenchHoliday(dateStr)) closedReason = 'Jour férié';
  return { ranges, closedReason };
}

function allSlotsForDay(dateStr) {
  const { ranges, closedReason } = dayInfo(dateStr);
  if (closedReason) return { slots: [], closedReason };
  const slots = [];
  for (const [start, end] of ranges) {
    for (let t = toMinutes(start); t + booking.slotMinutes <= toMinutes(end); t += booking.slotMinutes) slots.push(toHHMM(t));
  }
  return { slots, closedReason: null };
}

function bookedCounts(dateStr) {
  const rows = db.prepare("SELECT time, COUNT(*) AS n FROM appointments WHERE date = ? AND status IN ('en_attente','confirme') GROUP BY time").all(dateStr);
  return Object.fromEntries(rows.map((r) => [r.time, r.n]));
}

function getAvailability(dateStr) {
  if (!isValidDateStr(dateStr)) throw new ValidationError('Date invalide', 'date');
  const now = todayParis();
  const { slots, closedReason } = allSlotsForDay(dateStr);
  const counts = bookedCounts(dateStr);
  const minNotice = toMinutes(now.time) + booking.minNoticeHours * 60;
  const result = slots.map((time) => {
    let available = (counts[time] || 0) < booking.capacityPerSlot;
    if (dateStr < now.date) available = false;
    if (dateStr === now.date && toMinutes(time) < minNotice) available = false;
    return { time, available };
  });
  return { date: dateStr, label: formatDateFr(dateStr), closedReason, slots: result };
}

function getMonthAvailability(year, month) {
  const days = [];
  const now = todayParis();
  const maxDate = new Date(Date.now() + booking.maxDaysAhead * 86400000).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= last; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const { slots, closedReason } = allSlotsForDay(dateStr);
    let free = 0;
    if (!closedReason && dateStr >= now.date && dateStr <= maxDate) {
      const counts = bookedCounts(dateStr);
      const minNotice = toMinutes(now.time) + booking.minNoticeHours * 60;
      free = slots.filter((t) => (counts[t] || 0) < booking.capacityPerSlot && !(dateStr === now.date && toMinutes(t) < minNotice)).length;
    }
    days.push({ date: dateStr, closed: Boolean(closedReason), closedReason, free, past: dateStr < now.date, tooFar: dateStr > maxDate });
  }
  return { year, month, days };
}

// ---------- RENDEZ-VOUS ----------
async function createAppointment(input, ip) {
  const a = {
    date: clean(input.date, 10), time: clean(input.time, 5),
    name: clean(input.name, 120), email: clean(input.email, 200).toLowerCase(), phone: clean(input.phone, 30),
    vehicle: clean(input.vehicle, 120), plate: clean(input.plate, 20).toUpperCase(),
    service: clean(input.service, 200), message: clean(input.message, 2000),
  };
  if (a.name.length < 2) throw new ValidationError('Merci d’indiquer votre nom.', 'name');
  if (!isValidEmail(a.email)) throw new ValidationError('Adresse email invalide.', 'email');
  if (!isValidPhone(a.phone)) throw new ValidationError('Numéro de téléphone invalide.', 'phone');
  if (!a.service) throw new ValidationError('Merci de choisir une prestation.', 'service');
  if (!isValidDateStr(a.date)) throw new ValidationError('Date invalide.', 'date');
  const maxDate = new Date(Date.now() + booking.maxDaysAhead * 86400000).toISOString().slice(0, 10);
  if (a.date > maxDate) throw new ValidationError(`Les rendez-vous sont ouverts jusqu’à ${booking.maxDaysAhead} jours à l’avance.`, 'date');
  const availability = getAvailability(a.date);
  if (availability.closedReason) throw new ValidationError(`Le garage est fermé ce jour (${availability.closedReason}).`, 'date');
  const slot = availability.slots.find((s) => s.time === a.time);
  if (!slot) throw new ValidationError('Créneau horaire invalide.', 'time');
  if (!slot.available) throw new ValidationError('Ce créneau vient d’être réservé, merci d’en choisir un autre.', 'time');

  const reference = nextReference('RDV');
  const cancel_token = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO appointments (reference, date, time, name, email, phone, vehicle, plate, service, message, cancel_token, ip)
    VALUES (@reference, @date, @time, @name, @email, @phone, @vehicle, @plate, @service, @message, @cancel_token, @ip)`)
    .run({ ...a, reference, cancel_token, ip: ip || null });
  const saved = db.prepare('SELECT * FROM appointments WHERE reference = ?').get(reference);
  const ics = buildAppointmentIcs(saved);
  safeMail(() => mailer.appointmentRequestEmails(saved, ics));
  return { reference, date: saved.date, time: saved.time, label: formatDateFr(saved.date) };
}

function buildAppointmentIcs(a) {
  return buildIcs({
    uid: `${a.reference}@dylanauto`, date: a.date, time: a.time, durationMinutes: booking.slotMinutes,
    summary: `Rendez-vous ${g.name} – ${a.service}`,
    description: `Rendez-vous ${a.reference}\nPrestation : ${a.service}\nVéhicule : ${a.vehicle || '-'} ${a.plate || ''}\nTél. garage : ${g.phone}`,
    location: g.fullAddress, organizerEmail: g.email, organizerName: g.name,
  });
}

function setAppointmentStatus(id, status) {
  if (!['en_attente', 'confirme', 'annule', 'termine'].includes(status)) throw new ValidationError('Statut invalide.');
  const a = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!a) throw Object.assign(new Error('Rendez-vous introuvable'), { status: 404 });
  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, id);
  if (status !== a.status && (status === 'confirme' || status === 'annule')) {
    safeMail(() => mailer.appointmentStatusEmail({ ...a, status }, status, status === 'confirme' ? buildAppointmentIcs(a) : null));
  }
  return { ...a, status };
}

function cancelByClient(reference, token) {
  const a = db.prepare('SELECT * FROM appointments WHERE reference = ?').get(reference);
  if (!a || !token || a.cancel_token !== token) return { ok: false, reason: 'Lien d’annulation invalide.' };
  if (a.status === 'annule') return { ok: true, already: true, appointment: a };
  db.prepare("UPDATE appointments SET status = 'annule' WHERE id = ?").run(a.id);
  safeMail(() => mailer.appointmentCancelledByClientEmail(a));
  return { ok: true, appointment: a };
}

// ---------- DEVIS ----------
function computeQuote(vehicleTypeId, requested) {
  const vt = config.pricing.vehicleTypes.find((v) => v.id === vehicleTypeId);
  if (!vt) throw new ValidationError('Type de véhicule invalide.', 'vehicleType');
  const catalog = new Map();
  for (const cat of config.pricing.categories) for (const s of cat.services) catalog.set(s.id, { ...s, category: cat.label });
  const items = [];
  for (const r of requested || []) {
    const s = catalog.get(r.id);
    if (!s) continue;
    let qty = s.quantity ? Math.max(1, Math.min(s.max || 10, Math.round(Number(r.quantity) || 1))) : 1;
    const unitPrice = Math.round(s.price * vt.coef * 100) / 100;
    items.push({ id: s.id, label: s.label, category: s.category, unit: s.unit, quantity: qty, unitPrice, total: Math.round(unitPrice * qty * 100) / 100 });
  }
  if (items.length === 0) throw new ValidationError('Sélectionnez au moins une prestation.', 'services');
  if (items.length > 30) throw new ValidationError('Trop de prestations sélectionnées.', 'services');
  const total_ttc = Math.round(items.reduce((s, i) => s + i.total, 0) * 100) / 100;
  const total_ht = Math.round((total_ttc / (1 + g.vatRate)) * 100) / 100;
  const total_tva = Math.round((total_ttc - total_ht) * 100) / 100;
  return { vehicleType: vt, items, total_ht, total_tva, total_ttc };
}

async function createQuote(input, photos, ip) {
  const q = {
    name: clean(input.name, 120), email: clean(input.email, 200).toLowerCase(), phone: clean(input.phone, 30),
    vehicle_type: clean(input.vehicleType, 40), vehicle_brand: clean(input.brand, 60), vehicle_model: clean(input.model, 60),
    vehicle_year: clean(input.year, 4), vehicle_plate: clean(input.plate, 20).toUpperCase(), vehicle_km: clean(input.km, 10),
    message: clean(input.message, 2000),
  };
  if (q.name.length < 2) throw new ValidationError('Merci d’indiquer votre nom.', 'name');
  if (!isValidEmail(q.email)) throw new ValidationError('Adresse email invalide.', 'email');
  if (!isValidPhone(q.phone)) throw new ValidationError('Numéro de téléphone invalide.', 'phone');
  let requested = input.services;
  if (typeof requested === 'string') { try { requested = JSON.parse(requested); } catch { requested = []; } }
  if (!Array.isArray(requested)) requested = [];
  const computed = computeQuote(q.vehicle_type, requested);

  const reference = nextReference('DEV');
  const photoNames = (photos || []).map((p) => p.filename);
  db.prepare(`INSERT INTO quotes (reference, name, email, phone, vehicle_type, vehicle_brand, vehicle_model, vehicle_year, vehicle_plate, vehicle_km, items_json, total_ht, total_tva, total_ttc, message, photos_json, ip)
    VALUES (@reference, @name, @email, @phone, @vehicle_type, @vehicle_brand, @vehicle_model, @vehicle_year, @vehicle_plate, @vehicle_km, @items_json, @total_ht, @total_tva, @total_ttc, @message, @photos_json, @ip)`)
    .run({ ...q, reference, items_json: JSON.stringify(computed.items), total_ht: computed.total_ht, total_tva: computed.total_tva, total_ttc: computed.total_ttc, photos_json: JSON.stringify(photoNames), ip: ip || null });

  const full = { ...q, reference, ...computed, vehicleTypeLabel: computed.vehicleType.label, dateLabel: formatDateFr(todayParis().date), vatRate: g.vatRate, pricingNote: config.pricing.note };
  const pdf = buildQuotePdf(full, g);
  safeMail(() => mailer.quoteEmails(full, pdf, photos));
  return { reference, items: computed.items, total_ht: computed.total_ht, total_tva: computed.total_tva, total_ttc: computed.total_ttc };
}

function quotePdfById(id) {
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!q) return null;
  const vt = config.pricing.vehicleTypes.find((v) => v.id === q.vehicle_type);
  const full = { ...q, items: JSON.parse(q.items_json), vehicleTypeLabel: vt ? vt.label : q.vehicle_type, dateLabel: formatDateFr(q.created_at.slice(0, 10)), vatRate: g.vatRate, pricingNote: config.pricing.note };
  return { reference: q.reference, pdf: buildQuotePdf(full, g) };
}

// ---------- CONTACT ----------
async function createMessage(input, ip) {
  const m = { name: clean(input.name, 120), email: clean(input.email, 200).toLowerCase(), phone: clean(input.phone, 30), subject: clean(input.subject, 150), message: clean(input.message, 4000) };
  if (m.name.length < 2) throw new ValidationError('Merci d’indiquer votre nom.', 'name');
  if (!isValidEmail(m.email)) throw new ValidationError('Adresse email invalide.', 'email');
  if (m.phone && !isValidPhone(m.phone)) throw new ValidationError('Numéro de téléphone invalide.', 'phone');
  if (m.message.length < 10) throw new ValidationError('Votre message est trop court.', 'message');
  const { lastInsertRowid } = db.prepare('INSERT INTO messages (name, email, phone, subject, message, ip) VALUES (@name, @email, @phone, @subject, @message, @ip)').run({ ...m, ip: ip || null });
  safeMail(() => mailer.contactEmails(m));
  return { id: Number(lastInsertRowid) };
}

function safeMail(fn) {
  // Les emails partent en arrière-plan : une panne SMTP n'empêche jamais l'enregistrement de la demande.
  Promise.resolve().then(fn).catch((err) => console.error('[email] Échec d’envoi :', err.message));
}

module.exports = { ValidationError, getAvailability, getMonthAvailability, createAppointment, setAppointmentStatus, cancelByClient, computeQuote, createQuote, quotePdfById, createMessage, isValidDateStr };
