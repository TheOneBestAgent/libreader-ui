# TTS Integration Quick Reference

## Setup Commands

```bash
# 1. Create network and start TTS stack
docker network create pronouncex-net || true
cd /path/to/pronouncex
docker compose -f compose.yml up -d --build

# 2. Start reader with TTS integration
cd /path/to/libread-ereader
docker compose up -d --build

# 3. Access the reader
open http://localhost:3001
```

## TTS API Flow

### 1. Submit Job
```bash
curl -X POST http://localhost:3001/api/tts/reader/synthesize \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello world. This is a test.",
    "model": "default",
    "prefer_phonemes": true
  }'
```

Response:
```json
{
  "job_id": "uuid-here",
  "status": "queued"
}
```

### 2. Poll Status
```bash
curl http://localhost:3001/api/tts/v1/tts/jobs/<job_id>
```

Response:
```json
{
  "status": "processing",
  "segments_ready": 5,
  "segments_total": 10
}
```

### 3. Get Audio
```bash
curl http://localhost:3001/api/tts/v1/tts/jobs/<job_id>/audio.ogg --output audio.ogg
```

## Status Values

- `queued` - Job queued, waiting to start
- `processing` - Generating audio segments
- `complete` - Audio ready for playback
- `error` - Job failed
- `canceled` - Job was cancelled

## JavaScript Usage

```javascript
// Initialize TTS client
const tts = new TTSClient('/api/tts');

// Submit text
const job = await tts.synthesize("Text to speak");

// Poll for completion
await tts.pollJobStatus(job.job_id, (status) => {
  console.log(`Progress: ${status.segments_ready}/${status.segments_total}`);
});

// Play audio
const audioUrl = tts.getAudioUrl(job.job_id);
const audio = new Audio(audioUrl);
audio.play();

// Cancel if needed
await tts.cancelJob(job.job_id);
```

## Network Debugging

```bash
# Check if containers are on same network
docker network inspect pronouncex-net

# Test connectivity from reader to TTS
docker exec libread-reader curl http://pronouncex-api:8000/health

# View logs
docker logs libread-reader -f
docker logs pronouncex-api -f
```

## Common Issues

**Issue**: "TTS API error: connection refused"
- **Fix**: Ensure both containers are on `pronouncex-net` network
- **Fix**: Verify PronounceX API container is running

**Issue**: "Failed to fetch image"
- **Fix**: Check PronounceX API is accessible
- **Fix**: Verify DNS resolution of `pronouncex-api` hostname

**Issue**: Audio won't play in browser
- **Fix**: Ensure browser supports OGG Vorbis
- **Fix**: Check for CORS issues
- **Fix**: Verify audio URL is correct
