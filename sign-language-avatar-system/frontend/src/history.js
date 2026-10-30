/**
 * Persistent translation history (browser localStorage).
 * Each entry = one phrase: what was said/typed, how it was input, and the sign tokens
 * that were queued, so it can be replayed on the avatar later.
 */
const KEY = "signsync.history.v1";
const MAX_ENTRIES = 200;

export function loadHistory() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveHistory(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    /* storage full or blocked (private mode) - history just stays in memory */
  }
}

export function makeEntry({ text, source, tokens, unmapped = [], translatedText = "" }) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    source,
    at: new Date().toISOString(),
    tokens,
    unmapped,
    translatedText,
  };
}
