const CRITERIA = [
  ['creativity', 'Бүтээлч сэтгэлгээ'],
  ['color', 'Өнгө хэрэглээ'],
  ['technique', 'Гүйцэтгэл, ур чадвар'],
  ['effort', 'Хичээл зүтгэл, нямбай байдал'],
];

const $ = (sel) => document.querySelector(sel);
const state = { child: '', q: '', currentWorkId: null };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function stars(value) {
  if (value == null) return '';
  const full = Math.round(value);
  return `<span class="stars" title="${value} / 5">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span>`;
}

async function api(url, options) {
  const res = await fetch(url, options);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Алдаа гарлаа.');
  return data;
}

// ---------- Галерей ----------
async function loadGallery() {
  const params = new URLSearchParams();
  if (state.child) params.set('child', state.child);
  if (state.q) params.set('q', state.q);
  const works = await api('/api/works?' + params);

  $('#gallery').innerHTML = works.map((w) => `
    <article class="card" data-id="${w.id}">
      <img src="${escapeHtml(w.image_url)}" alt="${escapeHtml(w.title)}" loading="lazy">
      <div class="body">
        <h3>${escapeHtml(w.title)}</h3>
        <p class="meta">${escapeHtml(w.child_name)}${w.age_group ? ' · ' + escapeHtml(w.age_group) : ''}</p>
        ${w.evaluation_count
          ? `${stars(w.average)} <span class="meta">${w.average}</span><br><span class="badge done">${w.evaluation_count} дүгнэлт</span>`
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
    <button class="chip ${c.child_name === state.child ? 'active' : ''}" data-child="${escapeHtml(c.child_name)}">
      <b>${escapeHtml(c.child_name)}</b> ${c.work_count} бүтээл${c.average != null ? ' · ★ ' + c.average : ''}
    </button>`).join('');
}

function refresh() {
  return Promise.all([loadGallery(), loadChildren()]);
}

$('#gallery').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (card) openWork(card.dataset.id);
});

$('#childSummary').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.child = state.child === chip.dataset.child ? '' : chip.dataset.child;
  refresh();
});

$('#childFilter').addEventListener('change', (e) => {
  state.child = e.target.value;
  refresh();
});

let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value.trim(); loadGallery(); }, 250);
});

// ---------- Цонх хаах ----------
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
});

// ---------- Бүтээл оруулах ----------
const uploadForm = $('#uploadForm');
const fileInput = uploadForm.elements.image;
const dropZone = $('#dropZone');

$('#openUpload').addEventListener('click', () => {
  uploadForm.reset();
  showPreview(null);
  $('#uploadError').textContent = '';
  if (state.child) uploadForm.elements.child_name.value = state.child;
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
$('#criteria').innerHTML = CRITERIA.map(([key, label]) => `
  <div class="criterion">
    <span>${label}</span>
    <div class="rating">
      ${[5, 4, 3, 2, 1].map((n) => `
        <input type="radio" id="${key}${n}" name="${key}" value="${n}">
        <label for="${key}${n}" title="${n}">★</label>`).join('')}
    </div>
  </div>`).join('');

async function openWork(id) {
  const work = await api('/api/works/' + id);
  state.currentWorkId = work.id;
  renderWork(work);
  $('#evalForm').reset();
  $('#evalError').textContent = '';
  if (!$('#workDialog').open) $('#workDialog').showModal();
}

function renderWork(w) {
  $('#workImage').src = w.image_url;
  $('#workImage').alt = w.title;
  $('#workTitle').textContent = w.title;
  $('#workMeta').textContent = [w.child_name, w.age_group, w.created_at.slice(0, 10)].filter(Boolean).join(' · ');
  $('#workDesc').textContent = w.description;

  $('#workAverages').innerHTML = w.evaluation_count
    ? CRITERIA.map(([key, label]) => `
        <div class="row"><span>${label}</span><span>${stars(w.averages[key])} ${w.averages[key]}</span></div>`).join('') +
      `<div class="row total"><span>Нийт дундаж (${w.evaluation_count} дүгнэлт)</span><span>${stars(w.average)} ${w.average}</span></div>`
    : '<span class="meta">Одоогоор дүгнэлт өгөөгүй байна.</span>';

  $('#evalList').innerHTML = w.evaluations.map((e) => `
    <li>
      <div class="head">
        <strong>${escapeHtml(e.evaluator)}</strong>
        <span class="meta">${escapeHtml(e.created_at.slice(0, 16))}
          <button class="link-btn" data-delete-eval="${e.id}">устгах</button></span>
      </div>
      <div class="scores">${CRITERIA.map(([k, label]) => `${label}: ${e[k]}`).join(' · ')}</div>
      ${e.strengths ? `<p>👍 ${escapeHtml(e.strengths)}</p>` : ''}
      ${e.suggestions ? `<p>💡 ${escapeHtml(e.suggestions)}</p>` : ''}
    </li>`).join('') || '<li class="meta">—</li>';
}

$('#evalForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form));
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const work = await api(`/api/works/${state.currentWorkId}/evaluations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    renderWork(work);
    form.reset();
    $('#evalError').textContent = '';
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
  await api('/api/evaluations/' + id, { method: 'DELETE' });
  renderWork(await api('/api/works/' + state.currentWorkId));
  refresh();
});

$('#deleteWork').addEventListener('click', async () => {
  if (!confirm('Энэ бүтээл болон бүх дүгнэлтийг устгах уу?')) return;
  await api('/api/works/' + state.currentWorkId, { method: 'DELETE' });
  $('#workDialog').close();
  refresh();
});

refresh();
