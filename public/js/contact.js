// Formulaire de contact
(function () {
  const form = document.getElementById('contact-form');
  const submit = document.getElementById('contact-submit');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    DA.clearErrors(form);
    if (!DA.validateRequired(form)) return;
    const payload = {};
    ['name', 'phone', 'email', 'subject', 'message', 'website'].forEach((n) => { payload[n] = form[n].value; });
    DA.busy(submit, true);
    try {
      await DA.api('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      form.reset();
      document.getElementById('contact-ok').classList.add('show');
      submit.style.display = 'none';
    } catch (err) {
      DA.showError(form, err);
    } finally {
      DA.busy(submit, false);
    }
  });
})();
