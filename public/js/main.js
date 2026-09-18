// Comportements communs : menu, header, animations, statut ouvert/fermé, helpers formulaires
(function () {
  const burger = document.getElementById('burger');
  const nav = document.getElementById('nav');
  if (burger && nav) {
    burger.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => { if (!nav.contains(e.target) && !burger.contains(e.target) && nav.classList.contains('open')) { nav.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); } });
  }
  const here = location.pathname.replace(/\/index\.html$/, '/');
  document.querySelectorAll('.nav a, .bottom-nav a').forEach((a) => {
    const href = a.getAttribute('href');
    if (href === here) a.classList.add('active');
  });
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // Header compact + bouton retour en haut au défilement
  const header = document.getElementById('header');
  const toTop = document.getElementById('to-top');
  const onScroll = () => {
    if (header) header.classList.toggle('scrolled', window.scrollY > 8);
    if (toTop) toTop.classList.toggle('show', window.scrollY > 600);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if (toTop) toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // Animations d'apparition
  const revealEls = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach((el) => io.observe(el));
  } else revealEls.forEach((el) => el.classList.add('in'));

  // Compteurs animés
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        const el = en.target, target = parseFloat(el.dataset.count), dec = (el.dataset.count.split('.')[1] || '').length, suffix = el.dataset.suffix || '';
        const start = performance.now(), dur = 1400;
        const tick = (t) => { const p = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = (target * e).toFixed(dec).replace('.', ',') + suffix; if (p < 1) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.5 });
    counters.forEach((el) => io.observe(el));
  }

  // Statut ouvert / fermé (horaires Lun–Ven 9–12 / 14–18, heure de Paris)
  const status = document.getElementById('open-status');
  const hours = { 1: [[9, 12], [14, 18]], 2: [[9, 12], [14, 18]], 3: [[9, 12], [14, 18]], 4: [[9, 12], [14, 18]], 5: [[9, 12], [14, 18]] };
  try {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const day = now.getDay();
    const h = now.getHours() + now.getMinutes() / 60;
    const open = (hours[day] || []).some(([a, b]) => h >= a && h < b);
    if (status) {
      status.textContent = open ? 'Ouvert actuellement' : 'Fermé actuellement';
      status.classList.toggle('closed', !open);
    }
    const row = document.querySelector(`#hours-table tr[data-day="${day}"]`);
    if (row) row.classList.add('today');
  } catch (e) { /* ignore */ }
})();

// Helpers partagés par les formulaires
window.DA = {
  async api(path, options = {}) {
    const res = await fetch(path, options);
    let data = {};
    try { data = await res.json(); } catch (e) { /* vide */ }
    if (!res.ok) { const err = new Error(data.error || 'Une erreur est survenue.'); err.field = data.field; throw err; }
    return data;
  },
  euro(n) { return Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }); },
  toast(msg, ms = 3500) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
  },
  showError(form, err) {
    form.querySelectorAll('.field-error').forEach((e) => { e.classList.remove('show'); });
    form.querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
    if (err.field) {
      const box = form.querySelector(`#err-${err.field}`);
      const input = form.querySelector(`[name="${err.field}"]`);
      if (box) { box.textContent = err.message; box.classList.add('show'); }
      if (input) { input.classList.add('invalid'); input.focus(); input.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      if (box || input) return;
    }
    const alert = form.querySelector('.alert-err');
    if (alert) { alert.textContent = err.message; alert.classList.add('show'); alert.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else DA.toast(err.message);
  },
  clearErrors(form) {
    form.querySelectorAll('.field-error').forEach((e) => e.classList.remove('show'));
    form.querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
    form.querySelectorAll('.alert').forEach((e) => e.classList.remove('show'));
  },
  validateRequired(form) {
    let first = null;
    form.querySelectorAll('[required]').forEach((input) => {
      const name = input.name || input.id.replace(/^[a-z]-/, '');
      const box = form.querySelector(`#err-${name}`);
      let msg = '';
      if (input.type === 'checkbox') { if (!input.checked) msg = 'Merci de cocher cette case.'; }
      else if (!input.value.trim()) msg = 'Ce champ est obligatoire.';
      else if (input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.value)) msg = 'Adresse email invalide.';
      else if (input.type === 'tel' && !/^[+\d][\d\s().-]{6,20}$/.test(input.value.trim())) msg = 'Numéro de téléphone invalide.';
      else if (input.minLength > 0 && input.value.trim().length < input.minLength) msg = `Minimum ${input.minLength} caractères.`;
      if (msg) {
        if (box) { box.textContent = msg; box.classList.add('show'); }
        input.classList.add('invalid');
        if (!first) first = input;
      }
    });
    if (first) { first.focus(); first.scrollIntoView({ behavior: 'smooth', block: 'center' }); DA.toast('Merci de vérifier les champs en rouge.'); }
    return !first;
  },
  busy(button, on, label) {
    if (on) { button.dataset.label = button.innerHTML; button.disabled = true; button.innerHTML = `<span class="spinner"></span> ${label || 'Envoi en cours…'}`; }
    else { button.disabled = false; button.innerHTML = button.dataset.label || label; }
  },
};
