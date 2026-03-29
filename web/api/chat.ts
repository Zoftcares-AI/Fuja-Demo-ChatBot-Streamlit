import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const _cwd = process.cwd();
for (const name of [".env.local", ".env"] as const) {
  const p = resolve(_cwd, name);
  if (existsSync(p)) config({ path: p });
}

type HistoryItem = { role: string; content: string };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const agentUrl = (process.env.CLOUDFLARE_AGENT_URL || "").trim();
  const token = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
  if (!agentUrl || !token) {
    res.status(503).json({
      error: "Server misconfigured",
      configured: false,
      detail: "Missing CLOUDFLARE_AGENT_URL or CLOUDFLARE_API_TOKEN on the server.",
    });
    return;
  }

  const authHeader = (process.env.CLOUDFLARE_AUTH_HEADER || "Authorization").trim();
  const body = typeof req.body === "object" && req.body !== null ? req.body : {};
  const query = String((body as { query?: string }).query ?? "").trim();
  const messages = Array.isArray((body as { messages?: unknown }).messages)
    ? ((body as { messages: HistoryItem[] }).messages as HistoryItem[])
    : [];

  if (!query) {
    res.status(400).json({ error: "Missing query" });
    return;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [authHeader]: `Bearer ${token}`,
  };
  const cfId = (process.env.CF_ACCESS_CLIENT_ID || "").trim();
  const cfSecret = (process.env.CF_ACCESS_CLIENT_SECRET || "").trim();
  if (cfId && cfSecret) {
    headers["CF-Access-Client-Id"] = cfId;
    headers["CF-Access-Client-Secret"] = cfSecret;
  }

  const payload: Record<string, unknown> = { query, messages };
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  if (accountId) payload.account_id = accountId;

  try {
    const upstream = await fetch(agentUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const text = await upstream.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: "Invalid JSON from agent", raw: text.slice(0, 500) };
    }
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({
      error: "Failed to reach agent",
      detail: String(e),
    });
  }
}
