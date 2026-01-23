const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Database file location
const DB_DIR = process.env.LIBREAD_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'libread.db');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
const initSchema = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    tts_speed REAL DEFAULT 1.0,
    tts_voice TEXT DEFAULT 'en_US-amy-medium',
    tts_prefer_phonemes INTEGER DEFAULT 1,
    theme TEXT DEFAULT 'dark'
);

-- Books/Novels in user's library
CREATE TABLE IF NOT EXISTS library (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    novel_url TEXT NOT NULL,
    novel_title TEXT NOT NULL,
    novel_cover TEXT,
    author TEXT,
    total_chapters INTEGER DEFAULT 0,
    status TEXT DEFAULT 'reading' CHECK(status IN ('want_to_read', 'reading', 'completed', 'dropped')),
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, novel_url)
);

-- Reading progress per book
CREATE TABLE IF NOT EXISTS reading_progress (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    library_id TEXT NOT NULL,
    chapter_index INTEGER DEFAULT 0,
    chapter_title TEXT,
    chapter_url TEXT,
    scroll_position REAL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (library_id) REFERENCES library(id) ON DELETE CASCADE,
    UNIQUE(user_id, library_id)
);

-- Bookmarks within chapters
CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    library_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    chapter_title TEXT,
    position REAL DEFAULT 0,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (library_id) REFERENCES library(id) ON DELETE CASCADE
);

-- Reading statistics
CREATE TABLE IF NOT EXISTS reading_stats (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    library_id TEXT NOT NULL,
    date TEXT NOT NULL,
    chapters_read INTEGER DEFAULT 0,
    time_spent_seconds INTEGER DEFAULT 0,
    words_read INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (library_id) REFERENCES library(id) ON DELETE CASCADE,
    UNIQUE(user_id, library_id, date)
);

-- Sessions for tracking active reading
CREATE TABLE IF NOT EXISTS reading_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    library_id TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    chapters_read INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (library_id) REFERENCES library(id) ON DELETE CASCADE
);

-- Annotations (highlights, notes) within chapters
CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    library_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    chapter_url TEXT,
    type TEXT DEFAULT 'highlight' CHECK(type IN ('highlight', 'note', 'underline')),
    color TEXT DEFAULT 'yellow',
    selected_text TEXT NOT NULL,
    note TEXT,
    -- Position tracking using character offsets within chapter content
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    -- For paragraph-based positioning (more reliable across content changes)
    paragraph_index INTEGER,
    paragraph_text_preview TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    synced_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (library_id) REFERENCES library(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_library_user ON library(user_id);
CREATE INDEX IF NOT EXISTS idx_library_status ON library(user_id, status);
CREATE INDEX IF NOT EXISTS idx_progress_user ON reading_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_stats_user_date ON reading_stats(user_id, date);
CREATE INDEX IF NOT EXISTS idx_annotations_user ON annotations(user_id);
CREATE INDEX IF NOT EXISTS idx_annotations_library ON annotations(library_id, chapter_index);
`;

// Run schema initialization
db.exec(initSchema);

// Migrations - add new columns if they don't exist
const migrations = [
    // Migration 1: Add TTS engine columns
    {
        name: 'add_tts_engine_columns',
        check: () => {
            const info = db.prepare("PRAGMA table_info(users)").all();
            return !info.some(col => col.name === 'tts_engine');
        },
        run: () => {
            db.exec(`
                ALTER TABLE users ADD COLUMN tts_engine TEXT DEFAULT 'piper';
                ALTER TABLE users ADD COLUMN tts_edge_voice TEXT DEFAULT 'en-US-AriaNeural';
            `);
            console.log('[DB] Migration: Added tts_engine columns');
        }
    }
];

// Run pending migrations
migrations.forEach(migration => {
    try {
        if (migration.check()) {
            migration.run();
        }
    } catch (error) {
        console.error('[DB] Migration error (' + migration.name + '):', error.message);
    }
});

console.log('[DB] Database initialized at:', DB_PATH);

module.exports = db;
