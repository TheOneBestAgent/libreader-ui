// PronounceX TTS Client
// Handles all communication with the PronounceX TTS service

class TTSClient {
    // Maximum characters per chunk to avoid 413 errors
    // PronounceX API limit is 20000 chars; using 5000 for comfortable margin
    static MAX_CHUNK_SIZE = 5000;

    constructor(apiBase = '/api/tts') {
        this.apiBase = apiBase;
        this.currentJobId = null;
        this.currentJobIds = []; // For multi-chunk jobs
        this.pollingInterval = null;
        this.isPolling = false;
    }

    // Split text into chunks at sentence boundaries
    // Returns array of text chunks, each under MAX_CHUNK_SIZE
    static chunkText(text, maxSize = TTSClient.MAX_CHUNK_SIZE) {
        if (text.length <= maxSize) {
            return [text];
        }

        const chunks = [];
        let remaining = text;

        while (remaining.length > 0) {
            if (remaining.length <= maxSize) {
                chunks.push(remaining.trim());
                break;
            }

            // Find a good break point within maxSize
            let breakPoint = maxSize;
            const searchArea = remaining.substring(0, maxSize);

            // Priority 1: Break at paragraph (double newline)
            const paragraphBreak = searchArea.lastIndexOf('\n\n');
            if (paragraphBreak > maxSize * 0.5) {
                breakPoint = paragraphBreak + 2;
            } else {
                // Priority 2: Break at sentence end (.!?)
                const sentenceMatch = searchArea.match(/[.!?]["'\u201d\u2019]?\s+(?=[A-Z])/g);
                if (sentenceMatch) {
                    const lastSentenceEnd = searchArea.lastIndexOf(sentenceMatch[sentenceMatch.length - 1]);
                    if (lastSentenceEnd > maxSize * 0.3) {
                        breakPoint = lastSentenceEnd + sentenceMatch[sentenceMatch.length - 1].length;
                    }
                }
                
                // Priority 3: Break at single newline
                if (breakPoint === maxSize) {
                    const newlineBreak = searchArea.lastIndexOf('\n');
                    if (newlineBreak > maxSize * 0.5) {
                        breakPoint = newlineBreak + 1;
                    }
                }

                // Priority 4: Break at comma or semicolon
                if (breakPoint === maxSize) {
                    const clauseBreak = Math.max(
                        searchArea.lastIndexOf(', '),
                        searchArea.lastIndexOf('; ')
                    );
                    if (clauseBreak > maxSize * 0.5) {
                        breakPoint = clauseBreak + 2;
                    }
                }

                // Priority 5: Break at space (last resort)
                if (breakPoint === maxSize) {
                    const spaceBreak = searchArea.lastIndexOf(' ');
                    if (spaceBreak > maxSize * 0.3) {
                        breakPoint = spaceBreak + 1;
                    }
                }
            }

            chunks.push(remaining.substring(0, breakPoint).trim());
            remaining = remaining.substring(breakPoint).trim();
        }

        return chunks.filter(chunk => chunk.length > 0);
    }

    // Create a TTS synthesis job for a single chunk
    // Maps to: POST /v1/tts/jobs
    async synthesize(text, options = {}) {
        const payload = {
            text: text,
            // Disable phonemes - glow-tts model produces better output with direct text
            prefer_phonemes: options.preferPhonemes === true ? true : false
        };

        if (options.model || options.model_id) {
            payload.model_id = options.model || options.model_id;
        }

        if (options.readingProfile) {
            payload.reading_profile = options.readingProfile;
        }

        console.log('[TTS] Submitting synthesis job:', {
            textLength: text.length,
            model: payload.model_id,
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
    async synthesizeChunked(text, options = {}) {
        const chunks = TTSClient.chunkText(text);
        
        console.log('[TTS] Synthesizing text in', chunks.length, 'chunk(s), total length:', text.length);
        
        // Single chunk - use regular synthesis
        if (chunks.length === 1) {
            const result = await this.synthesize(chunks[0], options);
            this.currentJobIds = [result.job_id];
            return {
                job_ids: [result.job_id],
                chunks: [{
                    index: 0,
                    job_id: result.job_id,
                    length: chunks[0].length
                }],
                total_chunks: 1,
                is_chunked: false
            };
        }

        // Multiple chunks - create jobs for each
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
        const response = await fetch(this.apiBase + '/v1/tts/jobs/' + jobId);
        
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
                        const completed = segments.filter(s => s.status === 'ready').length;
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
    // Maps to: POST /v1/tts/jobs/{job_id}/cancel
    async cancelJob(jobId) {
        console.log('[TTS] Cancelling job:', jobId);
        
        await fetch(this.apiBase + '/v1/tts/jobs/' + jobId + '/cancel', {
            method: 'POST'
        });

        this.stopPolling();
    }

    // Get playlist for sequential playback
    // Maps to: GET /v1/tts/jobs/{job_id}/playlist.json
    async getPlaylist(jobId) {
        const response = await fetch(this.apiBase + '/v1/tts/jobs/' + jobId + '/playlist.json');
        
        if (!response.ok) {
            throw new Error('Failed to get playlist: ' + response.status);
        }

        return await response.json();
    }

    // Get merged audio URL
    // Maps to: GET /v1/tts/jobs/{job_id}/audio.ogg
    getAudioUrl(jobId) {
        return this.apiBase + '/v1/tts/jobs/' + jobId + '/audio.ogg';
    }

    // Get individual segment audio URL
    getSegmentUrl(jobId, segmentId) {
        return this.apiBase + '/v1/tts/jobs/' + jobId + '/segments/' + segmentId;
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

    // Get available models
    // Maps to: GET /v1/models
    async getModels() {
        const response = await fetch(this.apiBase + '/v1/models');
        
        if (!response.ok) {
            throw new Error('Failed to get models: ' + response.status);
        }

        return await response.json();
    }

    // Health check
    // Maps to: GET /health
    async healthCheck() {
        try {
            const response = await fetch(this.apiBase + '/health');
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

    cleanup() {
        this.stopPolling();
        this.currentJobId = null;
    }
}

window.TTSClient = TTSClient;
