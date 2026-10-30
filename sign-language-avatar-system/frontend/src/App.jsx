import { useEffect, useRef, useState } from "react";
import AvatarViewer from "./components/AvatarViewer.jsx";
import SpeechCapture from "./components/SpeechCapture.jsx";
import DictionaryBrowser from "./components/DictionaryBrowser.jsx";
import HistoryPanel from "./components/HistoryPanel.jsx";
import { POSES } from "./avatar/poses.js";
import { loadHistory, saveHistory, makeEntry } from "./history.js";

// Backend URL: set VITE_API_URL in frontend/.env to change it
const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const QUICK_PROMPTS = [
  { label: "👋 Hello & Thank you", text: "Hello thank you" },
  { label: "🩺 Where is doctor?", text: "Where is doctor" },
  { label: "🆘 Emergency please help", text: "Emergency please help" },
  { label: "💧 Water please", text: "Water please" },
  { label: "✅ Yes good", text: "Yes good" },
  { label: "🛑 Please stop", text: "Please stop" },
];

// Helper to convert text to sign sequence tokens
function textToSignSequence(text) {
  if (!text) return [];
  const words = text
    .toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  const tokens = [];
  let i = 0;
  while (i < words.length) {
    // Check 2-word compound (e.g. THANK YOU -> THANK-YOU)
    if (i + 1 < words.length && words[i] === "THANK" && words[i + 1] === "YOU") {
      tokens.push("THANK-YOU");
      i += 2;
      continue;
    }
    tokens.push(words[i]);
    i++;
  }

  return tokens.map((word) => {
    const isKnown = !!POSES[word];
    return isKnown
      ? { gloss: word, type: "clip", duration_ms: 900 }
      : { gloss: word, type: "fingerspell", letters: word.split(""), duration_ms: 350 * word.length };
  });
}

