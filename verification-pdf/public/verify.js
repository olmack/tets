'use strict';
// Contrôle d'intégrité du fichier PDF sur la page de vérification
(function () {
  const box = document.querySelector('.filecheck');
  if (!box) return;
  const input = box.querySelector('input[type=file]');
  const out = box.querySelector('.filecheck-result');

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    out.className = 'filecheck-result';
    out.textContent = 'Vérification en cours…';
    try {
      const res = await fetch(`/v/${encodeURIComponent(box.dataset.id)}/fichier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      if (data.identique) {
        out.classList.add('ok');
        out.textContent = `✓ Le fichier « ${file.name} » est identique à l'original : il n'a pas été modifié.`;
      } else {
        out.classList.add('bad');
        out.textContent = `✕ Le fichier « ${file.name} » ne correspond pas à l'original : il a été modifié, ou ce n'est pas le bon fichier.`;
      }
    } catch (err) {
      out.classList.add('bad');
      out.textContent = `Impossible de vérifier le fichier : ${err.message}`;
    } finally {
      input.value = '';
    }
  });
})();
