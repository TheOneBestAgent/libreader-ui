// LibRead Ereader Application
// Based on QuickNovel's LibReadProvider.kt implementation

const PROXY_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001/api'
    : '/api';
const API_BASE = 'https://libread.com';

// HTML escaping utility to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Helper function to clean chapter titles (DRY principle)
function cleanChapterTitle(rawTitle, fallbackIndex) {
    let title = rawTitle.replace(/<\/?[^>]+(>|$)/g, '').trim();
    title = title.replace(/^Chapter\s*\d+[:\-\s]*/i, '').trim();
    title = title.replace(/^C\.?\d+[:\.\-\s]*/i, '').trim();
    title = title.replace(/\s+/g, ' ').trim();
    return title || `Chapter ${fallbackIndex + 1}`;
}

function proxifyImage(imageUrl) {
    if (!imageUrl) return null;
    if (imageUrl.includes('/api/image')) return imageUrl;
    let absoluteUrl = imageUrl;
    if (!imageUrl.startsWith('http')) {
        absoluteUrl = imageUrl.startsWith('//') ? 'https:' + imageUrl : (imageUrl.startsWith('/') ? API_BASE + imageUrl : API_BASE + '/' + imageUrl);
    }
    return `${PROXY_BASE}/image?url=${encodeURIComponent(absoluteUrl)}`;
}

const state = {
    novels: [],
    currentNovel: null,
    currentChapter: null,
    currentChapterIndex: 0,
    chapters: [],
    theme: localStorage.getItem('theme') || 'light'
};

document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    setupEventListeners();
    initializeTTSManager();
    console.log('📚 LibRead Ereader initialized (QuickNovel method)');
});

function initializeTheme() {
    if (state.theme === 'dark') document.body.setAttribute('data-theme', 'dark');
}

function toggleTheme() {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', state.theme);
    localStorage.setItem('theme', state.theme);
}

function setupEventListeners() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchNovels();
        });
    }
}

// TTS Manager implementation
const ttsManager = {
    client: null,
    audio: null,
    isPlaying: false,
    isPaused: false,
    currentJobId: null,
    speed: 1.0,

    init() {
        if (typeof TTSClient !== 'undefined') {
            this.client = new TTSClient('/api/tts');
        }
        this.audio = new Audio();
        this.audio.addEventListener('ended', () => this.onAudioEnded());
        this.audio.addEventListener('error', (e) => this.onAudioError(e));
    },

    async play() {
        if (this.isPaused && this.audio.src) {
            this.audio.play();
            this.isPaused = false;
            this.isPlaying = true;
            this.updateUI();
            return;
        }

        const chapterContent = document.getElementById('chapterContent');
        if (!chapterContent || !this.client) {
            this.updateStatus('TTS not available');
            return;
        }

        const text = chapterContent.innerText;
        if (!text || text.length < 10) {
            this.updateStatus('No content to read');
            return;
        }

        try {
            this.updateStatus('Synthesizing...');
            const result = await this.client.synthesize(text);
            this.currentJobId = result.job_id;

            await this.client.pollJobStatus(result.job_id, (status) => {
                this.updateStatus(`Processing: ${status.progress || 0}%`);
                this.updateProgress(status.progress || 0);
            });

            const audioUrl = this.client.getAudioUrl(result.job_id);
            this.audio.src = audioUrl;
            this.audio.playbackRate = this.speed;
            await this.audio.play();
            
            this.isPlaying = true;
            this.isPaused = false;
            this.updateStatus('Playing');
            this.updateUI();
        } catch (error) {
            console.error('[TTS] Play error:', error);
            this.updateStatus('Error: ' + error.message);
        }
    },

    pause() {
        if (this.isPlaying && !this.isPaused) {
            this.audio.pause();
            this.isPaused = true;
            this.isPlaying = false;
            this.updateStatus('Paused');
            this.updateUI();
        }
    },

    stop() {
        this.audio.pause();
        this.audio.currentTime = 0;
        this.isPlaying = false;
        this.isPaused = false;
        this.updateStatus('Stopped');
        this.updateUI();
    },

    async cancel() {
        if (this.currentJobId && this.client) {
            try {
                await this.client.cancelJob(this.currentJobId);
            } catch (e) {
                console.error('[TTS] Cancel error:', e);
            }
        }
        this.stop();
        this.currentJobId = null;
        this.updateStatus('Cancelled');
    },

    setSpeed(speed) {
        this.speed = parseFloat(speed);
        if (this.audio) {
            this.audio.playbackRate = this.speed;
        }
    },

    onAudioEnded() {
        this.isPlaying = false;
        this.isPaused = false;
        this.updateStatus('Finished');
        this.updateUI();
    },

    onAudioError(e) {
        console.error('[TTS] Audio error:', e);
        this.isPlaying = false;
        this.isPaused = false;
        this.updateStatus('Audio error');
        this.updateUI();
    },

    updateStatus(text) {
        const statusEl = document.getElementById('ttsStatus');
        if (statusEl) statusEl.textContent = text;
    },

    updateProgress(percent) {
        const fillEl = document.getElementById('ttsProgressFill');
        const textEl = document.getElementById('ttsProgressText');
        if (fillEl) fillEl.style.width = percent + '%';
        if (textEl) textEl.textContent = `${percent}% complete`;
    },

    updateUI() {
        const playBtn = document.getElementById('ttsPlayBtn');
        const pauseBtn = document.getElementById('ttsPauseBtn');
        const stopBtn = document.getElementById('ttsStopBtn');
        const cancelBtn = document.getElementById('ttsCancelBtn');

        if (playBtn) playBtn.disabled = this.isPlaying;
        if (pauseBtn) pauseBtn.disabled = !this.isPlaying;
        if (stopBtn) stopBtn.disabled = !this.isPlaying && !this.isPaused;
        if (cancelBtn) cancelBtn.disabled = !this.currentJobId;
    }
};

