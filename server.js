const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const upload = multer();

// Import routes
const { router: authRouter } = require('./routes/auth');
const libraryRouter = require('./routes/library');

const app = express();

// Environment configuration with defaults
const PORT = process.env.PORT || 3001;
const LIBREAD_URL = process.env.LIBREAD_URL || 'https://libread.com';
// TTS API URLs - Default to localhost for local dev, Docker uses env vars
const PIPER_TTS_API_URL = process.env.PRONOUNCEX_TTS_API || 'http://localhost:8000';
const EDGE_TTS_API_URL = process.env.EDGE_TTS_API || 'http://localhost:8001';
// Legacy support - default TTS engine
const TTS_API_URL = PIPER_TTS_API_URL;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : ['http://localhost:3001', 'http://127.0.0.1:3001'];
const NODE_ENV = process.env.NODE_ENV || 'development';

// URL whitelist for proxy security
const ALLOWED_PROXY_DOMAINS = [
    'libread.com',
    'www.libread.com',
    'freewebnovel.com',
    'www.freewebnovel.com'
];

// Input validation helpers
function isValidString(value, maxLength = 500) {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isValidUrl(urlString) {
    try {
        const url = new URL(urlString);
        return ['http:', 'https:'].includes(url.protocol);
    } catch {
        return false;
    }
}

function isAllowedProxyUrl(urlString) {
    try {
        const url = new URL(urlString);
        return ALLOWED_PROXY_DOMAINS.some(domain => 
            url.hostname === domain || url.hostname.endsWith('.' + domain)
        );
    } catch {
        return false;
    }
}

function sanitizeInput(str) {
    if (typeof str !== 'string') return '';
    return str.trim().slice(0, 500);
}

// CORS configuration - restrictive in production, permissive in development
const corsOptions = NODE_ENV === 'production' 
    ? {
        origin: (origin, callback) => {
            // Allow requests with no origin (mobile apps, curl, etc.) in some cases
            if (!origin) return callback(null, true);
            if (ALLOWED_ORIGINS.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Accept', 'X-Requested-With']
    }
    : {}; // Permissive in development

app.use(cors(corsOptions));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));

// Rate limiting
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const proxyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 2000, // Proxy endpoints - increased for development
    message: { error: 'Too many proxy requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const ttsLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10000, // TTS polling needs many requests
    message: { error: 'Too many TTS requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply rate limiting
app.use('/api/tts/', ttsLimiter);
app.use('/api/', proxyLimiter);

// Auth and Library routes
app.use('/api/auth', authRouter);
app.use('/api/library', libraryRouter);

// Request logging
app.use((req, res, next) => {
    if (NODE_ENV !== 'production') {
        console.log(new Date().toISOString() + ' - ' + req.method + ' ' + req.path);
    }
    next();
});

// TTS Settings page
app.get('/settings', (req, res) => {
    res.sendFile(__dirname + '/settings.html');
});

// Helper function to get TTS API URL based on engine selection
function getTtsApiUrl(engine) {
    switch (engine) {
        case 'edge':
        case 'edge-tts':
            return EDGE_TTS_API_URL;
        case 'piper':
        case 'pronouncex':
        default:
            return PIPER_TTS_API_URL;
    }
}

// TTS Proxy - supports multiple engines via ?engine= query param
app.all('/api/tts/*', async (req, res) => {
    try {
        const ttsPath = req.path.replace('/api/tts', '');
        
        // Get engine from query param, body, or default to piper
        const engine = req.query.engine || (req.body && req.body.engine) || 'piper';
        const baseUrl = getTtsApiUrl(engine);
        const targetUrl = baseUrl + ttsPath;
        
        if (NODE_ENV !== 'production') {
            console.log(`[TTS Proxy] Engine: ${engine}, Target: ${targetUrl}`);
        }
        
        const requestOptions = {
            method: req.method,
            headers: {
                'Content-Type': req.headers['content-type'] || 'application/json',
                'Accept': 'application/json, audio/ogg, audio/mpeg'
            }
        };
        
        if (req.method === 'POST' && req.body) {
            // Remove engine from body before forwarding (it's our routing param)
            const bodyToSend = { ...req.body };
            delete bodyToSend.engine;
            requestOptions.body = JSON.stringify(bodyToSend);
        }
        
        const response = await fetch(targetUrl, requestOptions);
        const contentType = response.headers.get('content-type');
        
        if (contentType && contentType.includes('audio')) {
            const audioBuffer = await response.buffer();
            res.set('Content-Type', contentType);
            res.send(audioBuffer);
        } else {
            const data = await response.json();
            res.set('Content-Type', 'application/json');
            res.status(response.status).send(data);
        }
    } catch (error) {
        console.error('[TTS Proxy] Error:', error);
        res.status(500).json({ error: 'TTS proxy error', message: error.message });
    }
});

// LibRead search proxy - handles FormData
app.all('/api/search', upload.none(), async (req, res) => {
    try {
        // Handle POST with FormData or JSON body
        if (req.method === 'POST' && req.body) {
            const searchkey = sanitizeInput(req.body.searchkey);
            if (!isValidString(searchkey, 200)) {
                return res.status(400).json({ error: 'Invalid or missing searchkey parameter' });
            }
            
            const formData = new URLSearchParams();
            formData.append('searchkey', searchkey);
            
            // Fixed: POST to /search endpoint, not root
            const response = await fetch(LIBREAD_URL + '/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Referer': LIBREAD_URL + '/'
                },
                body: formData
            });
            const html = await response.text();
            res.set('Content-Type', 'text/html');
            res.send(html);
            return;
        }
        
        // Handle GET with query parameter
        const query = sanitizeInput(req.query.q);
        if (!query) {
            return res.status(400).json({ error: 'Missing query parameter' });
        }

        let targetUrl;
        if (query.startsWith('http')) {
            if (!isValidUrl(query) || !isAllowedProxyUrl(query)) {
                return res.status(403).json({ error: 'URL not allowed' });
            }
            targetUrl = query;
        } else {
            targetUrl = LIBREAD_URL + '/?q=' + encodeURIComponent(query);
        }
        
        const response = await fetch(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const html = await response.text();
        res.set('Content-Type', 'text/html');
        res.send(html);
    } catch (error) {
        console.error('[Search Proxy] Error:', error);
        res.status(500).json({ error: 'Search proxy error', message: error.message });
    }
});

// Generic proxy - with URL validation
app.get('/api/proxy', async (req, res) => {
    try {
        const targetUrl = sanitizeInput(req.query.url);
        
        if (!targetUrl) {
            return res.status(400).json({ error: 'Missing URL parameter' });
        }
        
        if (!isValidUrl(targetUrl)) {
            return res.status(400).json({ error: 'Invalid URL format' });
        }
        
        if (!isAllowedProxyUrl(targetUrl)) {
            return res.status(403).json({ error: 'URL domain not in whitelist' });
        }

        const response = await fetch(targetUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0', 
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8' 
            }
        });

        const html = await response.text();
        res.set('Content-Type', 'text/html');
        res.send(html);
    } catch (error) {
        console.error('[Proxy] Error:', error);
        res.status(500).json({ error: 'Proxy error', message: error.message });
    }
});

