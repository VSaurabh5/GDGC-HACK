const LLM_ENDPOINT = "/api/decide";
const LLM_REQUEST_INTERVAL_MS = 2000;
const LLM_ACTION_MAX_AGE_MS = 5000;
let llmRequestInFlight = false;

function getSensors() {
    return cars.map(c => {
        const sameLane = cars.filter(other =>
            other !== c && other.dir === c.dir && other.lane === c.lane
        );
        const frontCar = sameLane
            .filter(other => other.s > c.s)
            .sort((a, b) => a.s - b.s)[0];
        const rearCar = sameLane
            .filter(other => other.s < c.s)
            .sort((a, b) => b.s - a.s)[0];
        const neighbor = other => other
            ? { dist: Math.max(0, Math.abs(other.s - c.s) - L), dv: other.v - c.v }
            : null;
        const distToStop = STOP_S - c.s;

        return {
            id: c.id,
            speed: c.v,
            front: neighbor(frontCar),
            rear: neighbor(rearCar),
            left: null,
            right: null,
            signal: distToStop >= 0
                ? { state: getLightState(c.dir), distToStop }
                : null,
        };
    });
}

async function requestLLMDecisions() {
    if (llmRequestInFlight || cars.length === 0) return;
    llmRequestInFlight = true;
    const startedAt = performance.now();

    try {
        const response = await fetch(LLM_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cars: getSensors() }),
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `Server returned HTTP ${response.status}.`);
        }

        hud.latencyMs = Number.isFinite(result.latencyMs)
            ? result.latencyMs
            : performance.now() - startedAt;
        if (!Array.isArray(result.actions)) {
            throw new Error("Server response is missing actions.");
        }

        const actionById = new Map(result.actions.map(action => [action.id, action]));
        for (const c of cars) {
            const action = actionById.get(c.id);
            if (
                action &&
                !action.fallback &&
                ["ACCELERATE", "BRAKE", "MAINTAIN"].includes(action.action)
            ) {
                c.llmAction = action;
                c.llmActionAt = performance.now();
            }
        }
    } catch (error) {
        hud.latencyMs = null;
        console.error("[simulation] Could not get LLM decisions:", error);
    } finally {
        llmRequestInFlight = false;
        setTimeout(requestLLMDecisions, LLM_REQUEST_INTERVAL_MS);
    }
}

// ─── THREE.JS SETUP ──────────────────────────────────────────────────────────
