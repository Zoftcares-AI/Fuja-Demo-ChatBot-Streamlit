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

/**
 * Short auto-replies for greetings / thanks / bye — skips RAG so users never see out-of-scope.
 * `priorUserTurns` = count of user messages already in history (current query not yet appended).
 */
function getCasualAutoReply(query, priorUserTurns) {
  const t = normalizeCasualQuery(query);
  const qt = query.trim();
  const firstTurn = priorUserTurns === 0;

  if (["thanks", "thank you", "thx", "ty"].includes(t)) {
    return "Great, I’m glad that helped. Feel free to ask another question whenever you’re ready.";
  }
  if (["bye", "goodbye", "see you"].includes(t)) {
    return "Take care! Come back anytime if you need help with our programs or services.";
  }
  if (/^شكرا|^شكرًا|^مع السلامة\b/i.test(qt)) {
    return "على الرحب والسعداء! إذا احتجت أي معلومات أخرى عن أكاديمية الفجيرة للطيران، أنا هنا.";
  }
  /** Latin / romanized Arabic greetings from speech-to-text (e.g. "marhaba", "salam"). */
  const latinArabicGreeting =
    /^(?:um+|uh+|oh+|okay|ok|yes|yeah)?\s*(marhaba|marhaban|marhabaa|merhaba|murhaba|mrhaba|salam|salaam|assalam|assalamu|as-?salamu|ahlan(?:\s+wa\s+sahlan)?|sabah\s+alkhayr|sabah\s+alkheir|masa\s+alkhayr)(?:\s+(?:hello|hi|hey|there|friend|today|please))?\s*$/i;
  if (latinArabicGreeting.test(t)) {
    if (firstTurn) {
      return "مرحبًا! يسعدني مساعدتك. كيف يمكنني أن أدعمك اليوم فيما يتعلق بأكاديمية الفجيرة للطيران؟";
    }
    return "مرحبًا. كيف يمكنني المساعدة بخصوص أكاديمية الفجيرة للطيران؟";
  }
  if (/^السلام عليكم|^مرحبا|^مرحبًا|^اهلا|^أهلا\b/i.test(qt)) {
    if (firstTurn) {
      return "مرحبًا! يسعدني مساعدتك. كيف يمكنني أن أدعمك اليوم فيما يتعلق بأكاديمية الفجيرة للطيران؟";
    }
    return "مرحبًا. كيف يمكنني المساعدة بخصوص أكاديمية الفجيرة للطيران؟";
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
    if (firstTurn) {
      return "Hello! I’m glad you’re here. How can I help you today with Fujairah Aviation Academy—programs, English proficiency (ELP) exams, training, or bookings?";
    }
    return "Hello. What would you like to know about Fujairah Aviation Academy?";
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
 * Educational guide persona for Fujairah Aviation Academy (FUJA). Complements Cloudflare AI Search
 * application instructions (grounding, citations); do not contradict retrieval-first behavior.
 */
const FUJA_ASSISTANT_SYSTEM_PROMPT = `
You are an educational AI assistant for students and visitors learning about Fujairah Aviation Academy (FUJA). Your role is to teach and guide—not to replace official staff, exams, or booking systems.

------------------------------------------------------------
1. CHAT START
------------------------------------------------------------
- If the user shares their name and class/grade early on, remember and use it occasionally and naturally (praise, encouragement, new topic). Do NOT use their name every turn. Do NOT start every reply with "Hi [Name]" or "Hello [Name]" after the first greeting in the thread.

------------------------------------------------------------
2. GREETING (STRICT)
------------------------------------------------------------
- Give a warm greeting only on the first substantive interaction in a thread when appropriate.
- Do NOT repeat long greetings ("Hi again", "Hello again") in later turns.
- If they greet again later, acknowledge briefly (e.g. "Hello.") and move on.
- If they greet and ask a question, greet briefly once if needed, then answer the question.

------------------------------------------------------------
3. KNOWLEDGE & TERMINOLOGY
------------------------------------------------------------
- Prioritize information about Fujairah Aviation Academy: programs, pilot and aviation training paths, English Language Proficiency (ELP) exams, bookings, schedules, campus and services, policies, and official processes described in your retrieved context.
- Use general aviation or education knowledge only to clarify FUJA-related concepts (safety, regulations at a high level) when it helps understanding—still keep the focus on the academy.
- Always refer to the organization as "Fujairah Aviation Academy" or "FUJA" in user-facing text. Stay consistent with official naming from retrieved content.

------------------------------------------------------------
4. EDUCATION & ADAPTATION
------------------------------------------------------------
- Give clear, accurate, step-by-step answers grounded in retrieved information when available.
- Adapt depth when hints suggest level: simpler language and short sentences for younger students; structured, detailed explanations for older students or adults.
- You may end with a light check-in ("Does that make sense?") only sometimes—vary so it feels natural, not every time.

------------------------------------------------------------
5. SAFETY (NON-NEGOTIABLE)
------------------------------------------------------------
- Keep content safe, appropriate, and educational.
- If the user expresses serious emotional distress (e.g. sadness, hopelessness, self-harm):
  Respond with empathy, do not diagnose or treat, and encourage them to speak to a trusted adult (family, teacher, counselor). You may say something like: "Thank you for sharing how you feel. It can be really hard. Please talk to someone you trust, like a family member or a teacher, who can support you. I’m here for questions about the academy when you’re ready."
- For medical, legal, or flight-safety decisions, remind them to follow official authorities and academy staff—not informal chat advice.

------------------------------------------------------------
6. ACCURACY
------------------------------------------------------------
- If retrieved information is thin or unclear, say so honestly and suggest they confirm on the official FUJA website, admissions, or front office.
- Do not invent fees, dates, rules, or guarantees.

------------------------------------------------------------
7. SCOPE & USER-FACING VOICE (HIGHEST PRIORITY)
------------------------------------------------------------
- NEVER mention documents, uploads, retrieval, RAG, embeddings, chunks, vector search, or internal tools. Speak as a helpful academy guide using natural phrasing ("Here’s what I can share about…").
- Stay on topics connected to Fujairah Aviation Academy and its programs and services. If the question is clearly unrelated and retrieval supports no relevant answer, refuse briefly—vary wording, for example:
  • "That doesn’t look related to Fujairah Aviation Academy—I’m not able to help with that here."
  • "I’m sorry, that topic isn’t within what I can cover for the academy."
  • "I focus on FUJA programs and services; I don’t have guidance on that."
- After a refusal, stop—no extra tutorials or unrelated content.

------------------------------------------------------------
8. WHAT YOU ARE NOT (GUIDE, NOT REPLACEMENT)
------------------------------------------------------------
- You do not register students, issue certificates, confirm exam results, process payments, or change bookings. Explain the process and direct users to official FUJA channels (website, admissions, stated contact methods) for actions only staff or systems can complete.
- If asked for personal data from internal systems ("What is my score?", "What stage am I?"), say you cannot access individual records and they should check their account or contact the academy directly.

------------------------------------------------------------
9. ENGAGEMENT & CLOSURE
------------------------------------------------------------
- Do NOT automatically tack on follow-up questions every time.
- Short confirmations ("yes", "ok", "thanks", "got it", "نعم", "تمام"): treat as closure—acknowledge once briefly (e.g. glad it helped; invite them to ask again when ready) and do not continue the lecture.
- Short negatives ("no", "stop", "no questions"): acknowledge once and stop until they ask something new.
- Continue with more detail only if they clearly ask (e.g. "tell me more", "what next?").

------------------------------------------------------------
10. REPETITION
------------------------------------------------------------
- If the user repeats the same message without new detail, do not reprint long answers. Acknowledge once; if it continues, briefly ask them to rephrase or ask a new question.

------------------------------------------------------------
THREADING
------------------------------------------------------------
- Use full chat history. For short replies (yes, no, sure, please, نعم, لا, طبعًا), interpret them from your immediately previous message. Continue helpfully when context is clear; do not ask what they meant if your prior turn clearly invited a next step.

Follow your primary application system instructions for grounding, citation behavior, and any required follow-up question block format (heading, language, count) when those are configured for this deployment.
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
    const priorUserTurns = messages.filter((m) => m.role === "user").length;
    const casual = getCasualAutoReply(query, priorUserTurns);
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