function initializeTTSManager() {
    ttsManager.init();
}

async function fetchFromAPI(endpoint, options = {}) {
    try {
        const useProxy = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        let url;
        if (useProxy) {
            const targetUrl = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
            // Use proxy endpoint for chapter pages and novel pages
            if (endpoint.includes('/chapter-') || endpoint.includes('/libread/')) {
                url = `${PROXY_BASE}/proxy?url=${encodeURIComponent(targetUrl)}`;
            } else {
                url = `${PROXY_BASE}/search?q=${encodeURIComponent(targetUrl)}`;
            }
        } else {
            url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
        }
        console.log('Fetching:', url);
        const response = await fetch(url, options);
        if (!response.ok) throw new Error('Network response was not ok: ' + response.status);
        const html = await response.text();
        return parseHTML(html);
    } catch (error) {
        console.error('API Error:', error);
        return null;
    }
}

async function postToAPI(endpoint, data = {}) {
    try {
        const useProxy = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        let url, requestOptions;
        if (useProxy) {
            if (endpoint.includes('chapterlist.php')) {
                url = `${PROXY_BASE}/chapterlist?aid=${data.aid}`;
                requestOptions = { method: 'GET' };
            } else if (endpoint.includes('/search')) {
                // Use POST to send searchkey to the proxy
                url = `${PROXY_BASE}/search`;
                requestOptions = { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ searchkey: data.searchkey })
                };
            } else {
                url = `${PROXY_BASE}/search?q=${endpoint}`;
                requestOptions = { method: 'GET' };
            }
        } else {
            const formData = new FormData();
            Object.keys(data).forEach(key => formData.append(key, data[key]));
            url = `${API_BASE}${endpoint}`;
            requestOptions = { method: 'POST', body: formData };
        }
        console.log('POST to:', url);
        const response = await fetch(url, requestOptions);
        if (!response.ok) throw new Error('Network response was not ok: ' + response.status);
        return await response.text();
    } catch (error) {
        console.error('POST Error:', error);
        return null;
    }
}

function parseHTML(html) {
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
}

