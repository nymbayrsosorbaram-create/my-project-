const $ = (sel) => document.querySelector(sel);
const state = { child: '', level: '', q: '', currentWork: null };
let C; // хөтөлбөр (/api/curriculum)

const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ratingPill(r) {
  return r ? `<span class="pill r${r}">${C.RATINGS[r]}</span>` : '<span class="pill">Үнэлээгүй</span>';
}

async function api(url, options) {
  const res = await fetch(url, options);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Алдаа гарлаа.');
  return data;
}

// Нэг түвшний бүх үр дүнг дэд айгаар бүлэглэнэ
function outcomesForLevel(level) {
  return Object.values(C.OUTCOMES).filter((o) => o.level === level);
}

// ---------- Галерей ----------
async function loadGallery() {
  const params = new URLSearchParams();
  if (state.child) params.set('child', state.child);
  if (state.level) params.set('level', state.level);
  if (state.q) params.set('q', state.q);
  const works = await api('/api/works?' + params);

  $('#gallery').innerHTML = works.map((w) => `
    <article class="card" data-id="${w.id}">
      <img src="${escapeHtml(w.image_url)}" alt="${escapeHtml(w.title)}" loading="lazy">
      <div class="body">
        <h3>${escapeHtml(w.title)}</h3>
        <p class="meta">${escapeHtml(w.child_name)} · ${C.LEVEL_LABELS[w.level]}</p>
        <div class="codes">${w.outcomes.map((c) => `<span class="code" title="${escapeHtml(C.OUTCOMES[c]?.text)}">${c}</span>`).join('')}</div>
        ${w.latest
          ? `<span class="badge done">${C.ASSESSMENT_TYPES[w.latest.type].split(' ')[0]} · ${w.latest.achieved}/${w.latest.total} хүрсэн</span>`
          : '<span class="badge">Дүгнэлт хүлээж байна</span>'}
      </div>
    </article>`).join('');
  $('#empty').hidden = works.length > 0;
}

async function loadChildren() {
  const children = await api('/api/children');
  $('#childFilter').innerHTML = '<option value="">Бүх хүүхэд</option>' +
    children.map((c) => `<option value="${escapeHtml(c.child_name)}">${escapeHtml(c.child_name)}</option>`).join('');
  $('#childFilter').value = state.child;
  $('#childNames').innerHTML = children.map((c) => `<option value="${escapeHtml(c.child_name)}">`).join('');
  $('#childSummary').innerHTML = children.map((c) => `
    <div class="chip ${c.child_name === state.child ? 'active' : ''}">
      <button class="chip-name" data-child="${escapeHtml(c.child_name)}">
        <b>${escapeHtml(c.child_name)}</b> ${c.work_count} бүтээл · ${c.assessment_count} дүгнэлт
      </button>
      <button class="chip-pf" data-portfolio="${escapeHtml(c.child_name)}" title="Хувийн хавтас">📁</button>
    </div>`).join('');
}

function refresh() {
  return Promise.all([loadGallery(), loadChildren()]);
}

$('#gallery').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (card) openWork(card.dataset.id);
});

$('#childSummary').addEventListener('click', (e) => {
  const pf = e.target.closest('[data-portfolio]');
  if (pf) return openPortfolio(pf.dataset.portfolio);
  const chip = e.target.closest('[data-child]');
  if (!chip) return;
  state.child = state.child === chip.dataset.child ? '' : chip.dataset.child;
  refresh();
});

$('#childFilter').addEventListener('change', (e) => { state.child = e.target.value; refresh(); });
$('#levelFilter').addEventListener('change', (e) => { state.level = e.target.value; loadGallery(); });

let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value.trim(); loadGallery(); }, 250);
});

document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
});

// ---------- Бүтээл оруулах ----------
const uploadForm = $('#uploadForm');
const fileInput = uploadForm.elements.image;
const dropZone = $('#dropZone');

