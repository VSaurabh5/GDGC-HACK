const SIZE = 800, C = 400, ROAD = 160, H = ROAD / 2;

const L = 30, W = 16;
const MAX_SPEED = 120, ACC = 60, DEC = 150, STOP_S = 320, MAX_CARS = 20;
const LANES = { N: [340, 380], S: [460, 420], W: [420, 460], E: [380, 340] };
const COLORS = { N: "#4da3ff", S: "#ff9f43", W: "#c77dff", E: "#ffd166" };
const COLORS3D = { N: 0x4da3ff, S: 0xff9f43, W: 0xc77dff, E: 0xffd166 };

let cars = [], nextId = 0;

function spawnCar() {
    if (cars.length >= MAX_CARS) return;
    const dir = ["N","S","E","W"][Math.floor(Math.random()*4)];
    const lane = Math.floor(Math.random()*2);
    const same = cars.filter(c => c.dir===dir && c.lane===lane);
    const rearMost = same.length ? Math.min(...same.map(c => c.s - L)) : Infinity;
    if (rearMost < 60) return;
    cars.push({ id: nextId++, dir, lane, s: 0, v: 60, action: { action: "MAINTAIN" } });
}

function carPos(c) {
    const m = c.s - L/2;
    if (c.dir==="N") return { x: LANES.N[c.lane], y: m,        a: Math.PI/2 };
    if (c.dir==="S") return { x: LANES.S[c.lane], y: SIZE-m,   a: -Math.PI/2 };
    if (c.dir==="W") return { x: m,               y: LANES.W[c.lane], a: 0 };
    return                  { x: SIZE-m,           y: LANES.E[c.lane], a: Math.PI };
}

const clamp01 = x => Math.min(1, Math.max(0, x));

function applyPhysics(c, dt) {
    const a = c.action;
    let acc = 0;
    if (a.action==="ACCELERATE") acc =  clamp01(a.throttle  ?? 0.5) * ACC;
    else if (a.action==="BRAKE") acc = -clamp01(a.intensity ?? 0.5) * DEC;
    c.v = Math.min(MAX_SPEED, Math.max(0, c.v + acc*dt));
    c.s += c.v * dt;
}

// Local safety fallback used until the next valid LLM response arrives.
function decideTest(c) {
    const v = c.v;
    let brake = 0;
    let ahead = null;
    for (const o of cars) {
        if (o!==c && o.dir===c.dir && o.lane===c.lane && o.s>c.s && (!ahead||o.s<ahead.s)) ahead=o;
    }
    if (ahead) {
        const gap = (ahead.s - L) - c.s;
        if (gap <= 12) return {action:"BRAKE",intensity:1};
        const availableGap = Math.max(gap - 8, 0.5);
        const relativeStoppingDistance = Math.max(0, (v*v - ahead.v*ahead.v) / (2 * DEC));
        const desiredGap = 12 + v * 0.45 + relativeStoppingDistance;
        if (gap <= desiredGap) {
            const requiredDeceleration = v > ahead.v
                ? (v*v - ahead.v*ahead.v) / (2 * availableGap)
                : DEC * 0.35;
            brake = Math.max(brake, Math.min(1, requiredDeceleration / (DEC * 0.8)));
        }
    }
    const state = getLightState(c.dir);
    const dist  = STOP_S - c.s;
    const conflictingTraffic = dist > 0 && cars.some(other =>
        (c.dir === "N" || c.dir === "S") !== (other.dir === "N" || other.dir === "S") &&
        other.s > STOP_S &&
        other.s < STOP_S + ROAD + L
    );
    if ((state!=="GREEN" || conflictingTraffic) && dist>0) {
        const raw = (v*v)/(2*Math.max(dist-4,0.5))/DEC;
        if (!(state==="YELLOW" && !conflictingTraffic && raw>1)) brake = Math.max(brake, raw/0.8);
        if (dist<8 && v<10) return {action:"BRAKE",intensity:1};
    }
    if (brake>0.03) return {action:"BRAKE",intensity:Math.min(1,brake)};
    return {action:"ACCELERATE",throttle:0.8};
}

function box(c) {
    const p = carPos(c);
    const horiz = c.dir==="W"||c.dir==="E";
    const bw = horiz?L:W, bh = horiz?W:L;
    return { x1:p.x-bw/2, x2:p.x+bw/2, y1:p.y-bh/2, y2:p.y+bh/2 };
}
let touching = new Set();
function checkCollisions() {
    const now = new Set();
    for (let i=0;i<cars.length;i++) for (let j=i+1;j<cars.length;j++) {
        const a=box(cars[i]), b=box(cars[j]);
        if (a.x1<b.x2 && a.x2>b.x1 && a.y1<b.y2 && a.y2>b.y1) {
            const key = cars[i].id+"-"+cars[j].id;
            now.add(key);
            if (!touching.has(key)) hud.collisions++;
        }
    }
    touching = now;
}

