const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');

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
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append('image', new Blob([file], { type }), 'pic');
  return fd;
}

async function createWork(fields = { child_name: 'Анар', title: 'Миний гэр бүл', age_group: '5 нас' }) {
  const res = await fetch(base + '/api/works', { method: 'POST', body: uploadForm(fields) });
  assert.strictEqual(res.status, 201);
  return res.json();
}

test('бүтээл оруулж, зургийг нь авах', async () => {
  const work = await createWork();
  assert.strictEqual(work.child_name, 'Анар');
  assert.strictEqual(work.evaluation_count, 0);
  const img = await fetch(base + work.image_url);
  assert.strictEqual(img.status, 200);
  assert.deepStrictEqual(Buffer.from(await img.arrayBuffer()), PNG);
});

test('зураггүй эсвэл буруу төрлийн файлыг хүлээж авахгүй', async () => {
  let res = await fetch(base + '/api/works', { method: 'POST', body: uploadForm({ child_name: 'А', title: 'Б' }, null) });
  assert.strictEqual(res.status, 400);
  res = await fetch(base + '/api/works', { method: 'POST', body: uploadForm({ child_name: 'А', title: 'Б' }, Buffer.from('x'), 'text/plain') });
  assert.strictEqual(res.status, 400);
  res = await fetch(base + '/api/works', { method: 'POST', body: uploadForm({ child_name: '', title: 'Б' }) });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(fs.readdirSync(path.join(tmp, 'uploads')).length, 1); // зөвхөн эхний тестийнх
});

test('дүгнэлт нэмэхэд дундаж оноо тооцогдоно', async () => {
  const work = await createWork({ child_name: 'Тэмүүлэн', title: 'Морь' });
  const post = (body) => fetch(`${base}/api/works/${work.id}/evaluations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  assert.strictEqual((await post({ creativity: 6, color: 1, technique: 1, effort: 1 })).status, 400);
  assert.strictEqual((await post({ creativity: 5, color: 4 })).status, 400);

  await post({ evaluator: 'Багш', creativity: 5, color: 4, technique: 3, effort: 5, strengths: 'Өнгө сайхан' });
  const res = await post({ creativity: 3, color: 4, technique: 4, effort: 5 });
  const detail = await res.json();
  assert.strictEqual(detail.evaluation_count, 2);
  assert.deepStrictEqual(detail.averages, { creativity: 4, color: 4, technique: 3.5, effort: 5 });
  assert.strictEqual(detail.average, 4.1);

  const list = await (await fetch(`${base}/api/works?child=${encodeURIComponent('Тэмүүлэн')}`)).json();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].evaluation_count, 2);
  assert.strictEqual(list[0].average, 4.1);

  const children = await (await fetch(base + '/api/children')).json();
  assert.deepStrictEqual(children.map((c) => c.child_name).sort(), ['Анар', 'Тэмүүлэн']);
});

test('бүтээл устгахад зураг болон дүгнэлт устана', async () => {
  const work = await createWork({ child_name: 'Сараа', title: 'Нар' });
  await fetch(`${base}/api/works/${work.id}/evaluations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creativity: 5, color: 5, technique: 5, effort: 5 }),
  });
  assert.strictEqual((await fetch(`${base}/api/works/${work.id}`, { method: 'DELETE' })).status, 204);
  assert.strictEqual((await fetch(`${base}/api/works/${work.id}`)).status, 404);
  assert.ok(!fs.existsSync(path.join(tmp, 'uploads', work.image_file)));
});

test('хайлт ажиллана', async () => {
  const res = await (await fetch(base + '/api/works?q=' + encodeURIComponent('гэр'))).json();
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].title, 'Миний гэр бүл');
});