function renderOutcomeChoices(level) {
  const checked = new Set([...uploadForm.querySelectorAll('[name=outcomes]:checked')].map((i) => i.value.slice(3)));
  $('#outcomeChoices').innerHTML = outcomesForLevel(level).map((o) => `
    <label class="outcome-choice">
      <input type="checkbox" name="outcomes" value="${o.code}" ${checked.has(o.code.slice(3)) ? 'checked' : ''}>
      <span><b>${o.code}</b> <small class="meta">${escapeHtml(o.substrand)}</small><br>${escapeHtml(o.text)}</span>
    </label>`).join('');
}

$('#levelChoices').addEventListener('change', (e) => renderOutcomeChoices(Number(e.target.value)));

$('#openUpload').addEventListener('click', () => {
  uploadForm.reset();
  showPreview(null);
  $('#uploadError').textContent = '';
  if (state.child) uploadForm.elements.child_name.value = state.child;
  const level = Number(state.level) || 1;
  uploadForm.querySelector(`[name=level][value="${level}"]`).checked = true;
  $('#outcomeChoices').innerHTML = '';
  renderOutcomeChoices(level);
  $('#uploadDialog').showModal();
});

function showPreview(file) {
  const img = $('#preview');
  if (img.src) URL.revokeObjectURL(img.src);
  img.hidden = !file;
  $('#dropText').hidden = !!file;
  img.src = file ? URL.createObjectURL(file) : '';
}

fileInput.addEventListener('change', () => showPreview(fileInput.files[0]));

