const { DatabaseSync } = require('node:sqlite');

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS works (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      child_name  TEXT NOT NULL,
      age_group   TEXT NOT NULL DEFAULT '',
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_file  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `);

  // Анхны хувилбарын works хүснэгтэд хөтөлбөрийн талбарууд нэмэх
  const columns = db.prepare('PRAGMA table_info(works)').all().map((c) => c.name);
  if (!columns.includes('level')) db.exec('ALTER TABLE works ADD COLUMN level INTEGER NOT NULL DEFAULT 1');
  if (!columns.includes('outcomes')) db.exec(`ALTER TABLE works ADD COLUMN outcomes TEXT NOT NULL DEFAULT '[]'`);

  db.exec(`
    -- Нэг удаагийн дүгнэлт (гарааны / явцын / үр дүнгийн)
    CREATE TABLE IF NOT EXISTS assessments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      type        TEXT NOT NULL CHECK (type IN ('initial', 'formative', 'summative')),
      method      TEXT NOT NULL DEFAULT '',
      evaluator   TEXT NOT NULL,
      strengths   TEXT NOT NULL DEFAULT '',
      next_steps  TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    -- Суралцахуйн үр дүн (ЗУ...) эсвэл үнэлгээний шалгуур (K1, S1, A1...) тус бүрийн ахиц
    CREATE TABLE IF NOT EXISTS assessment_scores (
      assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      kind          TEXT NOT NULL CHECK (kind IN ('outcome', 'criterion')),
      code          TEXT NOT NULL,
      rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 3),
      PRIMARY KEY (assessment_id, kind, code)
    );

    CREATE INDEX IF NOT EXISTS idx_works_child ON works(child_name);
    CREATE INDEX IF NOT EXISTS idx_assessments_work ON assessments(work_id);
  `);
  return db;
}

module.exports = { openDb };
