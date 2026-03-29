function jsonResponse(payload, status, headers) {
  return new Response(JSON.stringify(payload), { status, headers });
}

/** Remove RAG/meta phrasing so end users never hear about uploads, context, or KB. */
function polishAssistantTone(text) {
  if (!text || typeof text !== "string") return text;
  let t = text;
  const patterns = [
    [/\bI have information now because you provided documents related to\b/gi, "Here is information about"],
    [/\bbecause you provided documents related to\b/gi, "about"],
    [/\byou provided documents related to\b/gi, "about"],
    [/\byou provided (the )?documents?\b/gi, ""],
    [/\bdocuments? (that |which )?you (uploaded|provided|shared)\b/gi, ""],
    [/\b(according to |based on )?the provided context\b/gi, ""],
    [/\busing the provided context\b/gi, ""],
    [/\bfrom the provided context\b/gi, ""],
    [/\bin the provided context\b/gi, ""],
    [/\bthe (retrieved |)context (shows|says|indicates)\b/gi, ""],
    [/\bfrom (your |the )(uploaded |)files?\b/gi, ""],
    [/\bfrom the knowledge base\b/gi, ""],
    [/\bthe knowledge base\b/gi, ""],
    [/\bI can now answer your questions using the provided context\.?\s*/gi, ""],
    [/\busing the (available |)information I have\b/gi, "based on what I know about our services"],
    [/\bto confirm, you would like to know more about\b/gi, "Would you like to know more about"],
  ];
  for (const [re, rep] of patterns) {
    t = t.replace(re, rep);
  }
  t = t.replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
  t = t.replace(/^[,.;]\s*/g, "").trim();
  return t;
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

function normalizeCasualQuery(query) {
  return query
    .toLowerCase()
    .trim()
    .replace(/[!?.。！？]+$/g, "")
    .replace(/\s+/g, " ");
}

/** Short auto-replies for greetings / thanks / bye — skips RAG so users never see out-of-scope. */
function getCasualAutoReply(query) {
  const t = normalizeCasualQuery(query);
  const qt = query.trim();
  if (["thanks", "thank you", "thx", "ty"].includes(t)) {
    return "You’re welcome! If you have more questions about Fujairah Aviation Academy, I’m happy to help.";
  }
  if (["bye", "goodbye", "see you"].includes(t)) {
    return "Take care! Come back anytime if you need help with our programs or services.";
  }
  if (/^شكرا|^شكرًا|^مع السلامة\b/i.test(qt)) {
    return "على الرحب والسعداء! إذا كان لديك المزيد من الأسئلة حول أكاديمية الفجيرة للطيران، أنا هنا للمساعدة.";
  }
  if (/^السلام عليكم|^مرحبا|^مرحبًا|^اهلا|^أهلا\b/i.test(qt)) {
    return "مرحبًا! كيف يمكنني مساعدتك اليوم فيما يتعلق بأكاديمية الفجيرة للطيران؟";
  }
  const greet = new Set([
    "hi",
    "hello",
    "hey",
    "hii",
    "yo",
    "sup",
    "good morning",
    "good afternoon",
    "good evening",
    "good night",
    "how are you",
    "how r u",
    "how're you",
    "how is it going",
    "how's it going",
    "whats up",
    "what's up",
  ]);
  if (greet.has(t)) {
    return "Hello! I’m doing well, thank you. How can I help you today with Fujairah Aviation Academy—programs, exams, or bookings?";
  }
  return null;
}

/** Ensure the latest user turn is present once (client often sends it both as `query` and last message). */
function finalizeMessages(messages, query) {
  const list = Array.isArray(messages) ? [...messages] : [];
  const q = String(query ?? "").trim();
  const last = list[list.length - 1];
  if (
    q &&
    (!last ||
      last.role !== "user" ||
      String(last.content ?? "").trim() !== q)
  ) {
    list.push({ role: "user", content: q });
  }
  return list;
}

/**
 * Short prepend only: thread continuity. Full policy (grounding, voice, follow-ups, refusals) lives in
 * Cloudflare AI Search system instructions—avoid duplicating or contradicting them here.
 */
const FUJA_ASSISTANT_SYSTEM_PROMPT = `
THREADING: Use the full chat history. If the user sends a short reply (yes, no, sure, please, نعم, لا, طبعًا), interpret it from your immediately previous assistant message—especially questions you asked or offers you made. Continue helpfully; do not ask what they meant when your prior turn clearly invited a next step.

Follow your primary application system instructions for grounding, public voice, refusals, and the exact follow-up block format (heading, language, and number of questions).
`.trim();

function withSystemPrompt(messages) {
  const list = Array.isArray(messages) ? [...messages] : [];
  const core = FUJA_ASSISTANT_SYSTEM_PROMPT;
  if (!list.length) return [{ role: "system", content: core }];
  if (list[0]?.role === "system") {
    const existing = String(list[0].content ?? "").trim();
    list[0] = {
      role: "system",
      content: existing ? `${core}\n\n---\n\n${existing}` : core,
    };
    return list;
  }
  return [{ role: "system", content: core }, ...list];
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
    const casual = getCasualAutoReply(query);
    if (casual) {
      return jsonResponse(
        {
          answer: casual,
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

      const msgs = withSystemPrompt(finalizeMessages(messages, query));

      // Prefer full `messages` first so short replies (e.g. "yes") keep prior assistant context.
      // Some AI Search setups weight `query` heavily and behave like single-turn if sent first.
      let upstreamResponse = await fetch(upstreamUrl, {
        ...requestOptions,
        body: JSON.stringify({ messages: msgs }),
      });

      if (!upstreamResponse.ok && upstreamResponse.status === 400) {
        upstreamResponse = await fetch(upstreamUrl, {
          ...requestOptions,
          body: JSON.stringify({ query, messages: msgs }),
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
      const chunks = resultPayload?.chunks ?? upstreamData?.chunks ?? [];
      const hasMatches = Array.isArray(matches) && matches.length > 0;
      const hasSources =
        Array.isArray(normalized.sources) && normalized.sources.length > 0;
      const hasChunks = Array.isArray(chunks) && chunks.length > 0;

      // Guardrail: if retrieval does not return evidence, do not answer broadly.
      if (!hasMatches && !hasSources && !hasChunks) {
        return jsonResponse(
          {
            answer:
              "I’m sorry, I don’t have information about that right now. You can ask me about topics related to Fujairah Aviation Academy (FUJA), and I’ll be happy to help.",
            sources: [],
            raw: { guardrail: "no-matches" },
          },
          200,
          corsHeaders,
        );
      }

      const answerText = polishAssistantTone(
        normalized.answer || "No answer returned by AI Search.",
      );
      return jsonResponse(
        {
          answer: answerText,
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
