"""
Edge-TTS Service
A FastAPI service that wraps edge-tts to provide the same API as PronounceX TTS.
This allows using Microsoft Edge's high-quality voices as an alternative to Piper.

Note: edge-tts does NOT support custom phonemes or SSML - it only supports plain text.
For users who need pronunciation customization, Piper TTS should be used instead.
"""

import asyncio
import hashlib
import os
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import aiofiles
import edge_tts
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# Configuration
REDIS_URL = os.environ.get("EDGE_TTS_REDIS_URL", "redis://localhost:6379/1")
CACHE_DIR = Path(os.environ.get("EDGE_TTS_CACHE_DIR", "/data/cache"))
DEFAULT_VOICE = os.environ.get("EDGE_TTS_DEFAULT_VOICE", "en-US-AriaNeural")
JOB_EXPIRY_SECONDS = 3600  # Jobs expire after 1 hour

# Ensure cache directory exists
CACHE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="Edge-TTS Service",
    description="Microsoft Edge TTS wrapper with PronounceX-compatible API",
    version="1.0.0"
)

# Redis connection pool
redis_pool: Optional[redis.Redis] = None


class SynthesisRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    model_id: Optional[str] = None  # Alias for voice, for compatibility
    prefer_phonemes: Optional[bool] = False  # Ignored - edge-tts doesn't support phonemes
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
    short_name: str
    gender: str
    locale: str


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
    return CACHE_DIR / f"{segment_id}.mp3"


async def store_job(r: redis.Redis, job_id: str, job_data: dict):
    """Store job data in Redis."""
    import json
    key = f"edge-tts:job:{job_id}"
    await r.set(key, json.dumps(job_data), ex=JOB_EXPIRY_SECONDS)


async def get_job(r: redis.Redis, job_id: str) -> Optional[dict]:
    """Retrieve job data from Redis."""
    import json
    key = f"edge-tts:job:{job_id}"
    data = await r.get(key)
    if data:
        return json.loads(data)
    return None


async def synthesize_text(text: str, voice: str, output_path: Path) -> bool:
    """
    Synthesize text using edge-tts.
    Returns True on success, False on failure.
    """
    try:
        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(str(output_path))
        return True
    except Exception as e:
        print(f"[Edge-TTS] Synthesis error: {e}")
        return False


async def synthesize_text_with_timing(text: str, voice: str, output_path: Path) -> tuple[bool, List[dict]]:
    """
    Synthesize text using edge-tts and extract word timing data.
    Returns (success, word_timings) where word_timings is a list of {text, offset, duration}.
    
    The timing data comes from edge-tts's SubMaker which extracts word boundaries
    from the TTS stream metadata.
    """
    word_timings = []
    
    try:
        communicate = edge_tts.Communicate(text, voice)
        submaker = edge_tts.SubMaker()
        
        # Collect audio chunks and timing metadata
        audio_chunks = []
        
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_chunks.append(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                # WordBoundary events contain precise timing for each word
                word_timings.append({
                    "text": chunk["text"],
                    "offset": chunk["offset"] / 10000,  # Convert from 100ns units to ms
                    "duration": chunk["duration"] / 10000,  # Convert from 100ns units to ms
                })
        
        # Write audio to file
        if audio_chunks:
            async with aiofiles.open(output_path, "wb") as f:
                for chunk in audio_chunks:
                    await f.write(chunk)
            print(f"[Edge-TTS] Synthesized with {len(word_timings)} word timing markers")
            return True, word_timings
        else:
            return False, []
            
    except Exception as e:
        print(f"[Edge-TTS] Synthesis with timing error: {e}")
        return False, []


async def process_job(job_id: str, text: str, voice: str):
    """
    Background task to process a TTS job.
    Splits text into segments and synthesizes each one.
    """
    r = await get_redis()
    
    try:
        # Update job to processing
        job_data = await get_job(r, job_id)
        if not job_data:
            return
        
        job_data["status"] = "processing"
        await store_job(r, job_id, job_data)
        
        # For edge-tts, we treat the entire text as one segment
        # (edge-tts handles long text well internally)
        segment_id = generate_segment_id(job_id, 0)
        output_path = get_cache_path(job_id, segment_id)
        
        # Synthesize with word timing extraction
        success, word_timings = await synthesize_text_with_timing(text, voice, output_path)
        
        if success and output_path.exists():
            file_size = output_path.stat().st_size
            job_data["status"] = "completed"
            job_data["segments"] = [{
                "id": segment_id,
                "index": 0,
                "status": "completed",
                "audio_url": f"/v1/tts/jobs/{job_id}/segments/{segment_id}/audio",
                "file_size": file_size,
                "format": "audio/mpeg",
                "word_timings": word_timings  # Include word timing data for sync
            }]
        else:
            job_data["status"] = "failed"
            job_data["error"] = "Synthesis failed"
        
        await store_job(r, job_id, job_data)
        
    except Exception as e:
        print(f"[Edge-TTS] Job processing error: {e}")
        job_data = await get_job(r, job_id)
        if job_data:
            job_data["status"] = "failed"
            job_data["error"] = str(e)
            await store_job(r, job_id, job_data)


@app.on_event("startup")
async def startup():
    """Initialize Redis connection on startup."""
    global redis_pool
    redis_pool = redis.from_url(REDIS_URL, decode_responses=False)
    print(f"[Edge-TTS] Service started, using voice: {DEFAULT_VOICE}")


@app.on_event("shutdown")
async def shutdown():
    """Close Redis connection on shutdown."""
    global redis_pool
    if redis_pool:
        await redis_pool.close()


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "edge-tts", "default_voice": DEFAULT_VOICE}


