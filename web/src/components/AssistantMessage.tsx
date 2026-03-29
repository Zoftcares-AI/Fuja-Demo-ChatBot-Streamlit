import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatAssistantMarkdown } from "../lib/formatAssistantMarkdown";
import type { StreamSpeed } from "../lib/chatApi";

type Props = {
  content: string;
  sources?: string[];
  streamSpeed: StreamSpeed;
  animateReveal: boolean;
  onRevealComplete?: () => void;
};

export function AssistantMessage({
  content,
  sources,
  streamSpeed,
  animateReveal,
  onRevealComplete,
}: Props) {
  const full = formatAssistantMarkdown(content);
  const showAnimated = animateReveal && streamSpeed !== "Fast";
  const [len, setLen] = useState(0);
  const text = showAnimated ? full.slice(0, len) : full;

  useEffect(() => {
    if (!animateReveal) return;

    if (streamSpeed === "Fast") {
      queueMicrotask(() => onRevealComplete?.());
      return;
    }

    let cancelled = false;
    const chunkSize = streamSpeed === "Slow" ? 3 : 10;
    const delayMs = streamSpeed === "Slow" ? 55 : 28;

    const start = () => {
      if (cancelled) return;
      setLen(0);
      let pos = 0;
      const step = () => {
        if (cancelled) return;
        pos = Math.min(pos + chunkSize, full.length);
        setLen(pos);
        if (pos < full.length) {
          window.setTimeout(step, delayMs);
        } else {
          onRevealComplete?.();
        }
      };
      step();
    };

    const tid = window.setTimeout(start, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(tid);
    };
  }, [full, animateReveal, streamSpeed, onRevealComplete]);

  return (
    <div className="msg assistant-msg">
      <div className="msg-avatar bot-avatar" aria-hidden>
        <svg viewBox="0 0 32 32" fill="none" className="bot-svg">
          <circle cx="16" cy="16" r="15" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10 14h12M10 18h8M14 22h4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="12" cy="11" r="1.2" fill="currentColor" />
          <circle cx="20" cy="11" r="1.2" fill="currentColor" />
        </svg>
      </div>
      <div className="msg-body">
        <div className="markdown-body" aria-live="polite">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
        {sources && sources.length > 0 && (
          <details className="refs">
            <summary>References</summary>
            <ul className="refs-list">
              {sources.map((s, i) => (
                <li key={i} className="ref-card">
                  {s}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
