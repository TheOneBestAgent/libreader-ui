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
    
    // Chapter jump input - Enter key support
    const chapterJumpInput = document.getElementById('chapterJumpInput');
    if (chapterJumpInput) {
        chapterJumpInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                jumpToChapter();
            }
        });
    }
    
    // Global keyboard shortcuts
    setupKeyboardShortcuts();
}

// Keyboard shortcuts for TTS and navigation
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Don't trigger shortcuts when typing in input fields
        const activeElement = document.activeElement;
        const isTyping = activeElement.tagName === 'INPUT' || 
                         activeElement.tagName === 'TEXTAREA' ||
                         activeElement.isContentEditable;
        
        if (isTyping) return;
        
        // Don't trigger if modifier keys are held (except for specific combos)
        const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
        
        switch (e.key) {
            // TTS Controls
            case ' ':  // Space - Play/Pause TTS
                e.preventDefault();
                if (ttsManager.isPlaying) {
                    ttsManager.pause();
                } else {
                    ttsManager.play();
                }
                break;
                
            case 'k':  // K - Also play/pause (YouTube-style)
            case 'K':
                if (!hasModifier) {
                    e.preventDefault();
                    if (ttsManager.isPlaying) {
                        ttsManager.pause();
                    } else {
                        ttsManager.play();
                    }
                }
                break;
                
            case 's':  // S - Stop TTS
            case 'S':
                if (!hasModifier) {
                    e.preventDefault();
                    ttsManager.stop();
                }
                break;
                
            case ',':  // Comma - Skip backward
            case '<':
                if (!hasModifier) {
                    e.preventDefault();
                    ttsManager.skipBackward();
                }
                break;
                
            case '.':  // Period - Skip forward
            case '>':
                if (!hasModifier) {
                    e.preventDefault();
                    ttsManager.skipForward();
                }
                break;
                
            // Chapter Navigation
            case 'j':  // J - Previous chapter
            case 'J':
                if (!hasModifier) {
                    e.preventDefault();
                    navigateChapter(-1);
                }
                break;
                
            case 'l':  // L - Next chapter
            case 'L':
                if (!hasModifier) {
                    e.preventDefault();
                    navigateChapter(1);
                }
                break;
                
            case 'ArrowLeft':  // Left arrow - Previous chapter
                if (!hasModifier) {
                    e.preventDefault();
                    navigateChapter(-1);
                }
                break;
                
            case 'ArrowRight':  // Right arrow - Next chapter
                if (!hasModifier) {
                    e.preventDefault();
                    navigateChapter(1);
                }
                break;
                
            // Volume controls
            case 'ArrowUp':  // Up arrow - Volume up
                if (!hasModifier && ttsManager.audioContext) {
                    e.preventDefault();
                    const currentVol = ttsManager.gainNode?.gain.value || 1.0;
                    ttsManager.setVolume(Math.min(1.0, currentVol + 0.1));
                }
                break;
                
            case 'ArrowDown':  // Down arrow - Volume down
                if (!hasModifier && ttsManager.audioContext) {
                    e.preventDefault();
                    const currentVol = ttsManager.gainNode?.gain.value || 1.0;
                    ttsManager.setVolume(Math.max(0, currentVol - 0.1));
                }
                break;
                
            case 'm':  // M - Mute/unmute
            case 'M':
                if (!hasModifier) {
                    e.preventDefault();
                    ttsManager.toggleMute();
                }
                break;
                
            // UI Controls
            case 'Escape':  // Escape - Close modals
                closeAuthModal();
                closeLibraryPanel();
                closeUserDropdown();
                break;
                
            case '/':  // Forward slash - Focus search
                if (!hasModifier) {
                    e.preventDefault();
                    const searchInput = document.getElementById('searchInput');
                    if (searchInput) searchInput.focus();
                }
                break;
                
            case '?':  // Question mark - Show keyboard shortcuts help
                if (!hasModifier) {
                    e.preventDefault();
                    showKeyboardShortcutsHelp();
                }
                break;
        }
    });
}

