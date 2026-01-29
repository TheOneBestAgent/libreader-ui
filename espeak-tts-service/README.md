# eSpeak-NG TTS Service

A FastAPI service that wraps eSpeak-NG to provide a PronounceX-compatible TTS API.

## Features

- Lightweight and fast TTS synthesis
- **IPA phoneme support via PronounceX dictionary integration**
- **Custom pronunciation support through PronounceX dictionaries**
- Multiple language/voice support
- Compatible with PronounceX API format
- Redis-backed job queue
- WAV audio output

## Configuration

Environment variables:

- `ESPEAK_TTS_REDIS_URL`: Redis connection URL (default: `redis://localhost:6379/2`)
- `ESPEAK_TTS_CACHE_DIR`: Audio cache directory (default: `/data/cache`)
- `ESPEAK_TTS_DEFAULT_VOICE`: Default voice ID (default: `en-us`)
- `ESPEAK_SPEED`: Speech rate in words per minute (default: `175`)
- `PRONOUNCEX_API_URL`: PronounceX API URL for phoneme conversion (default: `http://pronouncex-api:8000`)

## Phoneme Integration

When `prefer_phonemes: true` is set, the service:

1. Calls PronounceX API's `/v1/dicts/phonemize` endpoint to convert text → IPA phonemes
2. Uses PronounceX's dictionary system for custom pronunciations
3. Passes IPA phonemes to espeak-ng with `--ipa` flag for accurate pronunciation

This allows espeak to benefit from the same pronunciation dictionaries used by Piper/PronounceX.

## API Endpoints

### Health Check
```
GET /health
```

Returns service health status and espeak-ng availability.

### List Voices
```
GET /v1/tts/voices
```

Returns list of available eSpeak-NG voices.

### Create TTS Job
```
POST /v1/tts/jobs
Content-Type: application/json

{
  "text": "Hello, world!",
  "voice": "en-us",
  "prefer_phonemes": false
}
```

Returns job ID for polling.

### Get Job Status
```
GET /v1/tts/jobs/{job_id}
```

Returns job status and audio URLs when complete.

### Get Audio
```
GET /v1/tts/jobs/{job_id}/audio.wav
GET /v1/tts/jobs/{job_id}/segments/{segment_id}/audio
```

Returns WAV audio file.

### Delete Job
```
DELETE /v1/tts/jobs/{job_id}
```

Deletes job and associated audio files.

## Docker

Build:
```bash
docker build -t espeak-tts-service .
```

Run:
```bash
docker run -p 8003:8003 \
  -e ESPEAK_TTS_REDIS_URL=redis://localhost:6379/2 \
  -e ESPEAK_TTS_DEFAULT_VOICE=en-us \
  -v espeak-cache:/data/cache \
  espeak-tts-service
```

## Available Voices

eSpeak-NG supports many languages and variants. Common voices:

- `en-us` - US English
- `en-gb` - British English
- `es` - Spanish
- `fr` - French
- `de` - German
- `it` - Italian
- `pt` - Portuguese
- `ru` - Russian
- `zh` - Mandarin Chinese
- `ja` - Japanese
- `ko` - Korean

Use `espeak-ng --voices` to see all available voices.

## Notes

- eSpeak-NG produces robotic but intelligible speech
- Best used for testing or when lightweight/offline TTS is needed
- For higher quality voices, use Edge-TTS or Piper
- Supports IPA phoneme input with `prefer_phonemes: true`