['dragenter', 'dragover'].forEach((ev) => dropZone.addEventListener(ev, (e) => {
  e.preventDefault();
  dropZone.classList.add('over');
}));
['dragleave', 'drop'].forEach((ev) => dropZone.addEventListener(ev, () => dropZone.classList.remove('over')));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!e.dataTransfer.files.length) return;
  fileInput.files = e.dataTransfer.files;
  showPreview(fileInput.files[0]);
});

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!fileInput.files.length) {
    $('#uploadError').textContent = 'Зураг сонгоно уу.';
    return;
  }
  if (!uploadForm.querySelector('[name=outcomes]:checked')) {
    $('#uploadError').textContent = 'Суралцахуйн үр дүнг дор хаяж нэгийг сонгоно уу.';
    return;
  }
  const btn = uploadForm.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const work = await api('/api/works', { method: 'POST', body: new FormData(uploadForm) });
    $('#uploadDialog').close();
    await refresh();
    openWork(work.id);
  } catch (err) {
    $('#uploadError').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

// ---------- Дэлгэрэнгүй ба дүгнэлт ----------
function ratingRadios(name, allowNone) {
  const opts = Object.entries(C.RATINGS).map(([v, label]) => `
    <label class="r${v}"><input type="radio" name="${name}" value="${v}"><span>${label}</span></label>`).join('');
  return `<div class="segmented rating">${allowNone ? `<label><input type="radio" name="${name}" value="" checked><span>—</span></label>` : ''}${opts}</div>`;
}

async function openWork(id) {
  const work = await api('/api/works/' + id);
  renderWork(work);
  if (!$('#workDialog').open) $('#workDialog').showModal();
}

function renderWork(w) {
  state.currentWork = w;
  $('#workImage').src = w.image_url;
  $('#workImage').alt = w.title;
  $('#workTitle').textContent = w.title;
  $('#workMeta').textContent = [w.child_name, w.age_group, C.LEVEL_LABELS[w.level], w.created_at.slice(0, 10)].filter(Boolean).join(' · ');
  $('#workDesc').textContent = w.description;
  $('#workDesc').hidden = !w.description;

  const latest = w.assessments[0];
  $('#workOutcomes').innerHTML = w.outcomes.map((code) => `
    <li><div><b>${code}</b> ${escapeHtml(C.OUTCOMES[code].text)}</div>${ratingPill(latest?.outcomes[code])}</li>`).join('');

  const form = $('#evalForm');
  const evaluator = form.elements.evaluator.value;
  form.reset();
  form.elements.evaluator.value = evaluator;
  $('#evalError').textContent = '';
  $('#evalOutcomes').innerHTML = w.outcomes.map((code) => `
    <div class="rating-row">
      <span><b>${code}</b> ${escapeHtml(C.OUTCOMES[code].text)}</span>
      ${ratingRadios('o_' + code, false)}
    </div>`).join('');

  $('#evalList').innerHTML = w.assessments.map((a) => `
    <li>
      <div class="head">
        <strong>${escapeHtml(C.ASSESSMENT_TYPES[a.type])}</strong>
        <span class="meta">${escapeHtml(a.created_at.slice(0, 16))}
          <button class="link-btn" data-delete-eval="${a.id}">устгах</button></span>
      </div>
      <div class="meta">${escapeHtml(a.evaluator)}${a.method ? ' · ' + escapeHtml(a.method) : ''}</div>
      <div class="scores">${Object.entries(a.outcomes).map(([c, r]) => `<span>${c} ${ratingPill(r)}</span>`).join('')}</div>
      ${Object.keys(a.criteria).length ? `<div class="scores">${Object.entries(a.criteria).map(([c, r]) =>
        `<span title="${escapeHtml(criterionText(c))}">${c} ${ratingPill(r)}</span>`).join('')}</div>` : ''}
      ${a.strengths ? `<p>👍 ${escapeHtml(a.strengths)}</p>` : ''}
      ${a.next_steps ? `<p>➡️ ${escapeHtml(a.next_steps)}</p>` : ''}
    </li>`).join('') || '<li class="meta">Одоогоор дүгнэлт алга.</li>';
}

function criterionText(code) {
  for (const f of C.CRITERIA) for (const [c, text] of f.items) if (c === code) return text;
  return '';
}

$('#evalForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const body = { type: fd.get('type'), method: fd.get('method'), evaluator: fd.get('evaluator'),
    strengths: fd.get('strengths'), next_steps: fd.get('next_steps'), outcomes: {}, criteria: {} };
  for (const code of state.currentWork.outcomes) {
    const v = fd.get('o_' + code);
    if (!v) {
      $('#evalError').textContent = `${code} үр дүнг үнэлнэ үү.`;
      return;
    }
    body.outcomes[code] = Number(v);
  }
  for (const f of C.CRITERIA) for (const [code] of f.items) {
    const v = fd.get('c_' + code);
    if (v) body.criteria[code] = Number(v);
  }

  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const work = await api(`/api/works/${state.currentWork.id}/assessments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    renderWork(work);
    refresh();
  } catch (err) {
    $('#evalError').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$('#evalList').addEventListener('click', async (e) => {
  const id = e.target.dataset.deleteEval;
  if (!id || !confirm('Энэ дүгнэлтийг устгах уу?')) return;
  await api('/api/assessments/' + id, { method: 'DELETE' });
  renderWork(await api('/api/works/' + state.currentWork.id));
  refresh();
});

$('#deleteWork').addEventListener('click', async () => {
  if (!confirm('Энэ бүтээл болон бүх дүгнэлтийг устгах уу?')) return;
  await api('/api/works/' + state.currentWork.id, { method: 'DELETE' });
  $('#workDialog').close();
  refresh();
});

// ---------- Хувийн хавтас ----------
async function openPortfolio(name) {
  const pf = await api('/api/children/' + encodeURIComponent(name) + '/portfolio');
  $('#pfTitle').textContent = `${pf.child_name} — хувийн хавтас`;
  $('#pfLegend').innerHTML = Object.keys(C.RATINGS).map((r) => ratingPill(r)).join('') + ratingPill(null);

  // Хөтөлбөрийн хүснэгтийн бүтэцтэй ижил: мөр = дэд ай, багана = түвшин
  let rows = '';
  for (const strand of C.STRANDS) {
    rows += `<tr class="strand"><th colspan="5">Ай ${strand.id}. ${escapeHtml(strand.name)}</th></tr>`;
    for (const sub of strand.substrands) {
      for (const letter of Object.keys(sub.outcomes)) {
        rows += `<tr><th>${escapeHtml(sub.name)}<br><small class="meta">${escapeHtml(C.WORK_TYPES[letter] && strand.id === 2 ? C.WORK_TYPES[letter] : '')}</small></th>`;
        for (const level of C.LEVELS) {
          const code = `ЗУ${level}.${strand.id}${letter}`;
          const p = pf.outcomes[code];
          const r = p?.latest.rating;
          rows += `<td class="cell ${r ? 'r' + r : ''}" title="${escapeHtml(C.OUTCOMES[code].text)}">
            <b>${code}</b><span>${escapeHtml(C.OUTCOMES[code].text)}</span>
            ${p ? `<small>${C.RATINGS[r]} · ${p.history.length} удаа</small>` : ''}</td>`;
        }
        rows += '</tr>';
      }
    }
  }
  $('#pfOutcomes').innerHTML = `<thead><tr><th>Дэд ай</th>${C.LEVELS.map((l) => `<th>${C.LEVEL_LABELS[l]}</th>`).join('')}</tr></thead><tbody>${rows}</tbody>`;

  $('#pfCriteria').innerHTML = C.CRITERIA.map((f) => `
    <tr class="strand"><th colspan="3">${escapeHtml(f.frame)}</th></tr>
    ${f.items.map(([code, text]) => {
      const p = pf.criteria[code];
      return `<tr><td>${escapeHtml(text)}</td><td>${ratingPill(p?.latest.rating)}</td>
        <td class="history">${p ? p.history.map((h) => `<span class="dot r${h.rating}" title="${h.date.slice(0, 10)} · ${escapeHtml(h.title)} · ${C.RATINGS[h.rating]}"></span>`).join('') : ''}</td></tr>`;
    }).join('')}`).join('');

  $('#pfWorks').innerHTML = pf.works.map((w) => `
    <figure data-id="${w.id}">
      <img src="${escapeHtml(w.image_url)}" alt="${escapeHtml(w.title)}">
      <figcaption><b>${escapeHtml(w.title)}</b><br><span class="meta">${w.created_at.slice(0, 10)} · ${ROMAN[w.level]} · ${w.outcomes.join(', ')}</span></figcaption>
    </figure>`).join('');

  if (!$('#portfolioDialog').open) $('#portfolioDialog').showModal();
}

$('#pfWorks').addEventListener('click', (e) => {
  const fig = e.target.closest('figure');
  if (!fig) return;
  $('#portfolioDialog').close();
  openWork(fig.dataset.id);
});

$('#printPortfolio').addEventListener('click', () => window.print());

// ---------- Эхлүүлэх ----------
async function init() {
  C = await api('/api/curriculum');
  const levelOptions = C.LEVELS.map((l) => `<option value="${l}">${C.LEVEL_LABELS[l]}</option>`).join('');
  $('#levelFilter').innerHTML = '<option value="">Бүх түвшин</option>' + levelOptions;
  $('#levelChoices').innerHTML = C.LEVELS.map((l) => `
    <label><input type="radio" name="level" value="${l}"><span>${C.LEVEL_LABELS[l]}</span></label>`).join('');
  $('#evalType').innerHTML = Object.entries(C.ASSESSMENT_TYPES)
    .map(([k, v]) => `<option value="${k}" ${k === 'formative' ? 'selected' : ''}>${v}</option>`).join('');
  $('#evalMethod').innerHTML = C.METHODS.map((m) => `<option>${m}</option>`).join('');
  $('#evalCriteria').innerHTML = C.CRITERIA.map((f) => `
    <h4>${escapeHtml(f.frame)}</h4>
    ${f.items.map(([code, text]) => `
      <div class="rating-row"><span>${escapeHtml(text)}</span>${ratingRadios('c_' + code, true)}</div>`).join('')}`).join('');
  await refresh();
}

init();
