'use strict';
// Modèles d'emails (dirigeant + client)
const config = require('./config');
const { sendMail } = require('./smtp');
const { escapeHtml, euro, formatDateFr } = require('./utils');

const g = config.garage;

function layout(title, bodyHtml) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#111827;padding:22px 28px">
  <div style="font-size:22px;font-weight:bold;color:#fff;letter-spacing:1px">${escapeHtml(g.name)}</div>
  <div style="font-size:13px;color:#d1d5db;margin-top:4px">${escapeHtml(g.tagline)}</div>
</td></tr>
<tr><td style="padding:28px">
  <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
  ${bodyHtml}
</td></tr>
<tr><td style="background:#f9fafb;padding:18px 28px;font-size:12px;color:#6b7280;line-height:1.6">
  ${escapeHtml(g.legalName)} · ${escapeHtml(g.fullAddress)}<br>
  Tél. <a href="tel:${g.phone.replace(/\s/g, '')}" style="color:#6b7280">${escapeHtml(g.phone)}</a> · <a href="mailto:${g.email}" style="color:#6b7280">${escapeHtml(g.email)}</a><br>
  <a href="${config.siteUrl}" style="color:#6b7280">${config.siteUrl}</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

function rows(pairs) {
  return `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px">${pairs
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<tr><td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;color:#6b7280;width:38%;vertical-align:top">${escapeHtml(k)}</td><td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`)
    .join('')}</table>`;
}
function rowsText(pairs) {
  return pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k} : ${v}`).join('\n');
}
function button(href, label) {
  return `<p style="margin:20px 0"><a href="${href}" style="display:inline-block;background:#f59e0b;color:#111827;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:8px">${escapeHtml(label)}</a></p>`;
}

const STATUS_LABELS = { en_attente: 'En attente de confirmation', confirme: 'Confirmé', annule: 'Annulé', termine: 'Terminé' };

