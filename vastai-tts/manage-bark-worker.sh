#!/bin/bash
# Bark TTS Worker Management Script for Vast.ai
# Uses pre-built Docker image from GitHub Container Registry
#
# This script manages GPU workers for Bark TTS synthesis.
# Workers use persistent storage so models only download once.

set -e

# Configuration
GHCR_IMAGE="ghcr.io/theonebestagent/libread-bark-tts:latest"
ENDPOINT_NAME="bark-tts"
ENDPOINT_ID="11521"
WORKERGROUP_ID="16104"

# GPU search parameters - adjust as needed
GPU_SEARCH='reliability>0.95 num_gpus=1 gpu_ram>=10 disk_space>=50'
PREFERRED_GPUS="RTX_3060 RTX_3070 RTX_3080 RTX_4060"

show_help() {
    echo "Bark TTS Worker Management (Vast.ai + ghcr.io)"
    echo ""
    echo "Usage: $0 {start|stop|status|logs|test|search}"
    echo ""
    echo "Commands:"
    echo "  start   - Start a new Bark worker instance"
    echo "  stop    - Stop all running workers"
    echo "  status  - Check worker and endpoint status"
    echo "  logs    - View worker logs"
    echo "  test    - Test the TTS endpoint"
    echo "  search  - Search for available GPU offers"
    echo ""
    echo "Image: $GHCR_IMAGE"
    echo ""
    echo "Cost: ~\$0.05-0.12/hour depending on GPU"
    echo ""
    echo "First run takes 5-10 minutes to download Bark models (~5GB)."
    echo "Subsequent runs start in ~30 seconds (models cached on disk)."
}

search_gpus() {
    echo "Searching for GPU offers..."
    echo ""
    echo "Best affordable GPUs for Bark TTS:"
    echo "=================================="
    vastai search offers "$GPU_SEARCH" --order 'dph_total' --limit 10 | head -20
    echo ""
    echo "To start a specific offer:"
    echo "  vastai create instance OFFER_ID --image $GHCR_IMAGE --disk 50"
}