@app.get("/v1/tts/voices")
async def list_voices():
    """
    List all available Edge TTS voices.
    Returns a list of voices with their properties.
    """
    try:
        voices = await edge_tts.list_voices()
        result = []
        for v in voices:
            result.append({
                "id": v["ShortName"],
                "name": v["FriendlyName"],
                "short_name": v["ShortName"],
                "gender": v["Gender"],
                "locale": v["Locale"]
            })
        return {"voices": result, "count": len(result)}
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
        "segments": []
    }
    
    # Store job
    r = await get_redis()
    await store_job(r, job_id, job_data)
    
    # Start background processing using FastAPI's BackgroundTasks
    # This ensures the task runs properly in the uvicorn worker context
    background_tasks.add_task(process_job_sync, job_id, request.text.strip(), voice)
    
    return {
        "job_id": job_id,
        "status": "pending",
        "message": "Job created successfully"
    }


def process_job_sync(job_id: str, text: str, voice: str):
    """
    Synchronous wrapper for process_job that creates its own event loop.
    This is needed because BackgroundTasks runs in a thread pool.
    """
    import asyncio
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(process_job_with_new_redis(job_id, text, voice))
    finally:
        loop.close()


async def process_job_with_new_redis(job_id: str, text: str, voice: str):
    """
    Process a TTS job with a fresh Redis connection.
    This is needed when running in a background thread with a new event loop.
    """
    import json
    
    # Create a new Redis connection for this event loop
    r = redis.from_url(REDIS_URL, decode_responses=False)
    
    try:
        # Get job data
        key = f"edge-tts:job:{job_id}"
        data = await r.get(key)
        if not data:
            print(f"[Edge-TTS] Job {job_id} not found")
            return
        
        job_data = json.loads(data)
        
        # Update job to processing
        job_data["status"] = "processing"
        await r.set(key, json.dumps(job_data), ex=JOB_EXPIRY_SECONDS)
        
        # Generate segment info
        segment_id = generate_segment_id(job_id, 0)
        output_path = get_cache_path(job_id, segment_id)
        
        # Synthesize with word timing extraction
        print(f"[Edge-TTS] Starting synthesis for job {job_id}, {len(text)} chars")
        success, word_timings = await synthesize_text_with_timing(
            text, job_data.get("voice", DEFAULT_VOICE), output_path
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
                "format": "audio/mpeg",
                "word_timings": word_timings  # Include word timing data for sync
            }]
            print(f"[Edge-TTS] Job {job_id} completed, file size: {file_size}, {len(word_timings)} word timings")
        else:
            job_data["status"] = "failed"
            job_data["error"] = "Synthesis failed"
            print(f"[Edge-TTS] Job {job_id} failed")
        
        await r.set(key, json.dumps(job_data), ex=JOB_EXPIRY_SECONDS)
        
    except Exception as e:
        print(f"[Edge-TTS] Job processing error: {e}")
        try:
            key = f"edge-tts:job:{job_id}"
            data = await r.get(key)
            if data:
                job_data = json.loads(data)
                job_data["status"] = "failed"
                job_data["error"] = str(e)
                await r.set(key, json.dumps(job_data), ex=JOB_EXPIRY_SECONDS)
        except Exception as e2:
            print(f"[Edge-TTS] Failed to update job status: {e2}")
    finally:
        await r.close()


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
async def get_segment_audio(job_id: str, segment_id: str):
    """
    Get the audio for a completed segment.
    Returns MP3 audio file.
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
        media_type="audio/mpeg",
        filename=f"{segment_id}.mp3"
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
    key = f"edge-tts:job:{job_id}"
    await r.delete(key)
    
    return {"message": "Job deleted successfully"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
