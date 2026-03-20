# FUJA Streamlit + Cloudflare AI Search

This project gives you a Streamlit chat frontend connected to your existing Cloudflare AI Search / RAG agent endpoint.

## 1) Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill `.env` values:

- `CLOUDFLARE_API_TOKEN`: Token used to authenticate your endpoint.
- `CLOUDFLARE_AGENT_URL`: Full URL of your Cloudflare Worker/agent chat endpoint.
- `CLOUDFLARE_ACCOUNT_ID` (optional): Included in payload if your backend expects it.
- `CLOUDFLARE_AUTH_HEADER` (optional): Defaults to `Authorization`.

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
