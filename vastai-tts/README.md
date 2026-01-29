# Vast.ai TTS Integration

GPU-accelerated Text-to-Speech using Qwen3-TTS on Vast.ai's serverless infrastructure.

## Overview

This integration provides high-quality neural TTS synthesis by running Qwen3-TTS on Vast.ai's GPU cloud. The system uses a serverless architecture that automatically scales workers based on demand, meaning you only pay for what you use.

**Key Features:**
- Qwen3-TTS model for high-quality speech synthesis
- GPU acceleration for fast inference (~1-2s per sentence)
- Voice cloning capability (with reference audio)
- Auto-scaling serverless architecture
- Pay-per-request pricing

## Prerequisites

1. **Vast.ai Account**: Create an account at [vast.ai](https://vast.ai/) and add credits
2. **Vast.ai CLI**: Install the CLI tool
3. **Docker Hub Account** (optional): For hosting the worker image

## Setup Guide

### Step 1: Install Vast.ai CLI

```bash
pip install vastai
```

### Step 2: Configure API Key

Get your API key from the Vast.ai dashboard and configure:

```bash
vastai set api-key YOUR_API_KEY
```

### Step 3: Build and Push Docker Image

Build the worker Docker image:

```bash
cd vastai-tts
docker build -t YOUR_DOCKERHUB_USERNAME/libread-tts:latest .
docker push YOUR_DOCKERHUB_USERNAME/libread-tts:latest
```

### Step 4: Deploy Serverless Endpoint

Use the provided setup script:

```bash
# Set your Docker image
export VASTAI_DOCKER_IMAGE=YOUR_DOCKERHUB_USERNAME/libread-tts:latest

# Run setup
./setup-vastai.sh
```

Or manually create the endpoint via the Vast.ai dashboard:

1. Go to **Serverless** > **Endpoints**
2. Create a new endpoint named `libread-tts`
3. Create a template with your Docker image
4. Create a worker group with these settings:
   - Min Workers: 0 (scale to zero when idle)
   - Max Workers: 3 (adjust based on expected load)
   - GPU RAM: 8GB minimum
   - Search: `reliability>0.95 num_gpus=1`

### Step 5: Configure LibRead

Add the following environment variables to your LibRead server:

```bash
# In .env or docker-compose.yml
VASTAI_API_KEY=your_api_key_here
VASTAI_ENDPOINT_ID=your_endpoint_id_here  # Get from vast.ai dashboard
```

For Docker Compose, add to your `docker-compose.yml`:

```yaml
services:
  server:
    environment:
      - VASTAI_API_KEY=${VASTAI_API_KEY}
      - VASTAI_ENDPOINT_ID=${VASTAI_ENDPOINT_ID}
```

## Usage

Once configured, select "Vast.ai GPU TTS" from the TTS engine dropdown in LibRead settings. The system will:

1. Send synthesis requests to Vast.ai
2. Vast.ai routes requests to available GPU workers
3. Workers synthesize audio using Qwen3-TTS
4. Audio is returned as base64-encoded WAV

## Configuration Options

### Server Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VASTAI_API_KEY` | Your Vast.ai API key | Required |
| `VASTAI_ENDPOINT_ID` | Serverless endpoint ID | Required |

### Worker Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TTS_MODEL` | HuggingFace model ID | `Qwen/Qwen3-TTS-12Hz-1.7B-Base` |
| `TTS_MAX_LENGTH` | Max text length | `5000` |
| `PORT` | HTTP server port | `8080` |

### Endpoint Configuration

Adjust these in the setup script or Vast.ai dashboard:

| Setting | Description | Recommended |
|---------|-------------|-------------|
| `MIN_WORKERS` | Minimum workers (0 = scale to zero) | 0 |
| `MAX_WORKERS` | Maximum concurrent workers | 3 |
| `TARGET_WORKERS` | Default active workers | 1 |
| GPU RAM | Minimum GPU memory | 8GB |

## Pricing

Vast.ai charges based on:
- **GPU time**: ~$0.10-0.30/hour depending on GPU type
- **Cold start**: First request after idle may take 30-60s (model loading)

With scale-to-zero enabled (`MIN_WORKERS=0`), you only pay when actively using TTS.

**Cost estimation:**
- Light usage (< 100 requests/day): ~$1-5/month
- Moderate usage (100-1000 requests/day): ~$10-30/month
- Heavy usage: Consider reserved instances

## Troubleshooting

### "Vast.ai TTS not configured"

Ensure both `VASTAI_API_KEY` and `VASTAI_ENDPOINT_ID` are set in your environment.

### Slow first request

Cold starts take 30-60 seconds as the model loads. Subsequent requests should be 1-3 seconds. Keep `TARGET_WORKERS=1` to avoid cold starts.

### "No audio returned"

Check worker logs in the Vast.ai dashboard. Common issues:
- Worker crashed (check memory usage)
- Model failed to load (check logs)
- Network timeout (increase timeout in server.js)

### Worker keeps restarting

GPU memory may be insufficient. Increase `gpu_ram` requirement to 12GB or higher.

## API Reference

### Synthesis Request

```
POST /api/tts/v1/tts/jobs?engine=vastai
Content-Type: application/json

{
  "text": "Hello, world!",
  "language": "English",
  "voice": "default"  // or "clone" with voice data
}
```

### Response

```json
{
  "job_id": "vastai_1234567890_abc123",
  "status": "processing"
}
```

### Get Job Status

```
GET /api/tts/v1/tts/jobs/{job_id}?engine=vastai
```

### Get Audio

```
GET /api/tts/v1/tts/jobs/{job_id}/audio.wav?engine=vastai
```

## Files

| File | Description |
|------|-------------|
| `worker.py` | Vast.ai PyWorker implementation |
| `requirements.txt` | Python dependencies |
| `Dockerfile` | Worker container image |
| `setup-vastai.sh` | Endpoint deployment script |

## Voice Cloning (Advanced)

To use voice cloning, send a reference audio sample:

```json
{
  "text": "Text to synthesize",
  "voice": "clone",
  "voice_data": "BASE64_ENCODED_WAV_AUDIO"
}
```

The reference audio should be:
- 5-30 seconds of clear speech
- WAV format, 16kHz or higher
- Single speaker, minimal background noise

## License

MIT License - see main project LICENSE file.
