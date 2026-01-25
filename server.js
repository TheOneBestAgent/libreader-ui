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
const PIPER_TTS_API_URL = process.env.PRONOUNCEX_TTS_API || 'http://localhost:8001';
const EDGE_TTS_API_URL = process.env.EDGE_TTS_API || 'http://localhost:8001';
// Google Cloud TTS Configuration
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY || '';
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
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Accept', 'X-Requested-With', 'Authorization']
    }
    : {}; // Permissive in development

app.use(cors(corsOptions));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// Security headers (CSP)
app.use((req, res, next) => {
    // Content Security Policy - restrict resource loading
    const cspDirectives = [
        "default-src 'self'",
        // Allow inline scripts/styles (required for existing code) + DOMPurify CDN
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline'",
        // Images from self and allowed image proxy domains
        "img-src 'self' data: blob: https:",
        // Fonts
        "font-src 'self' data:",
        // Connect for API calls and TTS
        "connect-src 'self' https://texttospeech.googleapis.com https://edge.microsoft.com",
        // Media for audio playback
        "media-src 'self' blob:",
        // Frames - none needed
        "frame-ancestors 'none'",
        // Base URI restriction
        "base-uri 'self'"
    ];
    
    res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    next();
});

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
        case 'wavenet':
        case 'google':
        case 'google-tts':
            // WaveNet is handled separately via Google Cloud API
            return null;
        case 'piper':
        case 'pronouncex':
        default:
            return PIPER_TTS_API_URL;
    }
}

// TTS Proxy - supports multiple engines via ?engine= query param
app.all('/api/tts/*', async (req, res) => {
    try {
        // Extract path and preserve query string
        const ttsPath = req.originalUrl.replace('/api/tts', '').split('?')[0];
        
        // Get engine from query param, body, or default to piper
        const engine = req.query.engine || (req.body && req.body.engine) || 'piper';
        
        // Handle Google WaveNet separately (direct API call)
        if (engine === 'wavenet' || engine === 'google' || engine === 'google-tts') {
            return handleGoogleTTS(req, res, ttsPath);
        }
        
        const baseUrl = getTtsApiUrl(engine);
        
        // Build query string, excluding 'engine' param (used for routing only)
        const queryParams = new URLSearchParams();
        for (const [key, value] of Object.entries(req.query)) {
            if (key !== 'engine') {
                queryParams.append(key, value);
            }
        }
        const queryString = queryParams.toString();
        const targetUrl = baseUrl + ttsPath + (queryString ? '?' + queryString : '');
        
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
        
        // Check if response is OK before processing
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            console.error(`[TTS Proxy] Upstream error: ${response.status} - ${errorText}`);
            return res.status(response.status).json({ 
                error: 'TTS upstream error', 
                status: response.status,
                message: response.statusText 
            });
        }
        
        const contentType = response.headers.get('content-type') || '';
        
        if (contentType.includes('audio')) {
            const audioBuffer = await response.buffer();
            res.set('Content-Type', contentType);
            res.send(audioBuffer);
        } else if (contentType.includes('application/json')) {
            const data = await response.json();
            res.set('Content-Type', 'application/json');
            res.status(response.status).send(data);
        } else {
            // Unexpected content type
            console.warn(`[TTS Proxy] Unexpected content-type: ${contentType}`);
            const text = await response.text();
            res.set('Content-Type', 'text/plain');
            res.status(response.status).send(text);
        }
    } catch (error) {
        console.error('[TTS Proxy] Error:', error);
        res.status(500).json({ error: 'TTS proxy error', message: error.message });
    }
});

