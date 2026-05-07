/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║                 DATABASE / STATE MANAGER                        ║
 * ║                                                                  ║
 * ║  SQLite-based archive for tracking downloaded books,            ║
 * ║  preventing duplicates, and maintaining history.                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');
const config = require('./config');

let db = null;

/**
 * Initialize the database (creates tables if they don't exist).
 */
function initDB() {
  const dbDir = path.dirname(config.dbPath);
  fs.ensureDirSync(dbDir);

  db = new Database(config.dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asin TEXT UNIQUE NOT NULL,
      title TEXT,
      url TEXT,
      status TEXT DEFAULT 'pending',
      images_count INTEGER DEFAULT 0,
      download_dir TEXT,
      requested_by TEXT,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_books_asin ON books(asin);
    CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
    CREATE INDEX IF NOT EXISTS idx_books_requested_by ON books(requested_by);
  `);

  console.log('💾 Database initialized.');
  return db;
}

/**
 * Get the database instance, initializing if needed.
 */
function getDB() {
  if (!db) initDB();
  return db;
}

/**
 * Add a new book to the archive.
 * Returns the existing record if ASIN already exists.
 */
function addBook(asin, title, url, requestedBy) {
  const d = getDB();

  // Check if already exists
  const existing = d.prepare('SELECT * FROM books WHERE asin = ?').get(asin);
  if (existing) return { ...existing, alreadyExists: true };

  const result = d.prepare(`
    INSERT INTO books (asin, title, url, status, requested_by)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(asin, title, url, requestedBy || 'cli');

  return {
    id: result.lastInsertRowid,
    asin,
    title,
    url,
    status: 'pending',
    alreadyExists: false,
  };
}

/**
 * Mark a book as currently downloading.
 */
function markDownloading(asin) {
  const d = getDB();
  d.prepare("UPDATE books SET status = 'downloading' WHERE asin = ?").run(asin);
}

/**
 * Mark a book as successfully downloaded.
 */
function markDone(asin, imagesCount, downloadDir) {
  const d = getDB();
  d.prepare(`
    UPDATE books 
    SET status = 'done', 
        images_count = ?, 
        download_dir = ?,
        completed_at = CURRENT_TIMESTAMP
    WHERE asin = ?
  `).run(imagesCount, downloadDir, asin);
}

/**
 * Mark a book as failed.
 */
function markFailed(asin, error) {
  const d = getDB();
  d.prepare(`
    UPDATE books 
    SET status = 'failed', 
        error = ?,
        completed_at = CURRENT_TIMESTAMP
    WHERE asin = ?
  `).run(error, asin);
}

/**
 * Check if a book has already been downloaded.
 */
function isAlreadyDownloaded(asin) {
  const d = getDB();
  const row = d.prepare("SELECT * FROM books WHERE asin = ? AND status = 'done'").get(asin);
  return row || null;
}

/**
 * Get download history for a user.
 */
function getHistory(requestedBy, limit = 20) {
  const d = getDB();
  if (requestedBy) {
    return d.prepare(`
      SELECT * FROM books 
      WHERE requested_by = ? 
      ORDER BY requested_at DESC 
      LIMIT ?
    `).all(requestedBy, limit);
  }
  return d.prepare(`
    SELECT * FROM books 
    ORDER BY requested_at DESC 
    LIMIT ?
  `).all(limit);
}

/**
 * Get overall stats.
 */
function getStats() {
  const d = getDB();
  const total = d.prepare('SELECT COUNT(*) as count FROM books').get().count;
  const done = d.prepare("SELECT COUNT(*) as count FROM books WHERE status = 'done'").get().count;
  const failed = d.prepare("SELECT COUNT(*) as count FROM books WHERE status = 'failed'").get().count;
  const pending = d.prepare("SELECT COUNT(*) as count FROM books WHERE status IN ('pending', 'downloading')").get().count;
  const totalImages = d.prepare("SELECT COALESCE(SUM(images_count), 0) as total FROM books WHERE status = 'done'").get().total;

  return { total, done, failed, pending, totalImages };
}

/**
 * Get a book by ASIN.
 */
function getBook(asin) {
  const d = getDB();
  return d.prepare('SELECT * FROM books WHERE asin = ?').get(asin);
}

/**
 * Close the database connection.
 */
function closeDB() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  initDB,
  getDB,
  addBook,
  markDownloading,
  markDone,
  markFailed,
  isAlreadyDownloaded,
  getHistory,
  getStats,
  getBook,
  closeDB,
};
