function jsonResponse(payload, status, headers) {
  return new Response(JSON.stringify(payload), { status, headers });
}

function normalizeUpstreamResponse(data) {
  const result = data?.result ?? data;
  const answer =
    result?.answer ??
    result?.response ??
    result?.result ??
    result?.text ??
    result?.message ??
    result?.choices?.[0]?.message?.content ??
    "";
  const sources =
    result?.sources ?? result?.citations ?? result?.references ?? result?.context ?? [];
  return { answer, sources, raw: data };
}

function isGreeting(query) {
  const normalized = query.toLowerCase().trim();
  return [
    "hi",
    "hello",
    "hey",
    "hii",
    "yo",
    "good morning",
    "good afternoon",
    "good evening",
  ].includes(normalized);
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true }, 200, corsHeaders);
    }

    if (request.method !== "POST" || url.pathname !== "/chat") {
      return jsonResponse({ error: "Use POST /chat or GET /health" }, 404, corsHeaders);
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400, corsHeaders);
    }

    const query = (body.query || "").toString().trim();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!query) {
      return jsonResponse({ error: "Missing required field: query" }, 400, corsHeaders);
    }
    if (isGreeting(query)) {
      return jsonResponse(
        {
          answer:
            "Hello! How can I help you today? Ask me anything about your indexed knowledge base.",
          sources: [],
          raw: { fast_path: true },
        },
        200,
        corsHeaders,
      );
    }

    const upstreamUrl = env.AI_SEARCH_API_URL;
    const upstreamToken = env.AI_SEARCH_API_TOKEN;
    const upstreamAuthHeader = env.AI_SEARCH_AUTH_HEADER || "Authorization";

    if (!upstreamUrl) {
      return jsonResponse(
        { error: "Worker misconfigured: missing AI_SEARCH_API_URL." },
        500,
        corsHeaders,
      );
    }
    const timeoutMs = Number(env.AI_SEARCH_TIMEOUT_MS || 60000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("upstream-timeout"), timeoutMs);

    try {
      const requestOptions = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      };
      if (upstreamToken) {
        requestOptions.headers[upstreamAuthHeader] = `Bearer ${upstreamToken}`;
      }

      // Attempt 1: direct AI Search query shape.
      let upstreamResponse = await fetch(upstreamUrl, {
        ...requestOptions,
        body: JSON.stringify({ query, messages }),
      });

      // Attempt 2: chat completions shape if query format is rejected.
      if (!upstreamResponse.ok && upstreamResponse.status === 400) {
        const combinedMessages = [...messages, { role: "user", content: query }];
        upstreamResponse = await fetch(upstreamUrl, {
          ...requestOptions,
          body: JSON.stringify({ messages: combinedMessages }),
        });
      }

      if (!upstreamResponse.ok) {
        const upstreamText = await upstreamResponse.text();
        let upstreamJson = null;
        try {
          upstreamJson = JSON.parse(upstreamText);
        } catch {
          upstreamJson = null;
        }

        const upstreamErrors = Array.isArray(upstreamJson?.errors)
          ? upstreamJson.errors.map((e) => e?.message || JSON.stringify(e))
          : [];

        return jsonResponse(
          {
            error: "Upstream AI Search request failed.",
            upstream_status: upstreamResponse.status,
            upstream_body: upstreamText.slice(0, 1000),
            upstream_errors: upstreamErrors,
          },
          502,
          corsHeaders,
        );
      }

      const upstreamData = await upstreamResponse.json();
      const normalized = normalizeUpstreamResponse(upstreamData);
      const resultPayload = upstreamData?.result ?? upstreamData;
      const matches =
        resultPayload?.matches ?? resultPayload?.retrieval?.matches ?? [];
      const hasMatches = Array.isArray(matches) && matches.length > 0;
      const hasSources =
        Array.isArray(normalized.sources) && normalized.sources.length > 0;

      // Guardrail: if retrieval does not return evidence, do not answer broadly.
      if (!hasMatches && !hasSources) {
        return jsonResponse(
          {
            answer:
              "I’m sorry, I don’t have information about that right now. You can ask me about topics related to this service, and I’ll be happy to help.",
            sources: [],
            raw: { guardrail: "no-matches" },
          },
          200,
          corsHeaders,
        );
      }

      return jsonResponse(
        {
          answer: normalized.answer || "No answer returned by AI Search.",
          sources: Array.isArray(normalized.sources) ? normalized.sources : [],
          raw: normalized.raw,
        },
        200,
        corsHeaders,
      );
    } catch (error) {
      return jsonResponse(
        {
          error: "Failed to call upstream AI Search endpoint.",
          detail: String(error),
        },
        502,
        corsHeaders,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  },
};