// Handle Google WaveNet TTS API requests
async function handleGoogleTTS(req, res, path) {
    if (NODE_ENV !== 'production') {
        console.log(`[Google TTS] Path: ${path}, Method: ${req.method}`);
    }
    
    // Check for API key
    if (!GOOGLE_TTS_API_KEY) {
        return res.status(500).json({ 
            error: 'Google TTS API key not configured',
            message: 'Set GOOGLE_TTS_API_KEY environment variable'
        });
    }
    
    // GET /v1/tts/voices - Return list of WaveNet voices
    if (path === '/v1/tts/voices' && req.method === 'GET') {
        const voices = getGoogleWaveNetVoices();
        return res.json({ voices });
    }
    
    // POST /v1/tts/jobs - Create synthesis job
    if (path === '/v1/tts/jobs' && req.method === 'POST') {
        try {
            const { text, voiceName, languageCode, ssmlGender, audioEncoding, speakingRate, pitch, volumeGainDb } = req.body;
            
            if (!text) {
                return res.status(400).json({ error: 'Missing text parameter' });
            }
            
            // Call Google TTS API
            const googleResponse = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    input: { text },
                    voice: {
                        languageCode: languageCode || 'en-US',
                        name: voiceName || 'en-US-Wavenet-D',
                        ssmlGender: ssmlGender || 'MALE'
                    },
                    audioConfig: {
                        audioEncoding: audioEncoding || 'MP3',
                        speakingRate: speakingRate || 1.0,
                        pitch: pitch || 0.0,
                        volumeGainDb: volumeGainDb || 0.0,
                        sampleRateHertz: 24000
                    }
                })
            });
            
            if (!googleResponse.ok) {
                const errorData = await googleResponse.json();
                console.error('[Google TTS] API Error:', errorData);
                return res.status(500).json({ 
                    error: 'Google TTS API error', 
                    message: errorData.error?.message || 'Unknown error' 
                });
            }
            
            const data = await googleResponse.json();
            
            // Return job-like response for compatibility
            res.json({
                job_id: 'wavenet_' + Date.now(),
                status: 'complete',
                audio_content: data.audioContent,  // Base64-encoded audio
                segments: [{
                    segment_id: 0,
                    audio_url: null,  // Direct audio returned
                    text: text.substring(0, 100),
                    start_time: 0,
                    end_time: null
                }]
            });
        } catch (error) {
            console.error('[Google TTS] Synthesis error:', error);
            res.status(500).json({ error: 'Synthesis failed', message: error.message });
        }
        return;
    }
    
    // Handle other paths
    res.status(404).json({ error: 'Endpoint not found for Google TTS' });
}