// Show keyboard shortcuts help modal
function showKeyboardShortcutsHelp() {
    // Check if modal already exists
    let modal = document.getElementById('keyboardShortcutsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'keyboardShortcutsModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal keyboard-shortcuts-modal">
                <button class="modal-close" onclick="closeKeyboardShortcutsHelp()">&times;</button>
                <h2>Keyboard Shortcuts</h2>
                <div class="shortcuts-grid">
                    <div class="shortcut-section">
                        <h3>TTS Playback</h3>
                        <div class="shortcut-item"><kbd>Space</kbd> or <kbd>K</kbd> <span>Play / Pause</span></div>
                        <div class="shortcut-item"><kbd>S</kbd> <span>Stop</span></div>
                        <div class="shortcut-item"><kbd>,</kbd> <span>Skip backward</span></div>
                        <div class="shortcut-item"><kbd>.</kbd> <span>Skip forward</span></div>
                        <div class="shortcut-item"><kbd>↑</kbd> / <kbd>↓</kbd> <span>Volume up / down</span></div>
                        <div class="shortcut-item"><kbd>M</kbd> <span>Mute / Unmute</span></div>
                    </div>
                    <div class="shortcut-section">
                        <h3>Navigation & Reading</h3>
                        <div class="shortcut-item"><kbd>J</kbd> or <kbd>←</kbd> <span>Previous chapter</span></div>
                        <div class="shortcut-item"><kbd>L</kbd> or <kbd>→</kbd> <span>Next chapter</span></div>
                        <div class="shortcut-item"><kbd>+</kbd> / <kbd>-</kbd> <span>Font size</span></div>
                        <div class="shortcut-item"><kbd>/</kbd> <span>Focus search</span></div>
                        <div class="shortcut-item"><kbd>Esc</kbd> <span>Close modals</span></div>
                        <div class="shortcut-item"><kbd>?</kbd> <span>Show this help</span></div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.classList.add('active');
}

function closeKeyboardShortcutsHelp() {
    const modal = document.getElementById('keyboardShortcutsModal');
    if (modal) modal.classList.remove('active');
}

// TTS Manager implementation with Web Audio API for gapless playback
// Uses AudioContext and AudioBufferSourceNode for precise timing control
const ttsManager = {
    client: null,
    
    // Web Audio API components
    audioContext: null,
    gainNode: null,           // For volume control and fade-in/out
    currentSource: null,      // Currently playing AudioBufferSourceNode
    
    // Playback state
    isPlaying: false,
    isPaused: false,
    currentJobId: null,
    speed: 1.0,
    
    // Segment streaming state
    segments: [],             // Array of segment info from manifest
    currentSegmentIndex: 0,   // Which segment is currently playing
    segmentQueue: [],         // Ready segments with their AudioBuffers
    isStreaming: false,       // Whether we're in streaming mode
    synthesisComplete: false,
    isSeeking: false,         // True during skip operations to prevent onended race
    
    // Gapless playback - schedule next segment to start exactly when current ends
    nextScheduledTime: 0,     // AudioContext time when next segment should start
    scheduledSources: [],     // Array of scheduled AudioBufferSourceNodes
    
    // Preloading - fetch and decode segments ahead of playback
    preloadQueue: [],         // Segments waiting to be fetched
    preloadedBuffers: new Map(), // segmentId -> AudioBuffer
    fetchingSegments: new Set(), // Segments currently being fetched (prevent duplicates)
    preloadAhead: 3,          // Number of segments to preload ahead
    
    // Timing stats for debugging
    timingStats: null,
    
    // Text highlighting and progress tracking
    textChunks: [],               // Array of text chunks that match segments
    currentChunkIndex: -1,        // Currently playing chunk
    segmentStartTime: 0,          // When current segment started playing
    segmentDuration: 0,           // Duration of current segment
    progressUpdateInterval: null, // Interval for updating seekbar
    autoplayNext: false,          // Auto-play next chapter when done
    originalText: '',             // Store original chapter text

    init() {
        if (typeof TTSClient !== 'undefined') {
            this.client = new TTSClient('/api/tts');
            
            // Load engine preference from localStorage
            this.loadEngineFromSettings();
        }
        
        // Don't create AudioContext until user interaction (browser autoplay policy)
        // Will be created on first play()
        
        // Load autoplay preference
        this.loadAutoplayFromSettings();
        
        // Set up seekbar click handler
        this.setupSeekbar();
        
        console.log('[TTS] Manager initialized (Web Audio API mode)');
    },
    
    // Set up clickable seekbar for seeking within audio
    setupSeekbar() {
        document.addEventListener('click', (e) => {
            const progressBar = e.target.closest('.tts-progress-bar');
            if (!progressBar) return;
            
            if (!this.isStreaming || !this.isPlaying) return;
            if (this.segmentDuration <= 0) return;
            
            const rect = progressBar.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percent = clickX / rect.width;
            
            console.log('[TTS] Seekbar clicked at', Math.round(percent * 100) + '%');
            
            // For now, seeking within a single audio segment isn't supported
            // Would need to re-fetch and decode from a specific time offset
            // Show a message instead
            this.updateStatus('Seeking not supported - use skip buttons');
            setTimeout(() => {
                if (this.isPlaying) {
                    this.updateStatus('Playing...');
                }
            }, 2000);
        });
    },
    
    // Load autoplay preference from localStorage
    loadAutoplayFromSettings() {
        try {
            const saved = localStorage.getItem('ttsAutoplayNext');
            this.autoplayNext = saved === 'true';
            const checkbox = document.getElementById('ttsAutoplayNext');
            if (checkbox) checkbox.checked = this.autoplayNext;
        } catch (error) {
            console.warn('[TTS] Failed to load autoplay setting:', error);
        }
    },
    
    // Set autoplay next chapter
    setAutoplayNext(enabled) {
        this.autoplayNext = enabled;
        try {
            localStorage.setItem('ttsAutoplayNext', enabled ? 'true' : 'false');
        } catch (error) {
            console.warn('[TTS] Failed to save autoplay setting:', error);
        }
        console.log('[TTS] Auto-play next chapter:', enabled ? 'enabled' : 'disabled');
    },
    
    // Set up text highlighting - mark paragraphs for highlighting
    setupTextHighlighting(text) {
        const chapterContent = document.getElementById('chapterContent');
        if (!chapterContent) return;
        
        // Get all paragraphs
        const paragraphs = chapterContent.querySelectorAll('p');
        
        if (paragraphs.length > 0) {
            // Simply index each paragraph for highlighting
            // Progress through the audio will estimate which paragraph we're on
            this.textChunks = [];
            
            paragraphs.forEach((p, pIndex) => {
                p.classList.add('tts-sentence');
                p.setAttribute('data-tts-chunk', pIndex.toString());
                this.textChunks.push(p.innerText || '');
            });
            
            console.log('[TTS] Set up highlighting for', paragraphs.length, 'paragraphs');
        } else {
            // No paragraphs - treat whole content as single block
            this.textChunks = [text];
            const wrapper = document.createElement('div');
            wrapper.className = 'tts-sentence';
            wrapper.setAttribute('data-tts-chunk', '0');
            wrapper.innerHTML = chapterContent.innerHTML;
            chapterContent.innerHTML = '';
            chapterContent.appendChild(wrapper);
            console.log('[TTS] Set up highlighting: single block');
        }
        
        this.currentChunkIndex = -1;
    },
    
    
    // Update text highlighting for current paragraph
    updateHighlighting(paragraphIndex) {
        const chapterContent = document.getElementById('chapterContent');
        if (!chapterContent) return;
        
        // Get all highlighted elements
        const allSentences = chapterContent.querySelectorAll('.tts-sentence');
        if (allSentences.length === 0) return;
        
        // Only update if paragraph changed
        if (paragraphIndex === this.currentChunkIndex) return;
        
        // Track current element for scrolling
        let currentElement = null;
        
        // Apply highlighting to all paragraphs
        allSentences.forEach(el => {
            const elIndex = parseInt(el.getAttribute('data-tts-chunk') || '0');
            
            // Remove old classes
            el.classList.remove('tts-current-sentence', 'tts-read-sentence');
            
            // Apply new classes
            if (elIndex < paragraphIndex) {
                el.classList.add('tts-read-sentence');
            } else if (elIndex === paragraphIndex) {
                el.classList.add('tts-current-sentence');
                currentElement = el;
            }
        });
        
        // Update tracking
        this.currentChunkIndex = paragraphIndex;
        
        // Auto-scroll to current paragraph
        if (currentElement) {
            this.scrollToCurrentChunk(currentElement);
        }
    },
    
    // Scroll to the currently highlighted chunk
    scrollToCurrentChunk(element) {
        const currentEl = element || document.querySelector('.tts-current-sentence');
        if (!currentEl) return;
        
        // Get the element's position relative to the viewport
        const rect = currentEl.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        
        // Scroll if element is not in the middle 40% of the viewport
        const topThreshold = viewportHeight * 0.3;
        const bottomThreshold = viewportHeight * 0.6;
        
        if (rect.top < topThreshold || rect.top > bottomThreshold) {
            // Calculate target scroll position to put element in upper third
            const elementTop = rect.top + window.scrollY;
            const targetScroll = elementTop - (viewportHeight * 0.25);
            
            window.scrollTo({
                top: Math.max(0, targetScroll),
                behavior: 'smooth'
            });
        }
    },
    
    // Clear text highlighting
    clearHighlighting() {
        const chapterContent = document.getElementById('chapterContent');
        if (!chapterContent) return;
        
        const allSentences = chapterContent.querySelectorAll('.tts-sentence');
        allSentences.forEach(el => {
            el.classList.remove('tts-current-sentence', 'tts-read-sentence');
        });
        
        this.currentChunkIndex = -1;
    },
    
    // Start progress tracking interval
    startProgressTracking() {
        this.stopProgressTracking();
        
        this.progressUpdateInterval = setInterval(() => {
            this.updatePlaybackProgress();
        }, 100); // Update every 100ms for smooth seekbar
    },
    
    // Stop progress tracking interval
    stopProgressTracking() {
        if (this.progressUpdateInterval) {
            clearInterval(this.progressUpdateInterval);
            this.progressUpdateInterval = null;
        }
    },
    
    // Update playback progress (seekbar and highlighting)
    updatePlaybackProgress() {
        if (!this.isStreaming || !this.isPlaying) return;
        if (!this.audioContext) return;
        
        // Calculate progress within current audio
        let progress = 0;
        let timeRemaining = 0;
        
        if (this.scheduledSources.length > 0 && this.segmentDuration > 0) {
            const now = this.audioContext.currentTime;
            timeRemaining = Math.max(0, this.nextScheduledTime - now);
            const elapsed = this.segmentDuration - timeRemaining;
            progress = (elapsed / this.segmentDuration) * 100;
            progress = Math.max(0, Math.min(100, progress));
        }
        
        // Update seekbar
        const fillEl = document.getElementById('ttsProgressFill');
        if (fillEl) {
            fillEl.style.width = progress + '%';
        }
        
        // Update text with time remaining
        const textEl = document.getElementById('ttsProgressText');
        if (textEl) {
            const remaining = timeRemaining / this.speed;
            if (remaining > 60) {
                const mins = Math.floor(remaining / 60);
                const secs = Math.round(remaining % 60);
                textEl.textContent = `${Math.round(progress)}% - ${mins}m ${secs}s remaining`;
            } else if (remaining > 0) {
                textEl.textContent = `${Math.round(progress)}% - ${Math.round(remaining)}s remaining`;
            } else {
                textEl.textContent = `${Math.round(progress)}% complete`;
            }
        }
        
        // Update highlighting based on progress through text
        // For single-segment playback, estimate which paragraph we're on based on time
        if (this.textChunks && this.textChunks.length > 0) {
            const totalParagraphs = this.textChunks.length;
            const estimatedParagraph = Math.floor((progress / 100) * totalParagraphs);
            const clampedParagraph = Math.max(0, Math.min(estimatedParagraph, totalParagraphs - 1));
            this.updateHighlighting(clampedParagraph);
        }
    },
    
    // Estimate remaining playback time (kept for compatibility)
    estimateRemainingTime(currentSegmentProgress = 0) {
        if (this.segmentDuration <= 0) return null;
        
        const remaining = this.segmentDuration * (1 - currentSegmentProgress) / this.speed;
        
        if (remaining <= 0) return null;
        
        if (remaining < 60) {
            return `${Math.round(remaining)}s`;
        } else {
            const minutes = Math.floor(remaining / 60);
            const seconds = Math.round(remaining % 60);
            return `${minutes}m ${seconds}s`;
        }
    },
    
    // Load TTS engine preference from settings
    loadEngineFromSettings() {
        try {
            const saved = localStorage.getItem('ttsSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                if (settings.engine && this.client) {
                    this.client.setEngine(settings.engine);
                    console.log('[TTS] Engine loaded from settings:', settings.engine);
                }
            }
        } catch (error) {
            console.warn('[TTS] Failed to load engine from settings:', error);
        }
    },
    
    // Set TTS engine (called from settings or externally)
    setEngine(engine) {
        if (this.client) {
            this.client.setEngine(engine);
            console.log('[TTS] Engine changed to:', engine);
        }
    },
    
    // Get current engine
    getEngine() {
        return this.client ? this.client.getEngine() : 'piper';
    },
    
    // Check if current engine supports phonemes
    supportsPhonemes() {
        return this.client ? this.client.supportsPhonemes() : true;
    },
    
    // Get synthesis options based on current settings and engine
    getSynthesisOptions() {
        const options = {};
        
        try {
            const saved = localStorage.getItem('ttsSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                
                // For Edge TTS, pass the selected voice
                if (settings.engine === 'edge' && settings.edgeVoice) {
                    options.voice = settings.edgeVoice;
                }
                
                // For Piper, pass model and phoneme preferences
                if (settings.engine === 'piper' || !settings.engine) {
                    if (settings.model && settings.model !== 'default') {
                        options.model = settings.model;
                    }
                    options.preferPhonemes = settings.preferPhonemes !== false;
                }
            }
        } catch (error) {
            console.warn('[TTS] Failed to load synthesis options:', error);
        }
        
        return options;
    },
    
    // Initialize Web Audio API (called on first user interaction)
    initAudioContext() {
        if (this.audioContext) return;
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create gain node for volume control
            this.gainNode = this.audioContext.createGain();
            this.gainNode.connect(this.audioContext.destination);
            this.gainNode.gain.value = 1.0;
            
            console.log('[TTS] AudioContext initialized, sample rate:', this.audioContext.sampleRate);
        } catch (error) {
            console.error('[TTS] Failed to create AudioContext:', error);
            throw new Error('Web Audio API not supported');
        }
    },
    
    // Resume AudioContext if suspended (browser autoplay policy)
    async resumeAudioContext() {
        if (!this.audioContext) {
            this.initAudioContext();
        }
        
        if (this.audioContext.state === 'suspended') {
            console.log('[TTS] Resuming suspended AudioContext...');
            await this.audioContext.resume();
            console.log('[TTS] AudioContext resumed, state:', this.audioContext.state);
        }
    },

    resetStreamingState() {
        // Stop any scheduled sources
        for (const source of this.scheduledSources) {
            try {
                source.stop();
            } catch (e) {
                // Ignore - source may not have started
            }
        }
        this.scheduledSources = [];
        this.currentSource = null;
        
        this.segments = [];
        this.currentSegmentIndex = -1; // Start at -1 so first segment is index 0
        this.segmentQueue = [];
        this.playedSegmentIds = new Set(); // Track played segments to avoid duplicates
        this.isStreaming = false;
        this.synthesisComplete = false;
        this.timingStats = null;
        this.currentJobIds = []; // For chunked synthesis
        this.isChunked = false;
        
        // Reset preloading state
        this.preloadQueue = [];
        this.preloadedBuffers.clear();
        this.fetchingSegments.clear();
        this.nextScheduledTime = 0;
        
        // Reset progress tracking state
        this.segmentDuration = 0;
        this.segmentStartTime = 0;
        this.currentChunkIndex = -1;
        this.textChunks = [];
    },
    
    // Preprocess text to handle sound effects and special markers
    // IMPORTANT: Keep punctuation intact - Piper uses it for natural pauses!
    preprocessText(text) {
        let processed = text;
        
        // === SOUND EFFECTS - Normalize common vocalizations ===
        processed = processed.replace(/\bhmm+\b/gi, 'hmm');
        processed = processed.replace(/\bumm+\b/gi, 'um');
        processed = processed.replace(/\buh+\b/gi, 'uh');
        processed = processed.replace(/\bah+\b/gi, 'ah');
        processed = processed.replace(/\boh+\b/gi, 'oh');
        processed = processed.replace(/\bugh+\b/gi, 'ugh');
        processed = processed.replace(/\bheh+\b/gi, 'heh');
        processed = processed.replace(/\bhah+\b/gi, 'ha');
        processed = processed.replace(/\baww+\b/gi, 'aww');
        processed = processed.replace(/\bgrrr*\b/gi, 'grr');
        
        // === REMOVE DECORATIVE CHARACTERS ===
        // Remove lone asterisks and other decorative chars (but keep punctuation!)
        processed = processed.replace(/(?<!\*)\*(?!\*)/g, ''); // Single asterisks
        processed = processed.replace(/\*\*+/g, ''); // Multiple asterisks  
        processed = processed.replace(/\^+/g, ''); // Carets
        processed = processed.replace(/##+/g, ''); // Hash marks
        processed = processed.replace(/\|+/g, ''); // Pipes
        processed = processed.replace(/_+/g, ' '); // Underscores to spaces
        processed = processed.replace(/~+/g, ''); // Tildes
        
        // Handle action text in asterisks: *sighs* -> (sighs)
        processed = processed.replace(/\*([^*]+)\*/g, '($1)');
        
        // === SCENE BREAKS ===
        // ---- or ==== dividers -> pause
        processed = processed.replace(/[-=]{4,}/g, '...');
        
        // === AUTHOR NOTES - Make them speakable ===
        processed = processed.replace(/\[Author'?s?\s*Note[:\]]/gi, 'Author note:');
        processed = processed.replace(/\(A\/N[:\)]/gi, 'Author note:');
        processed = processed.replace(/\[TL\s*Note[:\]]/gi, 'Translator note:');
        
        // === CLEANUP ===
        // Collapse excessive ellipses
        processed = processed.replace(/\.{4,}/g, '...');
        
        // Remove HTML tags that might have slipped through
        processed = processed.replace(/<[^>]+>/g, ' ');
        
        // Clean up extra whitespace (but preserve newlines for paragraph breaks)
        processed = processed.replace(/[ \t]+/g, ' ');
        processed = processed.replace(/\n\s*\n+/g, '\n\n');
        processed = processed.trim();
        
        return processed;
    },

    async play() {
        // Initialize/resume AudioContext on user interaction
        try {
            await this.resumeAudioContext();
        } catch (error) {
            this.updateStatus('Audio not supported');
            return;
        }
        
        // Resume from pause - reschedule remaining segments
        if (this.isPaused && this.segmentQueue.length > 0) {
            console.log('[TTS] Resuming playback with', this.segmentQueue.length, 'segments in queue');
            this.isPaused = false;
            this.isPlaying = true;
            this.nextScheduledTime = this.audioContext.currentTime + 0.05; // Small delay to settle
            this.scheduleNextSegments();
            this.updateUI();
            return;
        }

        const chapterContent = document.getElementById('chapterContent');
        if (!chapterContent || !this.client) {
            this.updateStatus('TTS not available');
            return;
        }

        let text = chapterContent.innerText;
        if (!text || text.length < 10) {
            this.updateStatus('No content to read');
            return;
        }
        
        // Preprocess text to handle sound effects, scene breaks, etc.
        text = this.preprocessText(text);

        // Cancel any existing jobs before starting new ones
        if (this.currentJobIds && this.currentJobIds.length > 0) {
            console.log('[TTS] Cancelling', this.currentJobIds.length, 'previous job(s)');
            for (const jobId of this.currentJobIds) {
                try {
                    await this.client.cancelJob(jobId);
                } catch (e) {
                    // Ignore cancel errors - job may already be complete
                }
            }
        }

        // Reset state for new playback
        this.resetStreamingState();
        
        // Store original text and set up highlighting
        this.originalText = text;
        this.setupTextHighlighting(text);
        
        // Start progress update interval
        this.startProgressTracking();
        
        // Start timing with detailed metrics
        this.timingStats = {
            startTime: performance.now(),
            firstSegmentReady: null,
            firstSegmentDecoded: null,
            firstAudioPlayed: null,
            allSegmentsReady: null,
            textLength: text.length,
            segmentDecodeTimes: [],  // Time to decode each segment
            segmentFetchTimes: [],   // Time to fetch each segment
            gaps: []                 // Any gaps detected between segments
        };

        try {
            this.updateStatus('Starting synthesis...');
            console.log('[TTS] Starting synthesis for', text.length, 'characters');
            console.log('[TTS] Timing: Request sent at', this.timingStats.startTime.toFixed(2), 'ms');
            
            // Build synthesis options based on current engine and settings
            const synthOptions = this.getSynthesisOptions();
            console.log('[TTS] Using engine:', this.getEngine(), 'options:', synthOptions);
            
            // Use chunked synthesis to handle long texts and avoid 413 errors
            const result = await this.client.synthesizeChunked(text, synthOptions);
            this.currentJobIds = result.job_ids;
            this.currentJobId = result.job_ids[0]; // For backward compatibility
            this.isChunked = result.is_chunked;
            this.isStreaming = true;

            const submitTime = performance.now() - this.timingStats.startTime;
            console.log('[TTS] Timing: Jobs submitted in', submitTime.toFixed(2), 'ms');

            if (result.is_chunked) {
                console.log('[TTS] Text split into', result.total_chunks, 'chunks');
            }

            // Start segment polling - plays segments as they become ready
            await this.streamSegmentsChunked(result.job_ids);
            
        } catch (error) {
            console.error('[TTS] Play error:', error);
            this.updateStatus('Error: ' + error.message);
            this.isStreaming = false;
        }
    },

    // Stream segments as they become ready
    async streamSegments(jobId) {
        const pollInterval = 1000; // Check every 1 second
        let lastReadyCount = 0;

        console.log('[TTS] Starting segment streaming for job:', jobId);

        const poll = async () => {
            if (!this.isStreaming || this.currentJobId !== jobId) {
                console.log('[TTS] Streaming stopped or job changed');
                return; // Stopped or different job
            }

            try {
                const status = await this.client.getJobStatus(jobId);
                console.log('[TTS] Poll status:', status.manifest?.status, 'segments:', status.manifest?.segments?.length);
                const manifest = status.manifest || status;
                const segments = manifest.segments || [];
                
                // Track all segments
                this.segments = segments;
                
                // Find newly ready segments (Piper uses 'ready', Edge-TTS uses 'completed')
                const readySegments = segments.filter(s => s.status === 'ready' || s.status === 'completed');
                const progress = segments.length > 0 
                    ? Math.round((readySegments.length / segments.length) * 100) 
                    : 0;

                // Log timing for first segment
                if (readySegments.length > 0 && !this.timingStats.firstSegmentReady) {
                    this.timingStats.firstSegmentReady = performance.now();
                    const waitTime = (this.timingStats.firstSegmentReady - this.timingStats.startTime) / 1000;
                    console.log('[TTS] First segment ready after', waitTime.toFixed(2), 'seconds');
                }

                // Queue new ready segments for playback
                if (readySegments.length > lastReadyCount) {
                    for (let i = lastReadyCount; i < readySegments.length; i++) {
                        const segment = readySegments[i];
                        // Use segment_id and always use client.getSegmentUrl for correct path
                        const segmentId = segment.segment_id || segment.id;
                        // Always use getSegmentUrl - the API's url field has wrong path format
                        const segmentUrl = this.client.getSegmentUrl(jobId, segmentId);
                        this.segmentQueue.push({
                            index: i,
                            id: segmentId,
                            url: segmentUrl
                        });
                        console.log('[TTS] Queued segment', i + 1, 'of', segments.length, 'url:', segmentUrl);
                    }
                    lastReadyCount = readySegments.length;

                    // Start playback if not already playing
                    if (!this.isPlaying && !this.isPaused && this.segmentQueue.length > 0) {
                        this.playNextSegment();
                    }
                }

                // Update UI
                if (this.isPlaying) {
                    const currentSeg = this.currentSegmentIndex + 1;
                    const totalSegs = segments.length;
                    this.updateStatus(`Playing ${currentSeg}/${totalSegs} (${progress}% synthesized)`);
                } else {
                    this.updateStatus(`Synthesizing: ${progress}%`);
                }
                this.updateProgress(progress);

                // Check if job is complete
                const jobStatus = manifest.status;
                if (jobStatus === 'complete') {
                    this.synthesisComplete = true;
                    this.timingStats.allSegmentsReady = performance.now();
                    const totalTime = (this.timingStats.allSegmentsReady - this.timingStats.startTime) / 1000;
                    console.log('[TTS] All segments ready after', totalTime.toFixed(2), 'seconds');
                    console.log('[TTS] Timing stats:', {
                        textLength: this.timingStats.textLength,
                        timeToFirstSegment: ((this.timingStats.firstSegmentReady - this.timingStats.startTime) / 1000).toFixed(2) + 's',
                        timeToFirstAudio: this.timingStats.firstAudioPlayed 
                            ? ((this.timingStats.firstAudioPlayed - this.timingStats.startTime) / 1000).toFixed(2) + 's'
                            : 'N/A',
                        totalSynthesisTime: totalTime.toFixed(2) + 's',
                        totalSegments: segments.length
                    });
                    return; // Stop polling
                } else if (jobStatus === 'error' || jobStatus === 'canceled') {
                    this.updateStatus('Synthesis ' + jobStatus);
                    return;
                }

                // Continue polling
                setTimeout(poll, pollInterval);

            } catch (error) {
                console.error('[TTS] Polling error:', error);
                this.updateStatus('Error: ' + error.message);
            }
        };

        poll();
    },

    // Stream segments from multiple jobs (for chunked synthesis)
    // Uses Web Audio API for gapless playback with preloading
    async streamSegmentsChunked(jobIds) {
        const pollInterval = 500;  // Poll more frequently (500ms vs 1000ms)

        console.log('[TTS] Starting chunked segment streaming for', jobIds.length, 'jobs (Web Audio mode)');

        const poll = async () => {
            if (!this.isStreaming) {
                return;
            }
            
            // Check if job IDs have changed (new playback started while this poll was running)
            const jobIdsChanged = !this.currentJobIds || 
                jobIds.length !== this.currentJobIds.length ||
                !jobIds.every((id, i) => id === this.currentJobIds[i]);
            
            if (jobIdsChanged) {
                // Job IDs changed - a new playback started, stop this poll loop
                return;
            }

            try {
                const combinedStatus = await this.client.getChunkedJobStatus(jobIds);
                
                const segments = combinedStatus.segments || [];
                this.segments = segments;

                // Calculate base index for each job (cumulative)
                const jobBaseIndices = [0];
                for (let jobIdx = 0; jobIdx < combinedStatus.job_statuses.length - 1; jobIdx++) {
                    const status = combinedStatus.job_statuses[jobIdx];
                    const manifest = status.manifest || status;
                    const prevBase = jobBaseIndices[jobIdx];
                    const segCount = (manifest.segments || []).length;
                    jobBaseIndices.push(prevBase + segCount);
                }

                let newSegmentsQueued = 0;

                // Process segments from each job IN ORDER
                // For Edge-TTS: each job = 1 chunk = 1 segment, so jobIdx = chunkIdx = globalIdx
                // For Piper: each job may have multiple segments
                for (let jobIdx = 0; jobIdx < jobIds.length; jobIdx++) {
                    const status = combinedStatus.job_statuses[jobIdx];
                    const manifest = status.manifest || status;
                    const jobSegments = manifest.segments || [];
                    const jobId = jobIds[jobIdx];

                    // Process segments within this job
                    // Note: Piper uses 'ready', Edge-TTS uses 'completed'
                    for (let segIdx = 0; segIdx < jobSegments.length; segIdx++) {
                        const segment = jobSegments[segIdx];
                        if (segment.status !== 'ready' && segment.status !== 'completed') continue;
                        
                        const segmentId = segment.segment_id || segment.id;
                        
                        // Check if we already have this segment queued or played
                        const alreadyQueued = this.segmentQueue.some(s => s.id === segmentId);
                        const alreadyPlayed = this.playedSegmentIds && this.playedSegmentIds.has(segmentId);
                        
                        if (!alreadyQueued && !alreadyPlayed) {
                            const segmentUrl = this.client.getSegmentUrl(jobId, segmentId);
                            // For chunked Edge-TTS: jobIdx IS the chunk/segment index
                            // For Piper with multiple segments per job, use cumulative index
                            const globalIdx = this.isChunked ? jobIdx : (jobBaseIndices[jobIdx] + segIdx);
                            
                            this.segmentQueue.push({
                                index: globalIdx,
                                id: segmentId,
                                url: segmentUrl,
                                jobId: jobId,
                                jobIndex: jobIdx,
                                localIndex: segIdx
                            });
                            newSegmentsQueued++;
                            console.log('[TTS] Queued chunk', globalIdx + 1, 'of', jobIds.length, '(job', jobIdx + 1, ')');
                        }
                    }
                }
                
                // Sort queue by global index to ensure correct playback order
                this.segmentQueue.sort((a, b) => a.index - b.index);
                
                // Debug: log queue state if we added segments
                if (newSegmentsQueued > 0) {
                    console.log('[TTS] Queue after sort:', this.segmentQueue.map(s => s.index + 1).join(', '));
                }

                // Log timing for first segment
                if (this.segmentQueue.length > 0 && !this.timingStats.firstSegmentReady) {
                    this.timingStats.firstSegmentReady = performance.now();
                    const waitTime = (this.timingStats.firstSegmentReady - this.timingStats.startTime) / 1000;
                    console.log('[TTS] Timing: First segment queued after', waitTime.toFixed(2), 'seconds');
                    
                    // Immediately start preloading the first segments
                    this.preloadSegments();
                }

                // If we got new segments, try to schedule them
                if (newSegmentsQueued > 0 || this.segmentQueue.length > 0) {
                    // Start preloading ahead
                    this.preloadSegments();
                    
                    // Try to schedule playback if not already playing
                    if (!this.isPlaying && !this.isPaused && this.segmentQueue.length > 0) {
                        const nextExpected = this.currentSegmentIndex + 1;
                        const firstQueued = this.segmentQueue[0];
                        
                        if (firstQueued.index === nextExpected || this.currentSegmentIndex === -1) {
                            // Initialize timing for first playback
                            if (this.nextScheduledTime === 0) {
                                this.nextScheduledTime = this.audioContext.currentTime + 0.05;
                            }
                            this.scheduleNextSegments();
                        }
                    }
                }

                // Calculate overall progress
                const totalSegments = segments.length;
                const readySegments = segments.filter(s => s.status === 'ready' || s.status === 'completed').length;
                const progress = totalSegments > 0 ? Math.round((readySegments / totalSegments) * 100) : 0;

                // Update UI
                if (this.isPlaying) {
                    const currentSeg = this.currentSegmentIndex + 1;
                    this.updateStatus(`Playing ${currentSeg}/${totalSegments} (${progress}% synth)`);
                } else if (this.isPaused) {
                    this.updateStatus(`Paused (${progress}% synth)`);
                } else {
                    this.updateStatus(`Synthesizing: ${progress}%`);
                }
                this.updateProgress(progress);

                // Check if all jobs are complete
                if (combinedStatus.status === 'complete') {
                    this.synthesisComplete = true;
                    this.timingStats.allSegmentsReady = performance.now();
                    const totalTime = (this.timingStats.allSegmentsReady - this.timingStats.startTime) / 1000;
                    console.log('[TTS] Timing: All chunks synthesized after', totalTime.toFixed(2), 'seconds');
                    
                    // Final attempt to schedule any remaining segments
                    this.scheduleNextSegments();
                    return;
                } else if (combinedStatus.status === 'error' || combinedStatus.status === 'canceled') {
                    this.updateStatus('Synthesis ' + combinedStatus.status);
                    return;
                }

                // Continue polling
                setTimeout(poll, pollInterval);

            } catch (error) {
                console.error('[TTS] Polling error:', error);
                
                // Check if the job IDs have changed (new playback started)
                const jobIdsChanged = !this.currentJobIds || 
                    jobIds.length !== this.currentJobIds.length ||
                    !jobIds.every((id, i) => id === this.currentJobIds[i]);
                
                if (jobIdsChanged || !this.isStreaming) {
                    console.log('[TTS] Job IDs changed or streaming stopped, ending poll loop');
                    return;
                }
                
                // For 404 errors (job not found), stop polling - job expired or was deleted
                if (error.message && error.message.includes('404')) {
                    console.log('[TTS] Job not found (404), stopping polling');
                    this.updateStatus('Synthesis job expired. Please try again.');
                    this.isStreaming = false;
                    return;
                }
                
                this.updateStatus('Error: ' + error.message);
                
                // Retry after a delay for other errors
                setTimeout(poll, pollInterval * 2);
            }
        };

        poll();
    },

    // Fetch and decode a segment into an AudioBuffer
    async fetchAndDecodeSegment(segment) {
        // Check if already preloaded
        if (this.preloadedBuffers.has(segment.id)) {
            return this.preloadedBuffers.get(segment.id);
        }
        
        // Check if already being fetched (prevent duplicate requests)
        if (this.fetchingSegments.has(segment.id)) {
            // Wait for existing fetch to complete
            while (this.fetchingSegments.has(segment.id)) {
                await new Promise(r => setTimeout(r, 50));
            }
            // Now check if it was cached
            if (this.preloadedBuffers.has(segment.id)) {
                return this.preloadedBuffers.get(segment.id);
            }
        }
        
        // Mark as being fetched
        this.fetchingSegments.add(segment.id);
        const fetchStart = performance.now();
        
        try {
            // Fetch the audio data
            const response = await fetch(segment.url);
            if (!response.ok) {
                throw new Error('Failed to fetch segment: ' + response.status);
            }
            
            const fetchTime = performance.now() - fetchStart;
            if (this.timingStats) {
                this.timingStats.segmentFetchTimes.push({ index: segment.index, time: fetchTime });
            }
            
            const arrayBuffer = await response.arrayBuffer();
            
            // Decode to AudioBuffer
            const decodeStart = performance.now();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            const decodeTime = performance.now() - decodeStart;
            
            if (this.timingStats) {
                this.timingStats.segmentDecodeTimes.push({ index: segment.index, time: decodeTime });
            }
            
            console.log('[TTS] Segment', segment.index + 1, 'loaded:', fetchTime.toFixed(0), 'ms fetch,', decodeTime.toFixed(0), 'ms decode, duration:', audioBuffer.duration.toFixed(2), 's');
            
            // Log first segment decode time
            if (this.timingStats && !this.timingStats.firstSegmentDecoded) {
                this.timingStats.firstSegmentDecoded = performance.now();
                const totalTime = (this.timingStats.firstSegmentDecoded - this.timingStats.startTime) / 1000;
                console.log('[TTS] Timing: First segment ready to play after', totalTime.toFixed(2), 'seconds');
            }
            
            // Cache the buffer
            this.preloadedBuffers.set(segment.id, audioBuffer);
            
            return audioBuffer;
        } catch (error) {
            console.error('[TTS] Failed to fetch/decode segment', segment.index + 1, ':', error);
            throw error;
        } finally {
            // Remove from fetching set
            this.fetchingSegments.delete(segment.id);
        }
    },
    
    // Preload upcoming segments in the background
    async preloadSegments() {
        // Find segments to preload (next N segments that aren't already loaded or being fetched)
        const toPreload = [];
        
        for (let i = 0; i < this.preloadAhead && i < this.segmentQueue.length; i++) {
            const seg = this.segmentQueue[i];
            if (seg && !this.preloadedBuffers.has(seg.id) && !this.fetchingSegments.has(seg.id)) {
                toPreload.push(seg);
            }
        }
        
        // Preload in parallel (fetchAndDecodeSegment handles deduplication)
        for (const segment of toPreload) {
            // Fire and forget - errors are handled in fetchAndDecodeSegment
            this.fetchAndDecodeSegment(segment).catch(() => {});
        }
    },
    
    // Schedule segments for gapless playback using Web Audio API
    scheduleNextSegments() {
        if (!this.isStreaming || this.isPaused) return;
        
        // Schedule as many ready segments as we can
        while (this.segmentQueue.length > 0) {
            const expectedIndex = this.currentSegmentIndex + 1;
            
            // Find the next segment in order
            let segmentIdx;
            if (this.currentSegmentIndex === -1) {
                segmentIdx = this.segmentQueue.findIndex(s => s.index === 0);
            } else {
                segmentIdx = this.segmentQueue.findIndex(s => s.index === expectedIndex);
            }
            
            if (segmentIdx === -1) {
                // Expected segment not ready yet
                break;
            }
            
            const segment = this.segmentQueue.splice(segmentIdx, 1)[0];
            
            // Check if we have the buffer
            if (!this.preloadedBuffers.has(segment.id)) {
                // Not decoded yet - put it back and wait
                this.segmentQueue.unshift(segment);
                
                // Start preloading it
                this.fetchAndDecodeSegment(segment).then(() => {
                    // Re-trigger scheduling once decoded
                    this.scheduleNextSegments();
                }).catch(error => {
                    console.error('[TTS] Failed to decode segment', segment.index + 1);
                    // Skip this segment and try next
                    this.playedSegmentIds.add(segment.id);
                    this.currentSegmentIndex = segment.index;
                    this.scheduleNextSegments();
                });
                break;
            }
            
            const audioBuffer = this.preloadedBuffers.get(segment.id);
            this.playedSegmentIds.add(segment.id);
            this.currentSegmentIndex = segment.index;
            
            // Schedule this segment
            this.scheduleSegment(segment, audioBuffer);
        }
        
        // Check if we're done
        if (this.segmentQueue.length === 0 && this.synthesisComplete && this.scheduledSources.length === 0) {
            this.onPlaybackComplete();
        }
        
        // Preload upcoming segments
        this.preloadSegments();
    },
    
    // Schedule a single segment for playback at the precise time
    scheduleSegment(segment, audioBuffer) {
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = this.speed;
        source.connect(this.gainNode);
        
        // Calculate when to start this segment
        const now = this.audioContext.currentTime;
        let startTime;
        
        if (this.nextScheduledTime <= now) {
            // Start immediately (or very soon)
            startTime = now + 0.01; // 10ms buffer for safety
            
            // Log if there was a gap
            if (this.currentSegmentIndex > 0 && this.nextScheduledTime > 0) {
                const gap = now - this.nextScheduledTime;
                if (gap > 0.05) { // More than 50ms gap
                    console.log('[TTS] Warning: Gap of', (gap * 1000).toFixed(0), 'ms before segment', segment.index + 1);
                    this.timingStats.gaps.push({ index: segment.index, gap: gap * 1000 });
                }
            }
        } else {
            // Schedule to start right after previous segment ends
            startTime = this.nextScheduledTime;
        }
        
        // Calculate when this segment will end
        const duration = audioBuffer.duration / this.speed;
        this.nextScheduledTime = startTime + duration;
        this.segmentDuration = duration; // Track for progress calculation
        this.segmentStartTime = startTime;
        
        // Update highlighting when segment starts playing
        if (this.isChunked) {
            this.updateHighlighting(segment.index);
        }
        
        console.log('[TTS] Scheduling segment', segment.index + 1, 
            'at', startTime.toFixed(3), 's',
            'duration:', duration.toFixed(2), 's',
            'ends at:', this.nextScheduledTime.toFixed(3), 's');
        
        // Log first audio playback timing
        if (!this.timingStats.firstAudioPlayed) {
            this.timingStats.firstAudioPlayed = performance.now();
            const waitTime = (this.timingStats.firstAudioPlayed - this.timingStats.startTime) / 1000;
            console.log('[TTS] Timing: First audio scheduled after', waitTime.toFixed(2), 'seconds');
        }
        
        // Track this source
        this.scheduledSources.push(source);
        this.currentSource = source;
        
        // Handle when segment ends
        source.onended = () => {
            // Remove from scheduled sources
            const idx = this.scheduledSources.indexOf(source);
            if (idx !== -1) {
                this.scheduledSources.splice(idx, 1);
            }
            
            // Skip scheduling if we're in the middle of a seek operation
            if (this.isSeeking) {
                return;
            }
            
            // Update status
            if (this.isStreaming && !this.isPaused) {
                const totalSegs = this.segments.length;
                const progress = totalSegs > 0 
                    ? Math.round(((this.currentSegmentIndex + 1) / totalSegs) * 100) 
                    : 0;
                this.updateStatus(`Playing ${this.currentSegmentIndex + 1}/${totalSegs} (${progress}%)`);
                
                // Try to schedule more segments
                this.scheduleNextSegments();
            }
            
            // Check if all done
            if (this.scheduledSources.length === 0 && this.segmentQueue.length === 0 && this.synthesisComplete) {
                this.onPlaybackComplete();
            }
        };
        
        // Start the source
        source.start(startTime);
        
        this.isPlaying = true;
        this.isPaused = false;
        this.updateUI();
        
        // Update status
        const totalSegs = this.segments.length;
        const progress = totalSegs > 0 
            ? Math.round(((this.currentSegmentIndex + 1) / totalSegs) * 100) 
            : 0;
        this.updateStatus(`Playing ${this.currentSegmentIndex + 1}/${totalSegs} (${progress}%)`);
    },
    
    // Print detailed timing statistics
    printTimingStats() {
        if (!this.timingStats) return;
        
        const stats = this.timingStats;
        const totalTime = (performance.now() - stats.startTime) / 1000;
        
        console.log('=== TTS Timing Statistics ===');
        console.log('Text length:', stats.textLength, 'characters');
        console.log('Time to first segment ready:', 
            stats.firstSegmentReady ? ((stats.firstSegmentReady - stats.startTime) / 1000).toFixed(2) + 's' : 'N/A');
        console.log('Time to first audio scheduled:', 
            stats.firstAudioPlayed ? ((stats.firstAudioPlayed - stats.startTime) / 1000).toFixed(2) + 's' : 'N/A');
        console.log('Time to all segments ready:', 
            stats.allSegmentsReady ? ((stats.allSegmentsReady - stats.startTime) / 1000).toFixed(2) + 's' : 'N/A');
        console.log('Total playback time:', totalTime.toFixed(2) + 's');
        
        if (stats.segmentFetchTimes.length > 0) {
            const avgFetch = stats.segmentFetchTimes.reduce((a, b) => a + b.time, 0) / stats.segmentFetchTimes.length;
            console.log('Average segment fetch time:', avgFetch.toFixed(0) + 'ms');
        }
        
        if (stats.segmentDecodeTimes.length > 0) {
            const avgDecode = stats.segmentDecodeTimes.reduce((a, b) => a + b.time, 0) / stats.segmentDecodeTimes.length;
            console.log('Average segment decode time:', avgDecode.toFixed(0) + 'ms');
        }
        
        if (stats.gaps.length > 0) {
            console.log('Gaps detected:', stats.gaps.length);
            stats.gaps.forEach(g => console.log('  Segment', g.index, ':', g.gap.toFixed(0), 'ms gap'));
        } else {
            console.log('Gaps detected: 0 (gapless playback achieved!)');
        }
        console.log('=============================');
    },
    
    // Called when playback completes
    onPlaybackComplete() {
        this.isPlaying = false;
        this.isStreaming = false;
        this.stopProgressTracking();
        this.updateStatus('Finished');
        this.updateUI();
        this.printTimingStats();
        console.log('[TTS] Playback complete');
        
        // Handle auto-play next chapter
        if (this.autoplayNext) {
            console.log('[TTS] Auto-playing next chapter...');
            this.updateStatus('Loading next chapter...');
            
            // Small delay before starting next chapter
            setTimeout(() => {
                // Navigate to next chapter and auto-play
                if (typeof navigateChapter === 'function') {
                    navigateChapter(1, true); // true = auto-play after load
                }
            }, 1500);
        }
    },

    // Legacy method - kept for compatibility but now triggers scheduling
    playNextSegment() {
        // Don't start new playback if we're not streaming
        if (!this.isStreaming) {
            return;
        }
        
        // Trigger the new scheduling system
        this.scheduleNextSegments();
    },

    pause() {
        if (this.isPlaying && !this.isPaused) {
            // Stop all scheduled sources
            for (const source of this.scheduledSources) {
                try {
                    source.stop();
                } catch (e) {
                    // Ignore - source may have already stopped
                }
            }
            this.scheduledSources = [];
            this.currentSource = null;
            
            // Note: We keep segmentQueue intact so we can resume
            // The segments that were playing will need to be re-queued on resume
            // For simplicity, we just restart from where we left off
            
            this.isPaused = true;
            this.isPlaying = false;
            this.updateStatus('Paused');
            this.updateUI();
            console.log('[TTS] Paused at segment', this.currentSegmentIndex + 1);
        }
    },

    stop() {
        // Stop all scheduled sources
        for (const source of this.scheduledSources) {
            try {
                source.stop();
            } catch (e) {
                // Ignore
            }
        }
        this.scheduledSources = [];
        this.currentSource = null;
        
        this.isPlaying = false;
        this.isPaused = false;
        this.isStreaming = false;
        this.segmentQueue = [];
        this.preloadedBuffers.clear();
        this.nextScheduledTime = 0;
        
        // Stop progress tracking and clear highlighting
        this.stopProgressTracking();
        this.clearHighlighting();
        
        // Cancel any pending jobs to free up the queue
        if (this.currentJobIds && this.currentJobIds.length > 0 && this.client) {
            console.log('[TTS] Stopping - cancelling', this.currentJobIds.length, 'job(s)');
            for (const jobId of this.currentJobIds) {
                this.client.cancelJob(jobId).catch(() => {}); // Fire and forget
            }
            this.currentJobIds = [];
        }
        
        this.updateStatus('Stopped');
        this.updateUI();
    },

    async cancel() {
        // Cancel all jobs (for chunked synthesis)
        if (this.currentJobIds && this.currentJobIds.length > 0 && this.client) {
            for (const jobId of this.currentJobIds) {
                try {
                    await this.client.cancelJob(jobId);
                } catch (e) {
                    console.error('[TTS] Cancel error for job', jobId, ':', e);
                }
            }
        } else if (this.currentJobId && this.client) {
            // Fallback for single job
            try {
                await this.client.cancelJob(this.currentJobId);
            } catch (e) {
                console.error('[TTS] Cancel error:', e);
            }
        }
        this.stop();
        this.currentJobId = null;
        this.resetStreamingState();
        this.updateStatus('Cancelled');
    },

    setSpeed(speed) {
        this.speed = parseFloat(speed);
        
        // Update playback rate on all currently scheduled sources
        for (const source of this.scheduledSources) {
            try {
                source.playbackRate.value = this.speed;
            } catch (e) {
                // Ignore - source may have ended
            }
        }
        
        console.log('[TTS] Speed changed to', this.speed + 'x');
    },

    // Volume control
    volume: 1.0,
    isMuted: false,
    volumeBeforeMute: 1.0,

    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        
        if (this.gainNode) {
            this.gainNode.gain.value = this.isMuted ? 0 : this.volume;
        }
        
        // Update volume slider UI if it exists
        const volumeSlider = document.getElementById('ttsVolumeSlider');
        if (volumeSlider) {
            volumeSlider.value = this.volume * 100;
        }
        
        // Update volume display
        const volumeDisplay = document.getElementById('ttsVolumeDisplay');
        if (volumeDisplay) {
            volumeDisplay.textContent = Math.round(this.volume * 100) + '%';
        }
        
        // Update mute button icon
        this.updateVolumeIcon();
        
        console.log('[TTS] Volume changed to', Math.round(this.volume * 100) + '%');
    },

    toggleMute() {
        if (this.isMuted) {
            // Unmute - restore previous volume
            this.isMuted = false;
            if (this.gainNode) {
                this.gainNode.gain.value = this.volume;
            }
        } else {
            // Mute - save current volume and set to 0
            this.isMuted = true;
            this.volumeBeforeMute = this.volume;
            if (this.gainNode) {
                this.gainNode.gain.value = 0;
            }
        }
        
        this.updateVolumeIcon();
        console.log('[TTS] Mute toggled:', this.isMuted ? 'muted' : 'unmuted');
    },

    updateVolumeIcon() {
        const muteBtn = document.getElementById('ttsMuteBtn');
        if (muteBtn) {
            const icon = muteBtn.querySelector('span:first-child');
            if (icon) {
                if (this.isMuted || this.volume === 0) {
                    icon.textContent = '🔇';
                } else if (this.volume < 0.5) {
                    icon.textContent = '🔉';
                } else {
                    icon.textContent = '🔊';
                }
            }
        }
    },

    // Skip forward by specified number of segments (default: 1)
    skipForward(count = 1) {
        if (!this.isStreaming || this.segments.length === 0) {
            console.log('[TTS] Cannot skip forward - not streaming');
            return;
        }

        const targetIndex = Math.min(
            this.currentSegmentIndex + count,
            this.segments.length - 1
        );

        if (targetIndex === this.currentSegmentIndex) {
            console.log('[TTS] Already at last segment');
            return;
        }

        console.log('[TTS] Skipping forward from segment', this.currentSegmentIndex + 1, 'to', targetIndex + 1);
        this.skipToSegment(targetIndex);
    },

    // Skip backward by specified number of segments (default: 1)
    skipBackward(count = 1) {
        if (!this.isStreaming || this.segments.length === 0) {
            console.log('[TTS] Cannot skip backward - not streaming');
            return;
        }

        const targetIndex = Math.max(this.currentSegmentIndex - count, 0);

        if (targetIndex === this.currentSegmentIndex) {
            console.log('[TTS] Already at first segment');
            return;
        }

        console.log('[TTS] Skipping backward from segment', this.currentSegmentIndex + 1, 'to', targetIndex + 1);
        this.skipToSegment(targetIndex);
    },

    // Skip to a specific segment index
    skipToSegment(targetIndex) {
        if (targetIndex < 0 || targetIndex >= this.segments.length) {
            console.log('[TTS] Invalid segment index:', targetIndex);
            return;
        }

        // Set seeking flag to prevent onended handlers from interfering
        this.isSeeking = true;

        // Stop all currently scheduled sources
        for (const source of this.scheduledSources) {
            try {
                source.stop();
            } catch (e) {
                // Ignore - source may have already stopped
            }
        }
        this.scheduledSources = [];
        this.currentSource = null;

        // Clear the segment queue and rebuild it from the target index
        this.segmentQueue = [];
        
        // Guard against playedSegmentIds not being initialized
        if (!this.playedSegmentIds) {
            this.playedSegmentIds = new Set();
        } else {
            this.playedSegmentIds.clear();
        }

        // Mark segments before target as played
        for (let i = 0; i < targetIndex; i++) {
            const seg = this.segments[i];
            const segmentId = seg.segment_id || seg.id;
            this.playedSegmentIds.add(segmentId);
        }

        // Re-queue segments from target index onwards
        for (let i = targetIndex; i < this.segments.length; i++) {
            const seg = this.segments[i];
            if (seg.status === 'ready' || seg.status === 'completed') {
                const segmentId = seg.segment_id || seg.id;
                // Determine which job this segment belongs to
                // _jobId is added by getChunkedJobStatus() in tts-client.js
                let jobId = seg._jobId || this.currentJobIds[0];
                const segmentUrl = this.client.getSegmentUrl(jobId, segmentId);
                
                this.segmentQueue.push({
                    index: i,
                    id: segmentId,
                    url: segmentUrl,
                    jobId: jobId
                });
            }
        }

        // Reset timing for gapless playback from new position
        this.currentSegmentIndex = targetIndex - 1; // Will be incremented when first segment plays
        this.nextScheduledTime = this.audioContext.currentTime + 0.05;

        // Update status
        const totalSegs = this.segments.length;
        this.updateStatus(`Jumped to ${targetIndex + 1}/${totalSegs}`);

        // Clear seeking flag before scheduling new segments
        this.isSeeking = false;

        // If we were playing, start scheduling from new position
        if (this.isPlaying || this.isPaused) {
            this.isPlaying = true;
            this.isPaused = false;
            this.preloadSegments();
            this.scheduleNextSegments();
        }

        this.updateUI();
    },

    // Legacy handlers - kept for reference but not used with Web Audio API
    // The onended callback is now handled inline in scheduleSegment()
    onAudioEnded() {
        // With Web Audio API, segment end handling is done in scheduleSegment()
        // This method is kept for backward compatibility
        console.log('[TTS] Legacy onAudioEnded called (should not happen with Web Audio)');
    },

    onAudioError(e) {
        console.error('[TTS] Audio error:', e);
        
        // In streaming mode, try scheduling more segments
        if (this.isStreaming && (this.segmentQueue.length > 0 || !this.synthesisComplete)) {
            console.log('[TTS] Attempting to continue after error');
            this.scheduleNextSegments();
            return;
        }
        
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
        const skipBackBtn = document.getElementById('ttsSkipBackBtn');
        const skipForwardBtn = document.getElementById('ttsSkipForwardBtn');

        if (playBtn) playBtn.disabled = this.isPlaying;
        if (pauseBtn) pauseBtn.disabled = !this.isPlaying;
        if (stopBtn) stopBtn.disabled = !this.isPlaying && !this.isPaused;
        if (cancelBtn) cancelBtn.disabled = !this.currentJobId;
        
        // Skip buttons enabled when streaming, playing, and have segments
        // Require currentSegmentIndex >= 0 (playback has actually started)
        const canSkip = this.isStreaming && this.segments.length > 0 && this.currentSegmentIndex >= 0;
        if (skipBackBtn) skipBackBtn.disabled = !canSkip || this.currentSegmentIndex <= 0;
        if (skipForwardBtn) skipForwardBtn.disabled = !canSkip || this.currentSegmentIndex >= this.segments.length - 1;
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
    
    // Reset chapter list pagination to first page when loading a new novel
    chapterListState.currentPage = 0;
    
    // Fixed: Changed from 'welcomePage' to 'welcomeView' to match index.html
    document.getElementById('welcomeView').classList.add('hidden');
    document.getElementById('mainContent').classList.remove('active');
    document.getElementById('novelDetailView').classList.add('active');
    
    document.getElementById('novelTitle').textContent = novel.title;
    document.getElementById('novelMeta').textContent = novel.genres.join(' • ');
    document.getElementById('chapterList').innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading chapters...</p></div>';
    
    // Hide nav controls and pagination until chapters are loaded
    const navControls = document.getElementById('chapterNavControls');
    const pagination = document.getElementById('chapterPagination');
    if (navControls) navControls.style.display = 'none';
    if (pagination) pagination.style.display = 'none';
    
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

async function loadChapter(chapterIndex, autoPlay = false) {
    console.log('=== loadChapter ===', chapterIndex);
    
    if (chapterIndex < 0 || chapterIndex >= state.chapters.length) return;
    
    state.currentChapterIndex = chapterIndex;
    const chapter = state.chapters[chapterIndex];
    
    console.log('Loading:', chapter.title);
    console.log('URL:', chapter.url);
    
    // Ensure the chapter list page shows the current chapter
    const targetPage = Math.floor(chapterIndex / chapterListState.chaptersPerPage);
    if (targetPage !== chapterListState.currentPage) {
        chapterListState.currentPage = targetPage;
        displayChapterList();
    }
    
    document.querySelectorAll('.chapter-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeChapterItem = document.querySelector(`.chapter-item[data-index="${chapterIndex}"]`);
    if (activeChapterItem) {
        activeChapterItem.classList.add('active');
        // Scroll the chapter item into view in the list
        activeChapterItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
            
            // Auto-play TTS if requested (from auto-next feature)
            if (autoPlay && ttsManager) {
                console.log('[TTS] Auto-playing chapter...');
                // Small delay to let the DOM settle
                setTimeout(() => {
                    ttsManager.play();
                }, 500);
            }
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

// Chapter list pagination state
const chapterListState = {
    currentPage: 0,
    chaptersPerPage: 100
};

function displayChapterList() {
    const listContainer = document.getElementById('chapterList');
    const navControls = document.getElementById('chapterNavControls');
    const pagination = document.getElementById('chapterPagination');
    const rangeLabel = document.getElementById('chapterRangeLabel');
    const jumpInput = document.getElementById('chapterJumpInput');
    
    if (!listContainer) return;
    
    const totalChapters = state.chapters.length;
    const totalPages = Math.ceil(totalChapters / chapterListState.chaptersPerPage);
    const startIndex = chapterListState.currentPage * chapterListState.chaptersPerPage;
    const endIndex = Math.min(startIndex + chapterListState.chaptersPerPage, totalChapters);
    const displayChapters = state.chapters.slice(startIndex, endIndex);
    
    // Show navigation controls if there are chapters
    if (navControls && totalChapters > 0) {
        navControls.style.display = 'flex';
        if (jumpInput) {
            jumpInput.max = totalChapters;
            jumpInput.placeholder = `1-${totalChapters}`;
        }
        if (rangeLabel) {
            rangeLabel.textContent = `Showing ${startIndex + 1}-${endIndex} of ${totalChapters}`;
        }
    }
    
    // Render chapter list
    listContainer.innerHTML = displayChapters.map(chapter => {
        // XSS fix: escape HTML in chapter title
        const safeTitle = escapeHtml(chapter.title);
        return `
        <div class="chapter-item" data-index="${chapter.index}" onclick="loadChapter(${chapter.index})">
            <span class="chapter-number">Ch. ${chapter.number}</span>
            <span class="chapter-title">${safeTitle}</span>
        </div>
    `}).join('');
    
    // Show pagination if more than one page
    if (pagination && totalPages > 1) {
        pagination.style.display = 'flex';
        renderChapterPagination(totalPages);
    } else if (pagination) {
        pagination.style.display = 'none';
    }
}

function renderChapterPagination(totalPages) {
    const pagination = document.getElementById('chapterPagination');
    if (!pagination) return;
    
    const currentPage = chapterListState.currentPage;
    let html = '';
    
    // Previous button
    html += `<button class="chapter-page-btn" onclick="goToChapterPage(${currentPage - 1})" ${currentPage === 0 ? 'disabled' : ''}>← Prev</button>`;
    
    // Page numbers - show first, last, and pages around current
    const pagesToShow = [];
    pagesToShow.push(0); // Always show first page
    
    // Pages around current
    for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages - 2, currentPage + 2); i++) {
        pagesToShow.push(i);
    }
    
    if (totalPages > 1) {
        pagesToShow.push(totalPages - 1); // Always show last page
    }
    
    // Remove duplicates and sort
    const uniquePages = [...new Set(pagesToShow)].sort((a, b) => a - b);
    
    let lastPage = -1;
    for (const page of uniquePages) {
        if (lastPage !== -1 && page - lastPage > 1) {
            html += `<span style="padding: 0 0.3rem;">...</span>`;
        }
        const startCh = page * chapterListState.chaptersPerPage + 1;
        const endCh = Math.min((page + 1) * chapterListState.chaptersPerPage, state.chapters.length);
        html += `<button class="chapter-page-btn ${page === currentPage ? 'active' : ''}" 
                         onclick="goToChapterPage(${page})" 
                         title="Chapters ${startCh}-${endCh}">${page + 1}</button>`;
        lastPage = page;
    }
    
    // Next button
    html += `<button class="chapter-page-btn" onclick="goToChapterPage(${currentPage + 1})" ${currentPage === totalPages - 1 ? 'disabled' : ''}>Next →</button>`;
    
    pagination.innerHTML = html;
}

function goToChapterPage(page) {
    const totalPages = Math.ceil(state.chapters.length / chapterListState.chaptersPerPage);
    if (page < 0 || page >= totalPages) return;
    
    chapterListState.currentPage = page;
    displayChapterList();
    
    // Scroll chapter list to top
    const listContainer = document.getElementById('chapterList');
    if (listContainer) {
        listContainer.scrollTop = 0;
    }
}

function jumpToChapter() {
    const input = document.getElementById('chapterJumpInput');
    if (!input) return;
    
    const chapterNum = parseInt(input.value);
    if (isNaN(chapterNum) || chapterNum < 1 || chapterNum > state.chapters.length) {
        alert(`Please enter a chapter number between 1 and ${state.chapters.length}`);
        return;
    }
    
    // Find the chapter index (chapter numbers might not match array index)
    const chapterIndex = state.chapters.findIndex(ch => ch.number === chapterNum);
    
    if (chapterIndex !== -1) {
        // Navigate to the page containing this chapter
        const page = Math.floor(chapterIndex / chapterListState.chaptersPerPage);
        chapterListState.currentPage = page;
        displayChapterList();
        
        // Load the chapter
        loadChapter(chapterIndex);
    } else {
        // If exact match not found, try to load by index (0-based)
        const index = chapterNum - 1;
        if (index >= 0 && index < state.chapters.length) {
            const page = Math.floor(index / chapterListState.chaptersPerPage);
            chapterListState.currentPage = page;
            displayChapterList();
            loadChapter(index);
        }
    }
    
    // Clear input
    input.value = '';
}

function displayChapter(content, chapter) {
    const contentDiv = document.getElementById('chapterContent');
    // XSS fix: escape HTML in chapter title (content is intentionally HTML)
    const safeTitle = escapeHtml(chapter.title);
    contentDiv.innerHTML = `
        <h2 style="text-align: center; margin-bottom: 2rem;">Chapter ${chapter.number}: ${safeTitle}</h2>
        ${content}
    `;
    
    const contentPanel = document.querySelector('.chapter-content-panel');
    
    // Show and update reading progress indicator
    const progressContainer = document.getElementById('readingProgressContainer');
    const chapterInfo = document.getElementById('readingProgressChapter');
    
    if (progressContainer) {
        progressContainer.classList.add('visible');
    }
    if (chapterInfo) {
        chapterInfo.textContent = `Chapter ${chapter.number} of ${state.chapters.length}`;
    }
    
    // Apply current font size to new content
    applyFontSize();
    
    // Setup scroll tracking for this chapter (before restoring position)
    setupReadingProgressTracking(contentPanel);
    
    // Restore scroll position if we have a pending one, otherwise start at top
    if (state.pendingScrollPosition && state.pendingScrollPosition > 0) {
        // Small delay to let the content render
        setTimeout(() => {
            contentPanel.scrollTop = state.pendingScrollPosition;
            // Update progress indicator
            const scrollHeight = contentPanel.scrollHeight - contentPanel.clientHeight;
            if (scrollHeight > 0) {
                const progress = Math.round((state.pendingScrollPosition / scrollHeight) * 100);
                updateReadingProgress(progress);
            }
            state.pendingScrollPosition = 0; // Clear pending
        }, 100);
    } else {
        contentPanel.scrollTop = 0;
        updateReadingProgress(0);
    }
}

function updateChapterNavigation() {
    const prevBtn = document.getElementById('prevChapter');
    const nextBtn = document.getElementById('nextChapter');
    prevBtn.disabled = state.currentChapterIndex === 0;
    nextBtn.disabled = state.currentChapterIndex >= state.chapters.length - 1;
}

// Reading progress tracking
let readingProgressScrollHandler = null;

function setupReadingProgressTracking(contentPanel) {
    // Remove previous scroll handler if exists
    if (readingProgressScrollHandler) {
        contentPanel.removeEventListener('scroll', readingProgressScrollHandler);
    }
    
    // Create new scroll handler
    readingProgressScrollHandler = () => {
        const scrollTop = contentPanel.scrollTop;
        const scrollHeight = contentPanel.scrollHeight - contentPanel.clientHeight;
        
        if (scrollHeight > 0) {
            const progress = Math.round((scrollTop / scrollHeight) * 100);
            updateReadingProgress(progress);
            
            // Store scroll position for persistence (debounced in saveScrollPosition)
            saveScrollPositionDebounced(scrollTop);
        }
    };
    
    // Add scroll listener
    contentPanel.addEventListener('scroll', readingProgressScrollHandler);
}

function updateReadingProgress(percent) {
    const progressBar = document.getElementById('readingProgressBar');
    const progressPercent = document.getElementById('readingProgressPercent');
    
    if (progressBar) {
        progressBar.style.width = percent + '%';
    }
    if (progressPercent) {
        progressPercent.textContent = percent + '%';
    }
}

// Debounced scroll position saving
// Note: This only saves to state. Network sync is handled by progressSync.
let scrollSaveTimeout = null;
function saveScrollPositionDebounced(scrollTop) {
    if (scrollSaveTimeout) {
        clearTimeout(scrollSaveTimeout);
    }
    
    scrollSaveTimeout = setTimeout(() => {
        // Save to state for later persistence
        state.currentScrollPosition = scrollTop;
        
        // Mark progress as dirty for sync system (don't call saveReadingProgress directly)
        if (window.authClient?.isLoggedIn() && currentLibraryEntry && window.progressSync) {
            progressSync.markDirty();
        }
    }, 500); // Save after 500ms of no scrolling
}

// ==================== FONT SIZE CONTROLS ====================

// Font size state (percentage, 100 = default)
let currentFontSize = 100;
const MIN_FONT_SIZE = 50;
const MAX_FONT_SIZE = 200;
const FONT_SIZE_STEP = 10;

// Initialize font size from localStorage
function initFontSize() {
    const savedSize = localStorage.getItem('readerFontSize');
    if (savedSize) {
        currentFontSize = parseInt(savedSize, 10);
        applyFontSize();
    }
}

function increaseFontSize() {
    if (currentFontSize < MAX_FONT_SIZE) {
        currentFontSize += FONT_SIZE_STEP;
        applyFontSize();
        saveFontSize();
    }
}

function decreaseFontSize() {
    if (currentFontSize > MIN_FONT_SIZE) {
        currentFontSize -= FONT_SIZE_STEP;
        applyFontSize();
        saveFontSize();
    }
}

function applyFontSize() {
    const chapterContent = document.getElementById('chapterContent');
    if (chapterContent) {
        // Base font size is 1.25rem, scale from there
        const scaledSize = (1.25 * currentFontSize / 100).toFixed(2);
        chapterContent.style.fontSize = scaledSize + 'rem';
    }
    
    // Update display
    const display = document.getElementById('fontSizeDisplay');
    if (display) {
        display.textContent = currentFontSize + '%';
    }
}

function saveFontSize() {
    localStorage.setItem('readerFontSize', currentFontSize.toString());
}

// Add keyboard shortcuts for font size
function addFontSizeShortcuts() {
    document.addEventListener('keydown', (e) => {
        const activeElement = document.activeElement;
        const isTyping = activeElement.tagName === 'INPUT' || 
                         activeElement.tagName === 'TEXTAREA' ||
                         activeElement.isContentEditable;
        
        if (isTyping) return;
        
        // + or = to increase font size
        if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            increaseFontSize();
        }
        // - to decrease font size
        if (e.key === '-' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            decreaseFontSize();
        }
    });
}

// Initialize font size on page load
document.addEventListener('DOMContentLoaded', () => {
    initFontSize();
    addFontSizeShortcuts();
});

function navigateChapter(direction, autoPlay = false) {
    const newIndex = state.currentChapterIndex + direction;
    if (newIndex >= 0 && newIndex < state.chapters.length) {
        loadChapter(newIndex, autoPlay);
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

// ==================== ACCOUNT SYSTEM ====================

// Current book's library entry (if logged in and book is in library)
let currentLibraryEntry = null;

// Initialize account UI on page load
document.addEventListener('DOMContentLoaded', () => {
    initAccountUI();
});

function initAccountUI() {
    // Listen for auth state changes
    if (window.authClient) {
        authClient.onAuthChange(updateAccountUI);
        updateAccountUI(authClient.getUser(), authClient.isLoggedIn());
        
        // Verify token on load
        if (authClient.isLoggedIn()) {
            authClient.verifyToken().then(valid => {
                if (!valid) {
                    updateAccountUI(null, false);
                }
            });
        }
    }
}

function updateAccountUI(user, isLoggedIn) {
    const loginBtn = document.getElementById('loginBtn');
    const userMenu = document.getElementById('userMenu');
    const libraryBtn = document.getElementById('libraryBtn');
    const userName = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');

    if (isLoggedIn && user) {
        loginBtn.style.display = 'none';
        userMenu.style.display = 'block';
        libraryBtn.style.display = 'inline-block';
        userName.textContent = user.username;
        userAvatar.textContent = user.username.charAt(0).toUpperCase();
    } else {
        loginBtn.style.display = 'inline-block';
        userMenu.style.display = 'none';
        libraryBtn.style.display = 'none';
    }
}

function toggleUserDropdown() {
    const dropdown = document.getElementById('userDropdown');
    dropdown.classList.toggle('active');
}

function closeUserDropdown() {
    const dropdown = document.getElementById('userDropdown');
    dropdown.classList.remove('active');
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const userMenu = document.getElementById('userMenu');
    if (userMenu && !userMenu.contains(e.target)) {
        closeUserDropdown();
    }
});

// ==================== AUTH MODAL ====================

function showAuthModal(mode = 'login') {
    const modal = document.getElementById('authModal');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    
    modal.classList.add('active');
    
    if (mode === 'login') {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
    }
    
    // Clear errors
    document.getElementById('loginError').classList.remove('visible');
    document.getElementById('registerError').classList.remove('visible');
}

function closeAuthModal() {
    const modal = document.getElementById('authModal');
    modal.classList.remove('active');
    
    // Clear form fields
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('registerEmail').value = '';
    document.getElementById('registerUsername').value = '';
    document.getElementById('registerPassword').value = '';
}

async function doLogin() {
    const login = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    
    if (!login || !password) {
        errorEl.textContent = 'Please fill in all fields';
        errorEl.classList.add('visible');
        return;
    }
    
    const result = await authClient.login(login, password);
    
    if (result.success) {
        closeAuthModal();
        // Apply user's TTS preferences
        if (result.user.preferences) {
            applyUserPreferences(result.user.preferences);
        }
    } else {
        errorEl.textContent = result.error;
        errorEl.classList.add('visible');
    }
}

async function doRegister() {
    const email = document.getElementById('registerEmail').value.trim();
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value;
    const errorEl = document.getElementById('registerError');
    
    if (!email || !username || !password) {
        errorEl.textContent = 'Please fill in all fields';
        errorEl.classList.add('visible');
        return;
    }
    
    const result = await authClient.register(email, username, password);
    
    if (result.success) {
        closeAuthModal();
    } else {
        errorEl.textContent = result.error;
        errorEl.classList.add('visible');
    }
}

function doLogout() {
    authClient.logout();
    closeUserDropdown();
    currentLibraryEntry = null;
    
    // Hide library view if showing
    const libraryView = document.getElementById('libraryView');
    if (libraryView.classList.contains('active')) {
        showHome();
    }
}

function applyUserPreferences(prefs) {
    if (prefs.ttsSpeed) {
        const speedSelect = document.getElementById('ttsSpeed');
        if (speedSelect) {
            speedSelect.value = prefs.ttsSpeed;
            ttsManager.setSpeed(prefs.ttsSpeed);
        }
    }
    if (prefs.theme) {
        state.theme = prefs.theme;
        document.body.setAttribute('data-theme', prefs.theme);
        localStorage.setItem('theme', prefs.theme);
    }
}

// Allow Enter key to submit forms
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');
        
        if (loginForm && loginForm.style.display !== 'none' && loginForm.contains(e.target)) {
            doLogin();
        } else if (registerForm && registerForm.style.display !== 'none' && registerForm.contains(e.target)) {
            doRegister();
        }
    }
});

// ==================== LIBRARY VIEW ====================

async function showLibrary() {
    if (!authClient.isLoggedIn()) {
        showAuthModal('login');
        return;
    }
    
    // Hide other views
    document.getElementById('welcomeView').classList.add('hidden');
    document.getElementById('mainContent').classList.remove('active');
    document.getElementById('novelDetailView').classList.remove('active');
    
    // Show library view
    const libraryView = document.getElementById('libraryView');
    libraryView.classList.add('active');
    
    await loadLibrary();
}

async function loadLibrary() {
    const status = document.getElementById('libraryStatusFilter').value || null;
    const sort = document.getElementById('librarySortFilter').value || 'updated_at';
    
    const gridEl = document.getElementById('libraryGrid');
    const emptyEl = document.getElementById('libraryEmpty');
    
    gridEl.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading your library...</p></div>';
    emptyEl.style.display = 'none';
    
    const data = await libraryClient.getLibrary(status, sort, 'desc');
    
    // Update stats
    const reading = data.books.filter(b => b.status === 'reading').length;
    const completed = data.books.filter(b => b.status === 'completed').length;
    document.getElementById('statReading').textContent = reading;
    document.getElementById('statCompleted').textContent = completed;
    document.getElementById('statTotal').textContent = data.total;
    
    if (data.books.length === 0) {
        gridEl.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
    }
    
    gridEl.innerHTML = data.books.map(book => {
        const progressPercent = book.totalChapters > 0 
            ? Math.round((book.progress.chapterIndex / book.totalChapters) * 100)
            : 0;
        const coverUrl = book.novelCover ? proxifyImage(book.novelCover) : 'https://via.placeholder.com/100x140';
        
        return `
            <div class="library-card" onclick="openLibraryBook('${escapeHtml(book.id)}')">
                <img class="library-card-cover" src="${coverUrl}" alt="${escapeHtml(book.novelTitle)}" onerror="this.src='https://via.placeholder.com/100x140'">
                <div class="library-card-info">
                    <div class="library-card-title">${escapeHtml(book.novelTitle)}</div>
                    <div class="library-card-author">${escapeHtml(book.author || 'Unknown Author')}</div>
                    <div class="library-card-progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progressPercent}%"></div>
                        </div>
                        <div class="progress-text">Chapter ${book.progress.chapterIndex} of ${book.totalChapters || '?'}</div>
                    </div>
                    <span class="library-card-status status-${book.status}">${formatStatus(book.status)}</span>
                    <div class="library-card-actions" onclick="event.stopPropagation()">
                        <button onclick="changeBookStatus('${book.id}')">Status</button>
                        <button class="remove-btn" onclick="removeFromLibrary('${book.id}')">Remove</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function formatStatus(status) {
    const labels = {
        'reading': 'Reading',
        'want_to_read': 'Want to Read',
        'completed': 'Completed',
        'dropped': 'Dropped'
    };
    return labels[status] || status;
}

function filterLibrary() {
    loadLibrary();
}

async function openLibraryBook(libraryId) {
    const bookData = await libraryClient.getBook(libraryId);
    if (!bookData) return;
    
    const book = bookData.book;
    currentLibraryEntry = book;
    
    // Extract novel ID from URL
    const novelIdMatch = book.novelUrl.match(/(\d+)/);
    const novelId = novelIdMatch ? novelIdMatch[1] : null;
    
    // Add to state.novels if not already there
    const existingNovel = state.novels.find(n => n.id === novelId);
    if (!existingNovel && novelId) {
        state.novels.push({
            id: novelId,
            title: book.novelTitle,
            url: book.novelUrl,
            cover: book.novelCover,
            genres: [],
            rating: 0,
            chapters: book.totalChapters || 0
        });
    }
    
    // Hide library view
    document.getElementById('libraryView').classList.remove('active');
    
    // Load the novel
    await loadNovelDetails(novelId);
    
    // Jump to the saved chapter after a short delay to let chapters load
    setTimeout(() => {
        if (book.progress.chapterIndex >= 0 && state.chapters.length > book.progress.chapterIndex) {
            // Store scroll position to restore after chapter loads
            state.pendingScrollPosition = book.progress.scrollPosition || 0;
            loadChapter(book.progress.chapterIndex);
        }
    }, 500);
}

async function changeBookStatus(libraryId) {
    const statuses = ['reading', 'want_to_read', 'completed', 'dropped'];
    const labels = ['Reading', 'Want to Read', 'Completed', 'Dropped'];
    
    const currentBook = (await libraryClient.getBook(libraryId))?.book;
    if (!currentBook) return;
    
    const currentIdx = statuses.indexOf(currentBook.status);
    const newIdx = (currentIdx + 1) % statuses.length;
    
    const result = await libraryClient.updateBook(libraryId, { status: statuses[newIdx] });
    if (result.success) {
        loadLibrary();
    }
}

async function removeFromLibrary(libraryId) {
    if (!confirm('Remove this book from your library?')) return;
    
    const result = await libraryClient.removeBook(libraryId);
    if (result.success) {
        loadLibrary();
    }
}

// ==================== ADD TO LIBRARY ====================

// Override showHome to also hide library view
const originalShowHome = showHome;
showHome = function() {
    document.getElementById('libraryView').classList.remove('active');
    originalShowHome();
};

// Check if current novel is in library when viewing it
async function checkLibraryStatus() {
    if (!authClient.isLoggedIn() || !state.currentNovel) {
        currentLibraryEntry = null;
        return;
    }
    
    const entry = await libraryClient.findBookByUrl(state.currentNovel.url);
    currentLibraryEntry = entry || null;
    updateAddToLibraryButton();
}

function updateAddToLibraryButton() {
    // This would be called to update the UI - we'll add the button to the chapter panel
    const chapterPanel = document.querySelector('.chapter-list-panel');
    if (!chapterPanel) return;
    
    let btn = document.getElementById('addLibraryBtn');
    
    if (!authClient.isLoggedIn()) {
        if (btn) btn.remove();
        return;
    }
    
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'addLibraryBtn';
        btn.className = 'add-library-btn';
        // Insert after the novel meta
        const meta = document.getElementById('novelMeta');
        if (meta) {
            meta.after(btn);
        }
    }
    
    if (currentLibraryEntry) {
        btn.textContent = 'In Library';
        btn.classList.add('added');
        btn.onclick = () => showLibrary();
    } else {
        btn.textContent = 'Add to Library';
        btn.classList.remove('added');
        btn.onclick = addCurrentToLibrary;
    }
}

async function addCurrentToLibrary() {
    if (!authClient.isLoggedIn()) {
        showAuthModal('login');
        return;
    }
    
    if (!state.currentNovel) return;
    
    const btn = document.getElementById('addLibraryBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Adding...';
    }
    
    const result = await libraryClient.addBook(
        state.currentNovel.url,
        state.currentNovel.title,
        state.currentNovel.cover,
        null, // author - we could parse this
        state.chapters.length
    );
    
    if (result.success) {
        currentLibraryEntry = result.book;
        updateAddToLibraryButton();
    } else if (result.libraryId) {
        // Already in library
        currentLibraryEntry = { id: result.libraryId };
        updateAddToLibraryButton();
    }
    
    if (btn) btn.disabled = false;
}

// Update reading progress when changing chapters
const originalLoadChapter = loadChapter;
loadChapter = async function(chapterIndex) {
    await originalLoadChapter(chapterIndex);
    
    // Save progress to server if logged in and book is in library
    // Note: scroll position will be saved separately via saveScrollPositionDebounced
    if (authClient.isLoggedIn() && currentLibraryEntry) {
        const chapter = state.chapters[chapterIndex];
        if (chapter) {
            // Don't reset scroll position to 0 if we have a pending restore
            const scrollPos = state.pendingScrollPosition || 0;
            libraryClient.updateProgress(
                currentLibraryEntry.id,
                chapterIndex,
                chapter.title,
                chapter.url,
                scrollPos
            );
        }
    }
};

// Function to save reading progress with current scroll position
function saveReadingProgress() {
    if (!authClient.isLoggedIn() || !currentLibraryEntry) return;
    
    const chapter = state.chapters[state.currentChapterIndex];
    if (!chapter) return;
    
    const scrollPos = state.currentScrollPosition || 0;
    
    libraryClient.updateProgress(
        currentLibraryEntry.id,
        state.currentChapterIndex,
        chapter.title,
        chapter.url,
        scrollPos
    );
}

// Override loadNovelDetails to check library status
const originalLoadNovelDetails = loadNovelDetails;
loadNovelDetails = async function(novelId) {
    await originalLoadNovelDetails(novelId);
    
    // Check if this novel is in the user's library
    setTimeout(() => {
        checkLibraryStatus();
    }, 100);
};

// ==================== STATS MODAL ====================

function showStats() {
    if (!authClient.isLoggedIn()) {
        showAuthModal('login');
        return;
    }
    
    document.getElementById('statsModal').classList.add('active');
    loadStats();
}

function closeStatsModal() {
    document.getElementById('statsModal').classList.remove('active');
}

async function loadStats() {
    const days = document.getElementById('statsPeriod').value;
    const stats = await libraryClient.getStats(days);
    
    if (!stats) return;
    
    document.getElementById('statTotalTime').textContent = stats.overall.totalTimeFormatted || '0m';
    document.getElementById('statTotalChapters').textContent = stats.overall.totalChapters || 0;
    document.getElementById('statTotalWords').textContent = (stats.overall.totalWords || 0).toLocaleString();
    
    // Display per-book stats
    const booksList = document.getElementById('statsBooksList');
    if (stats.perBook && stats.perBook.length > 0) {
        booksList.innerHTML = stats.perBook.map(book => `
            <div class="stats-book-item">
                <span class="stats-book-title">${escapeHtml(book.novel_title)}</span>
                <span class="stats-book-time">${formatReadingTime(book.time)}</span>
            </div>
        `).join('');
    } else {
        booksList.innerHTML = '<p style="color: var(--text-muted); text-align: center;">No reading data yet</p>';
    }
}

function formatReadingTime(seconds) {
    if (!seconds) return '0m';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// ==================== IMPORT/EXPORT ====================

async function exportUserData() {
    if (!authClient.isLoggedIn()) return;
    
    const data = await libraryClient.exportData();
    if (!data) {
        alert('Failed to export data');
        return;
    }
    
    // Download as JSON file
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `libread-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showImportModal() {
    document.getElementById('importModal').classList.add('active');
    document.getElementById('importError').classList.remove('visible');
    document.getElementById('importSuccess').classList.remove('visible');
    document.getElementById('importFile').value = '';
}

function closeImportModal() {
    document.getElementById('importModal').classList.remove('active');
}

async function doImport() {
    const fileInput = document.getElementById('importFile');
    const errorEl = document.getElementById('importError');
    const successEl = document.getElementById('importSuccess');
    
    if (!fileInput.files || !fileInput.files[0]) {
        errorEl.textContent = 'Please select a file';
        errorEl.classList.add('visible');
        return;
    }
    
    try {
        const text = await fileInput.files[0].text();
        const data = JSON.parse(text);
        
        const result = await libraryClient.importData(data);
        
        if (result.success !== false) {
            successEl.textContent = `Imported ${result.booksImported} books, ${result.bookmarksImported} bookmarks (${result.booksSkipped} skipped)`;
            successEl.classList.add('visible');
            errorEl.classList.remove('visible');
            
            // Refresh library if viewing
            setTimeout(() => {
                closeImportModal();
                if (document.getElementById('libraryView').classList.contains('active')) {
                    loadLibrary();
                }
            }, 2000);
        } else {
            errorEl.textContent = result.error || 'Import failed';
            errorEl.classList.add('visible');
        }
    } catch (e) {
        errorEl.textContent = 'Invalid file format';
        errorEl.classList.add('visible');
    }
}

// ==================== ANNOTATIONS SYSTEM ====================

const annotationManager = {
    annotations: [],           // Current chapter's annotations
    allAnnotations: [],        // All annotations for current book
    selectedColor: 'yellow',   // Current highlight color
    pendingSelection: null,    // Text selection waiting for action
    isEnabled: true,           // Whether annotation system is active
    
    // Available highlight colors
    colors: {
        yellow: { bg: 'rgba(255, 235, 59, 0.4)', border: '#FDD835' },
        green: { bg: 'rgba(129, 199, 132, 0.4)', border: '#66BB6A' },
        blue: { bg: 'rgba(100, 181, 246, 0.4)', border: '#42A5F5' },
        pink: { bg: 'rgba(240, 98, 146, 0.4)', border: '#EC407A' },
        purple: { bg: 'rgba(186, 104, 200, 0.4)', border: '#AB47BC' },
        orange: { bg: 'rgba(255, 167, 38, 0.4)', border: '#FFA726' }
    },
    
    init() {
        this.setupTextSelection();
        this.setupAnnotationPanel();
        console.log('[Annotations] Manager initialized');
    },
    
    // Set up text selection listener for highlighting
    setupTextSelection() {
        const chapterContent = document.getElementById('chapterContent');
        if (!chapterContent) return;
        
        // Listen for mouseup to detect text selection
        document.addEventListener('mouseup', (e) => {
            // Only handle selections in chapter content
            if (!e.target.closest('#chapterContent')) {
                this.hideSelectionPopup();
                return;
            }
            
            // Small delay to let selection finalize
            setTimeout(() => this.handleTextSelection(e), 10);
        });
        
        // Hide popup when clicking elsewhere
        document.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.annotation-popup') && !e.target.closest('#chapterContent')) {
                this.hideSelectionPopup();
            }
        });
    },
    
    handleTextSelection(e) {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        
        if (!selectedText || selectedText.length < 2) {
            this.hideSelectionPopup();
            return;
        }
        
        // Don't show if not logged in or book not in library
        if (!window.authClient?.isLoggedIn() || !currentLibraryEntry) {
            return;
        }
        
        // Get selection range info
        const range = selection.getRangeAt(0);
        const chapterContent = document.getElementById('chapterContent');
        
        // Calculate offsets relative to chapter content
        const offsets = this.getSelectionOffsets(range, chapterContent);
        if (!offsets) return;
        
        // Get paragraph info for more reliable positioning
        const paragraphInfo = this.getParagraphInfo(range);
        
        // Store pending selection
        this.pendingSelection = {
            text: selectedText,
            startOffset: offsets.start,
            endOffset: offsets.end,
            range: range.cloneRange(),
            paragraphIndex: paragraphInfo.index,
            paragraphPreview: paragraphInfo.preview
        };
        
        // Show selection popup near the selection
        this.showSelectionPopup(e.clientX, e.clientY);
    },
    
    // Calculate character offsets from start of chapter content
    getSelectionOffsets(range, container) {
        try {
            const preSelectionRange = document.createRange();
            preSelectionRange.selectNodeContents(container);
            preSelectionRange.setEnd(range.startContainer, range.startOffset);
            const start = preSelectionRange.toString().length;
            
            return {
                start: start,
                end: start + range.toString().length
            };
        } catch (e) {
            console.error('[Annotations] Error getting offsets:', e);
            return null;
        }
    },
    
    // Get paragraph info for the selection
    getParagraphInfo(range) {
        const paragraph = range.startContainer.parentElement?.closest('p') || 
                         range.startContainer.closest?.('p');
        
        if (paragraph) {
            const allParagraphs = document.querySelectorAll('#chapterContent p');
            const index = Array.from(allParagraphs).indexOf(paragraph);
            return {
                index: index >= 0 ? index : null,
                preview: paragraph.textContent.substring(0, 100)
            };
        }
        
        return { index: null, preview: null };
    },
    
    // Show popup with highlight options
    showSelectionPopup(x, y) {
        this.hideSelectionPopup();
        
        const popup = document.createElement('div');
        popup.className = 'annotation-popup';
        popup.innerHTML = `
            <div class="annotation-popup-colors">
                ${Object.keys(this.colors).map(color => `
                    <button class="annotation-color-btn ${color === this.selectedColor ? 'active' : ''}" 
                            data-color="${color}" 
                            style="background: ${this.colors[color].bg}; border-color: ${this.colors[color].border};"
                            title="${color}"></button>
                `).join('')}
            </div>
            <div class="annotation-popup-actions">
                <button class="annotation-action-btn highlight-btn" title="Highlight">
                    <span>Highlight</span>
                </button>
                <button class="annotation-action-btn note-btn" title="Add Note">
                    <span>+ Note</span>
                </button>
            </div>
        `;
        
        // Position popup
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        let left = x;
        let top = y + 10;
        
        // Adjust if too close to edges
        if (left + 200 > viewportWidth) left = viewportWidth - 220;
        if (top + 80 > viewportHeight) top = y - 90;
        
        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
        
        document.body.appendChild(popup);
        
        // Add event listeners
        popup.querySelectorAll('.annotation-color-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectedColor = btn.dataset.color;
                popup.querySelectorAll('.annotation-color-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
        
        popup.querySelector('.highlight-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.createHighlight();
        });
        
        popup.querySelector('.note-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.createHighlightWithNote();
        });
    },
    
    hideSelectionPopup() {
        const existing = document.querySelector('.annotation-popup');
        if (existing) existing.remove();
    },
    
    // Create a highlight from current selection
    async createHighlight(withNote = false) {
        if (!this.pendingSelection || !currentLibraryEntry) return;
        
        const sel = this.pendingSelection;
        let note = null;
        
        if (withNote) {
            note = prompt('Add a note to this highlight:');
            if (note === null) return; // Cancelled
        }
        
        // Save to server
        const annotation = await this.saveAnnotation({
            chapterIndex: state.currentChapterIndex,
            chapterUrl: state.chapters[state.currentChapterIndex]?.url,
            type: 'highlight',
            color: this.selectedColor,
            selectedText: sel.text,
            note: note,
            startOffset: sel.startOffset,
            endOffset: sel.endOffset,
            paragraphIndex: sel.paragraphIndex,
            paragraphTextPreview: sel.paragraphPreview
        });
        
        if (annotation) {
            // Add to local array and render immediately
            // Note: We render here directly since we know the exact position
            // loadAnnotations() clears before rendering, so no double-render risk
            this.annotations.push(annotation);
            this.renderHighlight(annotation);
            this.updateAnnotationPanel();
        }
        
        // Clear selection
        window.getSelection().removeAllRanges();
        this.hideSelectionPopup();
        this.pendingSelection = null;
    },
    
    createHighlightWithNote() {
        this.createHighlight(true);
    },
    
    // Save annotation to server
    async saveAnnotation(data) {
        if (!currentLibraryEntry) return null;
        
        try {
            const response = await fetch(`${PROXY_BASE}/library/${currentLibraryEntry.id}/annotations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authClient.getToken()}`
                },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) throw new Error('Failed to save annotation');
            
            const result = await response.json();
            console.log('[Annotations] Saved:', result.annotation);
            return result.annotation;
        } catch (error) {
            console.error('[Annotations] Save error:', error);
            return null;
        }
    },
    
    // Load annotations for current chapter
    async loadAnnotations() {
        if (!currentLibraryEntry) {
            this.annotations = [];
            this.updateAnnotationPanel();
            return;
        }
        
        try {
            const response = await fetch(
                `${PROXY_BASE}/library/${currentLibraryEntry.id}/chapters/${state.currentChapterIndex}/annotations`,
                {
                    headers: {
                        'Authorization': `Bearer ${authClient.getToken()}`
                    }
                }
            );
            
            if (!response.ok) throw new Error('Failed to load annotations');
            
            const data = await response.json();
            this.annotations = data.annotations || [];
            console.log('[Annotations] Loaded', this.annotations.length, 'annotations for chapter', state.currentChapterIndex);
            
            // Clear existing highlights before re-rendering to avoid duplicates
            this.clearRenderedHighlights();
            
            // Render all highlights
            this.renderAllHighlights();
            this.updateAnnotationPanel();
        } catch (error) {
            console.error('[Annotations] Load error:', error);
            this.annotations = [];
            this.updateAnnotationPanel();
        }
    },
    
    // Load all annotations for the book (for the sidebar)
    async loadAllAnnotations() {
        if (!currentLibraryEntry) {
            this.allAnnotations = [];
            return;
        }
        
        try {
            const response = await fetch(
                `${PROXY_BASE}/library/${currentLibraryEntry.id}/annotations`,
                {
                    headers: {
                        'Authorization': `Bearer ${authClient.getToken()}`
                    }
                }
            );
            
            if (!response.ok) throw new Error('Failed to load annotations');
            
            const data = await response.json();
            this.allAnnotations = data.annotations || [];
            console.log('[Annotations] Loaded', this.allAnnotations.length, 'total annotations');
        } catch (error) {
            console.error('[Annotations] Load all error:', error);
            this.allAnnotations = [];
        }
    },
    
    // Render a single highlight in the DOM
    renderHighlight(annotation) {
        const chapterContent = document.getElementById('chapterContent');
        if (!chapterContent) return;
        
        try {
            // Create a tree walker to find text nodes
            const walker = document.createTreeWalker(
                chapterContent,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            let currentOffset = 0;
            let startNode = null, endNode = null;
            let startNodeOffset = 0, endNodeOffset = 0;
            
            // Find the start and end nodes
            while (walker.nextNode()) {
                const node = walker.currentNode;
                const nodeLength = node.textContent.length;
                
                // Check if start is in this node
                if (!startNode && currentOffset + nodeLength > annotation.startOffset) {
                    startNode = node;
                    startNodeOffset = annotation.startOffset - currentOffset;
                }
                
                // Check if end is in this node
                if (startNode && currentOffset + nodeLength >= annotation.endOffset) {
                    endNode = node;
                    endNodeOffset = annotation.endOffset - currentOffset;
                    break;
                }
                
                currentOffset += nodeLength;
            }
            
            if (!startNode || !endNode) {
                console.warn('[Annotations] Could not find text nodes for annotation');
                return;
            }
            
            // Create a range and wrap with highlight span
            const range = document.createRange();
            range.setStart(startNode, startNodeOffset);
            range.setEnd(endNode, endNodeOffset);
            
            // Check if the selected text roughly matches
            const rangeText = range.toString();
            if (rangeText.length < annotation.selectedText.length * 0.5) {
                console.warn('[Annotations] Text mismatch, skipping highlight');
                return;
            }
            
            // Create highlight wrapper
            const highlight = document.createElement('mark');
            highlight.className = `annotation-highlight annotation-${annotation.color}`;
            highlight.dataset.annotationId = annotation.id;
            highlight.title = annotation.note || annotation.selectedText.substring(0, 50) + '...';
            
            // Add click handler to show annotation details
            highlight.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showAnnotationDetails(annotation);
            });
            
            range.surroundContents(highlight);
            
        } catch (e) {
            console.warn('[Annotations] Error rendering highlight:', e);
        }
    },
    
    // Render all highlights for current chapter
    renderAllHighlights() {
        // Sort by start offset descending to avoid offset shifting issues
        const sorted = [...this.annotations].sort((a, b) => b.startOffset - a.startOffset);
        
        for (const annotation of sorted) {
            this.renderHighlight(annotation);
        }
    },
    
    // Clear all rendered highlights (before re-rendering)
    clearRenderedHighlights() {
        const highlights = document.querySelectorAll('.annotation-highlight');
        highlights.forEach(el => {
            const parent = el.parentNode;
            while (el.firstChild) {
                parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
        });
    },
    
    // Show annotation details popup/modal
    showAnnotationDetails(annotation) {
        // Create a mini-modal for annotation details
        const existing = document.querySelector('.annotation-detail-popup');
        if (existing) existing.remove();
        
        const popup = document.createElement('div');
        popup.className = 'annotation-detail-popup';
        popup.innerHTML = `
            <div class="annotation-detail-content">
                <div class="annotation-detail-header">
                    <span class="annotation-detail-color" style="background: ${this.colors[annotation.color]?.bg || this.colors.yellow.bg}"></span>
                    <span class="annotation-detail-date">${new Date(annotation.createdAt).toLocaleDateString()}</span>
                    <button class="annotation-detail-close">&times;</button>
                </div>
                <div class="annotation-detail-text">"${escapeHtml(annotation.selectedText)}"</div>
                ${annotation.note ? `<div class="annotation-detail-note">${escapeHtml(annotation.note)}</div>` : ''}
                <div class="annotation-detail-actions">
                    <button class="annotation-edit-btn">Edit Note</button>
                    <button class="annotation-delete-btn">Delete</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(popup);
        
        // Position near the highlight
        const highlight = document.querySelector(`[data-annotation-id="${annotation.id}"]`);
        if (highlight) {
            const rect = highlight.getBoundingClientRect();
            popup.style.top = (rect.bottom + window.scrollY + 10) + 'px';
            popup.style.left = Math.max(20, rect.left) + 'px';
        }
        
        // Event handlers
        popup.querySelector('.annotation-detail-close').onclick = () => popup.remove();
        popup.querySelector('.annotation-edit-btn').onclick = () => {
            popup.remove();
            this.editAnnotationNote(annotation);
        };
        popup.querySelector('.annotation-delete-btn').onclick = () => {
            popup.remove();
            this.deleteAnnotation(annotation);
        };
        
        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', function closePopup(e) {
                if (!popup.contains(e.target)) {
                    popup.remove();
                    document.removeEventListener('click', closePopup);
                }
            });
        }, 100);
    },
    
    // Edit annotation note
    async editAnnotationNote(annotation) {
        const newNote = prompt('Edit note:', annotation.note || '');
        if (newNote === null) return;
        
        try {
            const response = await fetch(
                `${PROXY_BASE}/library/${currentLibraryEntry.id}/annotations/${annotation.id}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authClient.getToken()}`
                    },
                    body: JSON.stringify({ note: newNote })
                }
            );
            
            if (response.ok) {
                annotation.note = newNote;
                // Update tooltip
                const highlight = document.querySelector(`[data-annotation-id="${annotation.id}"]`);
                if (highlight) {
                    highlight.title = newNote || annotation.selectedText.substring(0, 50) + '...';
                }
                this.updateAnnotationPanel();
            }
        } catch (error) {
            console.error('[Annotations] Edit error:', error);
        }
    },
    
    // Delete annotation
    async deleteAnnotation(annotation) {
        if (!confirm('Delete this highlight?')) return;
        
        try {
            const response = await fetch(
                `${PROXY_BASE}/library/${currentLibraryEntry.id}/annotations/${annotation.id}`,
                {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${authClient.getToken()}`
                    }
                }
            );
            
            if (response.ok) {
                // Remove from local arrays
                this.annotations = this.annotations.filter(a => a.id !== annotation.id);
                this.allAnnotations = this.allAnnotations.filter(a => a.id !== annotation.id);
                
                // Remove from DOM
                const highlight = document.querySelector(`[data-annotation-id="${annotation.id}"]`);
                if (highlight) {
                    const parent = highlight.parentNode;
                    while (highlight.firstChild) {
                        parent.insertBefore(highlight.firstChild, highlight);
                    }
                    parent.removeChild(highlight);
                }
                
                this.updateAnnotationPanel();
            }
        } catch (error) {
            console.error('[Annotations] Delete error:', error);
        }
    },
    
    // Set up the annotations panel/sidebar
    setupAnnotationPanel() {
        // Panel will be created in HTML
    },
    
    // Update the annotations panel content
    updateAnnotationPanel() {
        const panel = document.getElementById('annotationsPanel');
        const list = document.getElementById('annotationsList');
        const count = document.getElementById('annotationsCount');
        const badge = document.getElementById('annotationsBadge');
        
        if (!panel || !list) return;
        
        const annotationCount = this.annotations.length;
        
        // Update count in panel header
        if (count) {
            count.textContent = annotationCount;
        }
        
        // Update floating badge
        if (badge) {
            if (annotationCount > 0) {
                badge.textContent = annotationCount;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
        
        if (annotationCount === 0) {
            list.innerHTML = '<p class="annotations-empty">No highlights in this chapter. Select text to highlight.</p>';
            return;
        }
        
        list.innerHTML = this.annotations.map(a => `
            <div class="annotation-list-item" data-annotation-id="${a.id}">
                <div class="annotation-list-color" style="background: ${this.colors[a.color]?.bg || this.colors.yellow.bg}"></div>
                <div class="annotation-list-content">
                    <div class="annotation-list-text">"${escapeHtml(a.selectedText.substring(0, 80))}${a.selectedText.length > 80 ? '...' : ''}"</div>
                    ${a.note ? `<div class="annotation-list-note">${escapeHtml(a.note)}</div>` : ''}
                </div>
            </div>
        `).join('');
        
        // Add click handlers to scroll to highlight
        list.querySelectorAll('.annotation-list-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.annotationId;
                const highlight = document.querySelector(`[data-annotation-id="${id}"]`);
                if (highlight) {
                    highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    highlight.classList.add('annotation-flash');
                    setTimeout(() => highlight.classList.remove('annotation-flash'), 1000);
                }
            });
        });
    },
    
    // Toggle annotations panel visibility
    togglePanel() {
        const panel = document.getElementById('annotationsPanel');
        if (panel) {
            panel.classList.toggle('open');
        }
    }
};

