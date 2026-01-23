#!/bin/bash
# Start LibRead eReader with PronounceX TTS
# This script starts both the reader and TTS services locally

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TTS_PROJECT="/home/darvondoom/Projects/Ipa-tts-implementation"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  LibRead eReader + PronounceX TTS     ${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if TTS project exists
if [ ! -d "$TTS_PROJECT" ]; then
    echo -e "${RED}Error: TTS project not found at $TTS_PROJECT${NC}"
    exit 1
fi

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down services...${NC}"
    pkill -f "uvicorn api.app:app" 2>/dev/null || true
    pkill -f "node server.js" 2>/dev/null || true
    echo -e "${GREEN}Services stopped.${NC}"
}
trap cleanup EXIT

# Start TTS service in background
echo -e "\n${YELLOW}[1/2] Starting PronounceX TTS service...${NC}"
cd "$TTS_PROJECT/pronouncex-tts"

# Check for virtual environment
if [ -d "$TTS_PROJECT/.venv" ]; then
    source "$TTS_PROJECT/.venv/bin/activate"
elif [ -d "$TTS_PROJECT/venv" ]; then
    source "$TTS_PROJECT/venv/bin/activate"
else
    echo -e "${YELLOW}No virtual environment found. Using system Python.${NC}"
    echo -e "${YELLOW}Consider creating one with: python3 -m venv $TTS_PROJECT/.venv${NC}"
fi

# Start TTS API
PRONOUNCEX_TTS_GPU=0 uvicorn api.app:app --host 0.0.0.0 --port 8000 &
TTS_PID=$!
echo -e "${GREEN}TTS service starting (PID: $TTS_PID)...${NC}"

# Wait for TTS to be ready
echo -n "Waiting for TTS service"
for i in {1..30}; do
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        echo -e "\n${GREEN}TTS service ready!${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

if ! curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "\n${RED}TTS service failed to start${NC}"
    exit 1
fi

# Start Reader service
echo -e "\n${YELLOW}[2/2] Starting LibRead eReader...${NC}"
cd "$SCRIPT_DIR"
PRONOUNCEX_TTS_API=http://localhost:8000 node server.js &
READER_PID=$!
echo -e "${GREEN}Reader service starting (PID: $READER_PID)...${NC}"

# Wait for Reader to be ready
echo -n "Waiting for Reader service"
for i in {1..15}; do
    if curl -s http://localhost:3001/health > /dev/null 2>&1; then
        echo -e "\n${GREEN}Reader service ready!${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  All services running!                ${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "  Reader:  ${YELLOW}http://localhost:3001${NC}"
echo -e "  TTS API: ${YELLOW}http://localhost:8000${NC}"
echo -e "  TTS Settings: ${YELLOW}http://localhost:3001/settings${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Press Ctrl+C to stop all services"

# Wait for processes
wait
