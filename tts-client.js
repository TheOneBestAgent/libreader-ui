// TTS Client
// Handles all communication with TTS services (PronounceX/Piper and Edge-TTS)
// Supports multiple TTS engines with automatic routing

class TTSClient {
    // Maximum characters per chunk to avoid timeouts and processing issues
    // PronounceX API limit is 20000 chars; using 5000 for comfortable margin
    // Edge-TTS needs smaller chunks (~1500) to avoid processing timeouts
    static MAX_CHUNK_SIZE_PIPER = 5000;
    static MAX_CHUNK_SIZE_EDGE = 1500;
    
    // Available TTS engines
    static ENGINES = {
        PIPER: 'piper',      // PronounceX/Piper - supports custom phonemes
        EDGE: 'edge',        // Microsoft Edge TTS - high quality, no phoneme support
        WAVENET: 'wavenet',  // Google WaveNet - neural TTS, $4/1M chars
        ESPEAK: 'espeak',    // eSpeak NG - lightweight, offline capable
        OPENAI: 'openai',    // OpenAI TTS - premium neural voices
        WEB_SPEECH: 'web'    // Browser's built-in Web Speech API
    };

    constructor(apiBase = '/api/tts', engine = TTSClient.ENGINES.PIPER) {
        this.apiBase = apiBase;
        this.engine = engine;
        this.currentJobId = null;
        this.currentJobIds = []; // For multi-chunk jobs
        this.pollingInterval = null;
        this.isPolling = false;
    }
    
    // Set the TTS engine to use
    setEngine(engine) {
        switch (engine) {
            case 'edge':
            case 'edge-tts':
                this.engine = TTSClient.ENGINES.EDGE;
                break;
            case 'wavenet':
            case 'google':
            case 'google-tts':
                this.engine = TTSClient.ENGINES.WAVENET;
                break;
            case 'espeak':
            case 'espeak-ng':
                this.engine = TTSClient.ENGINES.ESPEAK;
                break;
            case 'openai':
                this.engine = TTSClient.ENGINES.OPENAI;
                break;
            case 'web':
            case 'web-speech':
                this.engine = TTSClient.ENGINES.WEB_SPEECH;
                break;
            default:
                this.engine = TTSClient.ENGINES.PIPER;
        }
        console.log('[TTS] Engine set to:', this.engine);
    }
    
    // Get current engine
    getEngine() {
        return this.engine;
    }
    
    // Check if current engine supports phonemes
    supportsPhonemes() {
        // Piper and eSpeak support custom phonemes
        // Google WaveNet supports SSML phoneme tags
        return this.engine === TTSClient.ENGINES.PIPER || 
               this.engine === TTSClient.ENGINES.ESPEAK ||
               this.engine === TTSClient.ENGINES.WAVENET;
    }

    // Maximum chunk sizes for different engines
    static MAX_CHUNK_SIZE_WAVENET = 5000;  // Google TTS API limit
    static MAX_CHUNK_SIZE_ESPEAK = 2000;
    static MAX_CHUNK_SIZE_OPENAI = 4096;
    static MAX_CHUNK_SIZE_WEB_SPEECH = 5000; // Limited by browser TTS constraints
    
    // Get appropriate chunk size for an engine
    static getMaxChunkSize(engine) {
        switch (engine) {
            case TTSClient.ENGINES.EDGE:
                return TTSClient.MAX_CHUNK_SIZE_EDGE;
            case TTSClient.ENGINES.WAVENET:
                return TTSClient.MAX_CHUNK_SIZE_WAVENET;
            case TTSClient.ENGINES.ESPEAK:
                return TTSClient.MAX_CHUNK_SIZE_ESPEAK;
            case TTSClient.ENGINES.OPENAI:
                return TTSClient.MAX_CHUNK_SIZE_OPENAI;
            case TTSClient.ENGINES.WEB_SPEECH:
                return TTSClient.MAX_CHUNK_SIZE_WEB_SPEECH;
            case TTSClient.ENGINES.PIPER:
            default:
                return TTSClient.MAX_CHUNK_SIZE_PIPER;
        }
    }

