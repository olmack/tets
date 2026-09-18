// Générateur de devis : calcul en direct, étapes, barre mobile, envoi
(async function () {
  const form = document.getElementById('devis-form');
  const typesWrap = document.getElementById('vehicle-types');
  const catsWrap = document.getElementById('service-cats');
  const summary = document.getElementById('summary-body');
  const totalEl = document.getElementById('total-ttc');
  const stickyTotal = document.getElementById('sticky-total');
  const submit = document.getElementById('devis-submit');
  const stepper = document.getElementById('stepper');
  const ICONS = { citadine: 'i-car', compacte: 'i-car', suv: 'i-suv', utilitaire: 'i-van', premium: 'i-sport' };
  let pricing;

  try {
    ({ pricing } = await DA.api('/api/config'));
  } catch (e) {
    catsWrap.innerHTML = '<p class="alert alert-err show">Impossible de charger la grille tarifaire. Appelez-nous au 04 34 12 63 91.</p>';
    return;
  }
  document.getElementById('pricing-note').textContent = pricing.note;

  typesWrap.innerHTML = pricing.vehicleTypes.map((v, i) => `<label><input type="radio" name="vehicleType" value="${v.id}" ${i === 0 ? 'checked' : ''}><svg class="ico"><use href="#${ICONS[v.id] || 'i-car'}"/></svg><span>${v.label}</span></label>`).join('');

  catsWrap.innerHTML = pricing.categories.map((cat, i) => `
    <details class="service-cat" ${i === 0 ? 'open' : ''}>
      <summary><span>${cat.label}<span class="count" data-count="${cat.id}" hidden>0</span></span><svg class="ico chev"><use href="#i-chev"/></svg></summary>
      ${cat.services.map((s) => `
        <div class="service-line">
          <label><input type="checkbox" name="svc" value="${s.id}" data-cat="${cat.id}"> <span>${s.label}<br><span class="unit">${s.unit}</span></span></label>
          ${s.quantity ? `<input type="number" name="qty-${s.id}" value="1" min="1" max="${s.max || 10}" inputmode="numeric" aria-label="Quantité" disabled>` : ''}
          <span class="sprice" data-price="${s.id}"></span>
        </div>`).join('')}
    </details>`).join('');

  const coef = () => pricing.vehicleTypes.find((v) => v.id === form.vehicleType.value)?.coef || 1;
  const catalog = {};
  pricing.categories.forEach((c) => c.services.forEach((s) => { catalog[s.id] = s; }));

  function selected() {
    return [...form.querySelectorAll('input[name="svc"]:checked')].map((cb) => {
      const qtyInput = form.querySelector(`[name="qty-${cb.value}"]`);
      return { id: cb.value, quantity: qtyInput ? Number(qtyInput.value) || 1 : 1 };
    });
  }

  function setStep(n) {
    stepper.querySelectorAll('a').forEach((a) => {
      const s = Number(a.dataset.step);
      a.classList.toggle('current', s === n);
      a.classList.toggle('done', s < n);
    });
  }

  function refresh() {
    const c = coef();
    Object.values(catalog).forEach((s) => {
      const el = form.querySelector(`[data-price="${s.id}"]`);
      if (el) el.textContent = `${s.unit === 'à partir de' ? 'dès ' : ''}${DA.euro(Math.round(s.price * c * 100) / 100)}`;
    });
    const counts = {};
    form.querySelectorAll('input[name="svc"]').forEach((cb) => {
      const q = form.querySelector(`[name="qty-${cb.value}"]`);
      if (q) q.disabled = !cb.checked;
      if (cb.checked) counts[cb.dataset.cat] = (counts[cb.dataset.cat] || 0) + 1;
    });
    form.querySelectorAll('[data-count]').forEach((el) => { const n = counts[el.dataset.count] || 0; el.textContent = n; el.hidden = n === 0; });
    const items = selected().map((r) => {
      const s = catalog[r.id];
      const unit = Math.round(s.price * c * 100) / 100;
      return { label: s.label, quantity: r.quantity, total: Math.round(unit * r.quantity * 100) / 100 };
    });
    const total = items.reduce((s, i) => s + i.total, 0);
    totalEl.textContent = DA.euro(total);
    if (stickyTotal) stickyTotal.textContent = DA.euro(total);
    if (items.length === 0) {
      summary.innerHTML = '<p class="empty">Sélectionnez un véhicule et des prestations pour voir votre estimation.</p>';
      return;
    }
    summary.innerHTML = `<table>${items.map((i) => `<tr><td>${i.label}${i.quantity > 1 ? ` <span class="muted">× ${i.quantity}</span>` : ''}</td><td>${DA.euro(i.total)}</td></tr>`).join('')}</table>`;
  }
  form.addEventListener('change', (e) => {
    refresh();
    if (e.target.name === 'vehicleType') setStep(2);
    if (e.target.name === 'svc' && selected().length) { setStep(3); document.getElementById('err-services').classList.remove('show'); }
  });
  form.addEventListener('input', (e) => { if (e.target.type === 'number' && e.target.name.startsWith('qty-')) refresh(); });
  refresh();

  // Étape courante selon la position de défilement
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { const n = Number(en.target.id.replace('etape-', '')); if (n > 1 || !selected().length) setStep(Math.max(n, selected().length ? 3 : 1)); } });
    }, { rootMargin: '-40% 0px -50% 0px' });
    ['etape-1', 'etape-2', 'etape-3'].forEach((id) => io.observe(document.getElementById(id)));
  }

  const stickyBtn = document.getElementById('sticky-submit');
  if (stickyBtn) stickyBtn.addEventListener('click', () => {
    if (!selected().length) { document.getElementById('etape-2').scrollIntoView({ behavior: 'smooth' }); DA.toast('Choisissez d’abord au moins une prestation.'); return; }
    if (!form.name.value || !form.email.value || !form.phone.value) { document.getElementById('etape-3').scrollIntoView({ behavior: 'smooth' }); DA.toast('Renseignez vos coordonnées pour recevoir le devis.'); return; }
    form.requestSubmit();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    DA.clearErrors(form);
    const items = selected();
    if (items.length === 0) {
      document.getElementById('err-services').classList.add('show');
      catsWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      DA.toast('Sélectionnez au moins une prestation.');
      return;
    }
    if (!DA.validateRequired(form)) return;
    const photos = document.getElementById('q-photos').files;
    if (photos.length > 3) { DA.showError(form, { field: 'photos', message: '3 photos maximum.' }); return; }
    for (const f of photos) if (f.size > 5 * 1024 * 1024) { DA.showError(form, { field: 'photos', message: `« ${f.name} » dépasse 5 Mo.` }); return; }

    const fd = new FormData();
    ['name', 'phone', 'email', 'brand', 'model', 'year', 'plate', 'km', 'message', 'website'].forEach((n) => fd.append(n, form[n].value));
    fd.append('vehicleType', form.vehicleType.value);
    fd.append('services', JSON.stringify(items));
    for (const f of photos) fd.append('photos', f, f.name);

    DA.busy(submit, true, 'Génération du devis…');
    if (stickyBtn) DA.busy(stickyBtn, true, 'Envoi…');
    try {
      const r = await DA.api('/api/quotes', { method: 'POST', body: fd });
      form.style.display = 'none';
      stepper.style.display = 'none';
      document.getElementById('sticky-bar')?.remove();
      document.body.classList.remove('has-sticky-bar');
      const box = document.getElementById('devis-result');
      document.getElementById('result-ref').textContent = r.reference;
      document.getElementById('result-items').innerHTML = `<table class="price-table" style="margin-top:12px"><thead><tr><th>Prestation</th><th>Total TTC</th></tr></thead><tbody>${r.items.map((i) => `<tr><td>${i.label}${i.quantity > 1 ? ` × ${i.quantity}` : ''}</td><td>${DA.euro(i.total)}</td></tr>`).join('')}<tr class="cat"><td>Total TTC estimé</td><td>${DA.euro(r.total_ttc)}</td></tr></tbody></table>`;
      box.style.display = 'block';
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      DA.toast('Devis envoyé par email ✔');
    } catch (err) {
      DA.showError(form, err);
    } finally {
      DA.busy(submit, false);
      if (stickyBtn && document.body.contains(stickyBtn)) DA.busy(stickyBtn, false);
    }
  });
})();
