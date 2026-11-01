const SYSTEM_PROMPT = `
Control each car using its speed, nearby cars, and signal. Brake for red lights
and unsafe following gaps; accelerate on clear roads with a green light. A null
signal means the car has passed the stop line. Return only valid JSON with one
action per input id, in input order, using the actions array schema:
{"actions":[{"id":0,"action":"ACCELERATE","throttle":0.8}]}
`.trim();

function buildUserMessage(sensorArray) {
  return JSON.stringify(sensorArray);
}

module.exports = { SYSTEM_PROMPT, buildUserMessage };
