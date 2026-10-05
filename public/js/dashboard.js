// Tableau de bord interactif du hero : aiguilles animées, ralenti permanent, montée en régime au clic
(function () {
  const tachoNeedle = document.getElementById('tacho-needle');
  const speedoNeedle = document.getElementById('speedo-needle');
  const tachoDigital = document.getElementById('tacho-digital');
  const speedoDigital = document.getElementById('speedo-digital');
  const btn = document.getElementById('engine-btn');
  const dash = document.querySelector('.dash');
  const label = document.getElementById('engine-label');
  const screen = document.getElementById('dash-msg');
  const leds = document.querySelectorAll('#dash-leds .led');
  if (!tachoNeedle || !speedoNeedle || !btn) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TACHO_MAX = 8, SPEEDO_MAX = 220;

  function setNeedle(el, digitalEl, value, max, decimals) {
    const clamped = Math.max(0, Math.min(max, value));
    const deg = 220 + (280 * clamped) / max;
    el.style.transform = `rotate(${deg}deg)`;
    if (digitalEl) digitalEl.textContent = clamped.toFixed(decimals);
  }

  const MESSAGES = [
    'Prêt à démarrer',
    'Devis en ligne en 2 min',
    'Rendez-vous 24h/24',
    'Toutes marques acceptées',
    '4,9/5 · 77 avis Google',
    'Mécanique · Carrosserie · Peinture',
  ];
  let msgIndex = 0;
  function cycleMessage() {
    if (!screen) return;
    screen.style.opacity = '0';
    setTimeout(() => { screen.textContent = MESSAGES[msgIndex % MESSAGES.length]; screen.style.opacity = '1'; msgIndex++; }, 260);
  }
  screen && (screen.style.transition = 'opacity .25s');
  cycleMessage();
  if (!reduced) setInterval(cycleMessage, 3400);

  // Voyant "PRÊT" allumé en continu, "RÉVISION" clignote doucement pour attirer l'œil (démo produit)
  const ledOk = document.querySelector('[data-led="ok"]');
  const ledRev = document.querySelector('[data-led="rev"]');
  if (ledOk) ledOk.classList.add('on-green');
  if (ledRev && !reduced) setInterval(() => ledRev.classList.toggle('on'), 1400);

  let idleT = 0, running = false, rafId = null;
  function idleLoop(ts) {
    if (!running) {
      idleT = ts / 1000;
      // Ralenti d'un moteur qui tourne : petites oscillations autour de 0.9 x1000 tr/min
      const rpm = 0.9 + Math.sin(idleT * 2.4) * 0.07 + Math.sin(idleT * 5.1) * 0.02;
      setNeedle(tachoNeedle, tachoDigital, rpm, TACHO_MAX, 1);
      setNeedle(speedoNeedle, speedoDigital, 0, SPEEDO_MAX, 0);
    }
    rafId = requestAnimationFrame(idleLoop);
  }
  if (reduced) {
    setNeedle(tachoNeedle, tachoDigital, 0.9, TACHO_MAX, 1);
    setNeedle(speedoNeedle, speedoDigital, 0, SPEEDO_MAX, 0);
  } else {
    rafId = requestAnimationFrame(idleLoop);
  }

  function rev() {
    if (running) return;
    running = true;
    btn.classList.add('running');
    dash.classList.add('revving');
    label.textContent = 'En régime…';
    if (ledRev) { ledRev.classList.remove('on'); ledRev.classList.add('on-red'); }
    if (screen) { screen.style.opacity = '0'; setTimeout(() => { screen.textContent = 'Vroom !'; screen.style.opacity = '1'; }, 200); }

    const sequence = [
      { rpm: 7.4, speed: 0, dur: 420 },   // montée rapide
      { rpm: 6.1, speed: 0, dur: 260 },   // léger rebond
      { rpm: 7.8, speed: 0, dur: 320 },   // pointe
      { rpm: 0.9, speed: 0, dur: 700 },   // retour au ralenti
    ];
    let i = 0;
    function step() {
      if (i >= sequence.length) {
        running = false;
        btn.classList.remove('running');
        dash.classList.remove('revving');
        label.textContent = 'Démarrer';
        if (ledRev) ledRev.classList.remove('on-red');
        setTimeout(cycleMessage, 300);
        return;
      }
      const s = sequence[i++];
      setNeedle(tachoNeedle, tachoDigital, s.rpm, TACHO_MAX, 1);
      setTimeout(step, s.dur);
    }
    step();
  }

  btn.addEventListener('click', rev);
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); rev(); } });
})();
