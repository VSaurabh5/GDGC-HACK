/**
 * test.js — sends 3 sample cars to /api/decide and prints the result.
 * Run AFTER starting the server: node server/server.js
 *
 * Scenarios:
 *   Car 0 — RED light close ahead, stopped traffic in front
 *   Car 1 — Car tailgating very close behind, car ahead braking hard
 * Run AFTER starting the server: node server/test.js
 *
 * Scenarios:
 *   Car 0 — RED light close ahead, stopped traffic in front
 *   Car 1 — Car tailgating very close behind, open road ahead
 *   Car 2 — GREEN light, clear road on all sides
 */

const ENDPOINT = "http://localhost:3000/api/decide";

// Read provider/model from env so the log matches what the server is using.
const PROVIDER = process.env.LLM_PROVIDER || "ollama";
const MODEL    = process.env.LLM_MODEL    || "gemma4:31b-cloud";

const testCars = [
  {
    id: 0,
    speed: 60,
    front:  { dist: 8,  dv: 0  },   // car barely ahead
    rear:   { dist: 40, dv: 2  },
    left:   null,
    right:  null,
    signal: { state: "RED", distToStop: 10 },  // nearly at the stop line
  },
  {
    id: 1,
    speed: 80,
    front:  { dist: 5,  dv: -20 }, // car ahead braking hard
    rear:   { dist: 3,  dv: 15  }, // tailgater closing fast
    left:   { dist: 20 },
    right:  null,
    signal: { state: "GREEN", distToStop: 200 },
  },
  {
    id: 2,
    speed: 50,
    front:  null,
    rear:   null,
    left:   null,
    right:  null,
    signal: { state: "GREEN", distToStop: 300 }, // clear road, green light
  },
];

async function main() {
  console.log(`provider   : ${PROVIDER}`);
  console.log(`model      : ${MODEL}`);
  console.log(`endpoint   : ${ENDPOINT}`);
  console.log(`cars sent  : ${testCars.length}\n`);
  console.log("Sending test request to", ENDPOINT, "...\n");

  try {
    const res  = await fetch(ENDPOINT, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ cars: testCars }),
    });

    const data = await res.json();

    console.log("HTTP status :", res.status);
    console.log("latencyMs  :", data.latencyMs);
    if (data.error) console.warn("error      :", data.error);

    console.log("\nActions:");
    data.actions.forEach((a) => {
      const flag = a.fallback ? "  ⚠ FALLBACK" : "";
      console.log(" ", JSON.stringify(a) + flag);
    });

    // Summary: count fallbacks.
    const fallbacks = data.actions.filter((a) => a.fallback).length;
    if (fallbacks > 0) {
      console.warn(`\n⚠  ${fallbacks} car(s) got fallback MAINTAIN — check server logs.`);
    } else {
      console.log("\n✓ All actions returned by LLM.");
    }

    console.log("\nActions:");
    data.actions.forEach((a) => console.log(" ", JSON.stringify(a)));
  } catch (err) {
    console.error("Request failed:", err.message);
    console.error("Is the server running?  →  node server/server.js");
  }
}

main();

/*
 ─── Equivalent curl command ───────────────────────────────────────────────────

curl -s -X POST http://localhost:3000/api/decide \
  -H "Content-Type: application/json" \
  -d '{
    "cars": [
      {"id":0,"speed":60,"front":{"dist":8,"dv":0},"rear":{"dist":40,"dv":2},"left":null,"right":null,"signal":{"state":"RED","distToStop":10}},
      {"id":1,"speed":80,"front":{"dist":5,"dv":-20},"rear":{"dist":3,"dv":15},"left":{"dist":20},"right":null,"signal":{"state":"GREEN","distToStop":200}},
      {"id":2,"speed":50,"front":null,"rear":null,"left":null,"right":null,"signal":{"state":"GREEN","distToStop":300}}
    ]
  }'

 ──────────────────────────────────────────────────────────────────────────────
*/
  }' | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); console.log(JSON.stringify(JSON.parse(d),null,2))"

 ──────────────────────────────────────────────────────────────────────────────
*/

