const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const router = express.Router();

// JWT secret - in production, use environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'libread-secret-key-change-in-production';
const JWT_EXPIRES_IN = '30d';

// Password requirements
const MIN_PASSWORD_LENGTH = 6;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// Optional auth - doesn't fail if no token, but adds user if present
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (!err) {
                req.user = user;
            }
        });
    }
    next();
}

// Register new user
router.post('/register', async (req, res) => {
    try {
        const { email, username, password } = req.body;

        // Validation
        if (!email || !username || !password) {
            return res.status(400).json({ error: 'Email, username, and password are required' });
        }

        if (!EMAIL_REGEX.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        if (username.length < 3 || username.length > 30) {
            return res.status(400).json({ error: 'Username must be 3-30 characters' });
        }

        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
        }

        if (password.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        }

        // Check if email or username already exists
        const existingUser = db.prepare(
            'SELECT id FROM users WHERE email = ? OR username = ?'
        ).get(email.toLowerCase(), username.toLowerCase());

        if (existingUser) {
            return res.status(409).json({ error: 'Email or username already registered' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // Create user
        const userId = uuidv4();
        const now = new Date().toISOString();

        db.prepare(`
            INSERT INTO users (id, email, username, password_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, email.toLowerCase(), username.toLowerCase(), passwordHash, now, now);

        // Generate JWT
        const token = jwt.sign(
            { userId, username: username.toLowerCase(), email: email.toLowerCase() },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.status(201).json({
            message: 'Registration successful',
            user: {
                id: userId,
                email: email.toLowerCase(),
                username: username.toLowerCase()
            },
            token
        });

    } catch (error) {
        console.error('[Auth] Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { login, password } = req.body; // login can be email or username

        if (!login || !password) {
            return res.status(400).json({ error: 'Login and password are required' });
        }

        // Find user by email or username
        const user = db.prepare(`
            SELECT id, email, username, password_hash, tts_speed, tts_voice, tts_prefer_phonemes, theme
            FROM users WHERE email = ? OR username = ?
        `).get(login.toLowerCase(), login.toLowerCase());

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        db.prepare('UPDATE users SET last_login = ? WHERE id = ?')
            .run(new Date().toISOString(), user.id);

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, username: user.username, email: user.email },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                preferences: {
                    ttsSpeed: user.tts_speed,
                    ttsVoice: user.tts_voice,
                    ttsPreferPhonemes: !!user.tts_prefer_phonemes,
                    theme: user.theme
                }
            },
            token
        });

    } catch (error) {
        console.error('[Auth] Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Get current user profile
router.get('/me', authenticateToken, (req, res) => {
    try {
        const user = db.prepare(`
            SELECT id, email, username, created_at, last_login,
                   tts_speed, tts_voice, tts_prefer_phonemes, theme
            FROM users WHERE id = ?
        `).get(req.user.userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get reading stats
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as books_in_library,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as books_completed,
                SUM(CASE WHEN status = 'reading' THEN 1 ELSE 0 END) as books_reading
            FROM library WHERE user_id = ?
        `).get(req.user.userId);

        res.json({
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                createdAt: user.created_at,
                lastLogin: user.last_login,
                preferences: {
                    ttsSpeed: user.tts_speed,
                    ttsVoice: user.tts_voice,
                    ttsPreferPhonemes: !!user.tts_prefer_phonemes,
                    theme: user.theme
                }
            },
            stats: {
                booksInLibrary: stats.books_in_library || 0,
                booksCompleted: stats.books_completed || 0,
                booksReading: stats.books_reading || 0
            }
        });

    } catch (error) {
        console.error('[Auth] Get profile error:', error);
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

// Update user preferences
router.patch('/preferences', authenticateToken, (req, res) => {
    try {
        const { ttsSpeed, ttsVoice, ttsPreferPhonemes, theme } = req.body;
        const updates = [];
        const params = [];

        if (ttsSpeed !== undefined) {
            updates.push('tts_speed = ?');
            params.push(parseFloat(ttsSpeed) || 1.0);
        }
        if (ttsVoice !== undefined) {
            updates.push('tts_voice = ?');
            params.push(ttsVoice);
        }
        if (ttsPreferPhonemes !== undefined) {
            updates.push('tts_prefer_phonemes = ?');
            params.push(ttsPreferPhonemes ? 1 : 0);
        }
        if (theme !== undefined) {
            updates.push('theme = ?');
            params.push(theme);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No preferences to update' });
        }

        updates.push('updated_at = ?');
        params.push(new Date().toISOString());
        params.push(req.user.userId);

        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

        res.json({ message: 'Preferences updated' });

    } catch (error) {
        console.error('[Auth] Update preferences error:', error);
        res.status(500).json({ error: 'Failed to update preferences' });
    }
});

// Change password
router.post('/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new password are required' });
        }

        if (newPassword.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        }

        const user = db.prepare('SELECT password_hash FROM users WHERE id = ?')
            .get(req.user.userId);

        const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const salt = await bcrypt.genSalt(10);
        const newHash = await bcrypt.hash(newPassword, salt);

        db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
            .run(newHash, new Date().toISOString(), req.user.userId);

        res.json({ message: 'Password changed successfully' });

    } catch (error) {
        console.error('[Auth] Change password error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// Verify token (for checking if still logged in)
router.get('/verify', authenticateToken, (req, res) => {
    res.json({ valid: true, user: req.user });
});

module.exports = { router, authenticateToken, optionalAuth };
