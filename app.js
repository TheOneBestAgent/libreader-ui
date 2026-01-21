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

    init() {
        if (typeof TTSClient !== 'undefined') {
            this.client = new TTSClient('/api/tts');
        }
        
        // Don't create AudioContext until user interaction (browser autoplay policy)
        // Will be created on first play()
        console.log('[TTS] Manager initialized (Web Audio API mode)');
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
            
            // Use chunked synthesis to handle long texts and avoid 413 errors
            const result = await this.client.synthesizeChunked(text);
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
                
                // Find newly ready segments
                const readySegments = segments.filter(s => s.status === 'ready');
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
                console.log('[TTS] Streaming stopped');
                return;
            }

            try {
                const pollStart = performance.now();
                const combinedStatus = await this.client.getChunkedJobStatus(jobIds);
                const pollTime = performance.now() - pollStart;
                
                if (pollTime > 500) {
                    console.log('[TTS] Warning: Slow poll response:', pollTime.toFixed(0), 'ms');
                }
                
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

                // Process segments from each job
                for (let jobIdx = 0; jobIdx < combinedStatus.job_statuses.length; jobIdx++) {
                    const status = combinedStatus.job_statuses[jobIdx];
                    const manifest = status.manifest || status;
                    const jobSegments = manifest.segments || [];
                    const jobId = jobIds[jobIdx];
                    const baseIdx = jobBaseIndices[jobIdx];

                    // Process ALL segments, queue only ready ones we haven't seen
                    for (let segIdx = 0; segIdx < jobSegments.length; segIdx++) {
                        const segment = jobSegments[segIdx];
                        if (segment.status !== 'ready') continue;
                        
                        const segmentId = segment.segment_id || segment.id;
                        
                        // Check if we already have this segment queued or played
                        const alreadyQueued = this.segmentQueue.some(s => s.id === segmentId);
                        const alreadyPlayed = this.playedSegmentIds && this.playedSegmentIds.has(segmentId);
                        
                        if (!alreadyQueued && !alreadyPlayed) {
                            const segmentUrl = this.client.getSegmentUrl(jobId, segmentId);
                            const globalIdx = baseIdx + segIdx;
                            
                            this.segmentQueue.push({
                                index: globalIdx,
                                id: segmentId,
                                url: segmentUrl,
                                jobId: jobId,
                                jobIndex: jobIdx,
                                localIndex: segIdx
                            });
                            newSegmentsQueued++;
                            console.log('[TTS] Queued segment', globalIdx + 1, '(job', jobIdx + 1, ', local', segIdx + 1, ')');
                        }
                    }
                }
                
                // Sort queue by global index
                this.segmentQueue.sort((a, b) => a.index - b.index);

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
                const readySegments = segments.filter(s => s.status === 'ready').length;
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
                this.updateStatus('Error: ' + error.message);
                
                // Retry after a delay
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
            this.isPlaying = false;
            this.isStreaming = false;
            this.updateStatus('Finished');
            this.updateUI();
            console.log('[TTS] Playback complete');
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
                this.isPlaying = false;
                this.isStreaming = false;
                this.updateStatus('Finished');
                this.updateUI();
                this.printTimingStats();
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
            if (seg.status === 'ready') {
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
        if (book.progress.chapterIndex > 0 && state.chapters.length > book.progress.chapterIndex) {
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
    if (authClient.isLoggedIn() && currentLibraryEntry) {
        const chapter = state.chapters[chapterIndex];
        if (chapter) {
            libraryClient.updateProgress(
                currentLibraryEntry.id,
                chapterIndex,
                chapter.title,
                chapter.url,
                0
            );
        }
    }
};

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
