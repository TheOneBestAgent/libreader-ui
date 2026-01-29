#!/bin/bash
# Vast.ai TTS Endpoint Setup Script
#
# This script helps you deploy a TTS serverless endpoint on Vast.ai.
# Prerequisites:
#   1. Vast.ai account with credits
#   2. Vast.ai CLI installed: pip install vastai
#   3. API key set: vastai set api-key YOUR_API_KEY

set -e

# Configuration
ENDPOINT_NAME="${VASTAI_ENDPOINT_NAME:-libread-tts}"
TEMPLATE_NAME="${VASTAI_TEMPLATE_NAME:-libread-tts-qwen3}"
MIN_WORKERS="${VASTAI_MIN_WORKERS:-0}"
MAX_WORKERS="${VASTAI_MAX_WORKERS:-3}"
TARGET_WORKERS="${VASTAI_TARGET_WORKERS:-1}"

# Docker image (you need to build and push this)
DOCKER_IMAGE="${VASTAI_DOCKER_IMAGE:-}"

echo "=============================================="
echo "Vast.ai TTS Serverless Endpoint Setup"
echo "=============================================="
echo ""

# Check if vastai CLI is installed
if ! command -v vastai &> /dev/null; then
    echo "Error: vastai CLI not found"
    echo "Install with: pip install vastai"
    exit 1
fi

# Check if API key is set
if ! vastai show user &> /dev/null; then
    echo "Error: Vast.ai API key not configured"
    echo "Set with: vastai set api-key YOUR_API_KEY"
    exit 1
fi

echo "Vast.ai CLI configured successfully"
echo ""

# Show current user
echo "Account info:"
vastai show user | head -5
echo ""

# Check if Docker image is specified
if [ -z "$DOCKER_IMAGE" ]; then
    echo "=============================================="
    echo "STEP 1: Build and Push Docker Image"
    echo "=============================================="
    echo ""
    echo "You need to build and push the TTS worker Docker image."
    echo ""
    echo "Option A: Use Docker Hub"
    echo "  docker build -t YOUR_USERNAME/libread-tts:latest ."
    echo "  docker push YOUR_USERNAME/libread-tts:latest"
    echo ""
    echo "Option B: Use Vast.ai's registry"
    echo "  (See Vast.ai docs for container registry setup)"
    echo ""
    echo "Then re-run this script with:"
    echo "  VASTAI_DOCKER_IMAGE=YOUR_USERNAME/libread-tts:latest ./setup-vastai.sh"
    echo ""
    exit 0
fi

echo "Using Docker image: $DOCKER_IMAGE"
echo ""

# Create template
echo "=============================================="
echo "STEP 2: Create Vast.ai Template"
echo "=============================================="
echo ""

# Check if template exists
EXISTING_TEMPLATE=$(vastai search templates --raw 2>/dev/null | jq -r ".[] | select(.name == \"$TEMPLATE_NAME\") | .hash_id" || echo "")

if [ -n "$EXISTING_TEMPLATE" ]; then
    echo "Template '$TEMPLATE_NAME' already exists (hash: $EXISTING_TEMPLATE)"
    TEMPLATE_HASH=$EXISTING_TEMPLATE
else
    echo "Creating template '$TEMPLATE_NAME'..."
    
    TEMPLATE_RESULT=$(vastai create template \
        --name "$TEMPLATE_NAME" \
        --image "$DOCKER_IMAGE" \
        --disk 20 \
        --env "TTS_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-Base" \
        --env "PORT=8080" \
        --raw)
    
    TEMPLATE_HASH=$(echo "$TEMPLATE_RESULT" | jq -r '.hash_id')
    echo "Template created with hash: $TEMPLATE_HASH"
fi

echo ""

# Create endpoint
echo "=============================================="
echo "STEP 3: Create Serverless Endpoint"
echo "=============================================="
echo ""

# Check if endpoint exists
EXISTING_ENDPOINT=$(vastai show endpoints --raw 2>/dev/null | jq -r ".[] | select(.name == \"$ENDPOINT_NAME\") | .id" || echo "")

if [ -n "$EXISTING_ENDPOINT" ]; then
    echo "Endpoint '$ENDPOINT_NAME' already exists (id: $EXISTING_ENDPOINT)"
    ENDPOINT_ID=$EXISTING_ENDPOINT
else
    echo "Creating endpoint '$ENDPOINT_NAME'..."
    
    ENDPOINT_RESULT=$(vastai create endpoint \
        --name "$ENDPOINT_NAME" \
        --raw)
    
    ENDPOINT_ID=$(echo "$ENDPOINT_RESULT" | jq -r '.id')
    echo "Endpoint created with id: $ENDPOINT_ID"
fi

echo ""

# Create workergroup
echo "=============================================="
echo "STEP 4: Create Worker Group"
echo "=============================================="
echo ""

echo "Creating worker group for endpoint..."

# GPU requirements for Qwen3-TTS: ~4GB VRAM minimum
vastai create workergroup \
    --template_hash "$TEMPLATE_HASH" \
    --endpoint_name "$ENDPOINT_NAME" \
    --min_workers $MIN_WORKERS \
    --max_workers $MAX_WORKERS \
    --target_workers $TARGET_WORKERS \
    --gpu_ram 8 \
    --search_params "reliability>0.95 num_gpus=1"

echo ""
echo "=============================================="
echo "SETUP COMPLETE"
echo "=============================================="
echo ""
echo "Endpoint Name: $ENDPOINT_NAME"
echo "Template Hash: $TEMPLATE_HASH"
echo ""
echo "To use this endpoint, set the following environment variable:"
echo "  export VASTAI_ENDPOINT_NAME=$ENDPOINT_NAME"
echo ""
echo "Or add to your .env file:"
echo "  VASTAI_ENDPOINT_NAME=$ENDPOINT_NAME"
echo "  VASTAI_API_KEY=your_api_key"
echo ""
echo "Monitor your endpoint:"
echo "  vastai show endpoints"
echo "  vastai get endpoint workers $ENDPOINT_NAME"
echo ""
