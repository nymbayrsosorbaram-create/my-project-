const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { openDb } = require('./db');
const curriculum = require('./curriculum');

const { OUTCOMES, CRITERIA_CODES, ASSESSMENT_TYPES, RATINGS } = curriculum;
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

  // Хөтөлбөрийн суралцахуйн үр дүн, шалгуур
  app.get('/api/curriculum', (req, res) => {
    res.json(curriculum);
  });

  // Бүтээлүүдийн жагсаалт (хүүхэд, түвшин, хайлтаар шүүнэ)
  app.get('/api/works', (req, res) => {
    const where = [];
    const params = [];
    if (req.query.child) {
      where.push('child_name = ?');
      params.push(String(req.query.child));
    }
    if (req.query.level) {
      where.push('level = ?');
      params.push(Number(req.query.level));
    }
    if (req.query.q) {
      where.push('(title LIKE ? OR child_name LIKE ? OR description LIKE ?)');
      const like = `%${req.query.q}%`;
      params.push(like, like, like);
    }
    const rows = db.prepare(`
      SELECT * FROM works ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC, id DESC
    `).all(...params);
    res.json(rows.map((w) => ({ ...formatWork(w), ...latestSummary(db, w.id) })));
  });

  // Шинэ бүтээл оруулах
  app.post('/api/works', upload.single('image'), (req, res) => {
    if (!req.file) throw new HttpError(400, 'Зураг сонгоно уу.');
    const childName = (req.body.child_name || '').trim();
    const title = (req.body.title || '').trim();
    const level = Number(req.body.level);
    const outcomes = [].concat(req.body.outcomes || []).flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);
    if (!childName || !title) throw new HttpError(400, 'Хүүхдийн нэр болон бүтээлийн нэрийг бөглөнө үү.');
    if (!curriculum.LEVELS.includes(level)) throw new HttpError(400, 'Хөтөлбөрийн түвшинг (I–IV) сонгоно уу.');
    if (!outcomes.length) throw new HttpError(400, 'Бүтээлтэй холбогдох суралцахуйн үр дүнг дор хаяж нэгийг сонгоно уу.');
    const unknown = outcomes.filter((c) => !OUTCOMES[c]);
    if (unknown.length) throw new HttpError(400, `Хөтөлбөрт байхгүй код: ${unknown.join(', ')}`);

    const result = db.prepare(`
      INSERT INTO works (child_name, age_group, title, description, image_file, level, outcomes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(childName, (req.body.age_group || '').trim(), title, (req.body.description || '').trim(),
      req.file.filename, level, JSON.stringify([...new Set(outcomes)]));
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
  app.post('/api/works/:id/assessments', (req, res) => {
    const work = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id);
    if (!work) throw new HttpError(404, 'Бүтээл олдсонгүй.');
    const body = req.body || {};
    if (!ASSESSMENT_TYPES[body.type]) throw new HttpError(400, 'Үнэлгээний төрлийг сонгоно уу.');

    const outcomeRatings = Object.entries(body.outcomes || {});
    const criterionRatings = Object.entries(body.criteria || {}).filter(([, r]) => r !== '' && r != null);
    const workOutcomes = JSON.parse(work.outcomes);
    const missing = workOutcomes.filter((c) => !(c in (body.outcomes || {})));
    if (missing.length) throw new HttpError(400, `Суралцахуйн үр дүн бүрийг үнэлнэ үү: ${missing.join(', ')}`);
    if (outcomeRatings.some(([c]) => !workOutcomes.includes(c))) throw new HttpError(400, 'Энэ бүтээлд хамааралгүй үр дүн байна.');
    if (criterionRatings.some(([c]) => !CRITERIA_CODES.has(c))) throw new HttpError(400, 'Үнэлгээний шалгуур буруу байна.');
    if ([...outcomeRatings, ...criterionRatings].some(([, r]) => !RATINGS[r])) {
      throw new HttpError(400, 'Ахицын түвшин буруу байна.');
    }

    db.exec('BEGIN');
    try {
      const { lastInsertRowid: id } = db.prepare(`
        INSERT INTO assessments (work_id, type, method, evaluator, strengths, next_steps)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(work.id, body.type, String(body.method || '').trim(),
        String(body.evaluator || '').trim() || 'Нэргүй',
        String(body.strengths || '').trim(), String(body.next_steps || '').trim());
      const insertScore = db.prepare('INSERT INTO assessment_scores (assessment_id, kind, code, rating) VALUES (?, ?, ?, ?)');
      for (const [code, r] of outcomeRatings) insertScore.run(id, 'outcome', code, Number(r));
      for (const [code, r] of criterionRatings) insertScore.run(id, 'criterion', code, Number(r));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.status(201).json(getWork(db, work.id));
  });

  app.delete('/api/assessments/:id', (req, res) => {
    const result = db.prepare('DELETE FROM assessments WHERE id = ?').run(req.params.id);
    if (!result.changes) throw new HttpError(404, 'Дүгнэлт олдсонгүй.');
    res.status(204).end();
  });

  // Хүүхэд бүрийн нэгтгэл
  app.get('/api/children', (req, res) => {
    res.json(db.prepare(`
      SELECT w.child_name, COUNT(DISTINCT w.id) AS work_count, COUNT(a.id) AS assessment_count,
             MAX(w.level) AS level
      FROM works w LEFT JOIN assessments a ON a.work_id = w.id
      GROUP BY w.child_name ORDER BY w.child_name
    `).all());
  });

  // Хүүхдийн хувийн хавтас: үр дүн, шалгуур тус бүрийн ахицын түүх
  app.get('/api/children/:name/portfolio', (req, res) => {
    const works = db.prepare('SELECT * FROM works WHERE child_name = ? ORDER BY created_at, id').all(req.params.name);
    if (!works.length) throw new HttpError(404, 'Хүүхэд олдсонгүй.');
    const rows = db.prepare(`
      SELECT s.kind, s.code, s.rating, a.type, a.created_at, a.id AS assessment_id, w.id AS work_id, w.title
      FROM assessment_scores s
      JOIN assessments a ON a.id = s.assessment_id
      JOIN works w ON w.id = a.work_id
      WHERE w.child_name = ?
      ORDER BY a.created_at, a.id
    `).all(req.params.name);

    const progress = { outcome: {}, criterion: {} };
    for (const r of rows) {
      const entry = (progress[r.kind][r.code] ??= { latest: null, history: [] });
      const item = { rating: r.rating, type: r.type, date: r.created_at, work_id: r.work_id, title: r.title };
      entry.history.push(item);
      entry.latest = item;
    }
    res.json({
      child_name: req.params.name,
      works: works.map((w) => ({ ...formatWork(w), ...latestSummary(db, w.id) })),
      outcomes: progress.outcome,
      criteria: progress.criterion,
    });
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

  return app;
}

function formatWork(work) {
  return { ...work, outcomes: JSON.parse(work.outcomes), image_url: `/uploads/${work.image_file}` };
}

// Сүүлийн дүгнэлтээр хэдэн үр дүнд хүрсэн (≥ "Хүрсэн") болохыг тоолно
function latestSummary(db, workId) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM assessments WHERE work_id = ?').get(workId).n;
  const latest = db.prepare('SELECT id, type, created_at FROM assessments WHERE work_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(workId);
  if (!latest) return { assessment_count: 0, latest: null };
  const scores = db.prepare(`SELECT rating FROM assessment_scores WHERE assessment_id = ? AND kind = 'outcome'`).all(latest.id);
  return {
    assessment_count: count,
    latest: { type: latest.type, date: latest.created_at, achieved: scores.filter((s) => s.rating >= 2).length, total: scores.length },
  };
}

function getWork(db, id) {
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(id);
  if (!work) return null;
  const scoreStmt = db.prepare('SELECT kind, code, rating FROM assessment_scores WHERE assessment_id = ?');
  const assessments = db.prepare('SELECT * FROM assessments WHERE work_id = ? ORDER BY created_at DESC, id DESC').all(id)
    .map((a) => {
      const scores = scoreStmt.all(a.id);
      const pick = (kind) => Object.fromEntries(scores.filter((s) => s.kind === kind).map((s) => [s.code, s.rating]));
      return { ...a, outcomes: pick('outcome'), criteria: pick('criterion') };
    });
  return { ...formatWork(work), ...latestSummary(db, work.id), assessments };
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
