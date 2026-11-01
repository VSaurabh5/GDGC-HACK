/**
 * server.js — Express proxy between the browser sim and the LLM.
 * Reads config from .env (GROQ_API_KEY, PORT, LLM_PROVIDER, LLM_MODEL).
 */

require("dotenv").config();
const express       = require("express");
const cors          = require("cors");
const { getLLMActions } = require("./llm");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ── In-flight guard ────────────────────────────────────────────────────────────
// The LLM call is expensive; reject overlapping requests instead of queuing.
let busy = false;

// ── Routes ─────────────────────────────────────────────────────────────────────

/** Health check — lets the frontend know the server is up. */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

/**
 * POST /api/decide
 * Body: { cars: [ sensorObject, ... ] }
 * Response (always HTTP 200): { actions, latencyMs, error? }
 */
app.post("/api/decide", async (req, res) => {
  // In-flight guard: reject if we're already waiting on the LLM.
  if (busy) {
    return res.status(429).json({ error: "busy" });
  }

  const { cars } = req.body ?? {};

  // Validate input.
  if (!Array.isArray(cars) || cars.length === 0) {
    return res.status(400).json({ error: "Body must contain a non-empty 'cars' array." });
  }

  busy = true;
  try {
    const { actions, latencyMs, error } = await getLLMActions(cars);

    // One log line per request — no API key, no sensitive data.
    const hadFallback = actions.some((a) => a.fallback);
    console.log(
      `[decide] cars=${cars.length} latency=${latencyMs}ms` +
      (error       ? ` error="${error}"`       : "") +
      (hadFallback ? " (fallback used)"        : "")
    );

    // Always 200 so the frontend keeps running even if the LLM failed.
    return res.json({ actions, latencyMs, ...(error ? { error } : {}) });
  } finally {
    busy = false;
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] model=${process.env.LLM_MODEL || "llama-3.3-70b-versatile"}`);
});

