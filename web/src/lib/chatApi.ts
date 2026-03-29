export type StreamSpeed = "Fast" | "Normal" | "Slow";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
};

export type HealthResponse = {
  ok: boolean;
  configured: boolean;
  hasAgentUrl?: boolean;
  hasToken?: boolean;
  hint?: string;
};

export async function fetchHealth(): Promise<HealthResponse> {
  const r = await fetch("/api/health");
  const text = await r.text();
  if (!r.ok) {
    let hint: string | undefined;
    if (r.status === 404) {
      hint =
        'The /api/health route was not found. In Vercel → Settings → General, set Root Directory to "web" (the folder that contains package.json and the api/ folder), save, and Redeploy.';
    } else {
      hint = `Health request failed (HTTP ${r.status}). Check the deployment Build and Functions logs in Vercel.`;
    }
    return { ok: false, configured: false, hint };
  }
  try {
    return JSON.parse(text) as HealthResponse;
  } catch {
    return {
      ok: false,
      configured: false,
      hint:
        "/api/health did not return JSON. Your deployment may be serving a static site only — confirm Root Directory is web and Functions are building.",
    };
  }
}

export type ChatResponse = {
  answer?: string;
  response?: string;
  result?: string;
  text?: string;
  sources?: string[];
  citations?: string[];
  error?: string;
  configured?: boolean;
  detail?: string;
  upstream_status?: number;
  upstream_errors?: string[];
  upstream_body?: string;
};

export async function sendChat(
  query: string,
  messages: { role: string; content: string }[],
): Promise<ChatResponse> {
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, messages }),
  });
  const raw = await r.text();
  let data: ChatResponse = {};
  try {
    data = raw ? (JSON.parse(raw) as ChatResponse) : {};
  } catch {
    data = { error: raw.slice(0, 500) || "Invalid response" };
  }
  if (!r.ok) {
    const err = new Error(
      data.error ||
        `Request failed (${r.status}): ${JSON.stringify(data).slice(0, 200)}`,
    ) as Error & { data: ChatResponse; status: number };
    err.data = data;
    err.status = r.status;
    throw err;
  }
  return data;
}

export function pickAnswer(data: ChatResponse): string {
  return (
    data.answer ||
    data.response ||
    data.result ||
    data.text ||
    ""
  ).toString();
}

export function pickSources(data: ChatResponse): string[] {
  const s = data.sources || data.citations;
  return Array.isArray(s) ? s.map(String) : [];
}