function showHome() {
    // Fixed: Changed from 'welcomePage' to 'welcomeView' to match index.html
    document.getElementById('welcomeView').classList.remove('hidden');
    document.getElementById('mainContent').classList.remove('active');
    document.getElementById('novelDetailView').classList.remove('active');
    state.currentNovel = null;
}

function showMainContent() {
    // Fixed: Changed from 'welcomePage' to 'welcomeView' to match index.html
    document.getElementById('welcomeView').classList.add('hidden');
    document.getElementById('mainContent').classList.add('active');
    document.getElementById('novelDetailView').classList.remove('active');
}

async function loadLatestNovels() {
    showMainContent();
    showLoading();
    const doc = await fetchFromAPI('/sort/latest-release/1');
    if (doc) {
        state.novels = parseNovelsFromPage(doc);
        displayNovels(state.novels);
        updateStats();
    }
}

async function searchNovels() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) return;
    showMainContent();
    showLoading();
    const html = await postToAPI('/search', { searchkey: query });
    if (html) {
        const doc = parseHTML(html);
        state.novels = parseNovelsFromPage(doc);
        displayNovels(state.novels);
    }
}

function parseNovelsFromPage(doc) {
    const novels = [];
    const seenIds = new Set();
    const novelItems = doc.querySelectorAll('.ul-list1 .li, .ul-list2 .li, .li-row');
    
    novelItems.forEach(item => {
        const titleLink = item.querySelector('h3.tit a, .tit a, .s1 a, a[href*="/lib/"]');
        if (!titleLink) return;
        
        const title = titleLink.getAttribute('title') || titleLink.textContent.trim();
        const url = titleLink.getAttribute('href');
        if (!url) return;
        
        const novelId = extractNovelId(url);
        if (seenIds.has(novelId)) return;
        seenIds.add(novelId);
        
        const img = item.querySelector('div.pic a img, .pic img, img');
        const cover = img ? img.getAttribute('src') : null;
        
        const genreLinks = item.querySelectorAll('.s2 a, .right .novel, a[href*="/genre/"]');
        const genres = Array.from(genreLinks).map(g => g.textContent.trim()).slice(0, 3);
        
        novels.push({
            id: novelId,
            title,
            url: url.startsWith('http') ? url : `${API_BASE}${url}`,
            cover: cover ? (cover.startsWith('http') ? cover : `${API_BASE}${cover}`) : null,
            genres,
            rating: 0,
            chapters: 0
        });
    });
    
    return novels;
}

function extractNovelId(url) {
    const match = url.match(/(\d+)(?:\/|$|\.html)/);
    return match ? match[1] : url.split('/').pop().replace('.html', '');
}

async function loadNovelDetails(novelId) {
    const novel = state.novels.find(n => n.id === novelId);
    if (!novel) return;
    
    state.currentNovel = novel;
    
    // Fixed: Changed from 'welcomePage' to 'welcomeView' to match index.html
    document.getElementById('welcomeView').classList.add('hidden');
    document.getElementById('mainContent').classList.remove('active');
    document.getElementById('novelDetailView').classList.add('active');
    
    document.getElementById('novelTitle').textContent = novel.title;
    document.getElementById('novelMeta').textContent = novel.genres.join(' • ');
    document.getElementById('chapterList').innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading chapters...</p></div>';
    
    try {
        // Use proxy to fetch the novel page (avoids CORS)
        const novelPath = novel.url.replace(API_BASE, '');
        const doc = await fetchFromAPI(novelPath);
        
        if (doc) {
            // Parse chapters directly from the novel page
            parseChaptersFromPage(doc, novel);
        } else {
            // Fallback: try the chapterlist API
            const aidMatch = novel.url.match(/(\d+)/);
            const aid = aidMatch ? aidMatch[1] : novelId;
            
            const chaptersData = await postToAPI('/api/chapterlist.php', { aid });
            if (chaptersData) {
                parseChaptersFromAPI(chaptersData, novel);
            } else {
                document.getElementById('chapterList').innerHTML = '<p style="color: var(--accent-terracotta);">Failed to load chapters</p>';
            }
        }
    } catch (error) {
        console.error('Error loading novel:', error);
        document.getElementById('chapterList').innerHTML = '<p style="color: var(--accent-terracotta);">Error loading chapters</p>';
    }
}