    // Split text into chunks at sentence boundaries
    // Returns array of text chunks, each under the max size for the engine
    // Optimized: O(n) using index-based slicing instead of repeated substring
    static chunkText(text, maxSize = TTSClient.MAX_CHUNK_SIZE_PIPER) {
        if (text.length <= maxSize) {
            return [text];
        }

        const chunks = [];
        let startIndex = 0;

        while (startIndex < text.length) {
            // Skip leading whitespace
            while (startIndex < text.length && /\s/.test(text[startIndex])) {
                startIndex++;
            }
            
            if (startIndex >= text.length) break;

            const remainingLength = text.length - startIndex;
            
            if (remainingLength <= maxSize) {
                chunks.push(text.substring(startIndex).trim());
                break;
            }

            // Find a good break point within maxSize from startIndex
            const endBoundary = startIndex + maxSize;
            const searchArea = text.substring(startIndex, endBoundary);
            let breakOffset = maxSize;

            // Priority 1: Break at paragraph (double newline)
            const paragraphBreak = searchArea.lastIndexOf('\n\n');
            if (paragraphBreak > maxSize * 0.5) {
                breakOffset = paragraphBreak + 2;
            } else {
                // Priority 2: Break at sentence end (.!?)
                const sentenceMatch = searchArea.match(/[.!?]["'\u201d\u2019]?\s+(?=[A-Z])/g);
                if (sentenceMatch) {
                    const lastSentenceEnd = searchArea.lastIndexOf(sentenceMatch[sentenceMatch.length - 1]);
                    if (lastSentenceEnd > maxSize * 0.3) {
                        breakOffset = lastSentenceEnd + sentenceMatch[sentenceMatch.length - 1].length;
                    }
                }
                
                // Priority 3: Break at single newline
                if (breakOffset === maxSize) {
                    const newlineBreak = searchArea.lastIndexOf('\n');
                    if (newlineBreak > maxSize * 0.5) {
                        breakOffset = newlineBreak + 1;
                    }
                }

                // Priority 4: Break at comma or semicolon
                if (breakOffset === maxSize) {
                    const clauseBreak = Math.max(
                        searchArea.lastIndexOf(', '),
                        searchArea.lastIndexOf('; ')
                    );
                    if (clauseBreak > maxSize * 0.5) {
                        breakOffset = clauseBreak + 2;
                    }
                }

                // Priority 5: Break at space (last resort)
                if (breakOffset === maxSize) {
                    const spaceBreak = searchArea.lastIndexOf(' ');
                    if (spaceBreak > maxSize * 0.3) {
                        breakOffset = spaceBreak + 1;
                    }
                }
            }

            const chunk = text.substring(startIndex, startIndex + breakOffset).trim();
            if (chunk.length > 0) {
                chunks.push(chunk);
            }
            startIndex += breakOffset;
        }

        return chunks.filter(chunk => chunk.length > 0);
    }

    // Create a TTS synthesis job for a single chunk
    // Maps to: POST /v1/tts/jobs
    // Engine is passed via payload and routed by server.js proxy
    async synthesize(text, options = {}) {
        const payload = {
            text: text,
            engine: this.engine,  // Tell server which TTS engine to use
            // Disable phonemes - glow-tts model produces better output with direct text
            // Note: edge-tts and wavenet ignore this parameter (don't support custom phonemes)
            prefer_phonemes: options.preferPhonemes === true ? true : false
        };

        // For Piper/PronounceX
        if (options.model || options.model_id) {
            payload.model_id = options.model || options.model_id;
        }

        if (options.readingProfile) {
            payload.reading_profile = options.readingProfile;
        }
        
        // For Edge-TTS: voice parameter
        if (options.voice) {
            payload.voice = options.voice;
        }
        
        // For Google WaveNet: voice and audio options
        if (this.engine === TTSClient.ENGINES.WAVENET) {
            if (options.languageCode) {
                payload.languageCode = options.languageCode;
            }
            if (options.voiceName) {
                payload.voiceName = options.voiceName;
            }
            if (options.ssmlGender) {
                payload.ssmlGender = options.ssmlGender;
            }
            if (options.audioEncoding) {
                payload.audioEncoding = options.audioEncoding;
            }
            if (options.speakingRate !== undefined) {
                payload.speakingRate = options.speakingRate;
            }
            if (options.pitch !== undefined) {
                payload.pitch = options.pitch;
            }
            if (options.volumeGainDb !== undefined) {
                payload.volumeGainDb = options.volumeGainDb;
            }
        }

        console.log('[TTS] Submitting synthesis job:', {
            engine: this.engine,
            textLength: text.length,
            model: payload.model_id,
            voice: payload.voice || payload.voiceName,
            preferPhonemes: payload.prefer_phonemes
        });

        try {
            const response = await fetch(this.apiBase + '/v1/tts/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error('TTS API error: ' + response.status + ' ' + errorText);
            }

            const data = await response.json();
            this.currentJobId = data.job_id;
            
            return data;
        } catch (error) {
            console.error('[TTS] Synthesis failed:', error);
            throw error;
        }
    }

    // Create TTS synthesis jobs for long text, automatically chunking if needed
    // Returns an object with job_ids array and chunk info for coordinated playback
    // NOTE: Edge-TTS handles long text internally, so we don't chunk for it
    // NOTE: Web Speech API should use WebSpeechEngine from tts-utils.js, not this client
    async synthesizeChunked(text, options = {}) {
        // Web Speech API: Should use WebSpeechEngine class instead of TTSClient
        if (this.engine === TTSClient.ENGINES.WEB_SPEECH) {
            throw new Error('Web Speech API should use WebSpeechEngine from tts-utils.js, not TTSClient');
        }

        // Edge-TTS: Send full text as single job (no chunking needed)
        // Edge-TTS handles long text well internally
        if (this.engine === TTSClient.ENGINES.EDGE) {
            console.log('[TTS] Edge-TTS: Sending full text as single job,', text.length, 'chars');
            return await this._synthesizeSingleJob(text, options);
        }
        
        // Get engine-specific chunk size
        const maxChunkSize = TTSClient.getMaxChunkSize(this.engine);
        const chunks = TTSClient.chunkText(text, maxChunkSize);
        
        const engineName = this.engine.toUpperCase();
        console.log('[TTS]', engineName + ': Synthesizing in', chunks.length, 'chunk(s), total length:', text.length);
        
        // Single chunk - use regular synthesis
        if (chunks.length === 1) {
            return await this._synthesizeSingleJob(chunks[0], options);
        }

        // Multiple chunks - create jobs for each
        return await this._synthesizeMultipleJobs(chunks, options);
    }

    // Helper: Synthesize single job (no chunking)
    async _synthesizeSingleJob(text, options) {
        const result = await this.synthesize(text, options);
        this.currentJobIds = [result.job_id];
        return {
            job_ids: [result.job_id],
            chunks: [{
                index: 0,
                job_id: result.job_id,
                length: text.length
            }],
            total_chunks: 1,
            is_chunked: false
        };
    }

    // Helper: Synthesize multiple jobs (with chunking)
    async _synthesizeMultipleJobs(chunks, options) {
        const jobs = [];
        this.currentJobIds = [];

        for (let i = 0; i < chunks.length; i++) {
            console.log('[TTS] Submitting chunk', i + 1, 'of', chunks.length, '(' + chunks[i].length + ' chars)');
            
            try {
                const result = await this.synthesize(chunks[i], options);
                jobs.push({
                    index: i,
                    job_id: result.job_id,
                    length: chunks[i].length
                });
                this.currentJobIds.push(result.job_id);
            } catch (error) {
                // If a chunk fails, cancel previously submitted jobs
                console.error('[TTS] Chunk', i + 1, 'failed, cancelling previous jobs');
                for (const job of jobs) {
                    try {
                        await this.cancelJob(job.job_id);
                    } catch (e) {
                        // Ignore cancel errors
                    }
                }
                throw error;
            }
        }

        // Set currentJobId to first job for backward compatibility
        this.currentJobId = jobs[0].job_id;

        return {
            job_ids: jobs.map(j => j.job_id),
            chunks: jobs,
            total_chunks: chunks.length,
            is_chunked: true
        };
    }

    // Get combined status for multiple jobs (for chunked synthesis)
    async getChunkedJobStatus(jobIds) {
        const statuses = await Promise.all(
            jobIds.map(id => this.getJobStatus(id))
        );

        // Combine all segments from all jobs with job index prefix
        let allSegments = [];
        let overallStatus = 'complete';
        
        for (let i = 0; i < statuses.length; i++) {
            const status = statuses[i];
            const manifest = status.manifest || status;
            const segments = manifest.segments || [];
            
            // Prefix segment info with job index for proper ordering
            const prefixedSegments = segments.map(seg => ({
                ...seg,
                _jobIndex: i,
                _jobId: jobIds[i]
            }));
            allSegments = allSegments.concat(prefixedSegments);

            // Determine overall status (processing/queued < complete, error trumps all)
            const jobStatus = manifest.status;
            if (jobStatus === 'error') {
                overallStatus = 'error';
            } else if (jobStatus === 'canceled' && overallStatus !== 'error') {
                overallStatus = 'canceled';
            } else if ((jobStatus === 'processing' || jobStatus === 'queued' || jobStatus === 'in_progress') && overallStatus === 'complete') {
                overallStatus = 'processing';
            }
        }

        return {
            job_ids: jobIds,
            status: overallStatus,
            segments: allSegments,
            job_statuses: statuses
        };
    }

    // Get job status/manifest
    // Maps to: GET /v1/tts/jobs/{job_id}
    async getJobStatus(jobId) {
        const url = this.apiBase + '/v1/tts/jobs/' + jobId + '?engine=' + this.engine;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error('Failed to get job status: ' + response.status);
        }

        return await response.json();
    }

    // Poll job status until complete/error/canceled
    async pollJobStatus(jobId, onProgress, interval = 500) {
        if (this.isPolling) {
            console.warn('[TTS] Already polling, stopping previous poll');
            this.stopPolling();
        }

        this.isPolling = true;

        return new Promise((resolve, reject) => {
            const poll = async () => {
                if (!this.isPolling) {
                    reject(new Error('Polling stopped'));
                    return;
                }

                try {
                    const status = await this.getJobStatus(jobId);
                    
                    // Calculate progress from segments
                    let progress = 0;
                    const manifest = status.manifest || status;
                    const segments = manifest.segments || [];
                    if (segments.length > 0) {
                        const completed = segments.filter(s => s.status === 'ready' || s.status === 'completed').length;
                        progress = Math.round((completed / segments.length) * 100);
                    }
                    
                    if (onProgress) {
                        onProgress({ ...status, progress });
                    }

                    const jobStatus = (status.manifest || status).status;
                    if (['complete', 'error', 'canceled'].includes(jobStatus)) {
                        this.stopPolling();
                        resolve(status);
                        return;
                    }

                    this.pollingInterval = setTimeout(poll, interval);
                } catch (error) {
                    this.stopPolling();
                    reject(error);
                }
            };

            poll();
        });
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearTimeout(this.pollingInterval);
            this.pollingInterval = null;
        }
        this.isPolling = false;
    }