// Initialize annotations when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    annotationManager.init();
});

// Load annotations when chapter loads (hook into displayChapter)
const originalDisplayChapter = displayChapter;
displayChapter = function(content, chapter) {
    originalDisplayChapter(content, chapter);
    
    // Load annotations for this chapter after a short delay
    if (currentLibraryEntry) {
        setTimeout(() => {
            annotationManager.loadAnnotations();
        }, 100);
    }
};

// ==================== READING PROGRESS SYNC IMPROVEMENTS ====================

const progressSync = {
    syncInterval: null,
    lastSyncTime: null,
    pendingSync: false,
    syncDebounceTimeout: null,
    listenersRegistered: false, // Guard to prevent duplicate listeners
    
    // Start automatic sync interval
    startAutoSync() {
        if (this.syncInterval) return;
        
        // Sync every 30 seconds if there are changes
        this.syncInterval = setInterval(() => {
            if (this.pendingSync && authClient?.isLoggedIn() && currentLibraryEntry) {
                this.syncNow();
            }
        }, 30000);
        
        // Register page lifecycle listeners only once
        if (!this.listenersRegistered) {
            this.listenersRegistered = true;
            
            // Sync when leaving the page
            window.addEventListener('beforeunload', () => {
                if (this.pendingSync) {
                    this.syncNow(true); // Use keepalive fetch for beforeunload
                }
            });
            
            // Sync when tab becomes hidden
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && this.pendingSync) {
                    this.syncNow();
                }
            });
        }
        
        console.log('[ProgressSync] Auto-sync started');
    },
    
    // Stop auto sync
    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    },
    
    // Mark that we have changes to sync
    markDirty() {
        this.pendingSync = true;
        this.updateSyncIndicator('pending');
        
        // Debounce immediate sync
        if (this.syncDebounceTimeout) {
            clearTimeout(this.syncDebounceTimeout);
        }
        
        this.syncDebounceTimeout = setTimeout(() => {
            if (this.pendingSync && authClient?.isLoggedIn() && currentLibraryEntry) {
                this.syncNow();
            }
        }, 5000); // Sync after 5 seconds of no changes
    },
    
    // Perform sync
    async syncNow(useKeepalive = false) {
        if (!authClient?.isLoggedIn() || !currentLibraryEntry) return;
        
        this.updateSyncIndicator('syncing');
        
        try {
            const chapter = state.chapters[state.currentChapterIndex];
            if (!chapter) return;
            
            const scrollPos = state.currentScrollPosition || 0;
            
            const syncData = {
                chapterIndex: state.currentChapterIndex,
                chapterTitle: chapter.title,
                chapterUrl: chapter.url,
                scrollPosition: scrollPos
            };
            
            // Use fetch with keepalive for beforeunload (works with auth headers)
            // sendBeacon cannot send Authorization headers, so we use keepalive fetch instead
            await fetch(`${PROXY_BASE}/library/${currentLibraryEntry.id}/progress`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authClient.getToken()}`
                },
                body: JSON.stringify(syncData),
                keepalive: useKeepalive // Allows request to outlive the page
            });
            
            this.pendingSync = false;
            this.lastSyncTime = new Date();
            this.updateSyncIndicator('synced');
            console.log('[ProgressSync] Synced successfully');
            
        } catch (error) {
            console.error('[ProgressSync] Sync failed:', error);
            this.updateSyncIndicator('error');
        }
    },
    
    // Update the sync status indicator
    updateSyncIndicator(status) {
        const indicator = document.getElementById('syncIndicator');
        if (!indicator) return;
        
        indicator.className = 'sync-indicator sync-' + status;
        
        switch (status) {
            case 'syncing':
                indicator.innerHTML = '<span class="sync-icon">&#8635;</span> Syncing...';
                break;
            case 'synced':
                indicator.innerHTML = '<span class="sync-icon">&#10003;</span> Synced';
                // Hide after 2 seconds
                setTimeout(() => {
                    if (indicator.classList.contains('sync-synced')) {
                        indicator.innerHTML = '';
                    }
                }, 2000);
                break;
            case 'pending':
                indicator.innerHTML = '<span class="sync-icon">&#9679;</span>';
                break;
            case 'error':
                indicator.innerHTML = '<span class="sync-icon">&#10007;</span> Sync failed';
                break;
        }
    }
};

// Start progress sync when authenticated
document.addEventListener('DOMContentLoaded', () => {
    if (window.authClient) {
        authClient.onAuthChange((user, isLoggedIn) => {
            if (isLoggedIn) {
                progressSync.startAutoSync();
            } else {
                progressSync.stopAutoSync();
            }
        });
        
        if (authClient.isLoggedIn()) {
            progressSync.startAutoSync();
        }
    }
});

// Export for use in saveScrollPositionDebounced
window.progressSync = progressSync;
