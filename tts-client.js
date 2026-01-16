// PronounceX TTS Client
// Handles all communication with the PronounceX TTS service

class TTSClient {
    constructor(apiBase = '/api/tts') {
        this.apiBase = apiBase;
        this.currentJobId = null;
        this.pollingInterval = null;
        this.isPolling = false;
    }

    async synthesize(text, options = {}) {
        const payload = {
            text: text,
            prefer_phonemes: options.preferPhonemes !== false
        };

        if (options.model) {
            payload.model = options.model;
        }

        console.log('[TTS] Submitting synthesis job:', {
            textLength: text.length,
            model: payload.model
        });

        try {
            const response = await fetch(this.apiBase + '/v1/reader/synthesize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error('TTS API error: ' + response.status + ' ' + response.statusText);
            }

            const data = await response.json();
            this.currentJobId = data.job_id;
            
            return data;
        } catch (error) {
            console.error('[TTS] Synthesis failed:', error);
            throw error;
        }
    }

    async getJobStatus(jobId) {
        const response = await fetch(this.apiBase + '/v1/tts/jobs/' + jobId);
        
        if (!response.ok) {
            throw new Error('Failed to get job status: ' + response.status);
        }

        return await response.json();
    }

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
                    
                    if (onProgress) {
                        onProgress(status);
                    }

                    if (['complete', 'error', 'canceled'].includes(status.status)) {
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

    async cancelJob(jobId) {
        console.log('[TTS] Cancelling job:', jobId);
        
        await fetch(this.apiBase + '/v1/tts/jobs/' + jobId + '/cancel', {
            method: 'POST'
        });

        this.stopPolling();
    }

    async getPlaylist(jobId) {
        const response = await fetch(this.apiBase + '/v1/tts/jobs/' + jobId + '/playlist.json');
        
        if (!response.ok) {
            throw new Error('Failed to get playlist: ' + response.status);
        }

        return await response.json();
    }

    getAudioUrl(jobId) {
        return this.apiBase + '/v1/tts/jobs/' + jobId + '/audio.ogg';
    }

    async healthCheck() {
        try {
            const response = await fetch(this.apiBase + '/health');
            return await response.json();
        } catch (error) {
            console.error('[TTS] Health check failed:', error);
            return null;
        }
    }

    cleanup() {
        this.stopPolling();
        this.currentJobId = null;
    }
}

window.TTSClient = TTSClient;
