'use strict';
// Interface d'administration : émission, registre, révocation
(function () {
  const $ = (sel) => document.querySelector(sel);
  const STATES = { valide: 'Valide', expire: 'Expiré', revoque: 'Révoqué' };
  let docs = [];

  async function api(path, options = {}) {
    const res = await fetch(path, { credentials: 'same-origin', ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data;
  }

  const frDate = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(c ?? ''));
    return node;
  }

  async function loadConfig() {
    const cfg = await api('/api/admin/config');
    $('#issuer').textContent = `${cfg.issuer} — Administration`;
    const notice = $('#url-notice');
    if (!cfg.baseUrlFromEnv || cfg.localOnly) {
      notice.hidden = false;
      notice.append(
        el('strong', {}, 'Attention : '),
        `les QR codes pointent vers `,
        el('code', {}, cfg.baseUrl),
        `. Cette adresse n'est joignable que depuis votre réseau local : un téléphone connecté au même Wi-Fi pourra la scanner, mais pas un destinataire extérieur. Avant d'émettre de vrais documents, mettez le site en ligne et indiquez son adresse dans BASE_URL (fichier .env). Les QR codes déjà émis ne changent pas d'adresse.`,
      );
    }
  }

  function render() {
    const q = $('#search').value.trim().toLowerCase();
    const list = docs.filter((d) => !q || [d.code, d.id, d.title, d.recipient].join(' ').toLowerCase().includes(q));
    const tbody = $('#rows');
    tbody.replaceChildren();
    if (!list.length) {
      tbody.append(el('tr', {}, el('td', { colspan: '7', class: 'muted' }, docs.length ? 'Aucun résultat.' : 'Aucun document émis pour l\'instant.')));
      return;
    }
    for (const d of list) {
      const actions = el('div', { class: 'actions' },
        el('a', { class: 'btn small secondary', href: `/api/admin/documents/${d.id}/pdf` }, 'PDF'),
        el('a', { class: 'btn small secondary', href: d.url, target: '_blank', rel: 'noopener' }, 'Voir la page'),
        d.status === 'revoque'
          ? el('button', { class: 'btn small secondary', type: 'button', onclick: () => restore(d) }, 'Réactiver')
          : el('button', { class: 'btn small danger', type: 'button', onclick: () => revoke(d) }, 'Révoquer'),
        el('button', { class: 'btn small danger', type: 'button', onclick: () => remove(d) }, 'Supprimer'),
      );
      tbody.append(el('tr', {},
        el('td', { class: 'mono' }, d.code),
        el('td', {}, d.title, d.note ? el('div', { class: 'muted' }, d.note) : ''),
        el('td', {}, d.recipient || '—'),
        el('td', {}, frDate(d.issuedAt), d.expiresAt ? el('div', { class: 'muted' }, `jusqu'au ${frDate(d.expiresAt)}`) : ''),
        el('td', {}, el('span', { class: `pill ${d.state}` }, STATES[d.state] || d.state)),
        el('td', {}, String(d.scans || 0)),
        el('td', {}, actions),
      ));
    }
  }

  async function refresh() {
    docs = await api('/api/admin/documents');
    render();
  }

  async function revoke(d) {
    const reason = prompt(`Révoquer le document ${d.code} « ${d.title} » ?\nLa page de vérification affichera « Document révoqué ».\n\nMotif (facultatif, affiché publiquement) :`, '');
    if (reason === null) return;
    await api(`/api/admin/documents/${d.id}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
    refresh();
  }

  async function restore(d) {
    await api(`/api/admin/documents/${d.id}/restore`, { method: 'POST' });
    refresh();
  }

  async function remove(d) {
    if (!confirm(`Supprimer définitivement le document ${d.code} du registre ?\nSon QR code affichera ensuite « Document non reconnu ». Pour simplement l'annuler, préférez « Révoquer ».`)) return;
    await api(`/api/admin/documents/${d.id}`, { method: 'DELETE' });
    refresh();
  }

  $('#issuedAt').value = new Date().toISOString().slice(0, 10);
  $('#search').addEventListener('input', render);

  $('#issue-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const v = (name) => form.elements.namedItem(name).value;
    const file = form.elements.namedItem('file').files[0];
    $('#form-error').textContent = '';
    if (!file) return;
    const params = new URLSearchParams({
      title: v('title'),
      recipient: v('recipient'),
      issuedAt: v('issuedAt'),
      expiresAt: v('expiresAt'),
      position: v('position'),
      pages: v('pages'),
      note: v('note'),
      filename: file.name,
    });
    const btn = $('#submit');
    btn.disabled = true;
    btn.textContent = 'Traitement…';
    try {
      const doc = await api(`/api/admin/documents?${params}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
      $('#result').hidden = false;
      $('#result-qr').src = `/api/admin/documents/${doc.id}/qr.svg`;
      $('#result-code').textContent = doc.code;
      $('#result-url').textContent = doc.url;
      $('#result-url').href = doc.url;
      $('#result-download').href = `/api/admin/documents/${doc.id}/pdf`;
      form.reset();
      $('#issuedAt').value = new Date().toISOString().slice(0, 10);
      refresh();
    } catch (err) {
      $('#form-error').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ajouter le QR code et enregistrer';
    }
  });

  loadConfig().catch(() => {});
  refresh().catch((err) => { $('#rows').replaceChildren(el('tr', {}, el('td', { colspan: '7', class: 'error' }, err.message))); });
})();