function parseChaptersFromAPI(apiHtml, novel) {
    console.log('=== parseChaptersFromAPI (QuickNovel method) ===');
    
    const chapters = [];
    const doc = parseHTML(apiHtml);
    
    // Try to find chapters in ul-list5 (the actual chapter list on libread.com)
    const chapterListItems = doc.querySelectorAll('ul.ul-list5 li, .chapter-list a, a[href*="chapter-"]');
    console.log('Chapter list items found:', chapterListItems.length);
    
    if (chapterListItems.length > 0) {
        // Parse from the visible chapter list
        chapterListItems.forEach((item, index) => {
            const link = item.tagName === 'A' ? item : item.querySelector('a');
            if (!link) return;
            
            const href = link.getAttribute('href');
            const fullTitle = link.textContent.trim();
            const titleAttr = link.getAttribute('title') || fullTitle;
            
            // Use helper function for title cleaning
            const title = cleanChapterTitle(titleAttr, index);
            
            const chapterUrl = href.startsWith('http') ? href : `${API_BASE}${href}`;
            const chapterNum = extractChapterNumber(chapterUrl);
            
            chapters.push({
                index,
                number: chapterNum || index + 1,
                title,
                url: chapterUrl
            });
        });
    } else {
        // Fallback: Try to parse from option tags (QuickNovel API method)
        console.log('No ul-list5 found, trying option tags...');
        const options = doc.querySelectorAll('option');
        
        options.forEach((option, index) => {
            const value = option.getAttribute('value');
            const rawTitle = option.textContent.trim();
            
            // Use helper function for title cleaning
            const title = cleanChapterTitle(rawTitle, index);
            
            if (value) {
                const chapterSlug = value.split('/').filter(Boolean).pop();
                const chapterUrl = `${API_BASE}${value}`;
                const chapterNum = extractChapterNumber(chapterSlug);
                
                chapters.push({
                    index,
                    number: chapterNum || index + 1,
                    title,
                    url: chapterUrl
                });
            }
        });
    }
    
    state.chapters = chapters.sort((a, b) => a.number - b.number);
    console.log('Total chapters loaded:', state.chapters.length);
    
    displayChapterList();
    
    if (state.chapters.length > 0) {
        loadChapter(0);
    }
}

function parseChaptersFromPage(doc, novel) {
    console.log('=== parseChaptersFromPage ===');
    const chapters = [];
    const seenUrls = new Set();
    
    // Try multiple selectors for chapter links
    // libread.com uses: ul.ul-list5 li a, or #idData li a
    const chapterSelectors = [
        '#idData li a',
        'ul.ul-list5 li a',
        '.chapter-list a',
        'a[href*="chapter-"]'
    ];
    
    let chapterLinks = [];
    for (const selector of chapterSelectors) {
        chapterLinks = doc.querySelectorAll(selector);
        if (chapterLinks.length > 0) {
            console.log(`Found ${chapterLinks.length} chapters with selector: ${selector}`);
            break;
        }
    }
    
    chapterLinks.forEach((link, index) => {
        const href = link.getAttribute('href');
        if (!href || !href.includes('chapter')) return;
        
        // Avoid duplicates
        if (seenUrls.has(href)) return;
        seenUrls.add(href);
        
        const chapterNum = extractChapterNumber(href);
        const titleAttr = link.getAttribute('title') || link.textContent.trim();
        const title = cleanChapterTitle(titleAttr, index);
        
        chapters.push({
            index: chapters.length,
            number: chapterNum || chapters.length + 1,
            title: title,
            url: href.startsWith('http') ? href : `${API_BASE}${href}`
        });
    });
    
    // Sort by chapter number
    state.chapters = chapters.sort((a, b) => a.number - b.number);
    
    // Re-index after sorting
    state.chapters.forEach((ch, idx) => ch.index = idx);
    
    console.log('Total chapters loaded:', state.chapters.length);
    displayChapterList();
    
    if (state.chapters.length > 0) {
        loadChapter(0);
    } else {
        document.getElementById('chapterList').innerHTML = '<p style="color: var(--text-muted);">No chapters found</p>';
        document.getElementById('chapterContent').innerHTML = '<p style="text-align: center;">No chapters available for this novel.</p>';
    }
}