// ---------- CONTACT ----------
async function contactEmails(msg) {
  const pairs = [['Nom', msg.name], ['Email', msg.email], ['Téléphone', msg.phone], ['Sujet', msg.subject], ['Message', msg.message]];
  await sendMail({
    to: config.ownerEmails,
    replyTo: `${msg.name} <${msg.email}>`,
    subject: `[Site] Nouveau message de ${msg.name}${msg.subject ? ` – ${msg.subject}` : ''}`,
    text: `Nouveau message reçu depuis le site web.\n\n${rowsText(pairs)}\n\nRépondez directement à cet email pour contacter le client.`,
    html: layout('Nouveau message depuis le site', `${rows(pairs)}<p style="font-size:13px;color:#6b7280">Répondez directement à cet email pour contacter le client.</p>${button(`${config.siteUrl}/admin/#messages`, 'Ouvrir l’espace administration')}`),
  });
  await sendMail({
    to: [msg.email],
    subject: `${g.name} – Nous avons bien reçu votre message`,
    text: `Bonjour ${msg.name},\n\nNous avons bien reçu votre message et nous vous répondrons dans les plus brefs délais (généralement sous 24h ouvrées).\n\nPour toute urgence, appelez-nous au ${g.phone}.\n\nÀ bientôt,\nL'équipe ${g.name}`,
    html: layout('Message bien reçu', `<p>Bonjour ${escapeHtml(msg.name)},</p><p>Nous avons bien reçu votre message et nous vous répondrons dans les plus brefs délais (généralement sous 24h ouvrées).</p><p>Pour toute urgence, appelez-nous au <strong>${escapeHtml(g.phone)}</strong>.</p><p>À bientôt,<br>L’équipe ${escapeHtml(g.name)}</p>`),
  });
}

// ---------- DEVIS ----------
function quoteItemsHtml(quote) {
  return `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px">
<tr style="background:#111827;color:#fff"><th align="left" style="padding:8px 10px">Prestation</th><th align="right" style="padding:8px 10px">Qté</th><th align="right" style="padding:8px 10px">Total TTC</th></tr>
${quote.items.map((i) => `<tr><td style="padding:7px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(i.label)}</td><td align="right" style="padding:7px 10px;border-bottom:1px solid #e5e7eb">${i.quantity}</td><td align="right" style="padding:7px 10px;border-bottom:1px solid #e5e7eb">${euro(i.total)}</td></tr>`).join('')}
<tr><td colspan="2" align="right" style="padding:10px;font-weight:bold;background:#fef3c7">TOTAL TTC estimé</td><td align="right" style="padding:10px;font-weight:bold;background:#fef3c7">${euro(quote.total_ttc)}</td></tr>
</table>`;
}
function quoteItemsText(quote) {
  return quote.items.map((i) => `- ${i.label} x${i.quantity} : ${euro(i.total)}`).join('\n') + `\nTOTAL TTC estimé : ${euro(quote.total_ttc)}`;
}

async function quoteEmails(quote, pdfBuffer, photos) {
  const vehicle = [quote.vehicleTypeLabel, quote.vehicle_brand, quote.vehicle_model, quote.vehicle_year, quote.vehicle_plate, quote.vehicle_km ? `${quote.vehicle_km} km` : ''].filter(Boolean).join(' · ');
  const pairs = [['Référence', quote.reference], ['Nom', quote.name], ['Email', quote.email], ['Téléphone', quote.phone], ['Véhicule', vehicle], ['Précisions', quote.message]];
  const attachments = [{ filename: `devis-${quote.reference}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }];
  const ownerAttachments = attachments.concat((photos || []).map((p) => ({ filename: p.filename, content: p.content, contentType: p.contentType })));

  await sendMail({
    to: config.ownerEmails,
    replyTo: `${quote.name} <${quote.email}>`,
    subject: `[Site] Demande de devis ${quote.reference} – ${quote.name} (${euro(quote.total_ttc)})`,
    text: `Nouvelle demande de devis depuis le site.\n\n${rowsText(pairs)}\n\n${quoteItemsText(quote)}\n\nLe PDF du devis estimatif est en pièce jointe.`,
    html: layout(`Demande de devis ${quote.reference}`, `${rows(pairs)}${quoteItemsHtml(quote)}<p style="font-size:13px;color:#6b7280">Le devis estimatif PDF est en pièce jointe${photos?.length ? `, ainsi que ${photos.length} photo(s) envoyée(s) par le client` : ''}. Répondez directement à cet email pour contacter le client.</p>${button(`${config.siteUrl}/admin/#devis`, 'Ouvrir l’espace administration')}`),
    attachments: ownerAttachments,
  });
  await sendMail({
    to: [quote.email],
    subject: `${g.name} – Votre devis estimatif ${quote.reference}`,
    text: `Bonjour ${quote.name},\n\nMerci pour votre demande. Voici votre estimation (le PDF est en pièce jointe) :\n\n${quoteItemsText(quote)}\n\n${config.pricing.note}\n\nNous vous recontactons rapidement pour confirmer le devis et convenir d'un rendez-vous. Vous pouvez aussi prendre rendez-vous directement : ${config.siteUrl}/rendez-vous.html\n\nÀ bientôt,\nL'équipe ${g.name}\n${g.phone}`,
    html: layout('Votre devis estimatif', `<p>Bonjour ${escapeHtml(quote.name)},</p><p>Merci pour votre demande. Voici votre estimation pour votre <strong>${escapeHtml(vehicle)}</strong> (le PDF est en pièce jointe) :</p>${quoteItemsHtml(quote)}<p style="font-size:13px;color:#6b7280">${escapeHtml(config.pricing.note)}</p><p>Nous vous recontactons rapidement pour confirmer le devis et convenir d’un rendez-vous.</p>${button(`${config.siteUrl}/rendez-vous.html`, 'Prendre rendez-vous en ligne')}<p>À bientôt,<br>L’équipe ${escapeHtml(g.name)} · ${escapeHtml(g.phone)}</p>`),
    attachments,
  });
}

// ---------- RENDEZ-VOUS ----------
function apptPairs(a) {
  return [['Référence', a.reference], ['Date', `${formatDateFr(a.date)} à ${a.time}`], ['Nom', a.name], ['Téléphone', a.phone], ['Email', a.email], ['Véhicule', a.vehicle], ['Immatriculation', a.plate], ['Prestation', a.service], ['Message', a.message]];
}

