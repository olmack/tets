// Espace administration
(function () {
  let data = null;
  let rdvFilter = 'all';
  let devisFilter = 'all';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
  const fmtDateTime = (iso) => { const d = new Date(iso.replace(' ', 'T') + 'Z'); return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); };
  const todayStr = new Date().toISOString().slice(0, 10);
  const LABELS = { en_attente: 'À confirmer', confirme: 'Confirmé', annule: 'Annulé', termine: 'Terminé', nouveau: 'Nouveau', traite: 'Traité', accepte: 'Accepté', refuse: 'Refusé', lu: 'Lu' };
  const status = (s) => `<span class="status s-${s}">${LABELS[s] || s}</span>`;

  async function load() {
    try {
      data = await DA.api('/api/admin/overview');
    } catch (e) {
      document.querySelector('main').innerHTML = `<p class="alert alert-err show">Erreur : ${esc(e.message)}</p>`;
      return;
    }
    document.getElementById('smtp-banner').style.display = data.smtpConfigured ? 'none' : 'block';
    document.getElementById('k-pending').textContent = data.stats.pendingAppointments;
    document.getElementById('k-today').textContent = data.stats.todayAppointments;
    document.getElementById('k-quotes').textContent = data.stats.newQuotes;
    document.getElementById('k-messages').textContent = data.stats.newMessages;
    document.getElementById('p-rdv').textContent = data.stats.pendingAppointments || '';
    document.getElementById('p-devis').textContent = data.stats.newQuotes || '';
    document.getElementById('p-messages').textContent = data.stats.newMessages || '';
    renderRdv(); renderDevis(); renderMessages(); renderClosures();
  }

  function renderRdv() {
    let list = data.appointments;
    if (rdvFilter === 'past') list = data.pastAppointments;
    else if (rdvFilter === 'today') list = list.filter((a) => a.date === todayStr);
    else if (rdvFilter !== 'all') list = list.filter((a) => a.status === rdvFilter);
    document.getElementById('rdv-body').innerHTML = list.length ? list.map((a) => `<tr>
      <td><strong>${fmtDate(a.date)}</strong><br>${a.time}<br><span class="muted" style="font-size:0.78rem">${esc(a.reference)}</span></td>
      <td><strong>${esc(a.name)}</strong><br><a href="tel:${esc(a.phone)}">${esc(a.phone)}</a><br><a href="mailto:${esc(a.email)}">${esc(a.email)}</a></td>
      <td>${esc(a.vehicle || '–')}<br><span class="muted">${esc(a.plate || '')}</span></td>
      <td>${esc(a.service)}${a.message ? `<pre class="msg muted" style="font-size:0.8rem;margin-top:4px">${esc(a.message)}</pre>` : ''}</td>
      <td>${status(a.status)}</td>
      <td><div class="actions">
        ${a.status !== 'confirme' && a.status !== 'termine' ? `<button class="ok" data-act="rdv-status" data-id="${a.id}" data-status="confirme">✔ Confirmer</button>` : ''}
        ${a.status === 'confirme' ? `<button data-act="rdv-status" data-id="${a.id}" data-status="termine">Terminé</button>` : ''}
        ${a.status !== 'annule' ? `<button class="ko" data-act="rdv-status" data-id="${a.id}" data-status="annule">✖ Annuler</button>` : ''}
        <button data-act="rdv-delete" data-id="${a.id}">🗑</button>
      </div></td></tr>`).join('') : '<tr><td colspan="6" class="muted center">Aucun rendez-vous.</td></tr>';
  }

  function renderDevis() {
    let list = data.quotes;
    if (devisFilter !== 'all') list = list.filter((q) => q.status === devisFilter);
    document.getElementById('devis-body').innerHTML = list.length ? list.map((q) => `<tr>
      <td><strong>${esc(q.reference)}</strong><br><span class="muted" style="font-size:0.78rem">${fmtDateTime(q.created_at)}</span></td>
      <td><strong>${esc(q.name)}</strong><br><a href="tel:${esc(q.phone)}">${esc(q.phone)}</a><br><a href="mailto:${esc(q.email)}">${esc(q.email)}</a></td>
      <td>${esc([q.vehicle_brand, q.vehicle_model, q.vehicle_year].filter(Boolean).join(' ') || '–')}<br><span class="muted">${esc(q.vehicle_plate || '')} ${q.vehicle_km ? `· ${esc(q.vehicle_km)} km` : ''}</span></td>
      <td><ul class="items-mini">${q.items.map((i) => `<li>${esc(i.label)}${i.quantity > 1 ? ` × ${i.quantity}` : ''}</li>`).join('')}</ul>${q.message ? `<pre class="msg muted" style="font-size:0.8rem;margin-top:4px">${esc(q.message)}</pre>` : ''}${q.photos.length ? `<span class="muted" style="font-size:0.78rem">📷 ${q.photos.length} photo(s) reçue(s) par email</span>` : ''}</td>
      <td><strong>${DA.euro(q.total_ttc)}</strong></td>
      <td>${status(q.status)}</td>
      <td><div class="actions">
        <a href="/api/admin/quotes/${q.id}/pdf" target="_blank">📄 PDF</a>
        ${q.status === 'nouveau' ? `<button class="ok" data-act="devis-status" data-id="${q.id}" data-status="traite">Traité</button>` : ''}
        ${q.status !== 'accepte' ? `<button class="ok" data-act="devis-status" data-id="${q.id}" data-status="accepte">Accepté</button>` : ''}
        ${q.status !== 'refuse' ? `<button class="ko" data-act="devis-status" data-id="${q.id}" data-status="refuse">Refusé</button>` : ''}
        <button data-act="devis-delete" data-id="${q.id}">🗑</button>
      </div></td></tr>`).join('') : '<tr><td colspan="7" class="muted center">Aucun devis.</td></tr>';
  }

  function renderMessages() {
    const list = data.messages;
    document.getElementById('messages-body').innerHTML = list.length ? list.map((m) => `<tr>
      <td>${fmtDateTime(m.created_at)}</td>
      <td><strong>${esc(m.name)}</strong><br><a href="mailto:${esc(m.email)}">${esc(m.email)}</a>${m.phone ? `<br><a href="tel:${esc(m.phone)}">${esc(m.phone)}</a>` : ''}</td>
      <td><strong>${esc(m.subject || '')}</strong><pre class="msg">${esc(m.message)}</pre></td>
      <td>${status(m.status)}</td>
      <td><div class="actions">
        <a href="mailto:${esc(m.email)}?subject=${encodeURIComponent('Re: ' + (m.subject || 'votre message') + ' – DYLAN AUTO')}">↩ Répondre</a>
        ${m.status === 'nouveau' ? `<button data-act="msg-status" data-id="${m.id}" data-status="lu">Lu</button>` : ''}
        ${m.status !== 'traite' ? `<button class="ok" data-act="msg-status" data-id="${m.id}" data-status="traite">Traité</button>` : ''}
        <button data-act="msg-delete" data-id="${m.id}">🗑</button>
      </div></td></tr>`).join('') : '<tr><td colspan="5" class="muted center">Aucun message.</td></tr>';
  }

  function renderClosures() {
    document.getElementById('closures-body').innerHTML = data.closures.length ? data.closures.map((c) => `<tr><td>${fmtDate(c.date)}</td><td>${esc(c.reason || '')}</td><td><div class="actions"><button class="ko" data-act="closure-delete" data-id="${c.id}">Réouvrir</button></div></td></tr>`).join('') : '<tr><td colspan="3" class="muted center">Aucune fermeture programmée.</td></tr>';
  }

  document.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const { act, id, status: st } = b.dataset;
    const post = (url, body) => DA.api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const del = (url) => DA.api(url, { method: 'DELETE' });
    try {
      b.disabled = true;
      if (act === 'rdv-status') {
        if (st === 'annule' && !confirm('Annuler ce rendez-vous ? Le client recevra un email d’annulation.')) return;
        await post(`/api/admin/appointments/${id}/status`, { status: st });
      } else if (act === 'rdv-delete') { if (!confirm('Supprimer définitivement ce rendez-vous (sans prévenir le client) ?')) return; await del(`/api/admin/appointments/${id}`); }
      else if (act === 'devis-status') await post(`/api/admin/quotes/${id}/status`, { status: st });
      else if (act === 'devis-delete') { if (!confirm('Supprimer ce devis ?')) return; await del(`/api/admin/quotes/${id}`); }
      else if (act === 'msg-status') await post(`/api/admin/messages/${id}/status`, { status: st });
      else if (act === 'msg-delete') { if (!confirm('Supprimer ce message ?')) return; await del(`/api/admin/messages/${id}`); }
      else if (act === 'closure-delete') await del(`/api/admin/closures/${id}`);
      await load();
    } catch (err) { alert(err.message); } finally { b.disabled = false; }
  });

  document.getElementById('closure-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const from = document.getElementById('cl-from').value;
    const to = document.getElementById('cl-to').value || from;
    try {
      await DA.api('/api/admin/closures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to, reason: document.getElementById('cl-reason').value }) });
      e.target.reset(); document.getElementById('cl-reason').value = 'Congés';
      await load();
    } catch (err) { alert(err.message); }
  });

  document.getElementById('refresh').addEventListener('click', load);
  document.getElementById('test-email').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Envoi…';
    try {
      const r = await DA.api('/api/admin/test-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      alert(r.simulated ? 'SMTP non configuré : l’email a été affiché dans la console du serveur.' : 'Email de test envoyé ! Vérifiez votre boîte de réception.');
    } catch (err) { alert('Échec de l’envoi : ' + err.message); } finally { b.disabled = false; b.textContent = '✉️ Tester l’envoi d’email'; }
  });

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${b.dataset.tab}`));
    history.replaceState(null, '', `#${b.dataset.tab}`);
  }));
  document.getElementById('rdv-filter').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; rdvFilter = b.dataset.f; e.currentTarget.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); renderRdv(); });
  document.getElementById('devis-filter').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; devisFilter = b.dataset.f; e.currentTarget.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); renderDevis(); });
  const hash = location.hash.slice(1);
  if (hash) document.querySelector(`.tabs button[data-tab="${hash}"]`)?.click();
  load();
  setInterval(load, 120000);
})();
