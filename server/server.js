/**
 * Serves the simulator and proxies requests to local Ollama.
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const { assertConfig, getLLMActions } = require("./llm");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MAX_CARS = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 40;
const MAX_CONCURRENT_REQUESTS = 4;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
  });
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origin is not allowed by CORS."));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));
app.use(express.json({ limit: "32kb", strict: true }));

const requestCounts = new Map();
let activeRequests = 0;
let rateLimitChecks = 0;

function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip;
  let window = requestCounts.get(key);
  if (!window || now - window.startedAt >= RATE_LIMIT_WINDOW_MS) {
    window = { startedAt: now, count: 0 };
    requestCounts.set(key, window);
  }

  window.count += 1;
  if (window.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: "Rate limit exceeded; try again shortly." });
  }

  rateLimitChecks += 1;
  if (rateLimitChecks % 256 === 0) {
    for (const [ip, entry] of requestCounts) {
      if (now - entry.startedAt >= RATE_LIMIT_WINDOW_MS) requestCounts.delete(ip);
    }
  }
  return next();
}

function isValidSensor(sensor) {
  if (!sensor || typeof sensor !== "object" || Array.isArray(sensor)) return false;
  if (!Number.isSafeInteger(sensor.id) || sensor.id < 0) return false;
  if (!Number.isFinite(sensor.speed) || sensor.speed < 0 || sensor.speed > 120) return false;

  for (const key of ["front", "rear", "left", "right"]) {
    const neighbor = sensor[key];
    if (neighbor === null) continue;
    if (!neighbor || typeof neighbor !== "object" || !Number.isFinite(neighbor.dist) || neighbor.dist < 0) {
      return false;
    }
    if (neighbor.dv !== undefined && !Number.isFinite(neighbor.dv)) return false;
  }

  if (sensor.signal === null) return true;
  return Boolean(
    sensor.signal &&
    typeof sensor.signal === "object" &&
    ["RED", "YELLOW", "GREEN"].includes(sensor.signal.state) &&
    Number.isFinite(sensor.signal.distToStop) &&
    sensor.signal.distToStop >= 0
  );
}

app.get(["/", "/index.html"], (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

app.get("/styles.css", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "styles.css"));
});

app.get("/lights.js", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "lights.js"));
});

app.get("/cars.js", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "cars.js"));
});

app.get("/sensors.js", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "sensors.js"));
});

app.get("/render.js", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "render.js"));
});

app.get("/main.js", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "main.js"));
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, provider: "ollama", model: process.env.LLM_MODEL || "gemma2:2b" });
});

app.post("/api/decide", rateLimit, async (req, res) => {
  const { cars } = req.body || {};
  if (
    !Array.isArray(cars) ||
    cars.length === 0 ||
    cars.length > MAX_CARS ||
    !cars.every(isValidSensor) ||
    new Set(cars.map((car) => car.id)).size !== cars.length
  ) {
    return res.status(400).json({
      error: `Body must contain 1-${MAX_CARS} cars with unique ids and valid sensor data.`,
    });
  }

  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    return res.status(503).json({ error: "The decision service is busy; retry shortly." });
  }

  activeRequests += 1;
  try {
    return res.json(await getLLMActions(cars));
  } finally {
    activeRequests -= 1;
  }
});

app.use((error, _req, res, _next) => {
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large." });
  }
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({ error: "Request body must be valid JSON." });
  }
  console.error("[server] Unexpected request error.");
  return res.status(500).json({ error: "Internal server error." });
});

if (require.main === module) {
  try {
    assertConfig();
  } catch (error) {
    console.error(`[server] Configuration error: ${error.message}`);
    process.exitCode = 1;
  }

  if (process.exitCode !== 1) {
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`[server] listening on port ${PORT}`);
      console.log(`[server] provider=ollama model=${process.env.LLM_MODEL || "gemma2:2b"}`);
    });
    server.requestTimeout = 60000;
    server.headersTimeout = 65000;
  }
}

module.exports = app;
