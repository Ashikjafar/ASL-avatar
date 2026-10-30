"""
Translate text from the selected language into English before sign generation.

Sign libraries exist for English glosses only, so when the user picks another
language the text is first converted to English and the normal text-to-gloss
pipeline runs on the English result.

Provider: the free MyMemory web API, called with the standard library only
(no extra dependency). Any failure (offline, timeout, quota, bad reply)
returns the original text with provider "unavailable" so the caller can fall
back to the built-in Hindi/Tamil lexicon instead of failing.

Set SIGN_TRANSLATE_URL to point at a different compatible endpoint.
"""
import json
import os
import logging
import urllib.parse
import urllib.request
from typing import Callable, Optional, Tuple

logger = logging.getLogger("sign-backend")

API_URL = os.environ.get("SIGN_TRANSLATE_URL", "https://api.mymemory.translated.net/get")
TIMEOUT_S = float(os.environ.get("SIGN_TRANSLATE_TIMEOUT", "4"))
MAX_CHARS = 450  # MyMemory limit is ~500 bytes per request


def source_code(language: Optional[str]) -> str:
    """'hi-IN' -> 'hi'; empty/None -> 'en'."""
    if not language:
        return "en"
    return language.replace("_", "-").split("-")[0].lower()


def needs_translation(language: Optional[str]) -> bool:
    return source_code(language) != "en"


def _mymemory(text: str, src: str) -> str:
    qs = urllib.parse.urlencode({"q": text[:MAX_CHARS], "langpair": f"{src}|en"})
    req = urllib.request.Request(f"{API_URL}?{qs}", headers={"User-Agent": "SignSync/1.1"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if int(data.get("responseStatus", 0)) != 200:
        raise RuntimeError(f"translation service status {data.get('responseStatus')}")
    out = (data.get("responseData") or {}).get("translatedText", "").strip()
    if not out:
        raise RuntimeError("empty translation")
    return out


# Replaceable in tests
_provider: Callable[[str, str], str] = _mymemory


def translate_to_english(text: str, language: Optional[str]) -> Tuple[str, str]:
    """Return (english_text, provider). provider is one of
    'none' (already English), 'mymemory' (translated) or 'unavailable'
    (translation failed; english_text is the unchanged input)."""
    if not needs_translation(language):
        return text, "none"
    src = source_code(language)
    try:
        return _provider(text, src), "mymemory"
    except Exception as exc:  # network, timeout, quota, parse
        logger.warning("translation %s->en failed: %s", src, exc)
        return text, "unavailable"