start_worker() {
    echo "Starting Bark TTS worker..."
    echo "Image: $GHCR_IMAGE"
    echo ""
    
    # Check if VASTAI_API_KEY is set
    if [ -z "$VASTAI_API_KEY" ]; then
        echo "Warning: VASTAI_API_KEY not set. Make sure you've run 'vastai set api-key YOUR_KEY'"
    fi
    
    echo "Searching for affordable GPU (RTX 3060/3070/3080/4060)..."
    
    # Find the cheapest suitable GPU
    OFFER_ID=$(vastai search offers "$GPU_SEARCH" --order 'dph_total' --raw 2>/dev/null | python3 -c "
import sys, json
try:
    offers = json.load(sys.stdin)
    if offers:
        # Prefer certain GPUs
        preferred = ['RTX_3060', 'RTX_3070', 'RTX_3080', 'RTX_4060', 'RTX_4070']
        for gpu in preferred:
            for offer in offers:
                if gpu in offer.get('gpu_name', ''):
                    print(offer['id'])
                    sys.exit(0)
        # Fall back to cheapest
        print(offers[0]['id'])
except Exception as e:
    print('', file=sys.stderr)
" 2>/dev/null)
    
    if [ -z "$OFFER_ID" ]; then
        echo "No suitable GPU found!"
        echo ""
        echo "Try searching manually:"
        echo "  $0 search"
        echo ""
        echo "Or expand search criteria:"
        echo "  vastai search offers 'reliability>0.9 num_gpus=1 gpu_ram>=8'"
        exit 1
    fi
    
    # Get offer details
    echo "Found offer ID: $OFFER_ID"
    vastai show machine $OFFER_ID 2>/dev/null | head -5 || true
    echo ""
    
    echo "Creating instance with pre-built Docker image..."
    echo "(Models will download to persistent /workspace on first run)"
    echo ""
    
    # Create instance with the ghcr.io image
    vastai create instance $OFFER_ID \
        --image "$GHCR_IMAGE" \
        --disk 50 \
        --ssh \
        --direct \
        --env "-p 8080:8080" \
        --label "${ENDPOINT_NAME}:${ENDPOINT_ID}:${WORKERGROUP_ID}"
    
    echo ""
    echo "=========================================="
    echo "Worker starting!"
    echo "=========================================="
    echo ""
    echo "First run: 5-10 minutes (downloading ~5GB Bark models)"
    echo "Subsequent runs: ~30 seconds (models cached)"
    echo ""
    echo "Commands:"
    echo "  $0 status  - Check if worker is ready"
    echo "  $0 logs    - View startup logs"
    echo "  $0 test    - Test TTS synthesis"
    echo "  $0 stop    - Stop worker when done"
}

stop_workers() {
    echo "Stopping all Bark workers..."
    
    vastai show instances --raw 2>/dev/null | python3 -c "
import sys, json, subprocess
try:
    instances = json.load(sys.stdin)
    stopped = 0
    for inst in instances:
        label = inst.get('label', '')
        if label.startswith('${ENDPOINT_NAME}') or 'bark' in inst.get('image', '').lower():
            print(f\"Stopping instance {inst['id']} ({inst.get('gpu_name', 'unknown')})...\")
            subprocess.run(['vastai', 'destroy', 'instance', str(inst['id'])], capture_output=True)
            stopped += 1
    if stopped == 0:
        print('No Bark workers found running.')
    else:
        print(f'Stopped {stopped} worker(s).')
except Exception as e:
    print(f'Error: {e}')
"
}

show_status() {
    echo "Bark TTS Worker Status"
    echo "======================"
    echo ""
    
    echo "Running instances:"
    vastai show instances 2>/dev/null | grep -E "ID|${ENDPOINT_NAME}|bark" || echo "  No workers running"
    
    echo ""
    echo "Endpoint check:"
    
    if [ -z "$VASTAI_API_KEY" ]; then
        echo "  VASTAI_API_KEY not set - cannot check endpoint"
        return
    fi
    
    curl -s -X POST "https://run.vast.ai/route/" \
        -H "Authorization: Bearer ${VASTAI_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"endpoint\": \"${ENDPOINT_NAME}\", \"cost\": 100}" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'url' in data:
        print(f\"  Worker ready at: {data['url']}\")
    elif 'status' in data:
        print(f\"  Status: {data['status']}\")
    elif 'error' in data:
        print(f\"  Error: {data['error']}\")
    else:
        print(f\"  Response: {data}\")
except Exception as e:
    print(f\"  Failed to check: {e}\")
"
}

show_logs() {
    echo "Fetching worker logs..."
    
    INSTANCE_INFO=$(vastai show instances --raw 2>/dev/null | python3 -c "
import sys, json
try:
    instances = json.load(sys.stdin)
    for inst in instances:
        label = inst.get('label', '')
        if label.startswith('${ENDPOINT_NAME}') or 'bark' in inst.get('image', '').lower():
            print(json.dumps(inst))
            break
except:
    pass
")
    
    if [ -z "$INSTANCE_INFO" ]; then
        echo "No Bark worker instance found"
        exit 1
    fi
    
    INSTANCE_ID=$(echo "$INSTANCE_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
    echo "Instance ID: $INSTANCE_ID"
    echo ""
    
    # Try to get logs via SSH
    SSH_INFO=$(vastai show instance $INSTANCE_ID --raw 2>/dev/null | python3 -c "
import sys, json
try:
    inst = json.load(sys.stdin)
    if isinstance(inst, list):
        inst = inst[0]
    ports = inst.get('ports', {})
    ssh_port = ports.get('22/tcp', [{}])[0].get('HostPort', '')
    ssh_host = inst.get('ssh_host', '')
    print(f'{ssh_host}:{ssh_port}')
except Exception as e:
    print(f'error:{e}', file=sys.stderr)
")
    
    if [[ "$SSH_INFO" == *":"* ]] && [[ "$SSH_INFO" != *"error"* ]]; then
        SSH_HOST=$(echo "$SSH_INFO" | cut -d: -f1)
        SSH_PORT=$(echo "$SSH_INFO" | cut -d: -f2)
        
        if [ -n "$SSH_HOST" ] && [ -n "$SSH_PORT" ]; then
            echo "Connecting to $SSH_HOST:$SSH_PORT..."
            echo ""
            ssh -o StrictHostKeyChecking=no \
                -o UserKnownHostsFile=/dev/null \
                -o ConnectTimeout=10 \
                -p "$SSH_PORT" \
                root@"$SSH_HOST" \
                "cat /var/log/vastai.log 2>/dev/null || journalctl -u docker --no-pager -n 50 2>/dev/null || docker logs \$(docker ps -q | head -1) 2>/dev/null || echo 'No logs found'" \
                2>/dev/null || echo "Failed to connect via SSH"
        fi
    else
        echo "Cannot get SSH info. Instance may still be starting."
        echo "Try again in a minute or check the Vast.ai dashboard."
    fi
}

test_tts() {
    echo "Testing Bark TTS endpoint..."
    echo ""
    
    if [ -z "$VASTAI_API_KEY" ]; then
        echo "Error: VASTAI_API_KEY not set"
        exit 1
    fi
    
    # Get worker URL
    WORKER_URL=$(curl -s -X POST "https://run.vast.ai/route/" \
        -H "Authorization: Bearer ${VASTAI_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"endpoint\": \"${ENDPOINT_NAME}\", \"cost\": 100}" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('url', ''))
except:
    pass
")
    
    if [ -z "$WORKER_URL" ]; then
        echo "No worker available. Start one with: $0 start"
        exit 1
    fi
    
    echo "Worker URL: $WORKER_URL"
    echo ""
    echo "Testing health endpoint..."
    curl -s "${WORKER_URL}/health" | python3 -m json.tool 2>/dev/null || echo "Health check failed"
    
    echo ""
    echo "Testing synthesis..."
    RESPONSE=$(curl -s -X POST "${WORKER_URL}/synthesize" \
        -H "Content-Type: application/json" \
        -d '{"text": "Hello! This is a test of Bark text to speech."}')
    
    echo "$RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if data.get('status') == 'success':
        print(f\"Success!\")
        print(f\"  Duration: {data.get('duration', 'N/A')}s\")
        print(f\"  Synthesis time: {data.get('synthesis_time', 'N/A')}s\")
        print(f\"  Audio size: {len(data.get('audio', ''))} bytes (base64)\")
    else:
        print(f\"Error: {data.get('error', 'Unknown error')}\")
except Exception as e:
    print(f\"Failed to parse response: {e}\")
"
}

# Main command handler
case "${1:-help}" in
    start)
        start_worker
        ;;
    stop)
        stop_workers
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs
        ;;
    test)
        test_tts
        ;;
    search)
        search_gpus
        ;;
    help|--help|-h|*)
        show_help
        ;;
esac
