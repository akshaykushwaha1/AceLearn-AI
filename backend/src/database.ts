import Database from "better-sqlite3";
import path from "node:path";

const databasePath = path.join(
  process.cwd(),
  "acelearn.db",
);

const db = new Database(databasePath);

// SQLite performance + reliability
db.pragma("journal_mode = WAL");

// Students
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    total_attempts INTEGER NOT NULL DEFAULT 0,
    correct_answers INTEGER NOT NULL DEFAULT 0,
    accuracy REAL NOT NULL DEFAULT 0,
    current_streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    skill_level TEXT NOT NULL DEFAULT 'beginner',
    current_difficulty TEXT NOT NULL DEFAULT 'easy',
    last_recommendation TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// Question attempts
db.exec(`
  CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    question TEXT NOT NULL,
    topic TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    student_answer TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    correct INTEGER NOT NULL,
    recommendation TEXT,
    next_topic TEXT,
    created_at TEXT NOT NULL,

    FOREIGN KEY (student_id)
      REFERENCES students(id)
  );
`);

// Topic performance
db.exec(`
  CREATE TABLE IF NOT EXISTS topic_progress (
    student_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0,
    accuracy REAL NOT NULL DEFAULT 0,

    PRIMARY KEY (student_id, topic),

    FOREIGN KEY (student_id)
      REFERENCES students(id)
  );
`);

console.log(`💾 SQLite database ready: ${databasePath}`);

export function saveStudentProgress(progress: {
  studentId: string;
  totalAttempts: number;
  correctAnswers: number;
  accuracy: number;
  currentStreak: number;
  bestStreak: number;
  skillLevel: string;
  currentDifficulty: string;
  lastRecommendation: string;
}) {
  const now = new Date().toISOString();

  const existing = db
    .prepare(
      `SELECT id FROM students WHERE id = ?`,
    )
    .get(progress.studentId);

  if (existing) {
    db.prepare(`
      UPDATE students
      SET
        total_attempts = ?,
        correct_answers = ?,
        accuracy = ?,
        current_streak = ?,
        best_streak = ?,
        skill_level = ?,
        current_difficulty = ?,
        last_recommendation = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      progress.totalAttempts,
      progress.correctAnswers,
      progress.accuracy,
      progress.currentStreak,
      progress.bestStreak,
      progress.skillLevel,
      progress.currentDifficulty,
      progress.lastRecommendation,
      now,
      progress.studentId,
    );

    return;
  }

  db.prepare(`
    INSERT INTO students (
      id,
      total_attempts,
      correct_answers,
      accuracy,
      current_streak,
      best_streak,
      skill_level,
      current_difficulty,
      last_recommendation,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    progress.studentId,
    progress.totalAttempts,
    progress.correctAnswers,
    progress.accuracy,
    progress.currentStreak,
    progress.bestStreak,
    progress.skillLevel,
    progress.currentDifficulty,
    progress.lastRecommendation,
    now,
    now,
  );
}

export default db;