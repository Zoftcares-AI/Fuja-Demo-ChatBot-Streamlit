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

const AR_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Pick en vs ar for TTS when UI is Auto (no extra npm deps).
 * Uses Arabic script range; Latin-only text is spoken as English.
 */
export function detectLangEnAr(text: string): "en" | "ar" {
  const plain = stripMarkdownForSpeech(text);
  if (!plain) return "en";
  return AR_SCRIPT.test(plain) ? "ar" : "en";
}

/** Web Speech API recognition language for UI mode (auto uses browser locale hint). */
export function recognitionLangForMode(mode: "en" | "ar" | "auto"): string {
  if (mode === "ar") return "ar-SA";
  if (mode === "en") return "en-US";
  if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("ar")) {
    return "ar-SA";
  }
  return "en-US";
}

export type VoiceUiLang = "en" | "ar" | "auto";

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

export function cancelSpeech(): void {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
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

let voicesWarmed = false;
function ensureVoicesLoaded(cb: () => void): void {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (synth.getVoices().length) {
    cb();
    return;
  }
  if (!voicesWarmed) {
    voicesWarmed = true;
    synth.onvoiceschanged = () => {
      cb();
      synth.onvoiceschanged = null;
    };
  }
  window.setTimeout(cb, 120);
}

export function speakText(text: string, lang: VoiceUiLang): void {
  if (!isSpeechSynthesisSupported()) return;
  const plain = stripMarkdownForSpeech(text);
  if (!plain) return;
  const resolved = lang === "auto" ? detectLangEnAr(text) : lang;
  window.speechSynthesis.cancel();

  const run = () => {
    const u = new SpeechSynthesisUtterance(plain);
    u.lang = resolved === "ar" ? "ar-SA" : "en-US";
    u.rate = resolved === "ar" ? 0.98 : 0.96;
    u.pitch = 1;
    const v = pickVoiceForLang(resolved);
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  };

  ensureVoicesLoaded(run);
}