    // Cancel a job
    // Different engines use different cancellation methods:
    // - Edge-TTS: DELETE /v1/tts/jobs/{job_id}
    // - Others: POST /v1/tts/jobs/{job_id}/cancel
    async cancelJob(jobId) {
        console.log('[TTS] Cancelling job:', jobId);
        
        try {
            // Edge-TTS and OpenAI use DELETE, others use POST to /cancel
            if (this.engine === TTSClient.ENGINES.EDGE || this.engine === TTSClient.ENGINES.OPENAI) {
                const response = await fetch(this.apiBase + '/v1/tts/jobs/' + jobId + '?engine=' + this.engine, {
                    method: 'DELETE'
                });
                // 404 is OK - job already deleted or expired
                if (!response.ok && response.status !== 404) {
                    console.warn('[TTS] Cancel job failed:', response.status);
                }
            } else {
                const response = await fetch(this.apiBase + '/v1/tts/jobs/' + jobId + '/cancel?engine=' + this.engine, {
                    method: 'POST'
                });
                if (!response.ok && response.status !== 404) {
                    console.warn('[TTS] Cancel job failed:', response.status);
                }
            }
        } catch (error) {
            // Ignore cancel errors - job may already be complete or deleted
            console.warn('[TTS] Cancel job error (ignored):', error.message);
        }

        this.stopPolling();
    }