function extractChapterNumber(url) {
    const match = url.match(/chapter-?(\d+)/i);
    return match ? parseInt(match[1]) : 0;
}

async function loadChapter(chapterIndex) {
    console.log('=== loadChapter ===', chapterIndex);
    
    if (chapterIndex < 0 || chapterIndex >= state.chapters.length) return;
    
    state.currentChapterIndex = chapterIndex;
    const chapter = state.chapters[chapterIndex];
    
    console.log('Loading:', chapter.title);
    console.log('URL:', chapter.url);
    
    document.querySelectorAll('.chapter-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeChapterItem = document.querySelector(`.chapter-item[data-index="${chapterIndex}"]`);
    if (activeChapterItem) {
        activeChapterItem.classList.add('active');
    }
    
    document.getElementById('chapterContent').innerHTML = '<p style="text-align: center; padding: 2rem;"><div class="loading-spinner"></div><br>Loading chapter...</p>';
    
    // Stop any playing TTS when changing chapters
    if (ttsManager.isPlaying || ttsManager.isPaused) {
        ttsManager.stop();
    }
    
    try {
        const doc = await fetchFromAPI(chapter.url.replace(API_BASE, ''));
        
        if (doc) {
            const content = parseChapterContent(doc, chapter);
            displayChapter(content, chapter);
            updateChapterNavigation();
            console.log('✓ Chapter loaded');
        } else {
            console.error('Failed - doc is null');
            document.getElementById('chapterContent').innerHTML = '<p style="text-align: center; color: var(--accent-terracotta);">Failed to load chapter</p>';
        }
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('chapterContent').innerHTML = '<p style="text-align: center; color: var(--accent-terracotta);">Failed to load chapter</p>';
    }
}

function parseChapterContent(doc, chapter) {
    // Try multiple selectors for chapter content
    // libread.com uses: div.txt
    // freewebnovel.com uses: div#article
    let contentElement = doc.querySelector('div#article, div.txt, .chapter-content, #chapter-content, .novel-content, .content, #content, article');
    
    if (contentElement) {
        let content = contentElement.innerHTML;
        
        // QuickNovel lines 92-97: Remove obfuscated domain
        content = content.replace(
            /\uD835\uDCF5\uD835\uDC8A\uD835\uDC83\uD835\uDE67\uD835\uDE5A\uD835\uDC82\uD835\uDCED.\uD835\uDCEC\uD835\uDE64\uD835\uDE62/g,
            ''
        );
        content = content.replace(/libread\.com/gi, '');
        content = content.replace(/freewebnovel\.com/gi, '');
        
        content = content
            .replace(/<script[^>]*>.*?<\/script>/gis, '')
            .replace(/<style[^>]*>.*?<\/style>/gis, '')
            .replace(/<!--.*?-->/gs, '')
            .replace(/<div[^>]*style=["'][^"']*text-align:\s*center[^"']*["'][^>]*>.*?<\/div>/gis, '');
        
        // Clean up whitespace but preserve paragraph structure
        content = content.replace(/\s{2,}/g, ' ').replace(/>\s+</g, '><');
        
        console.log('Content parsed from selector:', contentElement.tagName + (contentElement.id ? '#' + contentElement.id : ''), 'length:', content.length);
        return content;
    }
    
    console.log('Content element not found, looking for paragraphs...');
    
    // Fallback: Look for paragraphs with substantial content
    const paragraphs = doc.querySelectorAll('p');
    if (paragraphs.length > 5) {
        const validParagraphs = Array.from(paragraphs).filter(p => {
            const text = p.textContent.trim();
            return text.length > 20; // Only include meaningful paragraphs
        });
        
        if (validParagraphs.length > 0) {
            console.log('Found', validParagraphs.length, 'valid paragraphs');
            return validParagraphs.map(p => {
                // Preserve any HTML formatting within the paragraph
                return `<p>${p.innerHTML.trim()}</p>`;
            }).join('');
        }
    }
    
    console.log('No content found, document structure:', doc.body?.innerHTML?.substring(0, 500));
    return '<p>No content available. The chapter may have been moved or requires a different access method.</p>';
}

function displayNovels(novels) {
    const grid = document.getElementById('novelGrid');
    if (!grid) return;
    
    if (novels.length === 0) {
        grid.innerHTML = '<div class="loading"><p>No novels found.</p></div>';
        return;
    }
    
    grid.innerHTML = novels.map(novel => {
        const proxifiedCover = proxifyImage(novel.cover);
        // XSS fix: escape HTML in title
        const safeTitle = escapeHtml(novel.title);
        const safeId = escapeHtml(novel.id);
        return `
        <div class="novel-card" onclick="openNovel('${safeId}')">
            <img class="novel-cover" 
                 src="${proxifiedCover || 'https://via.placeholder.com/200x267'}" 
                 alt="${safeTitle}"
                 onerror="this.src='https://via.placeholder.com/200x267'">
            <div class="novel-info">
                <h3 class="novel-title">${safeTitle}</h3>
            </div>
        </div>
    `}).join('');
}

function displayChapterList() {
    const listContainer = document.getElementById('chapterList');
    if (!listContainer) return;
    
    const displayCount = Math.min(state.chapters.length, 100);
    const displayChapters = state.chapters.slice(0, displayCount);
    
    listContainer.innerHTML = displayChapters.map(chapter => {
        // XSS fix: escape HTML in chapter title
        const safeTitle = escapeHtml(chapter.title);
        return `
        <div class="chapter-item" data-index="${chapter.index}" onclick="loadChapter(${chapter.index})">
            <span class="chapter-number">Ch. ${chapter.number}</span>
            <span class="chapter-title">${safeTitle}</span>
        </div>
    `}).join('');
    
    if (state.chapters.length > displayCount) {
        listContainer.innerHTML += `<div style="text-align: center; padding: 1rem; color: var(--text-muted);">Showing ${displayCount} of ${state.chapters.length} chapters...</div>`;
    }
}

function displayChapter(content, chapter) {
    const contentDiv = document.getElementById('chapterContent');
    // XSS fix: escape HTML in chapter title (content is intentionally HTML)
    const safeTitle = escapeHtml(chapter.title);
    contentDiv.innerHTML = `
        <h2 style="text-align: center; margin-bottom: 2rem;">Chapter ${chapter.number}: ${safeTitle}</h2>
        ${content}
    `;
    document.querySelector('.chapter-content-panel').scrollTop = 0;
}

function updateChapterNavigation() {
    const prevBtn = document.getElementById('prevChapter');
    const nextBtn = document.getElementById('nextChapter');
    prevBtn.disabled = state.currentChapterIndex === 0;
    nextBtn.disabled = state.currentChapterIndex >= state.chapters.length - 1;
}

function navigateChapter(direction) {
    const newIndex = state.currentChapterIndex + direction;
    if (newIndex >= 0 && newIndex < state.chapters.length) {
        loadChapter(newIndex);
    }
}

function openNovel(novelId) {
    loadNovelDetails(novelId);
}

function showLoading() {
    document.getElementById('novelGrid').innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading...</p></div>';
}

function showError(message) {
    // XSS fix: escape HTML in error message
    const safeMessage = escapeHtml(message);
    document.getElementById('novelGrid').innerHTML = `<div class="loading"><p style="color: var(--accent-terracotta);">${safeMessage}</p></div>`;
}

function updateStats() {
    document.getElementById('totalNovels').textContent = state.novels.length;
    const totalChapters = state.novels.reduce((sum, novel) => sum + (novel.chapters || 0), 0);
    document.getElementById('totalChapters').textContent = totalChapters.toLocaleString();
}
