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
const POCKET_TTS_API_URL = process.env.POCKET_TTS_API || 'http://localhost:8002';
const ESPEAK_TTS_API_URL = process.env.ESPEAK_TTS_API || 'http://localhost:8003';
// Vast.ai Serverless Bark TTS
const VASTAI_TTS_ENDPOINT = process.env.VASTAI_TTS_ENDPOINT || 'bark-tts';
const VASTAI_API_KEY = process.env.VASTAI_API_KEY || '';

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
        // Allow inline scripts/styles + CDNs for DOMPurify
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
        // Allow inline styles + Google Fonts
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        // Images from self and allowed image proxy domains
        "img-src 'self' data: blob: https:",
        // Fonts from Google and self
        "font-src 'self' data: https://fonts.gstatic.com",
        // Connect for API calls - allow self (proxy handles external calls)
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
        case 'pocket':
        case 'pocket-tts':
            return POCKET_TTS_API_URL;
        case 'espeak':
        case 'espeak-ng':
            return ESPEAK_TTS_API_URL;
        case 'vastai':
        case 'bark':
            return 'vastai'; // Special marker for Vast.ai serverless
        case 'piper':
        case 'pronouncex':
        default:
            return PIPER_TTS_API_URL;
    }
}

// Vast.ai Bark TTS job storage (in-memory, for demo - use Redis in production)
const vastaiJobs = new Map();

