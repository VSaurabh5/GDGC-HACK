/**
 * Makes one batch local Ollama call for all cars and validates the response.
 */

const { SYSTEM_PROMPT, buildUserMessage } = require("./prompt");

const MODEL = process.env.LLM_MODEL || "gemma2:2b";
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "");
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 120000;
const MAX_TOKENS = 512;
const VALID_ACTIONS = new Set(["ACCELERATE", "BRAKE", "MAINTAIN"]);

function assertConfig() {
  let url;
  try {
    url = new URL(OLLAMA_URL);
  } catch {
    throw new Error("OLLAMA_URL must be a valid absolute URL.");
  }

  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("OLLAMA_URL must use HTTP or HTTPS.");
  }
  if (url.hostname === "ollama.com" && !OLLAMA_API_KEY) {
    throw new Error("OLLAMA_API_KEY is required for Ollama Cloud. Create one at https://ollama.com/settings/keys.");
  }
  if (!Number.isFinite(TIMEOUT_MS) || TIMEOUT_MS < 1000 || TIMEOUT_MS > 120000) {
    throw new Error("LLM_TIMEOUT_MS must be between 1000 and 120000.");
  }
}

function getEndpointAndHeaders() {
  const base = OLLAMA_URL.replace(/\/v1$/, "");
  const headers = { "Content-Type": "application/json" };
  if (new URL(OLLAMA_URL).hostname === "ollama.com" && OLLAMA_API_KEY) {
    headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;
  }

  return {
    endpoint: `${base}/v1/chat/completions`,
    headers,
  };
}

function fallbackAction(id) {
  return { id, action: "MAINTAIN", fallback: true };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function stripFences(text) {
  return text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
}

function fallback(ids, latencyMs, error) {
  return { actions: ids.map(fallbackAction), latencyMs, error };
}

async function getLLMActions(sensorArray) {
  const ids = sensorArray.map((car) => car.id);
  const { endpoint, headers } = getEndpointAndHeaders();
  const body = JSON.stringify({
    model: MODEL,
    temperature: 0,
    max_tokens: MAX_TOKENS,
    stream: false,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(sensorArray) },
    ],
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const responseText = await response.text();

    if (!response.ok) {
      let providerMessage = "";
      try {
        const responseJson = JSON.parse(responseText);
        const message = typeof responseJson?.error === "string"
          ? responseJson.error
          : responseJson?.error?.message;
        if (typeof message === "string") {
          providerMessage = ` ${message.replace(/\s+/g, " ").slice(0, 200)}`;
        }
      } catch {
        // Keep the HTTP status as the actionable error when the provider body is not JSON.
      }

      const error = response.status === 401 || response.status === 403
        ? "Ollama authentication failed; check OLLAMA_API_KEY."
        : response.status === 429
          ? "Ollama rate limit reached."
          : response.status === 402
            ? `Ollama Cloud requires billing or model access (HTTP 402).${providerMessage}`
            : `Ollama request failed (HTTP ${response.status}).${providerMessage}`;
      console.error(`[llm] ${error}`);
      return fallback(ids, latencyMs, error);
    }

    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      console.error("[llm] Ollama returned an invalid response.");
      return fallback(ids, latencyMs, "Invalid response from Ollama.");
    }

    const rawText = responseJson?.choices?.[0]?.message?.content;
    let parsed;
    try {
      parsed = JSON.parse(stripFences(typeof rawText === "string" ? rawText : ""));
    } catch {
      console.error("[llm] Model response was not valid JSON.");
      return fallback(ids, latencyMs, "Invalid JSON from Ollama model.");
    }

    if (!Array.isArray(parsed?.actions)) {
      return fallback(ids, latencyMs, "Ollama response is missing the actions array.");
    }

    const byId = new Map(parsed.actions.map((action) => [action?.id, action]));
    let hadInvalid = false;
    const actions = ids.map((id) => {
      const entry = byId.get(id);
      if (!entry || !VALID_ACTIONS.has(entry.action)) {
        hadInvalid = true;
        return fallbackAction(id);
      }

      const action = { id, action: entry.action };
      if (entry.action === "ACCELERATE") {
        action.throttle = typeof entry.throttle === "number" ? clamp01(entry.throttle) : 0.5;
      } else if (entry.action === "BRAKE") {
        action.intensity = typeof entry.intensity === "number" ? clamp01(entry.intensity) : 0.5;
      }
      return action;
    });

    console.log(`[llm] provider=ollama model=${MODEL} cars=${ids.length} latency=${latencyMs}ms`);
    return {
      actions,
      latencyMs,
      ...(hadInvalid ? { error: "Some model actions were invalid; fallback actions were used." } : {}),
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error?.name === "AbortError"
      ? "Ollama request timed out."
      : "Could not connect to the Ollama server.";
    console.error(`[llm] ${message}`);
    return fallback(ids, latencyMs, message);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { assertConfig, getLLMActions };
