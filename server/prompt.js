/**
 * prompt.js — STUB (teammate will replace with real driving logic)
 * Exports: SYSTEM_PROMPT, buildUserMessage(sensorArray)
 */

// Tells the LLM what its job is and what JSON shape to return.
const SYSTEM_PROMPT = `
You are a driving-decision engine for a 4-way intersection simulation.
You receive sensor readings for every active car and must return ONE action per car.

Rules:
- Reply ONLY with a JSON object: {"actions": [...]}
- Each element must have:
    "id"     : integer (same as input)
    "action" : one of "ACCELERATE" | "BRAKE" | "MAINTAIN"
  Optional fields depending on action:
    "throttle"  : number 0-1   (only for ACCELERATE)
    "intensity" : number 0-1   (only for BRAKE)
- Obey traffic signals (RED → stop, GREEN → go).
- Avoid rear-ending the car in front (use front.dist and front.dv).
- No extra keys, no explanations, no markdown.
`.trim();

/**
 * buildUserMessage(sensorArray)
 * Returns the user-turn string sent to the LLM.
 * Stub: just serialises the raw sensor data.
 * Teammate can replace this with a richer natural-language description.
 */
function buildUserMessage(sensorArray) {
  return JSON.stringify(sensorArray);
}

module.exports = { SYSTEM_PROMPT, buildUserMessage };

