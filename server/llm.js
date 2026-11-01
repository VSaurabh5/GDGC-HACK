/**
 * llm.js — makes ONE batch LLM call for all cars and validates the response.
 * Never throws; always returns { actions, latencyMs, error }.
 */

const { SYSTEM_PROMPT, buildUserMessage } = require("./prompt");

// ── Provider config (set LLM_PROVIDER=groq|gemini and LLM_MODEL in .env) ──────
const PROVIDER   = (process.env.LLM_PROVIDER || "groq").toLowerCase();
const MODEL      = process.env.LLM_MODEL      || "llama-3.3-70b-versatile";

// Endpoint map — add Gemini (OpenAI-compat) URL here when you switch.
const ENDPOINTS = {
  groq:   "https://api.groq.com/openai/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
};

const ENDPOINT = ENDPOINTS[PROVIDER] || ENDPOINTS.groq;
const API_KEY  = process.env.GROQ_API_KEY; // Gemini key var can be added later

// Max tokens: ~60 tokens per car + overhead is safe for 20 cars.
const MAX_TOKENS = 1600;
// Abort if LLM takes longer than this (ms).
const TIMEOUT_MS = 4000;

// Valid action strings.
const VALID_ACTIONS = new Set(["ACCELERATE", "BRAKE", "MAINTAIN"]);

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Clamp a number to [0, 1]. */
function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

/** Return a safe MAINTAIN fallback for a single car id. */
function fallbackAction(id) {
  return { id, action: "MAINTAIN", fallback: true };
}

/** Strip ```json ... ``` markdown fences if the model added them. */
function stripFences(text) {
  return text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * getLLMActions(sensorArray)
 * @param  {object[]} sensorArray  — one sensor object per car
 * @returns {Promise<{ actions: object[], latencyMs: number, error?: string }>}
 */
async function getLLMActions(sensorArray) {
  const ids = sensorArray.map((c) => c.id); // keep input id order

  // ── Build request ────────────────────────────────────────────────────────────
  const body = JSON.stringify({
    model: MODEL,
    temperature: 0,
    max_tokens: MAX_TOKENS,
    // JSON mode: Groq/OpenAI-compat requires the word "json" in the system prompt.
    response_format: { type: "json_object" },
    messages: [
      { role: "system",  content: SYSTEM_PROMPT },
      { role: "user",    content: buildUserMessage(sensorArray) },
    ],
  });

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0         = Date.now();

  let rawText  = "";
  let httpErr  = null;

  try {
    const res = await fetch(ENDPOINT, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body,
      signal: controller.signal,
    });

    const latencyMs = Date.now() - t0;
    clearTimeout(timer);

    // Handle HTTP-level errors (429, 5xx, etc.)
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      httpErr = `HTTP ${res.status}`;
      console.error("[llm] provider error:", httpErr, errText.slice(0, 200));
      return { actions: ids.map(fallbackAction), latencyMs, error: httpErr };
    }

    const json = await res.json();
    rawText = json?.choices?.[0]?.message?.content ?? "";

  } catch (err) {
    const latencyMs = Date.now() - t0;
    clearTimeout(timer);

    const isTimeout = err.name === "AbortError";
    const errorMsg  = isTimeout ? "LLM request timed out" : `Network error: ${err.message}`;
    console.error("[llm]", errorMsg);
    return { actions: ids.map(fallbackAction), latencyMs, error: errorMsg };
  }

  const latencyMs = Date.now() - t0;

  // ── Parse JSON ───────────────────────────────────────────────────────────────
  let parsed;
  try {
    parsed = JSON.parse(stripFences(rawText));
  } catch {
    console.error("[llm] JSON parse failed. Raw:", rawText.slice(0, 300));
    return {
      actions:   ids.map(fallbackAction),
      latencyMs,
      error:     "Invalid JSON from LLM",
    };
  }

  // The model must return {"actions": [...]}.
  const rawActions = Array.isArray(parsed?.actions) ? parsed.actions : null;
  if (!rawActions) {
    return {
      actions:   ids.map(fallbackAction),
      latencyMs,
      error:     "LLM response missing 'actions' array",
    };
  }

  // Index LLM output by id for fast lookup.
  const byId = new Map(rawActions.map((a) => [a?.id, a]));

  // ── Validate & normalise each car's action ───────────────────────────────────
  let hadInvalid = false;
  const actions = ids.map((id) => {
    const entry = byId.get(id);

    // Missing entry or bad action string → fallback.
    if (!entry || !VALID_ACTIONS.has(entry.action)) {
      hadInvalid = true;
      return fallbackAction(id);
    }

    const out = { id, action: entry.action };

    if (entry.action === "ACCELERATE") {
      out.throttle = typeof entry.throttle === "number"
        ? clamp01(entry.throttle)
        : 0.5; // sensible default if missing
    }

    if (entry.action === "BRAKE") {
      out.intensity = typeof entry.intensity === "number"
        ? clamp01(entry.intensity)
        : 0.5;
    }

    return out;
  });

  return {
    actions,
    latencyMs,
    ...(hadInvalid ? { error: "Some car actions were invalid; MAINTAIN used as fallback" } : {}),
  };
}

module.exports = { getLLMActions };