// Get list of Google WaveNet voices
function getGoogleWaveNetVoices() {
    return [
        // English (US)
        { name: 'en-US-Wavenet-A', languageCode: 'en-US', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        { name: 'en-US-Wavenet-B', languageCode: 'en-US', ssmlGender: 'MALE', natural_sample_rate_hertz: 24000 },
        { name: 'en-US-Wavenet-C', languageCode: 'en-US', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        { name: 'en-US-Wavenet-D', languageCode: 'en-US', ssmlGender: 'MALE', natural_sample_rate_hertz: 24000 },
        { name: 'en-US-Wavenet-E', languageCode: 'en-US', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        { name: 'en-US-Wavenet-F', languageCode: 'en-US', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        // English (UK)
        { name: 'en-GB-Wavenet-A', languageCode: 'en-GB', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        { name: 'en-GB-Wavenet-B', languageCode: 'en-GB', ssmlGender: 'MALE', natural_sample_rate_hertz: 24000 },
        { name: 'en-GB-Wavenet-C', languageCode: 'en-GB', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        { name: 'en-GB-Wavenet-D', languageCode: 'en-GB', ssmlGender: 'MALE', natural_sample_rate_hertz: 24000 },
        // English (Australia)
        { name: 'en-AU-Wavenet-A', languageCode: 'en-AU', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        { name: 'en-AU-Wavenet-B', languageCode: 'en-AU', ssmlGender: 'MALE', natural_sample_rate_hertz: 24000 },
        // Spanish
        { name: 'es-ES-Wavenet-A', languageCode: 'es-ES', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        { name: 'es-ES-Wavenet-B', languageCode: 'es-ES', ssmlGender: 'MALE', natural_sample_rate_hertz: 24000 },
        // French
        { name: 'fr-FR-Wavenet-A', languageCode: 'fr-FR', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        { name: 'fr-FR-Wavenet-B', languageCode: 'fr-FR', ssmlGender: 'MALE', natural_sample_rate_hertz: 24000 },
        // German
        { name: 'de-DE-Wavenet-A', languageCode: 'de-DE', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        { name: 'de-DE-Wavenet-B', languageCode: 'de-DE', ssmlGender: 'MALE', natural_sample_rate_hertz: 24000 },
        // Italian
        { name: 'it-IT-Wavenet-A', languageCode: 'it-IT', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        // Portuguese
        { name: 'pt-PT-Wavenet-A', languageCode: 'pt-PT', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        { name: 'pt-PT-Wavenet-B', languageCode: 'pt-PT', ssmlGender: 'MALE', natural_sample_rate_hertz: 24000 },
        // Japanese
        { name: 'ja-JP-Wavenet-A', languageCode: 'ja-JP', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        { name: 'ja-JP-Wavenet-B', languageCode: 'ja-JP', ssmlGender: 'MALE', natural_sample_rate_hertz: 24000 },
        // Korean
        { name: 'ko-KR-Wavenet-A', languageCode: 'ko-KR', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        // Chinese
        { name: 'zh-CN-Wavenet-A', languageCode: 'zh-CN', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        { name: 'zh-CN-Wavenet-B', languageCode: 'zh-CN', ssmlGender: 'MALE', natural_sample_rate_hertz: 24000 },
        // Russian
        { name: 'ru-RU-Wavenet-A', languageCode: 'ru-RU', ssmlGender: 'FEMALE', natural_sample_rate_hertz: 24000 },
        { name: 'ru-RU-Wavenet-B', languageCode: 'ru-RU', ssmlGender: 'MALE', natural_sample_rate_hertz: 24000 },
    ];
}

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

// Image proxy - with URL validation and SSRF protection
// Allowed domains for image proxying (prevent SSRF attacks)
const ALLOWED_IMAGE_DOMAINS = [
    'libread.com', 'www.libread.com',
    'freewebnovel.com', 'www.freewebnovel.com',
    'lightnovelworld.com', 'www.lightnovelworld.com',
    'novelupdates.com', 'www.novelupdates.com',
    'wuxiaworld.com', 'www.wuxiaworld.com',
    'webnovel.com', 'www.webnovel.com',
    'royalroad.com', 'www.royalroad.com',
    // CDN domains commonly used by novel sites
    'cdn.libread.com', 'img.libread.com',
    'cdn.novelupdates.com',
    'i.imgur.com', 'imgur.com'
];

// Check if IP is private/internal (SSRF protection)
function isPrivateIP(hostname) {
    // Block localhost and common private IP patterns
    const privatePatterns = [
        /^localhost$/i,
        /^127\./,
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
        /^192\.168\./,
        /^169\.254\./,
        /^0\./,
        /^::1$/,
        /^fe80:/i,
        /^fc00:/i,
        /^fd00:/i
    ];
    return privatePatterns.some(pattern => pattern.test(hostname));
}

app.get('/api/image', async (req, res) => {
    try {
        const imageUrl = sanitizeInput(req.query.url);
        
        if (!imageUrl) {
            return res.status(400).json({ error: 'Missing image URL parameter' });
        }
        
        if (!isValidUrl(imageUrl)) {
            return res.status(400).json({ error: 'Invalid image URL format' });
        }

        // SSRF Protection: Validate hostname
        let urlObj;
        try {
            urlObj = new URL(imageUrl);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid URL' });
        }

        const hostname = urlObj.hostname.toLowerCase();

        // Block private/internal IPs
        if (isPrivateIP(hostname)) {
            console.warn(`[Image Proxy] Blocked private IP access attempt: ${hostname}`);
            return res.status(403).json({ error: 'Access to internal resources is forbidden' });
        }

        // Check against allowlist
        if (!ALLOWED_IMAGE_DOMAINS.includes(hostname)) {
            console.warn(`[Image Proxy] Blocked non-allowlisted domain: ${hostname}`);
            return res.status(403).json({ 
                error: 'Domain not allowed',
                message: 'Only images from approved novel sites are permitted'
            });
        }

        // Only allow HTTPS in production
        if (NODE_ENV === 'production' && urlObj.protocol !== 'https:') {
            return res.status(400).json({ error: 'Only HTTPS URLs are allowed' });
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
