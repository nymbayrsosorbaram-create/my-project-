const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { openDb } = require('./db');

const CRITERIA = ['creativity', 'color', 'technique', 'effort'];
const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function createApp({ dataDir = path.join(__dirname, 'data'), uploadDir = path.join(__dirname, 'uploads') } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  const db = openDb(path.join(dataDir, 'app.db'));

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED_TYPES[file.mimetype]),
    }),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
      if (ALLOWED_TYPES[file.mimetype]) cb(null, true);
      else cb(new HttpError(400, 'Зөвхөн JPG, PNG, WEBP, GIF зураг оруулна уу.'));
    },
  });

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/uploads', express.static(uploadDir));

  // Бүтээлүүдийн жагсаалт (хүүхдийн нэр, хайлтаар шүүнэ)
  app.get('/api/works', (req, res) => {
    const where = [];
    const params = [];
    if (req.query.child) {
      where.push('w.child_name = ?');
      params.push(String(req.query.child));
    }
    if (req.query.q) {
      where.push('(w.title LIKE ? OR w.child_name LIKE ? OR w.description LIKE ?)');
      const like = `%${req.query.q}%`;
      params.push(like, like, like);
    }
    const rows = db.prepare(`
      SELECT w.*, COUNT(e.id) AS evaluation_count,
             ROUND(AVG((e.creativity + e.color + e.technique + e.effort) / 4.0), 1) AS average
      FROM works w LEFT JOIN evaluations e ON e.work_id = w.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY w.id ORDER BY w.created_at DESC, w.id DESC
    `).all(...params);
    res.json(rows.map(withImageUrl));
  });

  // Шинэ бүтээл оруулах
  app.post('/api/works', upload.single('image'), (req, res) => {
    if (!req.file) throw new HttpError(400, 'Зураг сонгоно уу.');
    const childName = (req.body.child_name || '').trim();
    const title = (req.body.title || '').trim();
    if (!childName || !title) {
      fs.rmSync(req.file.path, { force: true });
      throw new HttpError(400, 'Хүүхдийн нэр болон бүтээлийн нэрийг бөглөнө үү.');
    }
    const result = db.prepare(`
      INSERT INTO works (child_name, age_group, title, description, image_file)
      VALUES (?, ?, ?, ?, ?)
    `).run(childName, (req.body.age_group || '').trim(), title, (req.body.description || '').trim(), req.file.filename);
    res.status(201).json(getWork(db, result.lastInsertRowid));
  });

  app.get('/api/works/:id', (req, res) => {
    const work = getWork(db, req.params.id);
    if (!work) throw new HttpError(404, 'Бүтээл олдсонгүй.');
    res.json(work);
  });

  app.delete('/api/works/:id', (req, res) => {
    const work = db.prepare('SELECT image_file FROM works WHERE id = ?').get(req.params.id);
    if (!work) throw new HttpError(404, 'Бүтээл олдсонгүй.');
    db.prepare('DELETE FROM works WHERE id = ?').run(req.params.id);
    fs.rmSync(path.join(uploadDir, work.image_file), { force: true });
    res.status(204).end();
  });

  // Дүгнэлт нэмэх
  app.post('/api/works/:id/evaluations', (req, res) => {
    if (!db.prepare('SELECT 1 FROM works WHERE id = ?').get(req.params.id)) {
      throw new HttpError(404, 'Бүтээл олдсонгүй.');
    }
    const body = req.body || {};
    const scores = CRITERIA.map((c) => Number(body[c]));
    if (scores.some((s) => !Number.isInteger(s) || s < 1 || s > 5)) {
      throw new HttpError(400, 'Шалгуур бүрт 1-5 хооронд оноо өгнө үү.');
    }
    db.prepare(`
      INSERT INTO evaluations (work_id, evaluator, creativity, color, technique, effort, strengths, suggestions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.id,
      String(body.evaluator || '').trim() || 'Нэргүй',
      ...scores,
      String(body.strengths || '').trim(),
      String(body.suggestions || '').trim(),
    );
    res.status(201).json(getWork(db, req.params.id));
  });

  app.delete('/api/evaluations/:id', (req, res) => {
    const result = db.prepare('DELETE FROM evaluations WHERE id = ?').run(req.params.id);
    if (!result.changes) throw new HttpError(404, 'Дүгнэлт олдсонгүй.');
    res.status(204).end();
  });

  // Хүүхэд бүрийн нэгтгэл
  app.get('/api/children', (req, res) => {
    res.json(db.prepare(`
      SELECT w.child_name, COUNT(DISTINCT w.id) AS work_count,
             ROUND(AVG((e.creativity + e.color + e.technique + e.effort) / 4.0), 1) AS average
      FROM works w LEFT JOIN evaluations e ON e.work_id = w.id
      GROUP BY w.child_name ORDER BY w.child_name
    `).all());
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Олдсонгүй.' }));

  app.use((err, req, res, next) => {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Зургийн хэмжээ 10MB-аас ихгүй байна.' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Серверийн алдаа гарлаа.' });
  });

  app.locals.db = db;
  return app;
}

function getWork(db, id) {
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(id);
  if (!work) return null;
  const evaluations = db.prepare('SELECT * FROM evaluations WHERE work_id = ? ORDER BY created_at DESC, id DESC').all(id);
  const averages = {};
  for (const c of CRITERIA) {
    averages[c] = evaluations.length
      ? Math.round((evaluations.reduce((sum, e) => sum + e[c], 0) / evaluations.length) * 10) / 10
      : null;
  }
  const overall = evaluations.length
    ? Math.round((CRITERIA.reduce((sum, c) => sum + averages[c], 0) / CRITERIA.length) * 10) / 10
    : null;
  return { ...withImageUrl(work), evaluations, averages, average: overall, evaluation_count: evaluations.length };
}

function withImageUrl(work) {
  return { ...work, image_url: `/uploads/${work.image_file}` };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`Сервер ажиллаж байна: http://localhost:${port}`));
}

module.exports = { createApp };
