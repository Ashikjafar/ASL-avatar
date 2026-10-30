"""Regression tests for the bugs fixed in v1.1. Run: cd backend && python -m pytest"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from gloss_generator import GlossGenerator

g = GlossGenerator()
glosses = lambda text: [t["gloss"] for t in g.translate(text)[0]]


def test_metadata_key_is_not_a_sign():
    assert "_comment" not in g.signs and len(g.signs) == 35


def test_synonym_does_not_override_existing_sign():
    assert glosses("where is the hospital") == ["WHERE", "HOSPITAL"]  # was WHERE DOCTOR


def test_synonym_still_applies_when_no_sign_exists():
    assert glosses("I need a nurse")[-1] == "DOCTOR"


def test_tamil_input():
    assert glosses("வணக்கம் நன்றி") == ["HELLO", "THANK-YOU"]  # was silently dropped


def test_hindi_input_and_copula_dropped():
    assert glosses("नमस्ते, पानी कहाँ है") == ["HELLO", "WATER", "WHERE"]


def test_unmapped_non_latin_words_are_reported():
    tokens, unmapped = g.translate("पानी चाहिए")
    assert [t["gloss"] for t in tokens] == ["WATER"] and unmapped == ["चाहिए"]


def test_unknown_latin_word_is_fingerspelled():
    t = g.translate("Ravi")[0][0]
    assert t["type"] == "fingerspell" and t["letters"] == list("RAVI")


# ---- language -> English -> sign (translator mocked; no network needed) ----
import translator


def _with_provider(fn, text, lang):
    old = translator._provider
    translator._provider = fn
    try:
        return translator.translate_to_english(text, lang)
    finally:
        translator._provider = old


def test_english_is_not_translated():
    assert _with_provider(lambda t, s: 1 / 0, "hello", "en-IN") == ("hello", "none")


def test_spanish_goes_through_english_then_signs():
    eng, prov = _with_provider(lambda t, s: "where is the hospital" if s == "es" else t, "dónde está el hospital", "es-ES")
    assert prov == "mymemory" and glosses(eng) == ["WHERE", "HOSPITAL"]


def test_translation_failure_falls_back_to_original():
    def boom(t, s):
        raise OSError("offline")
    assert _with_provider(boom, "पानी कहाँ है", "hi-IN") == ("पानी कहाँ है", "unavailable")
    assert glosses("पानी कहाँ है") == ["WATER", "WHERE"]  # lexicon still works