// Helper: Handle Vast.ai Bark TTS synthesis
async function handleVastaiTts(text, voice) {
    if (!VASTAI_API_KEY) {
        throw new Error('Vast.ai API key not configured. Set VASTAI_API_KEY environment variable.');
    }
    
    // Get worker URL from Vast.ai serverless
    const routeResponse = await fetch('https://run.vast.ai/route/', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${VASTAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ endpoint: VASTAI_TTS_ENDPOINT, cost: 100 })
    });
    
    const routeData = await routeResponse.json();
    
    if (routeData.status && !routeData.url) {
        // Worker is spinning up
        return { 
            status: 'spinning_up', 
            message: routeData.status,
            estimated_wait: '1-2 minutes for cold start'
        };
    }
    
    if (!routeData.url) {
        throw new Error('No Vast.ai worker available: ' + JSON.stringify(routeData));
    }
    
    // Send synthesis request to worker
    const workerUrl = routeData.url.replace(/\/$/, '');
    const synthResponse = await fetch(`${workerUrl}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: voice || 'v2/en_speaker_6' })
    });
    
    if (!synthResponse.ok) {
        const errText = await synthResponse.text();
        throw new Error(`Vast.ai synthesis failed: ${synthResponse.status} - ${errText}`);
    }
    
    return await synthResponse.json();
}

// TTS Proxy - supports multiple engines via ?engine= query param
app.all('/api/tts/*', async (req, res) => {
    try {
        // Extract path and preserve query string
        const ttsPath = req.originalUrl.replace('/api/tts', '').split('?')[0];
        
        // Get engine from query param, body, or default to edge
        const engine = req.query.engine || (req.body && req.body.engine) || 'edge';
        
        const baseUrl = getTtsApiUrl(engine);
        
        // Special handling for Vast.ai Bark TTS
        if (baseUrl === 'vastai') {
            return await handleVastaiRequest(req, res, ttsPath);
        }
        
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

// Handle Vast.ai TTS requests (job-based API compatible with TTSClient)
async function handleVastaiRequest(req, res, ttsPath) {
    const method = req.method;
    
    if (NODE_ENV !== 'production') {
        console.log(`[Vast.ai TTS] ${method} ${ttsPath}`);
    }
    
    try {
        // POST /v1/tts/jobs - Create synthesis job
        if (method === 'POST' && ttsPath === '/v1/tts/jobs') {
            const { text, voice } = req.body;
            
            if (!text) {
                return res.status(400).json({ error: 'Missing text parameter' });
            }
            
            // Generate job ID
            const jobId = `vastai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Start synthesis in background
            vastaiJobs.set(jobId, { status: 'processing', created: Date.now() });
            
            // Async synthesis
            handleVastaiTts(text, voice)
                .then(result => {
                    if (result.status === 'spinning_up') {
                        vastaiJobs.set(jobId, { 
                            status: 'queued', 
                            message: result.message,
                            created: Date.now()
                        });
                    } else if (result.status === 'success' && result.audio) {
                        vastaiJobs.set(jobId, {
                            status: 'completed',
                            audio: result.audio,
                            duration: result.duration,
                            sample_rate: result.sample_rate,
                            created: Date.now()
                        });
                    } else {
                        vastaiJobs.set(jobId, { 
                            status: 'error', 
                            error: result.error || 'Unknown error',
                            created: Date.now()
                        });
                    }
                })
                .catch(error => {
                    vastaiJobs.set(jobId, { 
                        status: 'error', 
                        error: error.message,
                        created: Date.now()
                    });
                });
            
            return res.json({ job_id: jobId, status: 'processing' });
        }
        
        // GET /v1/tts/jobs/:jobId - Get job status
        const jobMatch = ttsPath.match(/^\/v1\/tts\/jobs\/([^\/]+)$/);
        if (method === 'GET' && jobMatch) {
            const jobId = jobMatch[1];
            const job = vastaiJobs.get(jobId);
            
            if (!job) {
                return res.status(404).json({ error: 'Job not found' });
            }
            
            // Return job-compatible format
            const response = {
                job_id: jobId,
                status: job.status,
                segments: job.status === 'completed' ? [{
                    id: 0,
                    status: 'ready',
                    audio_url: `/v1/tts/jobs/${jobId}/audio.wav`
                }] : []
            };
            
            if (job.error) response.error = job.error;
            if (job.message) response.message = job.message;
            if (job.duration) response.duration = job.duration;
            
            return res.json(response);
        }
        
        // GET /v1/tts/jobs/:jobId/audio.wav - Get audio
        const audioMatch = ttsPath.match(/^\/v1\/tts\/jobs\/([^\/]+)\/audio\.(wav|mp3)$/);
        if (method === 'GET' && audioMatch) {
            const jobId = audioMatch[1];
            const job = vastaiJobs.get(jobId);
            
            if (!job) {
                return res.status(404).json({ error: 'Job not found' });
            }
            
            if (job.status !== 'completed' || !job.audio) {
                return res.status(202).json({ status: job.status, message: 'Audio not ready yet' });
            }
            
            // Decode base64 audio and send
            const audioBuffer = Buffer.from(job.audio, 'base64');
            res.set('Content-Type', 'audio/wav');
            res.send(audioBuffer);
            
            // Clean up job after audio is retrieved (optional)
            // setTimeout(() => vastaiJobs.delete(jobId), 60000);
            return;
        }
        
        // GET /v1/tts/voices - Return available Bark voices
        if (method === 'GET' && ttsPath === '/v1/tts/voices') {
            return res.json({
                voices: [
                    { short_name: 'v2/en_speaker_6', name: 'Male Narrator', gender: 'Male', locale: 'en-US' },
                    { short_name: 'v2/en_speaker_9', name: 'Female Narrator', gender: 'Female', locale: 'en-US' },
                    { short_name: 'v2/en_speaker_1', name: 'Calm Male', gender: 'Male', locale: 'en-US' },
                    { short_name: 'v2/en_speaker_2', name: 'Young Female', gender: 'Female', locale: 'en-US' },
                    { short_name: 'v2/en_speaker_3', name: 'British Male', gender: 'Male', locale: 'en-GB' },
                    { short_name: 'v2/en_speaker_4', name: 'British Female', gender: 'Female', locale: 'en-GB' },
                ]
            });
        }
        
        // GET /health - Health check
        if (method === 'GET' && (ttsPath === '/health' || ttsPath === '/v1/health')) {
            return res.json({ 
                status: 'ok', 
                engine: 'vastai-bark',
                endpoint: VASTAI_TTS_ENDPOINT,
                configured: !!VASTAI_API_KEY
            });
        }
        
        // Unknown endpoint
        return res.status(404).json({ error: 'Unknown Vast.ai TTS endpoint', path: ttsPath });
        
    } catch (error) {
        console.error('[Vast.ai TTS] Error:', error);
        return res.status(500).json({ error: 'Vast.ai TTS error', message: error.message });
    }
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0'
            },
            redirect: 'follow',  // Follow redirects (libread.com -> freewebnovel.com)
            follow: 10           // Max 10 redirects
        });

        if (!response.ok) {
            console.error(`[Proxy] libread.com returned ${response.status} for: ${targetUrl}`);
            return res.status(response.status).json({ error: 'Upstream error', status: response.status, url: targetUrl });
        }

        const html = await response.text();
        res.set('Content-Type', 'text/html');
        res.set('X-Proxy-Status', 'success');
        res.send(html);
    } catch (error) {
        console.error('[Proxy] Fetch error for:', targetUrl, '-', error.message);
        res.status(502).json({ error: 'Upstream unavailable', message: error.message, url: targetUrl });
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