const carMeshesMap = new Map(); // id -> { group, brakeMat }

function makeCarMesh(colorHex) {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color:colorHex, metalness:0.3, roughness:0.4 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(W,10,L), bodyMat);
    body.position.y=7; body.castShadow=true; g.add(body);

    const roofMat = new THREE.MeshStandardMaterial({ color:0x0f172a, roughness:0.2, metalness:0.8 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W-2,7,L*0.5), roofMat);
    roof.position.set(0,13.5,-2); g.add(roof);

    // headlights front
    const hlMat = new THREE.MeshBasicMaterial({ color:0xffffd1 });
    [-W/2+3, W/2-3].forEach(x=>{
        const h=new THREE.Mesh(new THREE.BoxGeometry(3,2,1),hlMat);
        h.position.set(x,7,L/2+0.5); g.add(h);
    });

    // brake lights rear
    const brakeMat = new THREE.MeshStandardMaterial({ color:0x440000, emissive:0x000000, emissiveIntensity:0 });
    [-W/2+3, W/2-3].forEach(x=>{
        const b=new THREE.Mesh(new THREE.BoxGeometry(3.5,2,1),brakeMat);
        b.position.set(x,7,-L/2-0.5); g.add(b);
    });

    // wheels
    const wMat2 = new THREE.MeshStandardMaterial({ color:0x111111, roughness:0.8 });
    const wGeo  = new THREE.CylinderGeometry(3.5,3.5,2.5,12);
    wGeo.rotateZ(Math.PI/2);
    [[-W/2-0.5,3.5,L/3],[W/2+0.5,3.5,L/3],[-W/2-0.5,3.5,-L/3],[W/2+0.5,3.5,-L/3]].forEach(([x,y,z])=>{
        const w=new THREE.Mesh(wGeo,wMat2); w.position.set(x,y,z); w.castShadow=true; g.add(w);
    });

    return { group:g, brakeMat };
}

// ─── UPDATE LOOP (same logic as 2D) ─────────────────────────────────────────

let lastT = performance.now(), spawnTimer = 0;

function update(dt) {
    spawnTimer += dt;
    if (spawnTimer > 1) { spawnTimer=0; spawnCar(); }
    for (const c of cars) {
        const hasRecentLLMAction = c.llmAction && performance.now() - c.llmActionAt < LLM_ACTION_MAX_AGE_MS;
        const safetyAction = decideTest(c);
        c.action = safetyAction.action === "BRAKE"
            ? safetyAction
            : hasRecentLLMAction ? c.llmAction : safetyAction;
    }
    for (const c of cars) applyPhysics(c, dt);
    checkCollisions();
    cars = cars.filter(c => {
        if (c.s - L > SIZE) {
            hud.cleared++;
            const mo = carMeshesMap.get(c.id);
            if (mo) { scene.remove(mo.group); carMeshesMap.delete(c.id); }
            return false;
        }
        return true;
    });
}

// ─── SYNC 3D CARS TO SIMULATION STATE ────────────────────────────────────────
function syncCars() {
    for (const c of cars) {
        // create mesh if new
        if (!carMeshesMap.has(c.id)) {
            const mo = makeCarMesh(COLORS3D[c.dir]);
            scene.add(mo.group);
            carMeshesMap.set(c.id, mo);
        }
        const p  = carPos(c);
        const mo = carMeshesMap.get(c.id);

        // 2D: x=canvas-x, y=canvas-y  →  3D: X=x, Z=y, Y=height
        mo.group.position.set(p.x, 0, p.y);

        // 2D rotation p.a is CCW from East; Three.js Y-rotation is CW from North
        // carPos returns: N=PI/2, S=-PI/2, W=0, E=PI  (2D canvas angles)
        // We need: N=PI, S=0, W=PI/2, E=-PI/2  (Three.js world angles)
        mo.group.rotation.y = -p.a + Math.PI/2;

        // brake light
        const braking = c.action.action === "BRAKE";
        mo.brakeMat.color.setHex(braking ? 0xff3b30 : 0x440000);
        mo.brakeMat.emissive.setHex(braking ? 0xff3b30 : 0x000000);
        mo.brakeMat.emissiveIntensity = braking ? 0.8 : 0;
    }
}

// ─── HUD DOM UPDATE ──────────────────────────────────────────────────────────
