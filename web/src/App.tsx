import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchHealth,
  pickAnswer,
  pickSources,
  sendChat,
  type ChatResponse,
  type ChatTurn,
  type StreamSpeed,
} from "./lib/chatApi";
import {
  cancelSpeech,
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  recognitionLangForMode,
  speakText,
  speechRecognitionCtor,
  type VoiceUiLang,
} from "./lib/voice";
import { AssistantMessage } from "./components/AssistantMessage";
import { UserMessage } from "./components/UserMessage";
import "./App.css";

const SPEEDS: StreamSpeed[] = ["Fast", "Normal", "Slow"];

export default function App() {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [healthHint, setHealthHint] = useState<string | null>(null);
  const [streamSpeed, setStreamSpeed] = useState<StreamSpeed>("Normal");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [animateNextAssistant, setAnimateNextAssistant] = useState(false);
  const [voiceIn, setVoiceIn] = useState(false);
  const [voiceOut, setVoiceOut] = useState(false);
  const [speechMode, setSpeechMode] = useState<VoiceUiLang>("auto");
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<SpeechRecognition | null>(null);
  const voiceChunksRef = useRef<string[]>([]);
  const listeningIntentRef = useRef(false);
  const lastSpokenKey = useRef<string>("");
  const sendLockRef = useRef(false);
  const messagesRef = useRef<ChatTurn[]>(messages);
  messagesRef.current = messages;

  useEffect(() => {
    fetchHealth()
      .then((h) => {
        setConfigured(h.configured);
        setHealthHint(h.hint ?? null);
      })
      .catch(() => {
        setConfigured(false);
        setHealthHint("Could not reach /api/health. Check deployment and network.");
      });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, working]);

  useEffect(() => {
    return () => {
      cancelSpeech();
      listeningIntentRef.current = false;
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
      recRef.current = null;
    };
  }, []);

  const handleRevealComplete = useCallback(() => {
    setAnimateNextAssistant(false);
  }, []);

  const sendMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || sendLockRef.current) return;
      sendLockRef.current = true;
      try {
        setError(null);
        const prev = messagesRef.current;
        const nextMessages: ChatTurn[] = [...prev, { role: "user", content: text }];
        setMessages(nextMessages);
        setWorking(true);

        if (!configured) {
          setMessages((m) => [
            ...m,
            {
              role: "assistant",
              content:
                "This deployment is not fully configured. Add `CLOUDFLARE_AGENT_URL` and `CLOUDFLARE_API_TOKEN` to your Vercel project environment (or use `vercel dev` with `.env.local`), then redeploy.",
            },
          ]);
          return;
        }

        const historyPayload = nextMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        try {
          const data = await sendChat(text, historyPayload);
          const answer = pickAnswer(data) || "No response from the assistant.";
          const sources = pickSources(data);
          setAnimateNextAssistant(true);
          setMessages((m) => [...m, { role: "assistant", content: answer, sources }]);
        } catch (err: unknown) {
          const e = err as Error & { data?: ChatResponse };
          const d = e.data;
          const detail = d?.upstream_errors?.length
            ? ` ${d.upstream_errors.join(" ")}`
            : d?.detail
              ? ` ${d.detail}`
              : "";
          setError(`${e.message || "Request failed"}${detail}`);
          setMessages((m) => [
            ...m,
            {
              role: "assistant",
              content: `Something went wrong: ${e.message || "Unknown error"}`,
            },
          ]);
          setAnimateNextAssistant(false);
        }
      } finally {
        setWorking(false);
        sendLockRef.current = false;
      }
    },
    [configured],
  );

  useEffect(() => {
    if (!voiceOut || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== "assistant") return;
    const key = `${messages.length}-${last.content.length}-${last.content.slice(0, 40)}`;
    if (lastSpokenKey.current === key) return;
    lastSpokenKey.current = key;
    speakText(last.content, speechMode);
  }, [messages, voiceOut, speechMode]);

  /** Tap mic → speak (continuous); tap again → stop and send full transcript. */
  const toggleVoiceInput = useCallback(() => {
    setVoiceError(null);
    const Ctor = speechRecognitionCtor();
    if (!Ctor || working) {
      if (!Ctor) setVoiceError("Voice input needs Chrome, Edge, or Safari.");
      return;
    }

    if (listeningIntentRef.current && recRef.current) {
      const rec = recRef.current;
      listeningIntentRef.current = false;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      recRef.current = null;
      setListening(false);
      window.setTimeout(() => {
        const joined = voiceChunksRef.current.join(" ").replace(/\s+/g, " ").trim();
        voiceChunksRef.current = [];
        if (joined) void sendMessage(joined);
      }, 200);
      return;
    }

    listeningIntentRef.current = true;
    voiceChunksRef.current = [];
    const rec = new Ctor();
    rec.lang = recognitionLangForMode(speechMode);
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const row = ev.results[i];
        if (!row?.isFinal || !row[0]) continue;
        const part = row[0].transcript.trim();
        if (part) voiceChunksRef.current.push(part);
      }
    };

    rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
      if (ev.error === "aborted") return;
      listeningIntentRef.current = false;
      voiceChunksRef.current = [];
      setVoiceError(
        ev.error === "not-allowed"
          ? "Microphone permission denied."
          : ev.error === "no-speech"
            ? "No speech heard. Tap the mic, speak, then tap again to send."
            : `Voice: ${ev.error}`,
      );
      setListening(false);
      recRef.current = null;
    };

    rec.onend = () => {
      if (!listeningIntentRef.current) {
        setListening(false);
        recRef.current = null;
        return;
      }
      if (recRef.current !== rec) return;
      window.setTimeout(() => {
        if (!listeningIntentRef.current || recRef.current !== rec) return;
        try {
          rec.start();
        } catch {
          /* InvalidStateError: already running */
        }
      }, 80);
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch (e) {
      listeningIntentRef.current = false;
      setVoiceError(String(e));
      recRef.current = null;
      setListening(false);
    }
  }, [speechMode, working, sendMessage]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || working) return;
    setInput("");
    await sendMessage(text);
  };

  const sttOk = isSpeechRecognitionSupported();
  const ttsOk = isSpeechSynthesisSupported();

  return (
    <div className="app-shell">
      <header className="top-header">
        <div className="header-card">
          <div className="header-main">
            <div className="brand-mark" aria-hidden>
              <span className="brand-wing" />
              <span className="brand-core">FUJA</span>
              <span className="brand-wing mirror" />
            </div>
            <div className="header-copy">
              <h1 className="header-title">FUJAA Aviation Academy AI Assistant</h1>
              <p className="header-sub">
                Official information about our programs and services
              </p>
            </div>
          </div>
          <div className="header-aside">
            <label className="speed-label" htmlFor="stream-speed">
              Stream speed
            </label>
            <select
              id="stream-speed"
              className="speed-select"
              value={streamSpeed}
              onChange={(e) => setStreamSpeed(e.target.value as StreamSpeed)}
              disabled={working}
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <label className="speed-label" htmlFor="voice-lang">
              Speech
            </label>
            <select
              id="voice-lang"
              className="speed-select voice-lang-select"
              value={speechMode}
              onChange={(e) => setSpeechMode(e.target.value as VoiceUiLang)}
              disabled={working}
              title="Auto: STT follows browser locale; spoken replies match detected Arabic/English text."
            >
              <option value="auto">Auto (EN/AR)</option>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
            <div
              className={`status-pill ${configured ? "online" : "offline"}`}
              title={configured === null ? "Checking…" : configured ? "Backend ready" : "Config needed"}
            >
              <span className="status-dot" />
              {configured === null ? "Checking…" : configured ? "Connected" : "Config needed"}
            </div>
          </div>
        </div>
        <div className="voice-toolbar">
          <label className="voice-check">
            <input
              type="checkbox"
              checked={voiceIn}
              onChange={(e) => setVoiceIn(e.target.checked)}
              disabled={!sttOk}
            />
            Voice input {!sttOk && <span className="voice-na">(unsupported)</span>}
          </label>
          <label className="voice-check">
            <input
              type="checkbox"
              checked={voiceOut}
              onChange={(e) => setVoiceOut(e.target.checked)}
              disabled={!ttsOk}
            />
            Read replies aloud {!ttsOk && <span className="voice-na">(unsupported)</span>}
          </label>
        </div>
      </header>

      {configured === false && (
        <div className="banner warn" role="alert">
          {healthHint ? (
            <p className="banner-lead">{healthHint}</p>
          ) : (
            <p className="banner-lead">
              Set <code>CLOUDFLARE_AGENT_URL</code> and <code>CLOUDFLARE_API_TOKEN</code> in Vercel
              Environment Variables, then redeploy. Optional: <code>CLOUDFLARE_ACCOUNT_ID</code>,{" "}
              <code>CF_ACCESS_CLIENT_ID</code> / <code>CF_ACCESS_CLIENT_SECRET</code>.
            </p>
          )}
          <p className="banner-checklist">
            <strong>Checklist:</strong> Vercel project <strong>Root Directory</strong> ={" "}
            <code>web</code> · Variables enabled for <strong>Production</strong> (and{" "}
            <strong>Preview</strong> if you use preview links) · No leading/trailing spaces · Names
            exactly <code>CLOUDFLARE_AGENT_URL</code> and <code>CLOUDFLARE_API_TOKEN</code> (not{" "}
            <code>VITE_*</code>)
          </p>
        </div>
      )}

      {error && (
        <div className="banner err" role="alert">
          {error}
        </div>
      )}

      {voiceError && (
        <div className="banner err" role="alert">
          {voiceError}
        </div>
      )}

      <main className="chat-main">
        <div className="chat-scroll">
          {messages.length === 0 && (
            <div className="empty-state">
              <h2 className="empty-title">Welcome aboard</h2>
              <p className="empty-text">
                Ask about pilot training, ELP exams, programs, bookings, and academy services. Replies
                follow your official knowledge base. Use voice in Chrome or Edge for best results.
              </p>
            </div>
          )}
          {messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            const shouldAnimate = m.role === "assistant" && isLast && animateNextAssistant;
            return m.role === "user" ? (
              <UserMessage key={i} content={m.content} />
            ) : (
              <AssistantMessage
                key={i}
                content={m.content}
                sources={m.sources}
                streamSpeed={streamSpeed}
                animateReveal={shouldAnimate}
                onRevealComplete={shouldAnimate ? handleRevealComplete : undefined}
              />
            );
          })}
          {working && (
            <div className="msg assistant-msg working-row">
              <div className="msg-avatar bot-avatar" aria-hidden>
                <span className="typing-pulse" />
              </div>
              <div className="msg-body">
                <p className="working-caption">Working…</p>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form className="composer" onSubmit={onSubmit}>
          <div className="composer-pill">
            <span className="composer-attach" aria-hidden="true">
              +
            </span>
            <input
              type="text"
              className="composer-input"
              placeholder="Ask anything…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={working}
              autoComplete="off"
              aria-label="Message"
            />
            {voiceIn && sttOk && (
              <button
                type="button"
                className={`composer-mic-inline ${listening ? "listening" : ""}`}
                onClick={toggleVoiceInput}
                disabled={working}
                aria-pressed={listening}
                aria-label={
                  listening
                    ? "Stop and send message"
                    : "Voice: speak, then tap again to send"
                }
                title={
                  listening
                    ? "Tap to stop and send"
                    : "Tap to speak; tap again when finished"
                }
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 14a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3z"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M19 11a7 7 0 0 1-14 0M12 18v3M8 22h8"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
            <button
              type="submit"
              className="composer-submit-round"
              disabled={working || !input.trim()}
              aria-label="Send message"
              title="Send"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 5v14M5 12l7-7 7 7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </form>
      </main>

      <footer className="app-footer">
        <span>Fujairah Aviation Academy · Assistant experience · Voice uses your browser (HTTPS)</span>
      </footer>
    </div>
  );
}
