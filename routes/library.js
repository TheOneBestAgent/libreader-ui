const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticateToken } = require('./auth');

const router = express.Router();

// All library routes require authentication
router.use(authenticateToken);

// ==================== LIBRARY (Books) ====================

// Get user's library
router.get('/', (req, res) => {
    try {
        const { status, sort = 'updated_at', order = 'desc' } = req.query;
        
        let query = `
            SELECT l.*, 
                   p.chapter_index, p.chapter_title, p.scroll_position, p.updated_at as progress_updated
            FROM library l
            LEFT JOIN reading_progress p ON l.id = p.library_id
            WHERE l.user_id = ?
        `;
        const params = [req.user.userId];
        
        if (status) {
            query += ' AND l.status = ?';
            params.push(status);
        }
        
        // Validate sort field
        const allowedSorts = ['updated_at', 'added_at', 'novel_title', 'status'];
        const sortField = allowedSorts.includes(sort) ? sort : 'updated_at';
        const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        
        query += ` ORDER BY l.${sortField} ${sortOrder}`;
        
        const books = db.prepare(query).all(...params);
        
        res.json({
            books: books.map(b => ({
                id: b.id,
                novelUrl: b.novel_url,
                novelTitle: b.novel_title,
                novelCover: b.novel_cover,
                author: b.author,
                totalChapters: b.total_chapters,
                status: b.status,
                addedAt: b.added_at,
                updatedAt: b.updated_at,
                progress: {
                    chapterIndex: b.chapter_index || 0,
                    chapterTitle: b.chapter_title,
                    scrollPosition: b.scroll_position || 0,
                    lastRead: b.progress_updated
                }
            })),
            total: books.length
        });
        
    } catch (error) {
        console.error('[Library] Get library error:', error);
        res.status(500).json({ error: 'Failed to get library' });
    }
});

