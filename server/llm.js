/**
 * llm.js — makes ONE batch LLM call for all cars and validates the response.
 * Never throws; always returns { actions, latencyMs, error }.
 *
 * Providers: ollama (default) | groq
 *   LLM_PROVIDER=ollama   LLM_MODEL=gemma4:31b-cloud
 *   LLM_PROVIDER=groq     LLM_MODEL=openai/gpt-oss-120b
 */

const { SYSTEM_PROMPT, buildUserMessage } = require("./prompt");

// ── Config ─────────────────────────────────────────────────────────────────────
const PROVIDER    = (process.env.LLM_PROVIDER || "ollama").toLowerCase();
const MODEL       = process.env.LLM_MODEL     || "gemma4:31b-cloud";
const TIMEOUT_MS  = Number(process.env.LLM_TIMEOUT_MS) || 8000;
// Max tokens: ~75 tokens per car + overhead, safe for 20 cars.
const MAX_TOKENS  = 1500;

// Provider-specific endpoint and auth header builder.
function getEndpointAndHeaders() {
  if (PROVIDER === "groq") {
    return {
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      headers:  {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
    };
  }
  // ollama — no API key needed; local server only.
  const base = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
  return {
    endpoint: `${base}/v1/chat/completions`,
    headers:  { "Content-Type": "application/json" },
  };
}

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

/**
 * Map a fetch/HTTP error to a clean human-readable string.
 * "Connection refused" → "ollama not running"
 */
function classifyError(err, status, bodyText) {
  // Network-level: Ollama app not running.
  if (err && (err.code === "ECONNREFUSED" || /ECONNREFUSED|fetch failed/i.test(err.message))) {
    return "ollama not running";
  }
  // Timeout.
  if (err && err.name === "AbortError") {
    return "LLM request timed out";
  }
  // HTTP-level errors.
  if (status === 401 || status === 403) return "ollama auth/access denied";
  if (status === 429 || /quota|rate.?limit/i.test(bodyText || "")) return "ollama rate limited";
  if (status) return `HTTP ${status}`;
  // Generic network error.
  return `Network error: ${err?.message ?? "unknown"}`;
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * getLLMActions(sensorArray)
 * @param  {object[]} sensorArray  — one sensor object per car
 * @returns {Promise<{ actions: object[], latencyMs: number, error?: string }>}
 */
async function getLLMActions(sensorArray) {
  const ids = sensorArray.map((c) => c.id);

  const { endpoint, headers } = getEndpointAndHeaders();

  // Build the request body.
  // Only include fields that every OpenAI-compat server understands.
  const body = JSON.stringify({
    model:           MODEL,
    temperature:     0,
    max_tokens:      MAX_TOKENS,
    stream:          false,
    // JSON mode: requires the word "json" to appear in the system prompt.
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: buildUserMessage(sensorArray) },
    ],
  });

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0         = Date.now();

  let rawText = "";

  try {
    const res = await fetch(endpoint, {
      method:  "POST",
      headers,
      body,
      signal:  controller.signal,
    });

    clearTimeout(timer);
    const latencyMs = Date.now() - t0;

    // HTTP-level failures (401, 403, 429, 5xx …).
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      const errMsg   = classifyError(null, res.status, bodyText);
      console.error(`[llm] ${PROVIDER} error:`, errMsg, bodyText.slice(0, 200));
      return { actions: ids.map(fallbackAction), latencyMs, error: errMsg };
    }

    const json = await res.json();
    // Read content only; ignore any reasoning field the model may add.
    rawText = json?.choices?.[0]?.message?.content ?? "";

  } catch (err) {
    clearTimeout(timer);
    const latencyMs = Date.now() - t0;
    const errMsg    = classifyError(err, null, null);
    console.error(`[llm] ${PROVIDER}:`, errMsg);
    return { actions: ids.map(fallbackAction), latencyMs, error: errMsg };
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
    return { actions: ids.map(fallbackAction), latencyMs, error: "Invalid JSON from LLM" };
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
      actions:  ids.map(fallbackAction),
      latencyMs,
      error:    "LLM response missing 'actions' array",
    };
  }

  // Index by id for fast lookup.
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

    // Missing entry or unrecognised action → plain MAINTAIN fallback.
    // Missing entry or bad action string → fallback.
    if (!entry || !VALID_ACTIONS.has(entry.action)) {
      hadInvalid = true;
      return fallbackAction(id);
    }

    const out = { id, action: entry.action };

    if (entry.action === "ACCELERATE") {
      out.throttle = typeof entry.throttle === "number" ? clamp01(entry.throttle) : 0.5;
    }
    if (entry.action === "BRAKE") {
      out.intensity = typeof entry.intensity === "number" ? clamp01(entry.intensity) : 0.5;
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

  // ── Log one line per call ────────────────────────────────────────────────────
  console.log(
    `[llm] provider=${PROVIDER} model=${MODEL} cars=${sensorArray.length}` +
    ` latency=${latencyMs}ms` +
    (hadInvalid ? " (fallback used)" : "")
  );

  return {
    actions,
    latencyMs,
    ...(hadInvalid ? { error: "Some car actions were invalid; MAINTAIN used as fallback" } : {}),
  };
}

module.exports = { getLLMActions };

