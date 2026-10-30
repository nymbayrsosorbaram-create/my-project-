const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');
const { OUTCOMES, CRITERIA } = require('../curriculum');

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let server, base, tmp;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buteel-'));
  const app = createApp({ dataDir: path.join(tmp, 'data'), uploadDir: path.join(tmp, 'uploads') });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function uploadForm(fields, file = PNG, type = 'image/png') {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) [].concat(v).forEach((x) => fd.append(k, x));
  if (file) fd.append('image', new Blob([file], { type }), 'pic');
  return fd;
}

async function createWork(fields = {}) {
  const res = await fetch(base + '/api/works', {
    method: 'POST',
    body: uploadForm({ child_name: 'Анар', title: 'Манай гэр', level: '2', outcomes: ['ЗУ2.2а', 'ЗУ2.2б'], ...fields }),
  });
  assert.strictEqual(res.status, 201, await res.clone().text());
  return res.json();
}

const assess = (id, body) => fetch(`${base}/api/works/${id}/assessments`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('хөтөлбөрийн бүх суралцахуйн үр дүн, шалгуур бүрэн', async () => {
  assert.strictEqual(Object.keys(OUTCOMES).length, 28); // (1 + 6 дэд үсэг) × 4 түвшин
  assert.strictEqual(OUTCOMES['ЗУ3.2г'].substrand, 'Урлал');
  assert.strictEqual(CRITERIA.flatMap((f) => f.items).length, 11);
  const c = await (await fetch(base + '/api/curriculum')).json();
  assert.ok(c.OUTCOMES['ЗУ1.1а']);
});

test('бүтээл оруулж, зургийг нь авах', async () => {
  const work = await createWork();
  assert.deepStrictEqual(work.outcomes, ['ЗУ2.2а', 'ЗУ2.2б']);
  assert.strictEqual(work.level, 2);
  assert.strictEqual(work.assessment_count, 0);
  const img = await fetch(base + work.image_url);
  assert.deepStrictEqual(Buffer.from(await img.arrayBuffer()), PNG);
});

test('буруу оролтыг хүлээж авахгүй, зургийг үлдээхгүй', async () => {
  const bad = async (fields, file, type) => {
    const res = await fetch(base + '/api/works', {
      method: 'POST',
      body: uploadForm({ child_name: 'А', title: 'Б', level: '1', outcomes: 'ЗУ1.2а', ...fields }, file, type),
    });
    assert.strictEqual(res.status, 400);
  };
  await bad({}, null);
  await bad({}, Buffer.from('x'), 'text/plain');
  await bad({ child_name: '' });
  await bad({ level: '5' });
  await bad({ outcomes: [] });
  await bad({ outcomes: 'ЗУ9.9я' });
  assert.strictEqual(fs.readdirSync(path.join(tmp, 'uploads')).length, 1); // зөвхөн өмнөх тестийнх
});

test('дүгнэлт: үр дүн бүрийг үнэлэх шаардлагатай, шалгуур сонголттой', async () => {
  const work = await createWork({ child_name: 'Тэмүүлэн', title: 'Морь' });
  assert.strictEqual((await assess(work.id, { type: 'formative', outcomes: { 'ЗУ2.2а': 2 } })).status, 400);
  assert.strictEqual((await assess(work.id, { type: 'bad', outcomes: { 'ЗУ2.2а': 2, 'ЗУ2.2б': 2 } })).status, 400);
  assert.strictEqual((await assess(work.id, { type: 'formative', outcomes: { 'ЗУ2.2а': 4, 'ЗУ2.2б': 2 } })).status, 400);
  assert.strictEqual((await assess(work.id, { type: 'formative', outcomes: { 'ЗУ2.2а': 2, 'ЗУ2.2б': 2, 'ЗУ2.2г': 1 } })).status, 400);
  assert.strictEqual((await assess(work.id, { type: 'formative', outcomes: { 'ЗУ2.2а': 2, 'ЗУ2.2б': 2 }, criteria: { X9: 2 } })).status, 400);

  let res = await assess(work.id, {
    type: 'initial', method: 'Өдөр тутмын ажиглалт', evaluator: 'Багш',
    outcomes: { 'ЗУ2.2а': 1, 'ЗУ2.2б': 2 }, criteria: { S2: 1, A3: '' }, strengths: 'Өнгө сайн',
  });
  assert.strictEqual(res.status, 201);
  res = await assess(work.id, { type: 'formative', outcomes: { 'ЗУ2.2а': 2, 'ЗУ2.2б': 3 }, criteria: { S2: 2 } });
  const detail = await res.json();
  assert.strictEqual(detail.assessment_count, 2);
  assert.deepStrictEqual(detail.latest, { type: 'formative', date: detail.latest.date, achieved: 2, total: 2 });
  assert.deepStrictEqual(detail.assessments[1].criteria, { S2: 1 }); // хоосон шалгуур хадгалагдахгүй

  const pf = await (await fetch(`${base}/api/children/${encodeURIComponent('Тэмүүлэн')}/portfolio`)).json();
  assert.strictEqual(pf.works.length, 1);
  assert.deepStrictEqual(pf.outcomes['ЗУ2.2а'].history.map((h) => h.rating), [1, 2]);
  assert.strictEqual(pf.outcomes['ЗУ2.2б'].latest.rating, 3);
  assert.strictEqual(pf.criteria.S2.latest.rating, 2);

  const children = await (await fetch(base + '/api/children')).json();
  assert.deepStrictEqual(children.find((c) => c.child_name === 'Тэмүүлэн'), { child_name: 'Тэмүүлэн', work_count: 1, assessment_count: 2, level: 2 });
});

test('шүүлт: түвшин, хайлт', async () => {
  await createWork({ child_name: 'Сараа', title: 'Шавар баримал', level: '3', outcomes: 'ЗУ3.2г' });
  const byLevel = await (await fetch(base + '/api/works?level=3')).json();
  assert.deepStrictEqual(byLevel.map((w) => w.title), ['Шавар баримал']);
  const byQ = await (await fetch(base + '/api/works?q=' + encodeURIComponent('Морь'))).json();
  assert.deepStrictEqual(byQ.map((w) => w.title), ['Морь']);
});

test('бүтээл устгахад зураг болон дүгнэлт устана', async () => {
  const work = await createWork({ child_name: 'Болд', title: 'Нар' });
  const r = await assess(work.id, { type: 'summative', outcomes: { 'ЗУ2.2а': 2, 'ЗУ2.2б': 2 } });
  const aid = (await r.json()).assessments[0].id;
  assert.strictEqual((await fetch(`${base}/api/assessments/${aid}`, { method: 'DELETE' })).status, 204);
  assert.strictEqual((await fetch(`${base}/api/works/${work.id}`, { method: 'DELETE' })).status, 204);
  assert.strictEqual((await fetch(`${base}/api/works/${work.id}`)).status, 404);
  assert.ok(!fs.existsSync(path.join(tmp, 'uploads', work.image_file)));
  assert.strictEqual((await fetch(`${base}/api/children/${encodeURIComponent('Болд')}/portfolio`)).status, 404);
});
