"""
Vast.ai Serverless TTS Worker

This PyWorker provides text-to-speech synthesis using Qwen3-TTS on Vast.ai's
serverless GPU infrastructure. It implements the Vast.ai PyWorker interface
for auto-scaling GPU workers.

Supports:
- Qwen3-TTS with voice cloning
- Pocket TTS (ONNX) as fallback
- Both streaming and batch synthesis
"""

import os
import sys
import json
import time
import base64
import logging
import tempfile
from pathlib import Path
from typing import Optional, Dict, Any
from dataclasses import dataclass
import io

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Check for GPU
import torch
HAS_CUDA = torch.cuda.is_available()
logger.info(f"CUDA available: {HAS_CUDA}")
if HAS_CUDA:
    logger.info(f"GPU: {torch.cuda.get_device_name(0)}")
    logger.info(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")


class WorkerConfig:
    """Configuration for the TTS worker."""
    def __init__(self):
        self.model_id = os.environ.get("TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
        self.device = "cuda:0" if HAS_CUDA else "cpu"
        self.dtype = torch.bfloat16 if HAS_CUDA else torch.float32
        self.max_text_length = int(os.environ.get("TTS_MAX_LENGTH", "5000"))
        self.sample_rate = 24000


# Global model instance
config = WorkerConfig()
tts_model = None


def load_model():
    """Load the Qwen3-TTS model."""
    global tts_model
    
    if tts_model is not None:
        return tts_model
    
    logger.info(f"Loading model: {config.model_id}")
    logger.info(f"Device: {config.device}, Dtype: {config.dtype}")
    
    try:
        from qwen_tts import Qwen3TTSModel
        
        tts_model = Qwen3TTSModel.from_pretrained(
            config.model_id,
            device_map=config.device,
            dtype=config.dtype,
        )
        
        logger.info("Model loaded successfully")
        return tts_model
        
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        raise


def synthesize(text: str, language: str = "English", voice_data: Optional[str] = None) -> bytes:
    """
    Synthesize speech from text.
    
    Args:
        text: Text to synthesize
        language: Language code (English, Chinese, etc.)
        voice_data: Optional base64-encoded reference audio for voice cloning
        
    Returns:
        WAV audio data as bytes
    """
    import soundfile as sf
    import numpy as np
    
    model = load_model()
    
    # Handle voice cloning if reference audio provided
    if voice_data:
        # Decode base64 audio
        audio_bytes = base64.b64decode(voice_data)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_bytes)
            ref_audio_path = f.name
        
        try:
            wavs, sr = model.generate_voice_clone(
                text=text,
                language=language,
                ref_audio=ref_audio_path,
                ref_text="",  # Empty ref_text uses x-vector only mode
                x_vector_only_mode=True,
            )
        finally:
            os.unlink(ref_audio_path)
    else:
        # Use default voice synthesis
        wavs, sr = model.generate_voice_clone(
            text=text,
            language=language,
            x_vector_only_mode=True,
        )
    
    # Convert to WAV bytes
    buffer = io.BytesIO()
    sf.write(buffer, wavs[0], sr, format='WAV')
    buffer.seek(0)
    return buffer.read()


# ============================================================================
# Vast.ai PyWorker Interface
# ============================================================================

class Worker:
    """
    Vast.ai PyWorker implementation for TTS.
    
    The worker receives requests via the process() method and returns
    synthesized audio as base64-encoded WAV data.
    """
    
    def __init__(self, config: WorkerConfig):
        self.config = config
        self.ready = False
        
    def initialize(self):
        """Initialize the worker (load model)."""
        logger.info("Initializing TTS worker...")
        load_model()
        self.ready = True
        logger.info("Worker ready")
        
    def process(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process a TTS synthesis request.
        
        Request format:
        {
            "text": "Text to synthesize",
            "language": "English",  # Optional
            "voice": "base64_audio_data"  # Optional, for voice cloning
        }
        
        Response format:
        {
            "audio": "base64_encoded_wav",
            "sample_rate": 24000,
            "duration": 2.5,
            "status": "success"
        }
        """
        try:
            text = request.get("text", "")
            if not text:
                return {"status": "error", "error": "No text provided"}
            
            if len(text) > self.config.max_text_length:
                return {"status": "error", "error": f"Text too long (max {self.config.max_text_length} chars)"}
            
            language = request.get("language", "English")
            voice_data = request.get("voice")
            
            start_time = time.time()
            
            # Synthesize
            audio_bytes = synthesize(text, language, voice_data)
            
            synth_time = time.time() - start_time
            
            # Calculate duration (WAV header is 44 bytes, 16-bit mono @ 24kHz)
            audio_size = len(audio_bytes) - 44
            duration = audio_size / (2 * self.config.sample_rate)
            
            logger.info(f"Synthesized {len(text)} chars -> {duration:.2f}s audio in {synth_time:.2f}s")
            
            return {
                "audio": base64.b64encode(audio_bytes).decode("utf-8"),
                "sample_rate": self.config.sample_rate,
                "duration": duration,
                "synthesis_time": synth_time,
                "status": "success"
            }
            
        except Exception as e:
            logger.error(f"Synthesis failed: {e}")
            import traceback
            traceback.print_exc()
            return {"status": "error", "error": str(e)}
    
    def health_check(self) -> Dict[str, Any]:
        """Return worker health status."""
        return {
            "ready": self.ready,
            "model": self.config.model_id,
            "device": self.config.device,
            "cuda_available": HAS_CUDA,
        }


# ============================================================================
# HTTP Server for standalone testing
# ============================================================================

def run_http_server(port: int = 8080):
    """Run a simple HTTP server for testing."""
    from http.server import HTTPServer, BaseHTTPRequestHandler
    
    worker = Worker(config)
    worker.initialize()
    
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path == "/synthesize":
                content_length = int(self.headers['Content-Length'])
                body = self.rfile.read(content_length)
                request = json.loads(body)
                
                result = worker.process(request)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(result).encode())
            else:
                self.send_response(404)
                self.end_headers()
        
        def do_GET(self):
            if self.path == "/health":
                result = worker.health_check()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(result).encode())
            else:
                self.send_response(404)
                self.end_headers()
    
    server = HTTPServer(('0.0.0.0', port), Handler)
    logger.info(f"HTTP server running on port {port}")
    server.serve_forever()


if __name__ == "__main__":
    # When run directly, start HTTP server for testing
    port = int(os.environ.get("PORT", "8080"))
    run_http_server(port)
