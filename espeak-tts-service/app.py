"""
eSpeak-NG TTS Service
A FastAPI service that wraps espeak-ng to provide the same API as other TTS services.
Supports phoneme input and offline synthesis with lightweight, fast processing.
"""

import asyncio
import hashlib
import os
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import aiohttp
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# Configuration
REDIS_URL = os.environ.get("ESPEAK_TTS_REDIS_URL", "redis://localhost:6379/2")
CACHE_DIR = Path(os.environ.get("ESPEAK_TTS_CACHE_DIR", "/data/cache"))
DEFAULT_VOICE = os.environ.get("ESPEAK_TTS_DEFAULT_VOICE", "en-us")
JOB_EXPIRY_SECONDS = 3600  # Jobs expire after 1 hour
ESPEAK_SPEED = int(os.environ.get("ESPEAK_SPEED", "175"))  # Words per minute (default 175)
PRONOUNCEX_API_URL = os.environ.get("PRONOUNCEX_API_URL", "http://pronouncex-api:8000")  # For phoneme conversion

# Ensure cache directory exists
CACHE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="eSpeak-NG TTS Service",
    description="eSpeak-NG TTS wrapper with PronounceX-compatible API",
    version="1.0.0"
)

# Redis connection pool
redis_pool: Optional[redis.Redis] = None


class SynthesisRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    model_id: Optional[str] = None  # Alias for voice, for compatibility
    prefer_phonemes: Optional[bool] = False
    reading_profile: Optional[str] = None  # Ignored - for compatibility


class JobStatus(BaseModel):
    job_id: str
    status: str  # pending, processing, completed, failed
    created_at: str
    segments: List[dict] = []
    error: Optional[str] = None


class VoiceInfo(BaseModel):
    id: str
    name: str
    language: str


async def get_redis() -> redis.Redis:
    """Get Redis connection."""
    global redis_pool
    if redis_pool is None:
        redis_pool = redis.from_url(REDIS_URL, decode_responses=False)
    return redis_pool


def generate_job_id() -> str:
    """Generate a unique job ID."""
    return str(uuid.uuid4())


def generate_segment_id(job_id: str, index: int) -> str:
    """Generate a segment ID."""
    return f"{job_id}-seg-{index}"


def get_cache_path(job_id: str, segment_id: str) -> Path:
    """Get the cache file path for a segment."""
    return CACHE_DIR / f"{segment_id}.wav"


async def store_job(r: redis.Redis, job_id: str, job_data: dict):
    """Store job data in Redis."""
    import json
    key = f"espeak-tts:job:{job_id}"
    await r.set(key, json.dumps(job_data), ex=JOB_EXPIRY_SECONDS)


async def get_job(r: redis.Redis, job_id: str) -> Optional[dict]:
    """Retrieve job data from Redis."""
    import json
    key = f"espeak-tts:job:{job_id}"
    data = await r.get(key)
    if data:
        return json.loads(data)
    return None


