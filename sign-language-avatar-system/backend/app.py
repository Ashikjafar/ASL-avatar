"""
3D Sign Language Avatar System — FastAPI Backend Gateway
Provides REST and WebSocket endpoints for real-time text/speech to 3D Sign Language Gloss synthesis.
"""

import os
import sys
import json
import logging
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from gloss_generator import GlossGenerator, generate_gloss
import translator

# Configure Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("sign-backend")

app = FastAPI(
    title="3D Sign Language Avatar API",
    description="Real-time Voice & Text to 3D Sign Language Generation Backend",
    version="1.0.0",
)

# Enable CORS for frontend local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # "*" origins + credentials is rejected by browsers
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Gloss Generator Engine
generator = GlossGenerator()

# Request/Response Models
class TranslateRequest(BaseModel):
    text: str
    language: Optional[str] = "en-US"

class TranslateResponse(BaseModel):
    text: str
    tokens: List[Dict[str, Any]]
    count: int

# REST Endpoints
@app.get("/")
@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "online",
        "service": "3D Sign Language Avatar Backend",
        "version": "1.0.0",
        "total_signs": len(generator.signs),
    }

@app.get("/api/signs")
async def get_signs(category: Optional[str] = None):
    """Retrieve all available signs in the library with optional category filter."""
    signs = generator.signs
    if category:
        filtered = {k: v for k, v in signs.items() if v.get("category") == category}
        return {"category": category, "count": len(filtered), "signs": filtered}
    return {"count": len(signs), "signs": signs}

@app.post("/api/translate")
@app.post("/api/text-to-gloss")
async def translate_text(req: TranslateRequest):
    """Translate natural language text into a sequence of Sign Language tokens."""
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="Text field cannot be empty.")
    
    # Non-English input is translated to English first, because signs exist
    # for English glosses only. If translation is unavailable we fall back to
    # the built-in Hindi/Tamil lexicon on the original text.
    english, provider = translator.translate_to_english(req.text, req.language)
    tokens, unmapped = generator.translate(english)
    if not tokens and english != req.text:
        tokens, unmapped = generator.translate(req.text)
        provider = "unavailable"
    gloss_list = [t["gloss"] for t in tokens]
    return {
        "text": req.text,
        "translated_text": english,
        "source_language": req.language,
        "translation_provider": provider,
        "gloss": gloss_list,
        "tokens": tokens,
        "sequence": tokens,
        "unmapped": unmapped,
        "count": len(tokens),
    }

# WebSocket Endpoint for streaming translation
@app.websocket("/ws/sign")
async def websocket_sign_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket client connected to /ws/sign")
    
    try:
        # Send initial connection acknowledgment
        await websocket.send_json({
            "type": "connected",
            "message": "Connected to Sign Language Translation Stream",
            "available_signs": list(generator.signs.keys()),
        })
        
        while True:
            data_text = await websocket.receive_text()
            try:
                msg = json.loads(data_text)
                text = msg.get("text", "")
                if text:
                    tokens, unmapped = generator.translate(text)
                    await websocket.send_json({
                        "type": "sign_sequence",
                        "unmapped": unmapped,
                        "text": text,
                        "gloss": [t["gloss"] for t in tokens],
                        "tokens": tokens,
                        "sequence": tokens,
                    })
                else:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Empty text provided.",
                    })
            except json.JSONDecodeError:
                # Raw text received
                tokens, unmapped = generator.translate(data_text)
                await websocket.send_json({
                    "type": "sign_sequence",
                    "unmapped": unmapped,
                    "text": data_text,
                    "gloss": [t["gloss"] for t in tokens],
                    "tokens": tokens,
                    "sequence": tokens,
                })
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.close()
        except Exception:
            pass

if __name__ == "__main__":
    logger.info("Starting Sign Language Avatar Backend on http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
