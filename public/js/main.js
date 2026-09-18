// Comportements communs : menu mobile, lien actif, statut ouvert/fermé, année du footer
(function () {
  const burger = document.getElementById('burger');
  const nav = document.getElementById('nav');
  if (burger && nav) {
    burger.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', String(open));
    });
  }
  const here = location.pathname.replace(/\/index\.html$/, '/');
  document.querySelectorAll('.nav a').forEach((a) => {
    const href = a.getAttribute('href');
    if (href === here || (href !== '/' && here.startsWith(href))) a.classList.add('active');
  });
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

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
  showError(form, err) {
    form.querySelectorAll('.field-error').forEach((e) => { e.classList.remove('show'); });
    form.querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
    if (err.field) {
      const box = form.querySelector(`#err-${err.field}`);
      const input = form.querySelector(`[name="${err.field}"]`);
      if (box) { box.textContent = err.message; box.classList.add('show'); }
      if (input) { input.classList.add('invalid'); input.focus(); }
      if (box || input) return;
    }
    const alert = form.querySelector('.alert-err');
    if (alert) { alert.textContent = err.message; alert.classList.add('show'); alert.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  },
  clearErrors(form) {
    form.querySelectorAll('.field-error').forEach((e) => e.classList.remove('show'));
    form.querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
    form.querySelectorAll('.alert').forEach((e) => e.classList.remove('show'));
  },
  validateRequired(form) {
    // Validation côté navigateur des champs obligatoires (le serveur revalide tout)
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
    if (first) first.focus();
    return !first;
  },
  busy(button, on, label) {
    if (on) { button.dataset.label = button.textContent; button.disabled = true; button.innerHTML = `<span class="spinner"></span> ${label || 'Envoi en cours…'}`; }
    else { button.disabled = false; button.textContent = button.dataset.label || label; }
  },
};