export default function App() {
  const queueRef = useRef([]);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [lang, setLang] = useState("en-US"); // input language (speech + typed)
  const [translateNote, setTranslateNote] = useState("");
  const [listening, setListening] = useState(false);
  const [history, setHistory] = useState([]);
  const [sessions, setSessions] = useState(loadHistory); // persistent phrase history

  useEffect(() => saveHistory(sessions), [sessions]);

  const addSession = (entry) => setSessions((prev) => [makeEntry(entry), ...prev].slice(0, 200));
  const replaySession = (entry) => queueRef.current.push(...entry.tokens);
  const deleteSession = (id) => setSessions((prev) => prev.filter((e) => e.id !== id));
  const [manualInput, setManualInput] = useState("");
  const [backendOnline, setBackendOnline] = useState(false);
  const [activeTab, setActiveTab] = useState("translate"); // "translate", "dictionary", "stream", "guide"
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Check backend health on mount
  useEffect(() => {
    const checkBackend = async () => {
      try {
        const res = await fetch(`${API}/api/health`, { method: "GET" });
        if (res.ok) {
          setBackendOnline(true);
        } else {
          setBackendOnline(false);
        }
      } catch (e) {
        setBackendOnline(false);
      }
    };
    checkBackend();
    const interval = setInterval(checkBackend, 4000);
    return () => clearInterval(interval);
  }, []);

  const queueSignsFromText = async (text, source = "voice", language = lang) => {
    let items = [];
    let unmapped = [];
    let translatedText = "";

    // Try backend translation first if available
    if (backendOnline) {
      try {
        const res = await fetch(`${API}/api/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.tokens && data.tokens.length > 0) {
            items = data.tokens;
            unmapped = data.unmapped || [];
            if (data.translation_provider === "mymemory") translatedText = data.translated_text || "";
            else if (!language.startsWith("en")) setTranslateNote("Translation unavailable - used built-in word list");
            else setTranslateNote("");
          }
        }
      } catch (e) {
        // fallback to client-side
      }
    }

    if (items.length === 0) {
      items = textToSignSequence(text);
    }

    if (items.length === 0) return;

    // Push into the avatar's animation queue
    queueRef.current.push(...items);
    if (translatedText) setTranslateNote(`${language.split("-")[0].toUpperCase()} → EN: ${translatedText}`);
    addSession({ text, source, tokens: items, unmapped, translatedText });

    // Record in history log
    items.forEach((item) => {
      setHistory((prev) => [
        {
          word: item.gloss,
          type: item.type,
          source,
          at: new Date().toLocaleTimeString(),
        },
        ...prev,
      ].slice(0, 30));
    });
  };

  const handleFinalSpeech = (text, speechLang) => {
    if (!text) return;
    setTranscript((prev) => (prev ? prev + " " + text : text));
    setInterim("");
    queueSignsFromText(text, "voice", speechLang || lang);
  };

  const handleManualSubmit = (e) => {
    e?.preventDefault();
    const clean = manualInput.trim();
    if (!clean) return;
    setTranscript((prev) => (prev ? prev + " " + clean : clean));
    queueSignsFromText(clean, "typed");
    setManualInput("");
  };

  const triggerDirectSign = (word) => {
    const isKnown = !!POSES[word];
    const item = isKnown
      ? { gloss: word, type: "clip", duration_ms: 900 }
      : { gloss: word, type: "fingerspell", letters: word.split(""), duration_ms: 350 * word.length };

    queueRef.current.push(item);
    addSession({ text: word, source: "direct", tokens: [item] });
    setHistory((prev) => [
      {
        word,
        type: item.type,
        source: "direct",
        at: new Date().toLocaleTimeString(),
      },
      ...prev,
    ].slice(0, 30));
  };

  const triggerDirectFingerspell = (text) => {
    if (!text) return;
    const clean = text.toUpperCase().replace(/[^A-Z]/g, "");
    if (!clean) return;

    const item = {
      gloss: clean,
      type: "fingerspell",
      letters: clean.split(""),
      duration_ms: 350 * clean.length,
    };

    queueRef.current.push(item);
    addSession({ text: clean, source: "keyboard", tokens: [item] });
    setHistory((prev) => [
      {
        word: clean,
        type: "fingerspell",
        source: "keyboard",
        at: new Date().toLocaleTimeString(),
      },
      ...prev,
    ].slice(0, 30));
  };

  const handleQuickPrompt = (promptText) => {
    setTranscript((prev) => (prev ? prev + " " + promptText : promptText));
    queueSignsFromText(promptText, "prompt");
  };

  const handleClearTranscript = () => {
    setTranscript("");
    setInterim("");
  };

  const handleCopyTranscript = () => {
    if (!transcript) return;
    navigator.clipboard.writeText(transcript);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleClearHistory = () => {
    setHistory([]);
    queueRef.current = [];
  };

  return (
    <div className="app-layout">
      {/* TOP NAVIGATION / STUDIO NAVBAR */}
      <header className="app-navbar">
        <div className="navbar-brand">
          <div className="brand-logo-icon">
            <span className="logo-symbol">🤟</span>
            <span className="logo-glow-ring" />
          </div>
          <div>
            <div className="brand-title">
              SignSync <span className="brand-badge-ai">AI</span>
            </div>
            <div className="brand-tagline">3D Sign Language Avatar &amp; ASL Translation Studio</div>
          </div>
        </div>

        {/* Live System Telemetry Status Badges */}
        <div className="navbar-telemetry">
          <div className={`telemetry-pill ${backendOnline ? "online" : "local"}`} title="Backend NLP Server">
            <span className="telemetry-dot" />
            <span className="telemetry-text">
              {backendOnline ? "FastAPI Server Connected" : "Local Rule Engine Active"}
            </span>
          </div>

          <div className={`telemetry-pill ${listening ? "recording" : "ready"}`} title="Web Speech ASR">
            <span className="telemetry-dot" />
            <span className="telemetry-text">
              {listening ? "Microphone Live" : "ASR Ready"}
            </span>
          </div>

          <button
            type="button"
            className="navbar-action-btn"
            onClick={() => setShowInfoModal(true)}
            title="System architecture & ASL guide"
          >
            ℹ️ Guide
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE STUDIO GRID */}
      <main className="studio-workspace-grid">
        {/* LEFT COLUMN: 3D AVATAR VIEWPORT STAGE */}
        <section className="studio-viewport-pane">
          <div className="pane-header-bar">
            <div className="pane-title-group">
              <span className="pane-icon">🤖</span>
              <h2 className="pane-title">3D Avatar Stage</h2>
            </div>
            <span className="viewport-resolution-tag">WebGL 60 FPS • Real-Time Articulation</span>
          </div>

          {/* 3D AVATAR CANVAS */}
          <div className="avatar-canvas-wrapper">
            <AvatarViewer queueRef={queueRef} />
          </div>

          {/* QUICK PROMPT CHIPS ROW */}
          <div className="quick-prompts-card">
            <div className="quick-prompts-header">
              <span className="quick-title">⚡ Instant Demo Phrases:</span>
              <span className="quick-sub">Click to test instant translation &amp; 3D signing</span>
            </div>
            <div className="quick-prompts-list">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="quick-prompt-btn"
                  onClick={() => handleQuickPrompt(p.text)}
                  title={`Translate & Sign: "${p.text}"`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: CONTROL & TRANSLATION HUB */}
        <section className="studio-controls-pane">
          {/* Main Navigation Tabs */}
          <div className="control-tabs-bar">
            <button
              type="button"
              className={`control-tab-btn ${activeTab === "translate" ? "active" : ""}`}
              onClick={() => setActiveTab("translate")}
            >
              <span className="tab-icon">🎙️</span>
              <span>Live Translator</span>
            </button>

            <button
              type="button"
              className={`control-tab-btn ${activeTab === "dictionary" ? "active" : ""}`}
              onClick={() => setActiveTab("dictionary")}
            >
              <span className="tab-icon">📚</span>
              <span>ASL Dictionary</span>
            </button>

            <button
              type="button"
              className={`control-tab-btn ${activeTab === "stream" ? "active" : ""}`}
              onClick={() => setActiveTab("stream")}
            >
              <span className="tab-icon">📊</span>
              <span>Sign Stream ({history.length})</span>
            </button>

            <button
              type="button"
              className={`control-tab-btn ${activeTab === "history" ? "active" : ""}`}
              onClick={() => setActiveTab("history")}
            >
              <span className="tab-icon">🕘</span>
              <span>History ({sessions.length})</span>
            </button>

            <button
              type="button"
              className={`control-tab-btn ${activeTab === "guide" ? "active" : ""}`}
              onClick={() => setActiveTab("guide")}
            >
              <span className="tab-icon">💡</span>
              <span>ASL Grammar</span>
            </button>
          </div>

          {/* TAB 1: LIVE TRANSLATION & SPEECH STUDIO */}
          {activeTab === "translate" && (
            <div className="tab-content-panel">
              <div className="studio-card">
                <div className="card-header-bar">
                  <div>
                    <h3 className="card-heading">Voice &amp; Speech Input</h3>
                    <p className="card-subheading">Continuous speech recognition with multi-language parsing</p>
                  </div>
                </div>

                <SpeechCapture
                  onFinalText={handleFinalSpeech}
                  onInterimText={setInterim}
                  onListeningChange={setListening}
                  language={lang}
                  onLanguageChange={setLang}
                />
                {translateNote && (
                  <p className="card-subheading" role="status" data-testid="translate-note" style={{ marginTop: 8 }}>{translateNote}</p>
                )}
              </div>

              {/* LIVE TRANSCRIPT TERMINAL */}
              <div className="studio-card" style={{ marginTop: 16 }}>
                <div className="card-header-bar">
                  <div className="transcript-label-group">
                    <span className="terminal-dot red" />
                    <span className="terminal-dot yellow" />
                    <span className="terminal-dot green" />
                    <h3 className="card-heading" style={{ marginLeft: 6 }}>Live Translation Transcript</h3>
                  </div>

                  {transcript && (
                    <div className="transcript-actions-group">
                      <button
                        type="button"
                        onClick={handleCopyTranscript}
                        className="transcript-action-btn"
                        title="Copy transcript text"
                      >
                        {copySuccess ? "✓ Copied" : "📋 Copy"}
                      </button>
                      <button
                        type="button"
                        onClick={handleClearTranscript}
                        className="transcript-action-btn danger"
                        title="Clear transcript text"
                      >
                        🗑 Clear
                      </button>
                    </div>
                  )}
                </div>

                <div className="transcript-terminal-box">
                  <div className="transcript-body">
                    {transcript && <span className="final-transcript">{transcript}</span>}
                    {interim && (
                      <span className="interim-transcript">
                        {transcript ? " " : ""}
                        {interim}
                      </span>
                    )}
                    {!transcript && !interim && (
                      <span className="empty-transcript-placeholder">
                        <span className="placeholder-cursor">_</span>
                        Speak through your microphone or type a sentence below to watch the 3D avatar generate sign language…
                      </span>
                    )}
                  </div>
                </div>

                {/* HIGH-TECH MANUAL TEXT INPUT */}
                <form onSubmit={handleManualSubmit} className="manual-input-box">
                  <div className="input-field-wrap">
                    <span className="input-prefix">⌨️</span>
                    <input
                      type="text"
                      className="studio-input-field"
                      placeholder="Type any word or sentence (e.g., 'Hello thank you where is doctor') and hit Enter..."
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                    />
                    {manualInput && (
                      <button
                        type="button"
                        className="input-clear-btn"
                        onClick={() => setManualInput("")}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <button
                    type="submit"
                    className="studio-submit-btn"
                    disabled={!manualInput.trim()}
                  >
                    <span>Translate &amp; Sign</span>
                    <span className="submit-arrow">➔</span>
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 2: ASL DICTIONARY & KEYBOARD */}
          {activeTab === "dictionary" && (
            <div className="tab-content-panel">
              <DictionaryBrowser
                onTriggerSign={triggerDirectSign}
                onTriggerFingerspell={triggerDirectFingerspell}
              />
            </div>
          )}

          {/* TAB 3: SIGN STREAM & TIMELINE */}
          {activeTab === "stream" && (
            <div className="tab-content-panel">
              <div className="studio-card">
                <div className="card-header-bar">
                  <div>
                    <h3 className="card-heading">Sign Activity Stream ({history.length})</h3>
                    <p className="card-subheading">Chronological record of all generated ASL glosses &amp; fingerspells</p>
                  </div>
                  {history.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearHistory}
                      className="transcript-action-btn danger"
                    >
                      Clear Log
                    </button>
                  )}
                </div>

                {history.length === 0 ? (
                  <div className="empty-history-state">
                    <span className="empty-icon">📜</span>
                    <p>No signs performed yet.</p>
                    <span className="empty-sub">Speak or type above, or click a sign in the dictionary!</span>
                  </div>
                ) : (
                  <div className="history-stream-scroll">
                    <div className="history-timeline">
                      {history.map((item, index) => (
                        <div key={index} className="stream-item-row">
                          <div className="stream-time-badge">{item.at}</div>
                          <div className="stream-content">
                            <span className="stream-gloss-text">{item.word}</span>
                            <div className="stream-tags">
                              <span className={`stream-type-tag ${item.type}`}>
                                {item.type === "clip" ? "✨ 3D ASL Pose" : "🔤 Fingerspelled"}
                              </span>
                              <span className="stream-source-tag">Source: {item.source}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="stream-replay-btn"
                            onClick={() => triggerDirectSign(item.word)}
                            title={`Replay "${item.word}"`}
                          >
                            ↺ Replay
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: ASL GRAMMAR & ARCHITECTURE GUIDE */}
          {/* TAB: PERSISTENT TRANSLATION HISTORY */}
          {activeTab === "history" && (
            <div className="tab-content-panel">
              <HistoryPanel
                entries={sessions}
                onReplay={replaySession}
                onDelete={deleteSession}
                onClear={() => setSessions([])}
              />
            </div>
          )}

          {activeTab === "guide" && (
            <div className="tab-content-panel">
              <div className="studio-card">
                <h3 className="card-heading">ASL Grammar &amp; Translation Pipeline</h3>
                <p className="card-subheading">How English voice/text translates into American Sign Language (ASL)</p>

                <div className="guide-cards-list">
                  <div className="guide-item-card">
                    <div className="guide-card-icon">🧠</div>
                    <div className="guide-card-content">
                      <h4>ASL Syntax &amp; Topic-Comment Structure</h4>
                      <p>
                        Unlike English (Subject-Verb-Object), ASL frequently follows a <strong>Topic-Comment</strong> or <strong>Time-Topic-Comment</strong> order. Auxiliary words (like &ldquo;is&rdquo;, &ldquo;the&rdquo;, &ldquo;a&rdquo;) are omitted in ASL gloss notation.
                      </p>
                    </div>
                  </div>

                  <div className="guide-item-card">
                    <div className="guide-card-icon">🔤</div>
                    <div className="guide-card-content">
                      <h4>Automatic Fingerspelling Fallback</h4>
                      <p>
                        Words not present in the 3D sign library (such as proper names, specific technical terms, or rare words) automatically switch to <strong>A-Z fingerspelling</strong>, animating each letter sequentially.
                      </p>
                    </div>
                  </div>

                  <div className="guide-item-card">
                    <div className="guide-card-icon">⚡</div>
                    <div className="guide-card-content">
                      <h4>Procedural Forward-Kinematics</h4>
                      <p>
                        Joints (shoulders, elbows, wrists, and 5-finger articulations) interpolate smoothly via spherical Euler keyframing with natural physics damping and blinking micro-animations.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* SYSTEM ARCHITECTURE & INFO MODAL */}
      {showInfoModal && (
        <div className="modal-backdrop" onClick={() => setShowInfoModal(false)}>
          <div className="modal-window" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="modal-icon">ℹ️</span>
                <h3>About SignSync AI Studio</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowInfoModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <p>
                <strong>SignSync AI</strong> is a real-time web-based assistive communication workstation that converts spoken speech and written text into 3D Sign Language animations.
              </p>

              <div className="modal-features-grid">
                <div className="feature-box">
                  <span className="feature-icon">🎙️</span>
                  <strong>Web Speech ASR</strong>
                  <p>Continuous speech recognition supporting English, Hindi, Tamil, Spanish, and more.</p>
                </div>
                <div className="feature-box">
                  <span className="feature-icon">🤖</span>
                  <strong>Three.js 3D Avatar</strong>
                  <p>Articulated humanoid skeleton with 5-finger hand shapes and facial expressions.</p>
                </div>
                <div className="feature-box">
                  <span className="feature-icon">⚡</span>
                  <strong>FastAPI NLP Engine</strong>
                  <p>Deep-learning and rule-based ASL gloss tokenization and compound phrase matching.</p>
                </div>
                <div className="feature-box">
                  <span className="feature-icon">🔤</span>
                  <strong>A-Z Fingerspelling</strong>
                  <p>Complete 26-letter hand shape system for continuous unknown word spelling.</p>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="modal-action-btn"
                onClick={() => setShowInfoModal(false)}
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STUDIO FOOTER */}
      <footer className="app-footer">
        <div className="footer-left">
          <span>SignSync AI Studio • Real-Time Procedural WebGL Sign Language Synthesis</span>
        </div>
        <div className="footer-right">
          <span>WebGL 2.0 • Web Speech API • Three.js</span>
        </div>
      </footer>
    </div>
  );
}