// Add book to library
router.post('/', (req, res) => {
    try {
        const { novelUrl, novelTitle, novelCover, author, totalChapters } = req.body;
        
        if (!novelUrl || !novelTitle) {
            return res.status(400).json({ error: 'Novel URL and title are required' });
        }
        
        // Check if already in library
        const existing = db.prepare(
            'SELECT id FROM library WHERE user_id = ? AND novel_url = ?'
        ).get(req.user.userId, novelUrl);
        
        if (existing) {
            return res.status(409).json({ 
                error: 'Book already in library',
                libraryId: existing.id 
            });
        }
        
        const libraryId = uuidv4();
        const progressId = uuidv4();
        const now = new Date().toISOString();
        
        // Insert book
        db.prepare(`
            INSERT INTO library (id, user_id, novel_url, novel_title, novel_cover, author, total_chapters, added_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(libraryId, req.user.userId, novelUrl, novelTitle, novelCover || null, author || null, totalChapters || 0, now, now);
        
        // Initialize reading progress
        db.prepare(`
            INSERT INTO reading_progress (id, user_id, library_id, chapter_index, updated_at)
            VALUES (?, ?, ?, 0, ?)
        `).run(progressId, req.user.userId, libraryId, now);
        
        res.status(201).json({
            message: 'Book added to library',
            libraryId,
            book: {
                id: libraryId,
                novelUrl,
                novelTitle,
                novelCover,
                author,
                totalChapters,
                status: 'reading',
                progress: { chapterIndex: 0, scrollPosition: 0 }
            }
        });
        
    } catch (error) {
        console.error('[Library] Add book error:', error);
        res.status(500).json({ error: 'Failed to add book' });
    }
});

// Get single book from library
router.get('/:libraryId', (req, res) => {
    try {
        const book = db.prepare(`
            SELECT l.*, 
                   p.chapter_index, p.chapter_title, p.chapter_url, p.scroll_position, p.updated_at as progress_updated
            FROM library l
            LEFT JOIN reading_progress p ON l.id = p.library_id
            WHERE l.id = ? AND l.user_id = ?
        `).get(req.params.libraryId, req.user.userId);
        
        if (!book) {
            return res.status(404).json({ error: 'Book not found' });
        }
        
        // Get bookmarks for this book
        const bookmarks = db.prepare(`
            SELECT * FROM bookmarks WHERE library_id = ? AND user_id = ?
            ORDER BY chapter_index, position
        `).all(req.params.libraryId, req.user.userId);
        
        res.json({
            book: {
                id: book.id,
                novelUrl: book.novel_url,
                novelTitle: book.novel_title,
                novelCover: book.novel_cover,
                author: book.author,
                totalChapters: book.total_chapters,
                status: book.status,
                addedAt: book.added_at,
                updatedAt: book.updated_at,
                progress: {
                    chapterIndex: book.chapter_index || 0,
                    chapterTitle: book.chapter_title,
                    chapterUrl: book.chapter_url,
                    scrollPosition: book.scroll_position || 0,
                    lastRead: book.progress_updated
                }
            },
            bookmarks: bookmarks.map(b => ({
                id: b.id,
                chapterIndex: b.chapter_index,
                chapterTitle: b.chapter_title,
                position: b.position,
                note: b.note,
                createdAt: b.created_at
            }))
        });
        
    } catch (error) {
        console.error('[Library] Get book error:', error);
        res.status(500).json({ error: 'Failed to get book' });
    }
});

// Update book in library (status, metadata)
router.patch('/:libraryId', (req, res) => {
    try {
        const { status, totalChapters, novelCover, author } = req.body;
        const updates = [];
        const params = [];
        
        if (status) {
            const validStatuses = ['want_to_read', 'reading', 'completed', 'dropped'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({ error: 'Invalid status' });
            }
            updates.push('status = ?');
            params.push(status);
        }
        if (totalChapters !== undefined) {
            updates.push('total_chapters = ?');
            params.push(totalChapters);
        }
        if (novelCover !== undefined) {
            updates.push('novel_cover = ?');
            params.push(novelCover);
        }
        if (author !== undefined) {
            updates.push('author = ?');
            params.push(author);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        updates.push('updated_at = ?');
        params.push(new Date().toISOString());
        params.push(req.params.libraryId);
        params.push(req.user.userId);
        
        const result = db.prepare(`
            UPDATE library SET ${updates.join(', ')} WHERE id = ? AND user_id = ?
        `).run(...params);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Book not found' });
        }
        
        res.json({ message: 'Book updated' });
        
    } catch (error) {
        console.error('[Library] Update book error:', error);
        res.status(500).json({ error: 'Failed to update book' });
    }
});

// Remove book from library
router.delete('/:libraryId', (req, res) => {
    try {
        const result = db.prepare(
            'DELETE FROM library WHERE id = ? AND user_id = ?'
        ).run(req.params.libraryId, req.user.userId);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Book not found' });
        }
        
        res.json({ message: 'Book removed from library' });
        
    } catch (error) {
        console.error('[Library] Delete book error:', error);
        res.status(500).json({ error: 'Failed to remove book' });
    }
});

// ==================== READING PROGRESS ====================

// Update reading progress
router.put('/:libraryId/progress', (req, res) => {
    try {
        const { chapterIndex, chapterTitle, chapterUrl, scrollPosition } = req.body;
        
        if (chapterIndex === undefined) {
            return res.status(400).json({ error: 'Chapter index is required' });
        }
        
        const now = new Date().toISOString();
        
        // Update or insert progress
        const existing = db.prepare(
            'SELECT id FROM reading_progress WHERE library_id = ? AND user_id = ?'
        ).get(req.params.libraryId, req.user.userId);
        
        if (existing) {
            db.prepare(`
                UPDATE reading_progress 
                SET chapter_index = ?, chapter_title = ?, chapter_url = ?, scroll_position = ?, updated_at = ?
                WHERE id = ?
            `).run(chapterIndex, chapterTitle || null, chapterUrl || null, scrollPosition || 0, now, existing.id);
        } else {
            const progressId = uuidv4();
            db.prepare(`
                INSERT INTO reading_progress (id, user_id, library_id, chapter_index, chapter_title, chapter_url, scroll_position, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(progressId, req.user.userId, req.params.libraryId, chapterIndex, chapterTitle || null, chapterUrl || null, scrollPosition || 0, now);
        }
        
        // Update library updated_at
        db.prepare('UPDATE library SET updated_at = ? WHERE id = ?')
            .run(now, req.params.libraryId);
        
        res.json({ message: 'Progress updated' });
        
    } catch (error) {
        console.error('[Library] Update progress error:', error);
        res.status(500).json({ error: 'Failed to update progress' });
    }
});

// ==================== BOOKMARKS ====================

// Get bookmarks for a book
router.get('/:libraryId/bookmarks', (req, res) => {
    try {
        const bookmarks = db.prepare(`
            SELECT * FROM bookmarks WHERE library_id = ? AND user_id = ?
            ORDER BY chapter_index, position
        `).all(req.params.libraryId, req.user.userId);
        
        res.json({
            bookmarks: bookmarks.map(b => ({
                id: b.id,
                chapterIndex: b.chapter_index,
                chapterTitle: b.chapter_title,
                position: b.position,
                note: b.note,
                createdAt: b.created_at
            }))
        });
        
    } catch (error) {
        console.error('[Library] Get bookmarks error:', error);
        res.status(500).json({ error: 'Failed to get bookmarks' });
    }
});

// Add bookmark
router.post('/:libraryId/bookmarks', (req, res) => {
    try {
        const { chapterIndex, chapterTitle, position, note } = req.body;
        
        if (chapterIndex === undefined) {
            return res.status(400).json({ error: 'Chapter index is required' });
        }
        
        const bookmarkId = uuidv4();
        const now = new Date().toISOString();
        
        db.prepare(`
            INSERT INTO bookmarks (id, user_id, library_id, chapter_index, chapter_title, position, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(bookmarkId, req.user.userId, req.params.libraryId, chapterIndex, chapterTitle || null, position || 0, note || null, now);
        
        res.status(201).json({
            message: 'Bookmark added',
            bookmark: {
                id: bookmarkId,
                chapterIndex,
                chapterTitle,
                position,
                note,
                createdAt: now
            }
        });
        
    } catch (error) {
        console.error('[Library] Add bookmark error:', error);
        res.status(500).json({ error: 'Failed to add bookmark' });
    }
});

// Delete bookmark
router.delete('/:libraryId/bookmarks/:bookmarkId', (req, res) => {
    try {
        const result = db.prepare(
            'DELETE FROM bookmarks WHERE id = ? AND library_id = ? AND user_id = ?'
        ).run(req.params.bookmarkId, req.params.libraryId, req.user.userId);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Bookmark not found' });
        }
        
        res.json({ message: 'Bookmark deleted' });
        
    } catch (error) {
        console.error('[Library] Delete bookmark error:', error);
        res.status(500).json({ error: 'Failed to delete bookmark' });
    }
});

// ==================== STATISTICS ====================

// Update reading stats (called periodically while reading)
router.post('/:libraryId/stats', (req, res) => {
    try {
        const { timeSpent, wordsRead, chaptersRead } = req.body;
        const today = new Date().toISOString().split('T')[0];
        
        // Try to update existing record for today
        const existing = db.prepare(`
            SELECT id, time_spent_seconds, words_read, chapters_read 
            FROM reading_stats 
            WHERE user_id = ? AND library_id = ? AND date = ?
        `).get(req.user.userId, req.params.libraryId, today);
        
        if (existing) {
            db.prepare(`
                UPDATE reading_stats 
                SET time_spent_seconds = time_spent_seconds + ?,
                    words_read = words_read + ?,
                    chapters_read = chapters_read + ?
                WHERE id = ?
            `).run(timeSpent || 0, wordsRead || 0, chaptersRead || 0, existing.id);
        } else {
            const statsId = uuidv4();
            db.prepare(`
                INSERT INTO reading_stats (id, user_id, library_id, date, time_spent_seconds, words_read, chapters_read)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(statsId, req.user.userId, req.params.libraryId, today, timeSpent || 0, wordsRead || 0, chaptersRead || 0);
        }
        
        res.json({ message: 'Stats updated' });
        
    } catch (error) {
        console.error('[Library] Update stats error:', error);
        res.status(500).json({ error: 'Failed to update stats' });
    }
});

// Get reading statistics
router.get('/stats/summary', (req, res) => {
    try {
        const { days = 30 } = req.query;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(days));
        const startDateStr = startDate.toISOString().split('T')[0];
        
        // Overall stats
        const overall = db.prepare(`
            SELECT 
                SUM(time_spent_seconds) as total_time,
                SUM(words_read) as total_words,
                SUM(chapters_read) as total_chapters
            FROM reading_stats 
            WHERE user_id = ? AND date >= ?
        `).get(req.user.userId, startDateStr);
        
        // Daily breakdown
        const daily = db.prepare(`
            SELECT date, SUM(time_spent_seconds) as time, SUM(words_read) as words, SUM(chapters_read) as chapters
            FROM reading_stats
            WHERE user_id = ? AND date >= ?
            GROUP BY date
            ORDER BY date DESC
        `).all(req.user.userId, startDateStr);
        
        // Per book stats
        const perBook = db.prepare(`
            SELECT l.novel_title, 
                   SUM(s.time_spent_seconds) as time,
                   SUM(s.words_read) as words,
                   SUM(s.chapters_read) as chapters
            FROM reading_stats s
            JOIN library l ON s.library_id = l.id
            WHERE s.user_id = ? AND s.date >= ?
            GROUP BY s.library_id
            ORDER BY time DESC
            LIMIT 10
        `).all(req.user.userId, startDateStr);
        
        res.json({
            period: `Last ${days} days`,
            overall: {
                totalTimeSeconds: overall.total_time || 0,
                totalTimeFormatted: formatTime(overall.total_time || 0),
                totalWords: overall.total_words || 0,
                totalChapters: overall.total_chapters || 0
            },
            daily,
            perBook
        });
        
    } catch (error) {
        console.error('[Library] Get stats error:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// Helper function to format time
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

// ==================== IMPORT/EXPORT ====================

// Export all user data
router.get('/export', (req, res) => {
    try {
        const user = db.prepare(
            'SELECT id, email, username, created_at, tts_speed, tts_voice, tts_prefer_phonemes, theme FROM users WHERE id = ?'
        ).get(req.user.userId);
        
        const library = db.prepare(`
            SELECT l.*, p.chapter_index, p.chapter_title, p.chapter_url, p.scroll_position
            FROM library l
            LEFT JOIN reading_progress p ON l.id = p.library_id
            WHERE l.user_id = ?
        `).all(req.user.userId);
        
        const bookmarks = db.prepare(
            'SELECT * FROM bookmarks WHERE user_id = ?'
        ).all(req.user.userId);
        
        const stats = db.prepare(
            'SELECT * FROM reading_stats WHERE user_id = ?'
        ).all(req.user.userId);
        
        const exportData = {
            exportDate: new Date().toISOString(),
            version: '1.0',
            user: {
                username: user.username,
                email: user.email,
                createdAt: user.created_at,
                preferences: {
                    ttsSpeed: user.tts_speed,
                    ttsVoice: user.tts_voice,
                    ttsPreferPhonemes: !!user.tts_prefer_phonemes,
                    theme: user.theme
                }
            },
            library: library.map(l => ({
                novelUrl: l.novel_url,
                novelTitle: l.novel_title,
                novelCover: l.novel_cover,
                author: l.author,
                totalChapters: l.total_chapters,
                status: l.status,
                addedAt: l.added_at,
                progress: {
                    chapterIndex: l.chapter_index,
                    chapterTitle: l.chapter_title,
                    chapterUrl: l.chapter_url,
                    scrollPosition: l.scroll_position
                }
            })),
            bookmarks: bookmarks.map(b => ({
                novelUrl: library.find(l => l.id === b.library_id)?.novel_url,
                chapterIndex: b.chapter_index,
                chapterTitle: b.chapter_title,
                position: b.position,
                note: b.note,
                createdAt: b.created_at
            })),
            stats: stats
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="libread-export-${user.username}-${new Date().toISOString().split('T')[0]}.json"`);
        res.json(exportData);
        
    } catch (error) {
        console.error('[Library] Export error:', error);
        res.status(500).json({ error: 'Failed to export data' });
    }
});

// Import user data
router.post('/import', (req, res) => {
    try {
        const { library: importLibrary, bookmarks: importBookmarks } = req.body;
        
        if (!importLibrary || !Array.isArray(importLibrary)) {
            return res.status(400).json({ error: 'Invalid import data' });
        }
        
        let imported = 0;
        let skipped = 0;
        
        const now = new Date().toISOString();
        
        for (const book of importLibrary) {
            // Check if already exists
            const existing = db.prepare(
                'SELECT id FROM library WHERE user_id = ? AND novel_url = ?'
            ).get(req.user.userId, book.novelUrl);
            
            if (existing) {
                skipped++;
                continue;
            }
            
            const libraryId = uuidv4();
            const progressId = uuidv4();
            
            // Insert book
            db.prepare(`
                INSERT INTO library (id, user_id, novel_url, novel_title, novel_cover, author, total_chapters, status, added_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                libraryId, req.user.userId, book.novelUrl, book.novelTitle, 
                book.novelCover || null, book.author || null, book.totalChapters || 0,
                book.status || 'reading', book.addedAt || now, now
            );
            
            // Insert progress
            if (book.progress) {
                db.prepare(`
                    INSERT INTO reading_progress (id, user_id, library_id, chapter_index, chapter_title, chapter_url, scroll_position, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    progressId, req.user.userId, libraryId,
                    book.progress.chapterIndex || 0,
                    book.progress.chapterTitle || null,
                    book.progress.chapterUrl || null,
                    book.progress.scrollPosition || 0,
                    now
                );
            }
            
            imported++;
        }
        
        // Import bookmarks
        let bookmarksImported = 0;
        if (importBookmarks && Array.isArray(importBookmarks)) {
            for (const bm of importBookmarks) {
                const book = db.prepare(
                    'SELECT id FROM library WHERE user_id = ? AND novel_url = ?'
                ).get(req.user.userId, bm.novelUrl);
                
                if (book) {
                    const bookmarkId = uuidv4();
                    db.prepare(`
                        INSERT INTO bookmarks (id, user_id, library_id, chapter_index, chapter_title, position, note, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(bookmarkId, req.user.userId, book.id, bm.chapterIndex, bm.chapterTitle || null, bm.position || 0, bm.note || null, bm.createdAt || now);
                    bookmarksImported++;
                }
            }
        }
        
        res.json({
            message: 'Import complete',
            booksImported: imported,
            booksSkipped: skipped,
            bookmarksImported
        });
        
    } catch (error) {
        console.error('[Library] Import error:', error);
        res.status(500).json({ error: 'Failed to import data' });
    }
});

module.exports = router;
