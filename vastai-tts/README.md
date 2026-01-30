# Vast.ai Bark TTS Integration

GPU-accelerated Text-to-Speech using Bark on Vast.ai's infrastructure.

## Overview

This integration provides **expressive, context-aware** neural TTS synthesis by running Bark on Vast.ai's GPU cloud. The Docker image is hosted on GitHub Container Registry (ghcr.io) to avoid Docker Hub rate limits.

**Key Features:**
- **Bark AI** - Expressive TTS that understands context and emotion
- **Automatic expression** - Adds natural pauses, intonation, laughs, sighs based on text
- **Multiple voices** - Built-in voice presets for different characters/narration
- **Pre-built Docker image** - No build timeouts, fast deployment
- **Persistent model storage** - Models download once, cached on disk

## Quick Start

### Prerequisites

1. **Vast.ai Account**: Create an account at [vast.ai](https://vast.ai/) and add credits (~$5 minimum)
2. **Vast.ai CLI**: Install and configure:
   ```bash
   pip install vastai
   vastai set api-key YOUR_API_KEY
   ```
3. **Export API key** for the management script:
   ```bash
   export VASTAI_API_KEY=your_api_key_here
   ```

### Start a Worker

```bash
cd vastai-tts
./manage-bark-worker.sh start
```

This will:
1. Search for an affordable GPU (RTX 3060/3070/3080)
2. Create an instance with the pre-built Docker image
3. Download Bark models to persistent storage (first run: ~5-10 min)

### Check Status

```bash
./manage-bark-worker.sh status
```

### Test TTS

```bash
./manage-bark-worker.sh test
```

### Stop Worker (Save Money!)

```bash
./manage-bark-worker.sh stop
```

## Pricing

| GPU | Typical Cost | Notes |
|-----|--------------|-------|
| RTX 3060 | $0.05-0.08/hr | Best value, 12GB VRAM |
| RTX 3070 | $0.06-0.10/hr | Faster inference |
| RTX 3080 | $0.08-0.15/hr | Even faster |
| RTX 4060 | $0.08-0.12/hr | Newer, efficient |

**First run**: 5-10 minutes (model download)
**Subsequent runs**: ~30 seconds (models cached)

## Docker Image

The image is automatically built and pushed to GitHub Container Registry:

```
ghcr.io/darvondoom/libread-bark-tts:latest
```

### Why ghcr.io instead of Docker Hub?

- **No rate limits** - Docker Hub has strict pull limits
- **No timeouts** - Large images can timeout on Docker Hub
- **Free** - Unlimited pulls for public images
- **Integrated** - Automatically built via GitHub Actions

### Manual Instance Creation

If you prefer to create instances manually:

```bash
# Search for GPUs
vastai search offers 'reliability>0.95 num_gpus=1 gpu_ram>=10 disk_space>=50' --order 'dph_total'

# Create instance with specific offer
vastai create instance OFFER_ID \
    --image ghcr.io/darvondoom/libread-bark-tts:latest \
    --disk 50 \
    --ssh \
    --direct \
    --env "-p 8080:8080"
```

## Configuration

### Environment Variables (Worker)

| Variable | Description | Default |
|----------|-------------|---------|
| `BARK_VOICE` | Default voice preset | `v2/en_speaker_6` |
| `TTS_MAX_LENGTH` | Max text length | `500` |
| `PORT` | HTTP server port | `8080` |
| `HF_HOME` | Model cache directory | `/workspace/models` |

### LibRead Integration

Add to your `.env`:

```bash
VASTAI_API_KEY=your_api_key_here
VASTAI_ENDPOINT_ID=your_endpoint_id  # Optional, for serverless
```

## API Reference

### Health Check

```
GET /health
```

Response:
```json
{
  "ready": true,
  "model": "Bark",
  "device": "cuda:0",
  "cuda_available": true,
  "max_text_length": 500
}
```

### Synthesize

```
POST /synthesize
Content-Type: application/json

{
  "text": "Hello, world!",
  "voice": "v2/en_speaker_6"
}
```

Response:
```json
{
  "audio": "BASE64_ENCODED_WAV",
  "sample_rate": 24000,
  "duration": 1.5,
  "synthesis_time": 2.3,
  "status": "success"
}
```

### Voice Presets

| Voice | Description |
|-------|-------------|
| `v2/en_speaker_6` | Natural male narrator (default) |
| `v2/en_speaker_9` | Natural female narrator |
| `v2/en_speaker_1` | Calm male voice |
| `male` | Alias for speaker_6 |
| `female` | Alias for speaker_9 |
| `narrator` | Alias for speaker_1 |

## Troubleshooting

### "No suitable GPU found"

Expand search criteria:
```bash
vastai search offers 'reliability>0.9 num_gpus=1 gpu_ram>=8'
```

### Slow first request

Normal! First run downloads ~5GB of Bark models. Check progress:
```bash
./manage-bark-worker.sh logs
```

### Worker keeps restarting

GPU memory may be insufficient. Ensure at least 10GB VRAM.

### "Failed to pull image"

The image should be public. If issues persist:
```bash
# Check image exists
docker pull ghcr.io/darvondoom/libread-bark-tts:latest
```

## Building the Image

The image is automatically built via GitHub Actions when changes are pushed to `vastai-tts/`. To build manually:

```bash
cd vastai-tts
docker build -f Dockerfile.ghcr -t ghcr.io/darvondoom/libread-bark-tts:latest .
```

## Files

| File | Description |
|------|-------------|
| `Dockerfile.ghcr` | Optimized Dockerfile for ghcr.io |
| `bark-worker.py` | HTTP server for TTS synthesis |
| `manage-bark-worker.sh` | CLI for managing Vast.ai workers |
| `.github/workflows/build-bark-tts.yml` | GitHub Actions workflow |

## Cost Optimization

1. **Stop workers when not in use**: `./manage-bark-worker.sh stop`
2. **Use cheaper GPUs**: RTX 3060 is sufficient and cheapest
3. **Batch requests**: Combine short texts to reduce overhead
4. **Use interruptible instances**: Even cheaper, but may be terminated

## License

MIT License - see main project LICENSE file.
