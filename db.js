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

    CREATE TABLE IF NOT EXISTS evaluations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      evaluator   TEXT NOT NULL,
      creativity  INTEGER NOT NULL CHECK (creativity BETWEEN 1 AND 5),
      color       INTEGER NOT NULL CHECK (color BETWEEN 1 AND 5),
      technique   INTEGER NOT NULL CHECK (technique BETWEEN 1 AND 5),
      effort      INTEGER NOT NULL CHECK (effort BETWEEN 1 AND 5),
      strengths   TEXT NOT NULL DEFAULT '',
      suggestions TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_works_child ON works(child_name);
    CREATE INDEX IF NOT EXISTS idx_evaluations_work ON evaluations(work_id);
  `);
  return db;
}

module.exports = { openDb };
