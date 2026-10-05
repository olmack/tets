'use strict';
// Pages HTML générées côté serveur (page de vérification affichée après le scan du QR code)

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function frDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function layout(title, body, { issuer, scripts = [] } = {}) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="topbar"><a href="/" class="brand"><img src="/favicon.svg" alt="" width="28" height="28"> ${esc(issuer)}</a></header>
<main class="wrap">
${body}
</main>
<footer class="foot">Service de vérification des documents émis par ${esc(issuer)}</footer>
${scripts.map((s) => `<script src="${esc(s)}" defer></script>`).join('\n')}
</body>
</html>`;
}

function documentStatus(doc, today = new Date().toISOString().slice(0, 10)) {
  if (!doc) return 'introuvable';
  if (doc.status === 'revoque') return 'revoque';
  if (doc.expiresAt && today > doc.expiresAt) return 'expire';
  return 'valide';
}

const STATUS = {
  valide: { cls: 'ok', icon: '✓', title: 'Document authentique', text: (issuer) => `Ce document a bien été émis par ${issuer} et il est toujours valide.` },
  expire: { cls: 'warn', icon: '!', title: 'Document expiré', text: (issuer) => `Ce document a bien été émis par ${issuer}, mais sa date de validité est dépassée.` },
  revoque: { cls: 'bad', icon: '✕', title: 'Document révoqué', text: (issuer) => `Ce document a été émis par ${issuer} mais il a été annulé. Il n'est plus valable.` },
  introuvable: { cls: 'bad', icon: '✕', title: 'Document non reconnu', text: (issuer) => `Aucun document ne correspond à ce code dans le registre de ${issuer}. Ce document n'est pas authentique, ou le code a été mal saisi.` },
};

function verifyPage(doc, { issuer, code, formatId }) {
  const st = documentStatus(doc);
  const s = STATUS[st];
  let details = '';
  if (doc) {
    const rows = [
      ['N° du document', formatId(doc.id)],
      ['Intitulé', doc.title],
      doc.recipient && ['Délivré à', doc.recipient],
      ['Date d\'émission', frDate(doc.issuedAt)],
      doc.expiresAt && ['Valable jusqu\'au', frDate(doc.expiresAt)],
      st === 'revoque' && doc.revokedAt && ['Révoqué le', frDate(doc.revokedAt)],
      st === 'revoque' && doc.revokeReason && ['Motif', doc.revokeReason],
      doc.pageCount && ['Nombre de pages', String(doc.pageCount)],
    ].filter(Boolean);
    details = `
  <dl class="details">
    ${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('\n    ')}
  </dl>
  <p class="hint">Vérifiez que ces informations correspondent exactement au document que vous avez sous les yeux.</p>`;
  }
  const fileCheck = doc && st !== 'introuvable' ? `
<section class="card filecheck" data-id="${esc(doc.id)}">
  <h2>Vous avez le fichier PDF ?</h2>
  <p>Sélectionnez-le pour vérifier qu'il n'a pas été modifié, même d'un seul caractère. Le contrôle compare l'empreinte numérique du fichier à celle de l'original.</p>
  <label class="btn"><input type="file" accept="application/pdf,.pdf" hidden> Choisir le fichier PDF</label>
  <p class="filecheck-result" role="status" aria-live="polite"></p>
</section>` : `
<section class="card">
  <h2>Saisir un autre code</h2>
  ${lookupForm(code)}
</section>`;
  const body = `
<section class="card status ${s.cls}">
  <div class="status-icon" aria-hidden="true">${s.icon}</div>
  <h1>${esc(s.title)}</h1>
  <p class="lead">${esc(s.text(issuer))}</p>
  ${details}
</section>
${fileCheck}`;
  return layout(`${s.title} — ${issuer}`, body, { issuer, scripts: doc ? ['/verify.js'] : [] });
}

function lookupForm(code = '') {
  return `<form action="/v" method="get" class="lookup">
    <label for="code">Numéro du document</label>
    <div class="row"><input id="code" name="code" value="${esc(code)}" placeholder="ex. K7Q2-M9XD-4TPA" autocomplete="off" autocapitalize="characters" required>
    <button class="btn" type="submit">Vérifier</button></div>
  </form>`;
}

function homePage({ issuer }) {
  const body = `
<section class="card">
  <h1>Vérifier un document</h1>
  <p class="lead">Les documents PDF émis par ${esc(issuer)} portent un QR code. Scannez-le avec l'appareil photo de votre téléphone : vous arriverez directement sur la page qui confirme si le document est authentique.</p>
  <p>Pas de téléphone sous la main ? Saisissez le numéro inscrit sous le QR code :</p>
  ${lookupForm()}
</section>`;
  return layout(`Vérification de documents — ${issuer}`, body, { issuer });
}

function messagePage(title, text, { issuer }) {
  return layout(title, `<section class="card"><h1>${esc(title)}</h1><p class="lead">${esc(text)}</p><p><a href="/">Retour à l'accueil</a></p></section>`, { issuer });
}

module.exports = { verifyPage, homePage, messagePage, documentStatus, esc };
