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
  const bottomRef = useRef<HTMLDivElement>(null);

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

  const handleRevealComplete = useCallback(() => {
    setAnimateNextAssistant(false);
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || working) return;

    setInput("");
    setError(null);
    const historyBefore = messages;
    const nextMessages: ChatTurn[] = [...historyBefore, { role: "user", content: text }];
    setMessages(nextMessages);
    setWorking(true);

    if (!configured) {
      setWorking(false);
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
    } finally {
      setWorking(false);
    }
  };

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
            <div
              className={`status-pill ${configured ? "online" : "offline"}`}
              title={configured === null ? "Checking…" : configured ? "Backend ready" : "Config needed"}
            >
              <span className="status-dot" />
              {configured === null ? "Checking…" : configured ? "Connected" : "Config needed"}
            </div>
          </div>
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

      <main className="chat-main">
        <div className="chat-scroll">
          {messages.length === 0 && (
            <div className="empty-state">
              <h2 className="empty-title">Welcome aboard</h2>
              <p className="empty-text">
                Ask about pilot training, ELP exams, programs, bookings, and academy services. Replies
                follow your official knowledge base.
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
          <input
            type="text"
            className="composer-input"
            placeholder="Message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={working}
            autoComplete="off"
            aria-label="Message"
          />
          <button type="submit" className="composer-send" disabled={working || !input.trim()}>
            Send
          </button>
        </form>
      </main>

      <footer className="app-footer">
        <span>Fujairah Aviation Academy · Assistant experience</span>
      </footer>
    </div>
  );
}