// Chapter list proxy
app.get('/api/chapterlist', async (req, res) => {
    try {
        const aid = sanitizeInput(req.query.aid);
        
        if (!aid || !/^\d+$/.test(aid)) {
            return res.status(400).json({ error: 'Invalid article ID parameter (must be numeric)' });
        }

        const params = new URLSearchParams();
        params.append('aid', aid);

        const response = await fetch(LIBREAD_URL + '/api/chapterlist.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': LIBREAD_URL + '/',
                'Origin': LIBREAD_URL,
                'User-Agent': 'Mozilla/5.0',
                'Accept': '*/*'
            },
            body: params
        });

        const html = await response.text();
        res.set('Content-Type', 'text/html; charset=UTF-8');
        res.send(html);
    } catch (error) {
        console.error('[Chapterlist Proxy] Error:', error);
        res.status(500).json({ error: 'Chapterlist proxy error', message: error.message });
    }
});

// Image proxy - with URL validation
app.get('/api/image', async (req, res) => {
    try {
        const imageUrl = sanitizeInput(req.query.url);
        
        if (!imageUrl) {
            return res.status(400).json({ error: 'Missing image URL parameter' });
        }
        
        if (!isValidUrl(imageUrl)) {
            return res.status(400).json({ error: 'Invalid image URL format' });
        }

        const response = await fetch(imageUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0', 
                'Referer': LIBREAD_URL + '/' 
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({ 
                error: 'Failed to fetch image', 
                status: response.statusText 
            });
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg';
        
        // Validate that response is actually an image
        if (!contentType.startsWith('image/')) {
            return res.status(400).json({ error: 'URL does not point to an image' });
        }
        
        const buffer = await response.buffer();
        
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
        res.set('Access-Control-Allow-Origin', '*');
        res.send(buffer);
    } catch (error) {
        console.error('[Image Proxy] Error:', error);
        res.status(500).json({ error: 'Image proxy error', message: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        environment: NODE_ENV
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log('LibRead Ereader Proxy Server running on http://localhost:' + PORT);
    console.log('Environment:', NODE_ENV);
    console.log('TTS API:', TTS_API_URL);
    console.log('TTS Settings: http://localhost:' + PORT + '/settings');
});

module.exports = app;
