import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const _cwd = process.cwd();
for (const name of [".env.local", ".env"] as const) {
  const p = resolve(_cwd, name);
  if (existsSync(p)) config({ path: p });
}

/**
 * Reports whether server-side env is present. Never returns secret values.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const url = (process.env.CLOUDFLARE_AGENT_URL || "").trim();
  const token = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
  const hasAgentUrl = Boolean(url);
  const hasToken = Boolean(token);
  const configured = hasAgentUrl && hasToken;

  let hint: string | undefined;
  if (!configured) {
    if (!hasAgentUrl && !hasToken) {
      hint =
        "Neither CLOUDFLARE_AGENT_URL nor CLOUDFLARE_API_TOKEN is set for this deployment. Add both under Vercel → Settings → Environment Variables, enable them for Production (and Preview if you use preview URLs), then Redeploy.";
    } else if (!hasAgentUrl) {
      hint =
        "CLOUDFLARE_AGENT_URL is missing or empty. Add it in Vercel Environment Variables (full Worker URL ending in /chat), then Redeploy.";
    } else {
      hint =
        "CLOUDFLARE_API_TOKEN is missing or empty. Add it in Vercel Environment Variables, then Redeploy. Do not use a VITE_ prefix — these variables are server-only.";
    }
  }

  res.status(200).json({
    ok: true,
    configured,
    hasAgentUrl,
    hasToken,
    hint,
  });
}
