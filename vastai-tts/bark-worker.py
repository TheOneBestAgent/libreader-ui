"""
Vast.ai Serverless TTS Worker using Bark
Expressive, context-aware text-to-speech
"""

import os
import sys
import json
import time
import base64
import logging
import io
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Optional

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

# Configuration
DEVICE = "cuda:0" if HAS_CUDA else "cpu"
MAX_TEXT_LENGTH = int(os.environ.get("TTS_MAX_LENGTH", "500"))  # Bark works best with shorter chunks
SAMPLE_RATE = 24000
DEFAULT_VOICE = os.environ.get("BARK_VOICE", "v2/en_speaker_6")  # Natural, expressive voice

# Global model - lazy loaded
bark_model_loaded = False

def load_bark():
    """Load Bark model on first use."""
    global bark_model_loaded
    
    if bark_model_loaded:
        return
    
    logger.info("Loading Bark model...")
    from bark import SAMPLE_RATE as BARK_SR, preload_models
    
    # Set device
    os.environ["CUDA_VISIBLE_DEVICES"] = "0" if HAS_CUDA else ""
    
    # Preload all models
    preload_models(
        text_use_gpu=HAS_CUDA,
        text_use_small=False,
        coarse_use_gpu=HAS_CUDA,
        coarse_use_small=False,
        fine_use_gpu=HAS_CUDA,
        fine_use_small=False,
        codec_use_gpu=HAS_CUDA,
    )
    
    bark_model_loaded = True
    logger.info("Bark model loaded successfully")

def synthesize(text: str, voice: str = None) -> bytes:
    """
    Synthesize speech from text using Bark.
    
    Args:
        text: Text to synthesize (Bark handles expression automatically)
        voice: Voice preset (e.g., 'v2/en_speaker_6')
        
    Returns:
        WAV audio data as bytes
    """
    import numpy as np
    import soundfile as sf
    from bark import generate_audio, SAMPLE_RATE as BARK_SR
    
    # Ensure model is loaded
    load_bark()
    
    # Use provided voice or default
    history_prompt = voice if voice else DEFAULT_VOICE
    
    # Generate audio
    # Bark automatically adds expression based on context!
    audio_array = generate_audio(
        text,
        history_prompt=history_prompt,
        text_temp=0.7,  # Higher = more creative/expressive
        waveform_temp=0.7
    )
    
    # Convert to WAV bytes
    buffer = io.BytesIO()
    # Ensure audio is in the right format
    audio_array = np.array(audio_array, dtype=np.float32)
    sf.write(buffer, audio_array, BARK_SR, format='WAV')
    buffer.seek(0)
    return buffer.read()

class BarkHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        """Suppress default request logging."""
        pass
    
    def do_POST(self):
        if self.path == "/synthesize":
            try:
                content_length = int(self.headers['Content-Length'])
                body = self.rfile.read(content_length)
                request = json.loads(body)
                
                text = request.get("text", "")
                if not text:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "status": "error",
                        "error": "No text provided"
                    }).encode())
                    return
                
                # Bark works best with chunks under 500 chars
                if len(text) > MAX_TEXT_LENGTH:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "status": "error",
                        "error": f"Text too long (max {MAX_TEXT_LENGTH} chars). Split into smaller chunks for best results."
                    }).encode())
                    return
                
                # Get voice parameter
                voice = request.get("voice")
                if voice and not voice.startswith("v2/"):
                    # Map simple voice names to Bark presets
                    voice_map = {
                        "male": "v2/en_speaker_6",
                        "female": "v2/en_speaker_9",
                        "narrator": "v2/en_speaker_1",
                    }
                    voice = voice_map.get(voice.lower(), DEFAULT_VOICE)
                
                logger.info(f"Synthesizing: {len(text)} chars with voice {voice or DEFAULT_VOICE}")
                
                start_time = time.time()
                audio_bytes = synthesize(text, voice)
                synth_time = time.time() - start_time
                
                # Calculate duration
                audio_size = len(audio_bytes) - 44  # WAV header
                duration = audio_size / (2 * SAMPLE_RATE)
                
                logger.info(f"Generated {duration:.2f}s audio in {synth_time:.2f}s")
                
                result = {
                    "audio": base64.b64encode(audio_bytes).decode("utf-8"),
                    "sample_rate": SAMPLE_RATE,
                    "duration": duration,
                    "synthesis_time": synth_time,
                    "status": "success"
                }
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(result).encode())
                
            except Exception as e:
                logger.error(f"Synthesis failed: {e}")
                import traceback
                traceback.print_exc()
                
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "status": "error",
                    "error": str(e)
                }).encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_GET(self):
        if self.path == "/health":
            result = {
                "ready": bark_model_loaded,
                "model": "Bark",
                "device": DEVICE,
                "cuda_available": HAS_CUDA,
                "max_text_length": MAX_TEXT_LENGTH
            }
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    
    # Pre-load model on startup
    logger.info("Pre-loading Bark model...")
    load_bark()
    logger.info("Bark ready!")
    
    server = HTTPServer(('0.0.0.0', port), BarkHandler)
    logger.info(f"Bark TTS server running on port {port}")
    logger.info(f"Device: {DEVICE}")
    logger.info(f"Max text length: {MAX_TEXT_LENGTH} chars")
    server.serve_forever()