async function appointmentRequestEmails(a, ics) {
  const pairs = apptPairs(a);
  const cancelUrl = `${config.siteUrl}/api/appointments/${a.reference}/cancel?token=${a.cancel_token}`;
  const attachments = [{ filename: `rendez-vous-${a.reference}.ics`, content: Buffer.from(ics, 'utf8'), contentType: 'text/calendar; method=REQUEST' }];
  await sendMail({
    to: config.ownerEmails,
    replyTo: `${a.name} <${a.email}>`,
    subject: `[Site] Nouveau rendez-vous ${formatDateFr(a.date)} ${a.time} – ${a.name}`,
    text: `Nouvelle demande de rendez-vous depuis le site.\n\n${rowsText(pairs)}\n\nConfirmez ou annulez ce rendez-vous dans l'espace administration : ${config.siteUrl}/admin/#rdv`,
    html: layout('Nouvelle demande de rendez-vous', `${rows(pairs)}<p>Le créneau est réservé provisoirement. Confirmez-le (le client recevra un email de confirmation) ou annulez-le depuis l’espace administration.</p>${button(`${config.siteUrl}/admin/#rdv`, 'Gérer les rendez-vous')}`),
    attachments,
  });
  await sendMail({
    to: [a.email],
    subject: `${g.name} – Demande de rendez-vous reçue (${formatDateFr(a.date)} à ${a.time})`,
    text: `Bonjour ${a.name},\n\nNous avons bien reçu votre demande de rendez-vous :\n\n${rowsText(pairs)}\n\nLe garage va confirmer ce rendez-vous très prochainement, vous recevrez un email de confirmation.\n\nAdresse : ${g.fullAddress}\n\nPour annuler : ${cancelUrl}\n\nÀ bientôt,\nL'équipe ${g.name} · ${g.phone}`,
    html: layout('Demande de rendez-vous reçue', `<p>Bonjour ${escapeHtml(a.name)},</p><p>Nous avons bien reçu votre demande de rendez-vous :</p>${rows(pairs)}<p>Le garage va <strong>confirmer</strong> ce rendez-vous très prochainement : vous recevrez un email de confirmation. Une invitation calendrier est jointe à cet email.</p><p><strong>Adresse :</strong> ${escapeHtml(g.fullAddress)}<br><a href="${g.googleMapsUrl}">Itinéraire Google Maps</a></p><p style="font-size:13px;color:#6b7280">Un empêchement ? <a href="${cancelUrl}" style="color:#b91c1c">Annuler ce rendez-vous</a> ou appelez-nous au ${escapeHtml(g.phone)}.</p><p>À bientôt,<br>L’équipe ${escapeHtml(g.name)}</p>`),
    attachments,
  });
}

async function appointmentStatusEmail(a, status, ics) {
  const pairs = apptPairs(a);
  if (status === 'confirme') {
    await sendMail({
      to: [a.email],
      subject: `${g.name} – Rendez-vous confirmé le ${formatDateFr(a.date)} à ${a.time}`,
      text: `Bonjour ${a.name},\n\nVotre rendez-vous est CONFIRMÉ :\n\n${rowsText(pairs)}\n\nAdresse : ${g.fullAddress}\nMerci d'arriver 5 minutes avant l'heure avec la carte grise du véhicule.\n\nÀ bientôt,\nL'équipe ${g.name} · ${g.phone}`,
      html: layout('Rendez-vous confirmé ✔', `<p>Bonjour ${escapeHtml(a.name)},</p><p>Bonne nouvelle : votre rendez-vous est <strong style="color:#15803d">confirmé</strong>.</p>${rows(pairs)}<p><strong>Adresse :</strong> ${escapeHtml(g.fullAddress)} · <a href="${g.googleMapsUrl}">Itinéraire</a></p><p>Merci d’arriver 5 minutes avant l’heure avec la carte grise du véhicule.</p><p>À bientôt,<br>L’équipe ${escapeHtml(g.name)} · ${escapeHtml(g.phone)}</p>`),
      attachments: ics ? [{ filename: `rendez-vous-${a.reference}.ics`, content: Buffer.from(ics, 'utf8'), contentType: 'text/calendar; method=REQUEST' }] : [],
    });
  } else if (status === 'annule') {
    await sendMail({
      to: [a.email],
      subject: `${g.name} – Rendez-vous du ${formatDateFr(a.date)} annulé`,
      text: `Bonjour ${a.name},\n\nVotre rendez-vous du ${formatDateFr(a.date)} à ${a.time} a été annulé.\n\nVous pouvez reprendre rendez-vous à tout moment : ${config.siteUrl}/rendez-vous.html ou par téléphone au ${g.phone}.\n\nL'équipe ${g.name}`,
      html: layout('Rendez-vous annulé', `<p>Bonjour ${escapeHtml(a.name)},</p><p>Votre rendez-vous du <strong>${formatDateFr(a.date)} à ${a.time}</strong> a été annulé.</p>${button(`${config.siteUrl}/rendez-vous.html`, 'Reprendre rendez-vous')}<p>Ou par téléphone au ${escapeHtml(g.phone)}.</p><p>L’équipe ${escapeHtml(g.name)}</p>`),
    });
  }
}

async function appointmentCancelledByClientEmail(a) {
  await sendMail({
    to: config.ownerEmails,
    subject: `[Site] Rendez-vous annulé par le client – ${formatDateFr(a.date)} ${a.time} – ${a.name}`,
    text: `Le client a annulé son rendez-vous.\n\n${rowsText(apptPairs(a))}`,
    html: layout('Rendez-vous annulé par le client', rows(apptPairs(a))),
  });
}

module.exports = { contactEmails, quoteEmails, appointmentRequestEmails, appointmentStatusEmail, appointmentCancelledByClientEmail, STATUS_LABELS };
