# FUJA Assistant — React frontend (Vercel)

Professional chat UI for the same Cloudflare Worker backend used by the Streamlit app. Features aligned with `app.py`:

- Header, connection status, stream speed (**Fast** / **Normal** / **Slow**)
- Character reveal animation (matches Streamlit chunk timing)
- Markdown answers + **References** collapsible (sources)
- `formatAssistantMarkdown` parity with the Python app
- **Voice (browser):** enable **Voice input** and/or **Read replies aloud** in the header; choose **English** or **العربية**. Uses the Web Speech API (Chrome / Edge recommended; HTTPS required on Vercel).

## Security

The Worker token stays **server-side**. The browser only calls `/api/chat` and `/api/health` on your Vercel deployment.

## Deploy on Vercel

1. Push the repo and set **Root Directory** to `web` (Vercel → Project → **Settings** → **General**). If this is wrong, `/api/health` returns 404 and the app always shows “Config needed” even when env vars exist.
2. In Vercel → **Environment Variables**, add at minimum:
   - `CLOUDFLARE_AGENT_URL` — full URL to `.../chat`
   - `CLOUDFLARE_API_TOKEN` — Bearer token your Worker expects
3. For each variable, enable **Production** and **Preview** (if you open preview deployment URLs). Then **Redeploy** — env changes do not apply to old deployments.
4. Optional: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AUTH_HEADER`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` (Cloudflare Access).
5. Deploy. Vercel will build with Vite and expose `api/chat.ts` and `api/health.ts` as serverless functions.

**Debug:** Open `https://YOUR_DEPLOYMENT/api/health` in the browser. You should see JSON with `"configured": true` when URL and token are set. If you get 404, Root Directory is almost certainly not `web`.

## Local development

Install dependencies from `web/`:

```bash
cd web
npm install
```

Create `.env.local` in **`web/`** with the same variables as `.env.example`.

**Run `vercel dev` from the repository root** (`fuja-chatbot`, parent of `web/`), not from inside `web/`:

```bash
cd ..   # repo root, if you are in web/
npx vercel dev
```

If your Vercel project has **Settings → General → Root Directory = `web`** (as in deploy instructions), the CLI already enters `web` for you. Starting it from `web/` makes it look for `web/web` and fails with `web/web doesn't exist`.

If you prefer to run the CLI only from `web/`, set **Root Directory** to empty in the Vercel project (advanced) or use a separate link — the usual setup for this monorepo is **root directory `web` + `vercel dev` from repo root**.

**Important:** Variables in `.env.local` exist only on your machine. **They are not used by your live Vercel deployment** unless you also add them under Vercel → Project → Settings → Environment Variables and redeploy.

Plain `npm run dev` (Vite only) will **not** have `/api` routes unless you run `vercel dev` in parallel or add your own proxy.

### If `vercel dev` errors on `index.html` / import analysis

A catch-all rewrite to `/index.html` can confuse the Vite dev server inside `vercel dev`. This project omits that rewrite because the app only uses `/` (no client-side routes). If you add React Router later, use Vercel’s two-step SPA fallback:

```json
"rewrites": [
  { "handle": "filesystem" },
  { "source": "/((?!api/).*)", "destination": "/index.html" }
]
```

## Build

```bash
npm run build
npm run preview
```
