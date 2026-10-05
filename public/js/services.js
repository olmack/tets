// Page prestations : tableaux de prix générés depuis /api/config
(async function () {
  const wrap = document.getElementById('price-tables');
  try {
    const { pricing } = await DA.api('/api/config');
    document.getElementById('pricing-note').textContent = pricing.note;
    wrap.innerHTML = pricing.categories.map((cat) => `
      <h2 id="${cat.id}" style="margin-top:36px">${cat.label}</h2>
      <table class="price-table">
        <thead><tr><th>Prestation</th><th>Tarif indicatif TTC</th></tr></thead>
        <tbody>${cat.services.map((s) => `<tr><td>${s.label}</td><td>${s.unit === 'à partir de' ? 'dès ' : ''}${DA.euro(s.price)}${s.unit.startsWith('par') ? ` <span class="muted" style="font-weight:400;font-size:0.85rem">${s.unit}</span>` : ''}</td></tr>`).join('')}</tbody>
      </table>`).join('');
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  } catch (e) {
    wrap.innerHTML = '<p class="alert alert-err show">Impossible de charger les tarifs. Appelez-nous au 04 34 12 63 91.</p>';
  }
})();
