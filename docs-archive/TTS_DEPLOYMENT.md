# LibRead Ereader + PronounceX TTS Deployment Guide

This guide covers deploying the LibRead ereader with integrated PronounceX TTS support.

## Prerequisites

1. **PronounceX TTS Stack** running on Docker network `pronouncex-net`
2. Docker and Docker Compose installed

## Quick Start

### 1. Start PronounceX TTS Stack

From your PronounceX repository:

```bash
# Create shared network (one-time)
docker network create pronouncex-net

# Start TTS stack
docker compose -f compose.yml up -d --build
```

### 2. Start LibRead Reader

From this repository:

```bash
# Build and start with Docker Compose
docker compose up -d --build
```

The reader will be available at `http://localhost:3001`

## Architecture

```
┌─────────────────────────────────────────────┐
│         Browser / Client                    │
│    http://localhost:3001                    │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│      LibRead Reader Container               │
│      Port: 3001                             │
│      ┌──────────────────────────────────┐   │
│      │  Express.js + Static Files       │   │
│      │  /api/tts/* → TTS Proxy          │   │
│      │  /api/* → LibRead Proxy          │   │
│      └──────────────────────────────────┘   │
└──────────────┬──────────────────────────────┘
               │
               │ pronouncex-net
               ▼
┌─────────────────────────────────────────────┐
│      PronounceX API Container               │
│      Port: 8000 (internal)                  │
│      - /reader/synthesize                   │
│      - /v1/tts/jobs/{id}                    │
│      - /v1/tts/jobs/{id}/audio.ogg          │
└─────────────────────────────────────────────┘
```

## Configuration

### Environment Variables

Edit `docker-compose.yml` to configure:

```yaml
environment:
  - PRONOUNCEX_TTS_API=http://pronouncex-api:8000  # TTS API endpoint
```

### Running on Host (Development)

If you need to run the reader on the host machine (not Docker):

1. **Publish PronounceX API port** - In your PronounceX `compose.yml`:

```yaml
services:
  pronouncex-api:
    ports:
      - "8000:8000"  # Add this
```

2. **Update server.js** - Change the default TTS API URL:

```javascript
const ttsApiBase = process.env.PRONOUNCEX_TTS_API || 'http://127.0.0.1:8000';
```

3. **Run the reader**:

```bash
npm install
npm start
```

## Usage

### Reading with TTS

1. Open any novel in the reader
2. Navigate to a chapter
3. Click "Play Chapter" in the TTS player
4. Use controls to pause, stop, or adjust speed

### TTS Features

- **Play/Pause/Stop**: Control audio playback
- **Speed Control**: 0.75x to 2.0x playback speed
- **Progress Tracking**: Visual progress during synthesis and playback
- **Auto-Cleanup**: Stops playback when changing chapters

## Troubleshooting

### TTS Not Working

1. **Check network connectivity**:
```bash
docker network inspect pronouncex-net
```

2. **Verify TTS API is accessible**:
```bash
docker exec libread-reader curl http://pronouncex-api:8000/health
```

3. **Check reader logs**:
```bash
docker logs libread-reader -f
```

### Audio Not Playing

1. Check browser console for errors
2. Verify the TTS job completed successfully
3. Check browser supports OGG Vorbis playback

## API Endpoints

### Reader App

- `GET /` - Reader UI
- `GET /health` - Health check
- `GET /api/search?q=<query>` - Search novels
- `GET /api/proxy?url=<url>` - Generic proxy
- `GET /api/novel/<id>` - Novel details
- `GET /api/chapterlist?aid=<id>` - Chapter list
- `GET /api/chapter/<novelId>/<chapterId>` - Chapter content
- `ALL /api/tts/*` - TTS API proxy

### TTS (via Proxy)

- `POST /api/tts/reader/synthesize` - Submit TTS job
- `GET /api/tts/v1/tts/jobs/<id>` - Get job status
- `GET /api/tts/v1/tts/jobs/<id>/audio.ogg` - Get audio
- `GET /api/tts/health` - TTS health check

## Development

To run without Docker for development:

```bash
# Install dependencies
npm install

# Start with local TTS endpoint
PRONOUNCEX_TTS_API=http://localhost:8000 npm start
```

## Production Deployment

For production:

1. Use environment variables for configuration
2. Enable HTTPS
3. Set up proper logging
4. Configure resource limits
5. Use a reverse proxy (nginx) for static files

Example nginx config:

```nginx
server {
    listen 80;
    server_name reader.example.com;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Support

For issues with:
- **Reader app**: Check this repository's issues
- **TTS service**: Check PronounceX repository issues