def get_available_voices() -> List[dict]:
    """
    Get list of available eSpeak-NG voices.
    Runs 'espeak-ng --voices' and parses the output.
    """
    try:
        result = subprocess.run(
            ['espeak-ng', '--voices'],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if result.returncode != 0:
            return []
        
        voices = []
        lines = result.stdout.strip().split('\n')
        
        # Skip header line
        for line in lines[1:]:
            parts = line.split()
            if len(parts) >= 4:
                # Format: Pty Language Age/Gender VoiceName File Other_langs
                language = parts[1]
                voice_name = parts[3]
                
                voices.append({
                    "id": voice_name,
                    "name": voice_name,
                    "language": language
                })
        
        return voices
    except Exception as e:
        print(f"[eSpeak] Error getting voices: {e}")
        return []


async def convert_text_to_phonemes(text: str) -> Optional[str]:
    """
    Convert text to IPA phonemes using PronounceX phonemize API.
    This leverages PronounceX's dictionary system for custom pronunciations.
    
    Returns IPA phoneme string, or None if conversion fails.
    """
    try:
        async with aiohttp.ClientSession() as session:
            url = f"{PRONOUNCEX_API_URL}/v1/dicts/phonemize"
            params = {"text": text}
            
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as response:
                if response.status == 200:
                    data = await response.json()
                    phonemes = data.get("phonemes")
                    if phonemes:
                        print(f"[eSpeak] Converted text to phonemes: '{text[:50]}...' -> '{phonemes[:50]}...'")
                        return phonemes
                else:
                    print(f"[eSpeak] Phonemize API returned {response.status}")
                    return None
    except asyncio.TimeoutError:
        print(f"[eSpeak] Phonemize API timeout for text: {text[:50]}...")
        return None
    except Exception as e:
        print(f"[eSpeak] Phonemize API error: {e}")
        return None


async def synthesize_text(text: str, voice: str, output_path: Path, prefer_phonemes: bool = False) -> bool:
    """
    Synthesize text using espeak-ng.
    Returns True on success, False on failure.
    
    Args:
        text: Text to synthesize (will be converted to IPA if prefer_phonemes=True)
        voice: Voice ID (e.g., 'en-us', 'en-gb', 'es', etc.)
        output_path: Output WAV file path
        prefer_phonemes: If True, convert text to IPA phonemes before synthesis
    """
    try:
        synthesis_text = text
        use_ipa_mode = False
        
        # If prefer_phonemes is enabled, convert text to IPA phonemes using PronounceX API
        if prefer_phonemes:
            phonemes = await convert_text_to_phonemes(text)
            if phonemes:
                synthesis_text = phonemes
                use_ipa_mode = True
                print(f"[eSpeak] Using phoneme input mode for synthesis")
            else:
                # Fall back to regular text if phoneme conversion fails
                print(f"[eSpeak] Phoneme conversion failed, falling back to regular text")
        
        cmd = ['espeak-ng']
        
        # Add voice selection
        cmd.extend(['-v', voice])
        
        # Set speed (words per minute)
        cmd.extend(['-s', str(ESPEAK_SPEED)])
        
        # Output to WAV file
        cmd.extend(['-w', str(output_path)])
        
        # If we have IPA phonemes, use IPA input mode
        if use_ipa_mode:
            cmd.append('--ipa')
        
        # Add text/phonemes to synthesize
        cmd.append(synthesis_text)
        
        # Run espeak-ng
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if result.returncode != 0:
            print(f"[eSpeak] Synthesis error: {result.stderr}")
            return False
        
        return output_path.exists() and output_path.stat().st_size > 0
        
    except subprocess.TimeoutExpired:
        print(f"[eSpeak] Synthesis timeout for text: {text[:50]}...")
        return False
    except Exception as e:
        print(f"[eSpeak] Synthesis error: {e}")
        return False


async def process_job_with_new_redis(job_id: str, text: str, voice: str, prefer_phonemes: bool):
    """
    Process a TTS job with a fresh Redis connection.
    This is needed when running in a background thread with a new event loop.
    """
    import json
    
    # Create a new Redis connection for this event loop
    r = redis.from_url(REDIS_URL, decode_responses=False)
    
    try:
        # Get job data
        key = f"espeak-tts:job:{job_id}"
        data = await r.get(key)
        if not data:
            print(f"[eSpeak] Job {job_id} not found")
            return
        
        job_data = json.loads(data)
        
        # Update job to processing
        job_data["status"] = "processing"
        await r.set(key, json.dumps(job_data), ex=JOB_EXPIRY_SECONDS)
        
        # Generate segment info
        segment_id = generate_segment_id(job_id, 0)
        output_path = get_cache_path(job_id, segment_id)
        
        # Synthesize
        print(f"[eSpeak] Starting synthesis for job {job_id}, {len(text)} chars, phonemes={prefer_phonemes}")
        success = await synthesize_text(
            text, 
            job_data.get("voice", DEFAULT_VOICE), 
            output_path,
            prefer_phonemes
        )
        
        if success and output_path.exists():
            file_size = output_path.stat().st_size
            job_data["status"] = "completed"
            job_data["segments"] = [{
                "id": segment_id,
                "index": 0,
                "status": "completed",
                "audio_url": f"/v1/tts/jobs/{job_id}/segments/{segment_id}/audio",
                "file_size": file_size,
                "format": "audio/wav"
            }]
            print(f"[eSpeak] Job {job_id} completed, file size: {file_size}")
        else:
            job_data["status"] = "failed"
            job_data["error"] = "Synthesis failed"
            print(f"[eSpeak] Job {job_id} failed")
        
        await r.set(key, json.dumps(job_data), ex=JOB_EXPIRY_SECONDS)
        
    except Exception as e:
        print(f"[eSpeak] Job processing error: {e}")
        try:
            key = f"espeak-tts:job:{job_id}"
            data = await r.get(key)
            if data:
                job_data = json.loads(data)
                job_data["status"] = "failed"
                job_data["error"] = str(e)
                await r.set(key, json.dumps(job_data), ex=JOB_EXPIRY_SECONDS)
        except Exception as e2:
            print(f"[eSpeak] Failed to update job status: {e2}")
    finally:
        await r.close()


def process_job_sync(job_id: str, text: str, voice: str, prefer_phonemes: bool):
    """
    Synchronous wrapper for process_job that creates its own event loop.
    This is needed because BackgroundTasks runs in a thread pool.
    """
    import asyncio
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(process_job_with_new_redis(job_id, text, voice, prefer_phonemes))
    finally:
        loop.close()


@app.on_event("startup")
async def startup():
    """Initialize Redis connection on startup."""
    global redis_pool
    redis_pool = redis.from_url(REDIS_URL, decode_responses=False)
    print(f"[eSpeak] Service started, default voice: {DEFAULT_VOICE}, speed: {ESPEAK_SPEED} wpm")


@app.on_event("shutdown")
async def shutdown():
    """Close Redis connection on shutdown."""
    global redis_pool
    if redis_pool:
        await redis_pool.close()


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    # Test espeak-ng availability
    try:
        result = subprocess.run(
            ['espeak-ng', '--version'],
            capture_output=True,
            text=True,
            timeout=5
        )
        espeak_available = result.returncode == 0
    except:
        espeak_available = False
    
    return {
        "status": "healthy" if espeak_available else "degraded",
        "service": "espeak-ng",
        "default_voice": DEFAULT_VOICE,
        "espeak_available": espeak_available
    }


@app.get("/v1/tts/voices")
async def list_voices():
    """
    List all available eSpeak-NG voices.
    Returns a list of voices with their properties.
    """
    try:
        voices = get_available_voices()
        return {"voices": voices, "count": len(voices)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list voices: {e}")


@app.post("/v1/tts/jobs")
async def create_job(request: SynthesisRequest, background_tasks: BackgroundTasks):
    """
    Create a new TTS synthesis job.
    Compatible with PronounceX TTS API.
    """
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")
    
    # Determine voice to use
    voice = request.voice or request.model_id or DEFAULT_VOICE
    
    # Generate job ID
    job_id = generate_job_id()
    
    # Create job record
    job_data = {
        "job_id": job_id,
        "status": "pending",
        "created_at": datetime.utcnow().isoformat(),
        "text_length": len(request.text),
        "voice": voice,
        "prefer_phonemes": request.prefer_phonemes or False,
        "segments": []
    }
    
    # Store job
    r = await get_redis()
    await store_job(r, job_id, job_data)
    
    # Start background processing
    background_tasks.add_task(
        process_job_sync, 
        job_id, 
        request.text.strip(), 
        voice,
        request.prefer_phonemes or False
    )
    
    return {
        "job_id": job_id,
        "status": "pending",
        "message": "Job created successfully"
    }


@app.get("/v1/tts/jobs/{job_id}")
async def get_job_status(job_id: str):
    """
    Get the status of a TTS job.
    Compatible with PronounceX TTS API.
    """
    r = await get_redis()
    job_data = await get_job(r, job_id)
    
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return job_data


@app.get("/v1/tts/jobs/{job_id}/segments/{segment_id}/audio")
@app.get("/v1/tts/jobs/{job_id}/segments/{segment_id}")
async def get_segment_audio(job_id: str, segment_id: str):
    """
    Get the audio for a completed segment.
    Returns WAV audio file.
    """
    r = await get_redis()
    job_data = await get_job(r, job_id)
    
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job_data["status"] != "completed":
        raise HTTPException(status_code=400, detail=f"Job is {job_data['status']}, not completed")
    
    # Find the segment
    segment = None
    for seg in job_data.get("segments", []):
        if seg["id"] == segment_id:
            segment = seg
            break
    
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")
    
    # Get audio file
    audio_path = get_cache_path(job_id, segment_id)
    
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    
    return FileResponse(
        audio_path,
        media_type="audio/wav",
        filename=f"{segment_id}.wav"
    )


@app.get("/v1/tts/jobs/{job_id}/audio.wav")
async def get_job_audio(job_id: str):
    """
    Get the complete audio for a job.
    For single-segment jobs, returns the segment audio directly.
    """
    r = await get_redis()
    job_data = await get_job(r, job_id)
    
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job_data["status"] != "completed":
        raise HTTPException(status_code=400, detail=f"Job is {job_data['status']}, not completed")
    
    segments = job_data.get("segments", [])
    if not segments:
        raise HTTPException(status_code=404, detail="No segments found")
    
    # For now, just return first segment (espeak creates single segment)
    segment_id = segments[0]["id"]
    audio_path = get_cache_path(job_id, segment_id)
    
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    
    return FileResponse(
        audio_path,
        media_type="audio/wav",
        filename=f"{job_id}.wav"
    )


@app.delete("/v1/tts/jobs/{job_id}")
async def delete_job(job_id: str):
    """
    Delete a TTS job and its audio files.
    """
    r = await get_redis()
    job_data = await get_job(r, job_id)
    
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Delete audio files
    for seg in job_data.get("segments", []):
        audio_path = get_cache_path(job_id, seg["id"])
        if audio_path.exists():
            audio_path.unlink()
    
    # Delete job from Redis
    key = f"espeak-tts:job:{job_id}"
    await r.delete(key)
    
    return {"message": "Job deleted successfully"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8003)
