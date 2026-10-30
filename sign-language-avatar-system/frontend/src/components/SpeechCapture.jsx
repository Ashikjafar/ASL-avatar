import { useEffect, useRef, useState } from "react";

/**
 * MODULE 1 — Speech Capture & ASR
 * --------------------------------
 * Captures live microphone speech in-browser using the Web Speech API
 * (SpeechRecognition / webkitSpeechRecognition).
 *
 * Fixed issues:
 * - Decoupled recognition instance lifecycle from React state re-renders.
 * - Proper onend auto-restart with state preservation.
 * - Comprehensive error handling for mic permissions (not-allowed), network, and silence.
 * - Added audio visualizer and language selection.
 */
export default function SpeechCapture({ onFinalText, onInterimText, onListeningChange, language, onLanguageChange }) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  // Language can be controlled by the parent (so typed input shares it) or local.
  const [localLang, setLocalLang] = useState("en-US");
  const selectedLang = language ?? localLang;
  const setSelectedLang = (v) => {
    setLocalLang(v);
    onLanguageChange?.(v);
  };

  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const restartTimerRef = useRef(null);

  // Keep parent notified of listening changes
  useEffect(() => {
    onListeningChange?.(listening);
  }, [listening, onListeningChange]);

  // Keep callbacks fresh in refs so event handlers always have the latest versions
  const onFinalTextRef = useRef(onFinalText);
  const onInterimTextRef = useRef(onInterimText);
  useEffect(() => {
    onFinalTextRef.current = onFinalText;
    onInterimTextRef.current = onInterimText;
  }, [onFinalText, onInterimText]);

  // Initialize Speech Recognition once
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = selectedLang;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      isListeningRef.current = true;
      setListening(true);
      setErrorMessage("");
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const item = event.results[i];
        const transcript = item[0]?.transcript || "";
        if (item.isFinal) {
          const finalClean = transcript.trim();
          if (finalClean) {
            onFinalTextRef.current?.(finalClean, recognition.lang);
          }
        } else {
          interim += transcript;
        }
      }
      onInterimTextRef.current?.(interim.trim());
    };

    recognition.onerror = (event) => {
      console.warn("Speech recognition error:", event.error);
      
      switch (event.error) {
        case "not-allowed":
        case "service-not-allowed":
          setErrorMessage(
            "Microphone access blocked. Please click the lock/settings icon in your browser address bar and allow microphone permissions."
          );
          isListeningRef.current = false;
          setListening(false);
          break;
        case "audio-capture":
          setErrorMessage("No microphone detected. Please connect a microphone and check system settings.");
          isListeningRef.current = false;
          setListening(false);
          break;
        case "network":
          setErrorMessage(
            "Network error: Unable to reach speech recognition service. Please check your internet connection or browser settings."
          );
          break;
        case "no-speech":
          // Normal timeout when silence occurs, ignore error
          break;
        case "aborted":
          // User or system stopped recognition
          break;
        default:
          setErrorMessage(`Speech recognition issue: ${event.error}`);
          break;
      }
    };

    recognition.onend = () => {
      // If user still wants to listen, auto-restart (handles Chrome's automatic pause)
      if (isListeningRef.current) {
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          if (isListeningRef.current) {
            try {
              recognition.start();
            } catch (err) {
              console.log("Recognition restart note:", err.message);
            }
          }
        }, 150);
      } else {
        setListening(false);
        onInterimTextRef.current?.("");
      }
    };

    recognitionRef.current = recognition;

    return () => {
      isListeningRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          // ignore cleanup error
        }
      }
    };
  }, []);

  // Update language if changed
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = selectedLang;
      if (isListeningRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // handled by onend restart
        }
      }
    }
  }, [selectedLang]);

  const toggle = () => {
    if (!recognitionRef.current) return;

    if (listening || isListeningRef.current) {
      isListeningRef.current = false;
      setListening(false);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.warn("Stop error:", err);
      }
      onInterimText?.("");
    } else {
      setErrorMessage("");
      isListeningRef.current = true;
      try {
        recognitionRef.current.start();
        setListening(true);
      } catch (err) {
        console.warn("Start error:", err);
        // If already started or in transition, retry shortly
        if (err.name === "InvalidStateError") {
          try {
            recognitionRef.current.stop();
            setTimeout(() => {
              if (isListeningRef.current) recognitionRef.current.start();
            }, 100);
          } catch (e) {
            setErrorMessage("Failed to initialize microphone. Please click again.");
            isListeningRef.current = false;
            setListening(false);
          }
        } else {
          setErrorMessage("Failed to start speech recognition. " + (err.message || ""));
          isListeningRef.current = false;
          setListening(false);
        }
      }
    }
  };

  if (!supported) {
    return (
      <div className="unsupported-banner">
        <div className="unsupported-header">
          <span className="unsupported-icon">🎙️⚠️</span>
          <strong>Speech Recognition API Not Supported in this Browser</strong>
        </div>
        <p className="unsupported-text">
          Please open in <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> for live Web Speech ASR voice recognition, or use the high-speed manual text input below.
        </p>
      </div>
    );
  }

  return (
    <div className="speech-controls-wrapper">
      <div className="speech-actions">
        {/* Animated Mic Button Container */}
        <div className={`mic-button-aura-wrap ${listening ? "is-active" : ""}`}>
          <button
            id="mic-toggle-btn"
            type="button"
            onClick={toggle}
            className={`mic-button ${listening ? "listening" : ""}`}
            title={listening ? "Click to stop listening" : "Click to activate microphone"}
          >
            {listening ? (
              <>
                <span className="mic-icon-pulse">⏹</span>
                <span className="mic-btn-text">Stop Listening</span>
              </>
            ) : (
              <>
                <span className="mic-icon">🎙️</span>
                <span className="mic-btn-text">Start Voice Input</span>
              </>
            )}
          </button>
        </div>

        {/* Dynamic 10-Bar Audio Equalizer Visualizer */}
        {listening ? (
          <div className="audio-visualizer-container" aria-label="Audio Visualizer Active">
            <div className="audio-visualizer">
              <span className="bar bar-1"></span>
              <span className="bar bar-2"></span>
              <span className="bar bar-3"></span>
              <span className="bar bar-4"></span>
              <span className="bar bar-5"></span>
              <span className="bar bar-6"></span>
              <span className="bar bar-7"></span>
              <span className="bar bar-8"></span>
              <span className="bar bar-9"></span>
              <span className="bar bar-10"></span>
            </div>
            <span className="recording-indicator-tag">● RECORDING</span>
          </div>
        ) : (
          <div className="speech-idle-hint">
            <span className="hint-dot"></span>
            <span>Click to speak naturally in any supported language</span>
          </div>
        )}

        {/* Language Selection */}
        <div className="language-selector">
          <span className="lang-icon">🌐</span>
          <select
            id="lang-select"
            value={selectedLang}
            onChange={(e) => setSelectedLang(e.target.value)}
            disabled={listening}
            className="lang-select"
            title="Choose recognition language"
          >
            <option value="en-US">🇺🇸 English (US)</option>
            <option value="en-IN">🇮🇳 English (India)</option>
            <option value="en-GB">🇬🇧 English (UK)</option>
            <option value="hi-IN">🇮🇳 हिन्दी (Hindi)</option>
            <option value="ta-IN">🇮🇳 தமிழ் (Tamil)</option>
            <option value="es-ES">🇪🇸 Español</option>
            <option value="fr-FR">🇫🇷 Français</option>
            <option value="de-DE">🇩🇪 Deutsch</option>
          </select>
        </div>
      </div>

      {/* Error Message Toast */}
      {errorMessage && (
        <div className="speech-error-box" role="alert">
          <div className="error-icon">⚠️</div>
          <div className="error-text">
            <span>{errorMessage}</span>
            <button
              className="error-dismiss-btn"
              onClick={() => setErrorMessage("")}
              title="Dismiss warning"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
