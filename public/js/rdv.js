// Prise de rendez-vous : calendrier + créneaux + envoi
(function () {
  const form = document.getElementById('rdv-form');
  const grid = document.getElementById('calendar-grid');
  const monthLabel = document.getElementById('month-label');
  const slotsWrap = document.getElementById('slots');
  const slotsHint = document.getElementById('slots-hint');
  const chosen = document.getElementById('chosen');
  const submit = document.getElementById('rdv-submit');
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const today = new Date();
  let view = { year: today.getFullYear(), month: today.getMonth() + 1 };
  let selectedDate = null;
  let selectedTime = null;
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  async function renderMonth() {
    monthLabel.textContent = `${MONTHS[view.month - 1]} ${view.year}`;
    grid.innerHTML = '<div class="dow">Lu</div><div class="dow">Ma</div><div class="dow">Me</div><div class="dow">Je</div><div class="dow">Ve</div><div class="dow">Sa</div><div class="dow">Di</div>';
    let data;
    try { data = await DA.api(`/api/appointments/availability?year=${view.year}&month=${view.month}`); }
    catch (e) { grid.insertAdjacentHTML('beforeend', '<p class="alert alert-err show" style="grid-column:1/-1">Impossible de charger les disponibilités.</p>'); return; }
    const firstDow = (new Date(view.year, view.month - 1, 1).getDay() + 6) % 7; // lundi = 0
    for (let i = 0; i < firstDow; i++) grid.insertAdjacentHTML('beforeend', '<div></div>');
    for (const d of data.days) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day';
      btn.textContent = Number(d.date.slice(8));
      const disabled = d.closed || d.past || d.tooFar;
      btn.disabled = disabled;
      if (!disabled) btn.classList.add(d.free > 0 ? 'free' : 'full');
      if (d.date === todayStr) btn.classList.add('today');
      if (d.date === selectedDate) btn.classList.add('selected');
      btn.title = d.closed ? d.closedReason : d.past ? 'Date passée' : d.tooFar ? 'Trop éloigné' : `${d.free} créneau(x) disponible(s)`;
      btn.addEventListener('click', () => selectDate(d.date));
      grid.appendChild(btn);
    }
    const prevDisabled = view.year < today.getFullYear() || (view.year === today.getFullYear() && view.month <= today.getMonth() + 1);
    document.getElementById('prev-month').disabled = prevDisabled;
  }

  async function selectDate(date) {
    selectedDate = date;
    selectedTime = null;
    grid.querySelectorAll('.day').forEach((b) => b.classList.toggle('selected', b.textContent === String(Number(date.slice(8))) && !b.disabled));
    slotsHint.textContent = 'Chargement des créneaux…';
    slotsWrap.innerHTML = '';
    updateChosen();
    try {
      const data = await DA.api(`/api/appointments/availability?date=${date}`);
      slotsHint.textContent = `Créneaux du ${data.label} :`;
      if (data.closedReason) { slotsHint.textContent = `${data.label} : ${data.closedReason}.`; return; }
      const morning = data.slots.filter((s) => s.time < '13:00');
      const afternoon = data.slots.filter((s) => s.time >= '13:00');
      const block = (label, list) => list.length ? `<p class="slot-period">${label}</p><div class="slots">${list.map((s) => `<button type="button" class="slot" data-time="${s.time}" ${s.available ? '' : 'disabled'}>${s.time}</button>`).join('')}</div>` : '';
      slotsWrap.innerHTML = block('Matin', morning) + block('Après-midi', afternoon);
      if (!data.slots.some((s) => s.available)) slotsWrap.insertAdjacentHTML('beforeend', '<p class="muted" style="margin-top:10px">Plus de créneau disponible ce jour, choisissez une autre date.</p>');
      slotsWrap.querySelectorAll('.slot:not(:disabled)').forEach((b) => b.addEventListener('click', () => {
        selectedTime = b.dataset.time;
        slotsWrap.querySelectorAll('.slot').forEach((x) => x.classList.toggle('selected', x === b));
        document.getElementById('err-slot').classList.remove('show');
        updateChosen();
      }));
    } catch (e) {
      slotsHint.textContent = 'Impossible de charger les créneaux.';
    }
  }

  function updateChosen() {
    if (selectedDate && selectedTime) {
      const [y, m, d] = selectedDate.split('-');
      chosen.style.display = 'block';
      chosen.textContent = `📅 Rendez-vous choisi : ${d}/${m}/${y} à ${selectedTime}`;
    } else chosen.style.display = 'none';
  }

  document.getElementById('prev-month').addEventListener('click', () => { view.month--; if (view.month < 1) { view.month = 12; view.year--; } renderMonth(); });
  document.getElementById('next-month').addEventListener('click', () => { view.month++; if (view.month > 12) { view.month = 1; view.year++; } renderMonth(); });
  renderMonth();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    DA.clearErrors(form);
    if (!selectedDate || !selectedTime) {
      document.getElementById('err-slot').classList.add('show');
      document.querySelector('.calendar').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!DA.validateRequired(form)) return;
    const payload = { date: selectedDate, time: selectedTime };
    ['service', 'name', 'phone', 'email', 'vehicle', 'plate', 'message', 'website'].forEach((n) => { payload[n] = form[n].value; });
    DA.busy(submit, true, 'Enregistrement…');
    try {
      const r = await DA.api('/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      form.style.display = 'none';
      document.getElementById('result-text').innerHTML = `Votre demande de rendez-vous pour le <strong>${r.label} à ${r.time}</strong> est enregistrée sous la référence <strong>${r.reference}</strong>.`;
      const box = document.getElementById('rdv-result');
      box.style.display = 'block';
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      if (err.field === 'time' || err.field === 'date') { selectDate(selectedDate); }
      DA.showError(form, err);
    } finally {
      DA.busy(submit, false);
    }
  });
})();
