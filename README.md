# FUJA Streamlit + Cloudflare AI Search

This project gives you a Streamlit chat frontend connected to your existing Cloudflare AI Search / RAG agent endpoint.

## Cloudflare Worker backend (fix for deploy error)

If deploy logs show:

- `Could not detect a directory containing static files`

you are deploying without an explicit Worker entrypoint. This repo now includes a Worker backend in `worker/`.

Deploy it with:

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

After deploy, copy the Worker URL and set:

```env
CLOUDFLARE_AGENT_URL=https://<your-worker>.<your-subdomain>.workers.dev/chat
```

## Private AI Search via Worker (recommended)

Use this secure flow:

- Streamlit -> Worker `/chat`
- Worker -> private AI Search API (server-side token)
- Worker -> Streamlit `{ answer, sources }`

Configure Worker vars/secrets:

```bash
cd worker
npx wrangler secret put AI_SEARCH_API_TOKEN
```

Then edit `worker/wrangler.toml`:

- `AI_SEARCH_API_URL`: private AI Search endpoint URL or public AI Search URL
- `AI_SEARCH_AUTH_HEADER`: usually `Authorization`
- `AI_SEARCH_TIMEOUT_MS`: optional timeout

Notes:

- If using private Cloudflare API endpoint, set `AI_SEARCH_API_TOKEN` secret.
- If using AI Search public URL, token can be omitted.

Deploy:

```bash
cd worker
npx wrangler deploy
```

## 1) Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill `.env` values:

- `CLOUDFLARE_API_TOKEN`: Token used to authenticate your Worker `/chat` endpoint.
- `CLOUDFLARE_AGENT_URL`: Full URL of your Cloudflare Worker/agent chat endpoint.
- `CLOUDFLARE_ACCOUNT_ID` (optional): Included in payload if your backend expects it.
- `CLOUDFLARE_AUTH_HEADER` (optional): Defaults to `Authorization`.
- `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` (optional): required only if your Worker endpoint is protected by Cloudflare Access.

## 2) Run

```bash
streamlit run app.py
```

Open the local Streamlit URL shown in terminal.

## 3) Expected backend contract

The app sends `POST` JSON:

```json
{
  "query": "user question",
  "messages": [
    {"role": "user", "content": "hello"}
  ],
  "account_id": "optional"
}
```

The app can read any of these response keys for answer text:

- `answer`
- `response`
- `result`
- `text`

Optional source keys:

- `sources`
- `citations`

## 4) If your endpoint has different payload/response shape

Edit `cloudflare_client.py` inside `ask()` to match your exact Cloudflare agent API format.

hello