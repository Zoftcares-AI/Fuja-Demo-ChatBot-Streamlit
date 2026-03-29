/** Strip markdown-ish noise for speech synthesis. */
export function stripMarkdownForSpeech(text: string): string {
  let t = text || "";
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/`[^`]+`/g, " ");
  t = t.replace(/\[([^\]]+)]\([^)]+\)/g, "$1");
  t = t.replace(/[*_#>|]+/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t.slice(0, 8000);
}

export type VoiceUiLang = "en" | "ar";

/**
 * Web Speech API `lang` for the mic session.
 */
export function recognitionLangForMode(mode: VoiceUiLang): string {
  return mode === "ar" ? "ar-SA" : "en-US";
}

export function speechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return speechRecognitionCtor() !== null;
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Cleared when a new utterance is scheduled so stale voice-load callbacks never speak. */
let voiceLoadTimer: ReturnType<typeof setTimeout> | null = null;
/** Bumped on cancel and on each new speak so async voice-load callbacks never speak after interrupt. */
let speakGeneration = 0;

export function cancelSpeech(): void {
  if (typeof window !== "undefined") {
    speakGeneration += 1;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (typeof window !== "undefined" && voiceLoadTimer !== null) {
    window.clearTimeout(voiceLoadTimer);
    voiceLoadTimer = null;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = null;
  }
}

function pickVoiceForLang(resolved: "en" | "ar"): SpeechSynthesisVoice | null {
  const synth = window.speechSynthesis;
  const voices = synth.getVoices();
  if (!voices.length) return null;
  const want = resolved === "ar" ? "ar" : "en";
  const prefer = (v: SpeechSynthesisVoice) => {
    const l = (v.lang || "").toLowerCase();
    if (want === "ar") return l.startsWith("ar");
    return l.startsWith("en");
  };
  const ranked = [...voices].filter(prefer).sort((a, b) => {
    const an = (a.name || "").toLowerCase();
    const bn = (b.name || "").toLowerCase();
    const aGoogle = an.includes("google") || an.includes("samantha") ? 0 : 1;
    const bGoogle = bn.includes("google") || bn.includes("samantha") ? 0 : 1;
    if (aGoogle !== bGoogle) return aGoogle - bGoogle;
    return a.localService === b.localService ? 0 : a.localService ? -1 : 1;
  });
  return ranked[0] ?? null;
}

/** Blocks duplicate speak for the same chat turn (Strict Mode / effect double-run). */
let lastSpeakTurnIndex = -1;
let lastSpeakTurnAt = 0;
let lastSpeakContentSig = "";

/** Run cb once when voices are ready. Deduplicates `onvoiceschanged` vs fallback timeout (both used to fire = double speech). */
function ensureVoicesLoaded(cb: () => void): void {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (voiceLoadTimer !== null) {
    window.clearTimeout(voiceLoadTimer);
    voiceLoadTimer = null;
  }
  synth.onvoiceschanged = null;

  if (synth.getVoices().length > 0) {
    cb();
    return;
  }
  let done = false;
  const runOnce = () => {
    if (done) return;
    done = true;
    if (voiceLoadTimer !== null) {
      window.clearTimeout(voiceLoadTimer);
      voiceLoadTimer = null;
    }
    synth.onvoiceschanged = null;
    cb();
  };
  synth.onvoiceschanged = runOnce;
  voiceLoadTimer = window.setTimeout(runOnce, 300);
}

export function speakText(text: string, lang: VoiceUiLang, messageCount?: number): void {
  if (!isSpeechSynthesisSupported()) return;
  const plain = stripMarkdownForSpeech(text);
  if (!plain) return;
  const resolved = lang;

  const contentSig = `${messageCount ?? 0}:${plain.slice(0, 160)}`;
  if (typeof messageCount === "number" && messageCount > 0) {
    const now = Date.now();
    if (
      messageCount === lastSpeakTurnIndex &&
      contentSig === lastSpeakContentSig &&
      now - lastSpeakTurnAt < 5000
    ) {
      return;
    }
    lastSpeakTurnIndex = messageCount;
    lastSpeakTurnAt = now;
    lastSpeakContentSig = contentSig;
  }

  cancelSpeech();
  const gen = ++speakGeneration;
  let didEnqueueUtterance = false;

  const run = () => {
    if (gen !== speakGeneration) return;
    if (didEnqueueUtterance) return;
    didEnqueueUtterance = true;
    const u = new SpeechSynthesisUtterance(plain);
    u.lang = resolved === "ar" ? "ar-SA" : "en-US";
    u.rate = resolved === "ar" ? 0.98 : 0.96;
    u.pitch = 1;
    const v = pickVoiceForLang(resolved);
    if (v) u.voice = v;
    if (gen !== speakGeneration) return;
    window.speechSynthesis.speak(u);
  };

  ensureVoicesLoaded(run);
}