    // Get playlist for sequential playback
    // Maps to: GET /v1/tts/jobs/{job_id}/playlist.json
    async getPlaylist(jobId) {
        const url = this.apiBase + '/v1/tts/jobs/' + jobId + '/playlist.json?engine=' + this.engine;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error('Failed to get playlist: ' + response.status);
        }

        return await response.json();
    }

    // Different engines use different audio formats:
    // - Piper: .ogg (Opus codec)
    // - Edge-TTS: .mp3
    // - eSpeak: .wav (PCM)
    // - OpenAI: .mp3 (AAC codec)
    // - WaveNet: .mp3 (default, can also use OGG_OPUS)
    getAudioUrl(jobId) {
        let ext;
        switch (this.engine) {
            case TTSClient.ENGINES.EDGE:
            case TTSClient.ENGINES.OPENAI:
            case TTSClient.ENGINES.WAVENET:
                ext = 'mp3';
                break;
            case TTSClient.ENGINES.ESPEAK:
                ext = 'wav';
                break;
            case TTSClient.ENGINES.PIPER:
            default:
                ext = 'ogg';
                break;
        }
        return this.apiBase + '/v1/tts/jobs/' + jobId + '/audio.' + ext + '?engine=' + this.engine;
    }

    // Get individual segment audio URL
    // Note: Piper uses /segments/{id}, Edge-TTS uses /segments/{id}/audio
    getSegmentUrl(jobId, segmentId) {
        if (this.engine === TTSClient.ENGINES.EDGE || 
            this.engine === TTSClient.ENGINES.OPENAI ||
            this.engine === TTSClient.ENGINES.WAVENET) {
            return this.apiBase + '/v1/tts/jobs/' + jobId + '/segments/' + segmentId + '/audio?engine=' + this.engine;
        }
        return this.apiBase + '/v1/tts/jobs/' + jobId + '/segments/' + segmentId + '?engine=' + this.engine;
    }

    // Dictionary: Learn a word/phrase
    // Maps to: POST /v1/dicts/learn
    async learnWord(key) {
        const response = await fetch(this.apiBase + '/v1/dicts/learn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });

        if (!response.ok) {
            throw new Error('Failed to learn word: ' + response.status);
        }

        return await response.json();
    }

    // Dictionary: Lookup a word/phrase
    // Maps to: GET /v1/dicts/lookup?key=...
    async lookupWord(key) {
        const response = await fetch(this.apiBase + '/v1/dicts/lookup?key=' + encodeURIComponent(key));
        
        if (!response.ok) {
            throw new Error('Failed to lookup word: ' + response.status);
        }

        return await response.json();
    }

    // Dictionary: Override pronunciation
    // Maps to: POST /v1/dicts/override
    async overrideWord(key, phonemes, pack = 'local_overrides') {
        const response = await fetch(this.apiBase + '/v1/dicts/override', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pack, key, phonemes })
        });

        if (!response.ok) {
            throw new Error('Failed to override word: ' + response.status);
        }

        return await response.json();
    }

    // Dictionary: Get all dictionaries
    // Maps to: GET /v1/dicts
    async getDictionaries() {
        const response = await fetch(this.apiBase + '/v1/dicts');
        
        if (!response.ok) {
            throw new Error('Failed to get dictionaries: ' + response.status);
        }

        return await response.json();
    }

    // Dictionary: Compile dictionaries
    // Maps to: POST /v1/dicts/compile
    async compileDictionaries() {
        const response = await fetch(this.apiBase + '/v1/dicts/compile', {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error('Failed to compile dictionaries: ' + response.status);
        }

        return await response.json();
    }

    // Get available models (Piper) or voices (all engines)
    // Routes to appropriate endpoint based on engine type
    async getModels() {
        return await this.getVoices();
    }

    // Get available voices for the current engine
    async getVoices() {
        let url;
        
        switch (this.engine) {
            case TTSClient.ENGINES.PIPER:
                // Piper uses models endpoint
                url = this.apiBase + '/v1/models?engine=' + this.engine;
                break;
            
            case TTSClient.ENGINES.EDGE:
            case TTSClient.ENGINES.WAVENET:
            case TTSClient.ENGINES.ESPEAK:
            case TTSClient.ENGINES.OPENAI:
                // All other engines use voices endpoint
                url = this.apiBase + '/v1/tts/voices?engine=' + this.engine;
                break;
            
            case TTSClient.ENGINES.WEB_SPEECH:
                // Web Speech API voices are fetched client-side via speechSynthesis.getVoices()
                throw new Error('Web Speech API voices should be fetched using speechSynthesis.getVoices()');
            
            default:
                throw new Error('Unknown TTS engine: ' + this.engine);
        }
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error('Failed to get voices for ' + this.engine + ': ' + response.status);
        }

        return await response.json();
    }
    
    // Get available Edge-TTS voices (convenience method)
    // Returns list of voices with id, name, gender, locale
    async getEdgeVoices() {
        const url = this.apiBase + '/v1/tts/voices?engine=edge';
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error('Failed to get Edge-TTS voices: ' + response.status);
        }
        
        return await response.json();
    }

    // Get available eSpeak NG voices (convenience method)
    async getEspeakVoices() {
        const url = this.apiBase + '/v1/tts/voices?engine=espeak';
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error('Failed to get eSpeak voices: ' + response.status);
        }
        
        return await response.json();
    }

    // Get available Google WaveNet voices (convenience method)
    async getWavenetVoices() {
        const url = this.apiBase + '/v1/tts/voices?engine=wavenet';
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error('Failed to get Google WaveNet voices: ' + response.status);
        }
        
        return await response.json();
    }

    // Get available OpenAI TTS voices (convenience method)
    async getOpenAIVoices() {
        const url = this.apiBase + '/v1/tts/voices?engine=openai';
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error('Failed to get OpenAI voices: ' + response.status);
        }
        
        return await response.json();
    }

    // Health check
    // Maps to: GET /health
    async healthCheck() {
        try {
            const url = this.apiBase + '/health?engine=' + this.engine;
            const response = await fetch(url);
            if (!response.ok) {
                return { status: 'error', error: response.status };
            }
            return await response.json();
        } catch (error) {
            console.error('[TTS] Health check failed:', error);
            return { status: 'error', error: error.message };
        }
    }

    // Get metrics
    // Maps to: GET /v1/metrics
    async getMetrics() {
        const response = await fetch(this.apiBase + '/v1/metrics');
        
        if (!response.ok) {
            throw new Error('Failed to get metrics: ' + response.status);
        }

        return await response.json();
    }

    // Engine capability detection methods
    
    // Check if engine requires server-side processing
    requiresServer() {
        return this.engine !== TTSClient.ENGINES.WEB_SPEECH;
    }
    
    // Check if engine supports offline mode
    supportsOffline() {
        return this.engine === TTSClient.ENGINES.ESPEAK || 
               this.engine === TTSClient.ENGINES.WEB_SPEECH;
    }
    
    // Check if engine uses job-based synthesis (async polling)
    usesJobQueue() {
        return this.engine === TTSClient.ENGINES.PIPER || 
               this.engine === TTSClient.ENGINES.ESPEAK;
    }
    
    // Check if engine supports SSML marks for synchronization
    supportsSSMLMarks() {
        return this.engine === TTSClient.ENGINES.EDGE || 
               this.engine === TTSClient.ENGINES.OPENAI ||
               this.engine === TTSClient.ENGINES.WAVENET;
    }
    
    // Check if engine supports multiple voice styles/emotions
    supportsVoiceStyles() {
        return this.engine === TTSClient.ENGINES.EDGE || 
               this.engine === TTSClient.ENGINES.OPENAI;
    }
    
    // Check if engine is premium/paid
    isPremium() {
        return this.engine === TTSClient.ENGINES.OPENAI;
    }
    
    // Get engine quality rating (1-5)
    getQualityRating() {
        switch (this.engine) {
            case TTSClient.ENGINES.OPENAI:
                return 5; // Premium neural voices
            case TTSClient.ENGINES.EDGE:
            case TTSClient.ENGINES.WAVENET:
                return 4; // High quality neural voices
            case TTSClient.ENGINES.PIPER:
                return 3; // Good quality, customizable
            case TTSClient.ENGINES.WEB_SPEECH:
                return 2; // Browser-dependent quality
            case TTSClient.ENGINES.ESPEAK:
                return 2; // Robotic but functional
            default:
                return 0;
        }
    }
    
    // Get engine display name
    getEngineName() {
        switch (this.engine) {
            case TTSClient.ENGINES.PIPER:
                return 'Piper TTS';
            case TTSClient.ENGINES.EDGE:
                return 'Microsoft Edge TTS';
            case TTSClient.ENGINES.WAVENET:
                return 'Google WaveNet TTS';
            case TTSClient.ENGINES.ESPEAK:
                return 'eSpeak NG';
            case TTSClient.ENGINES.OPENAI:
                return 'OpenAI TTS';
            case TTSClient.ENGINES.WEB_SPEECH:
                return 'Web Speech API';
            default:
                return 'Unknown';
        }
    }
    
    // Get engine description
    getEngineDescription() {
        switch (this.engine) {
            case TTSClient.ENGINES.PIPER:
                return 'Local neural TTS with phoneme customization support';
            case TTSClient.ENGINES.EDGE:
                return 'Cloud-based neural TTS with high-quality voices';
            case TTSClient.ENGINES.WAVENET:
                return 'Google neural TTS - $4/1M chars, excellent quality';
            case TTSClient.ENGINES.ESPEAK:
                return 'Lightweight offline TTS with phoneme support';
            case TTSClient.ENGINES.OPENAI:
                return 'Premium neural TTS with natural-sounding voices';
            case TTSClient.ENGINES.WEB_SPEECH:
                return 'Browser built-in TTS (quality varies by platform)';
            default:
                return '';
        }
    }
    
    // Static method: Get all available engines with metadata
    static getAllEngines() {
        return [
            {
                id: TTSClient.ENGINES.PIPER,
                name: 'Piper TTS',
                description: 'Local neural TTS with phoneme customization',
                quality: 3,
                offline: false,
                phonemes: true,
                ssml: false,
                premium: false,
                recommended: true
            },
            {
                id: TTSClient.ENGINES.EDGE,
                name: 'Microsoft Edge TTS',
                description: 'Cloud neural TTS with high quality',
                quality: 4,
                offline: false,
                phonemes: false,
                ssml: true,
                premium: false,
                recommended: true
            },
            {
                id: TTSClient.ENGINES.WAVENET,
                name: 'Google WaveNet TTS',
                description: 'Google neural TTS - $4/1M chars, excellent quality',
                quality: 4,
                offline: false,
                phonemes: true,  // Supports SSML phoneme tags
                ssml: true,
                premium: false,  // Paid but affordable
                recommended: true
            },
            {
                id: TTSClient.ENGINES.ESPEAK,
                name: 'eSpeak NG',
                description: 'Lightweight offline TTS',
                quality: 2,
                offline: true,
                phonemes: true,
                ssml: false,
                premium: false,
                recommended: false
            },
            {
                id: TTSClient.ENGINES.OPENAI,
                name: 'OpenAI TTS',
                description: 'Premium neural TTS (requires API key)',
                quality: 5,
                offline: false,
                phonemes: false,
                ssml: true,
                premium: true,
                recommended: false
            },
            {
                id: TTSClient.ENGINES.WEB_SPEECH,
                name: 'Web Speech API',
                description: 'Browser built-in TTS',
                quality: 2,
                offline: true,
                phonemes: false,
                ssml: false,
                premium: false,
                recommended: false
            }
        ];
    }

    cleanup() {
        this.stopPolling();
        this.currentJobId = null;
    }
}

window.TTSClient = TTSClient;
