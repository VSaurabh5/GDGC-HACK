const hud = { collisions: 0, latencyMs: null, cleared: 0 };

function updateHUD() {
    const colEl = document.getElementById("hud-collisions");
    colEl.textContent = hud.collisions;
    colEl.style.color = hud.collisions > 0 ? "#ff3b30" : "#34c759";
    document.getElementById("hud-latency").textContent =
        hud.latencyMs === null ? "--" : Math.round(hud.latencyMs) + " ms";
    document.getElementById("hud-cleared").textContent = hud.cleared;
}

// ─── CHASE CAMERA ────────────────────────────────────────────────────────────
function updateChaseCam() {
    if (cameraMode !== "chase" || cars.length === 0) return;
    const p = carPos(cars[0]);
    const angle = -p.a + Math.PI/2;
    camera.position.set(p.x - Math.sin(angle)*70, 45, p.y - Math.cos(angle)*70);
    camera.lookAt(p.x, 10, p.y);
}

// ─── VEHICLE PANEL ───────────────────────────────────────────────────────────
const DIR_LABEL = { N:"North", S:"South", W:"West", E:"East" };
function updateVehiclePanel() {
    const list = document.getElementById("vp-list");
    if (!list) return;
    // show up to 8 cars to keep panel from overflowing
    const visible = cars.slice(0, 8);
    list.innerHTML = visible.map(c => {
        const act = c.action.action;
        const actClass = act==="ACCELERATE"?"act-ACC":act==="BRAKE"?"act-BRK":"act-MNT";
        const actLabel = act==="ACCELERATE"?"ACCEL":act==="BRAKE"?"BRAKE":"HOLD";
        const speedPct = Math.round(c.v / MAX_SPEED * 100);
        const dist = Math.round(STOP_S - c.s);
        const signal = getLightState(c.dir);
        const sigColor = signal==="GREEN"?"#22c55e":signal==="YELLOW"?"#eab308":"#ef4444";
        return `<div class="vcard">
          <div class="vc-top">
            <span class="vc-id">#${c.id}</span>
            <span class="vc-dir dir-${c.dir}">${DIR_LABEL[c.dir]} L${c.lane+1}</span>
          </div>
          <div class="vc-rows">
            <div class="vc-row"><span class="vc-key">Speed</span><span class="vc-val">${Math.round(c.v)} px/s</span></div>
            <div class="vc-row"><span class="vc-key">Action</span><span class="vc-action ${actClass}">${actLabel}</span></div>
            <div class="vc-row"><span class="vc-key">Signal</span><span class="vc-val" style="color:${sigColor}">${signal}</span></div>
            <div class="vc-row"><span class="vc-key">To stop</span><span class="vc-val">${dist>0?dist+"px":"past"}</span></div>
          </div>
          <div class="vc-bar-bg"><div class="vc-bar" style="width:${speedPct}%"></div></div>
        </div>`;
    }).join("") + (cars.length > 8 ? `<div style="padding:8px 16px;font-size:11px;color:#475569;font-family:'JetBrains Mono',monospace">+${cars.length-8} more…</div>` : "");
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
function frame(t) {
    const dt = Math.min((t - lastT) / 1000, 0.05);
    lastT = t;

    update(dt);           // identical simulation logic
    syncCars();           // apply state to 3D meshes
    updateLightVisuals(); // glow correct lamp
    updateChaseCam();
    updateHUD();
    updateVehiclePanel(); // right-side live vehicle data

    if (controls.enabled) controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
}

// ─── THEME TOGGLE ─────────────────────────────────────────────────────────────
const DARK = {
    bg:      0x020408,
    fog:     0x020408,
    grass:   0x0a1a0e,
    road:    0x111318,
    ambient: { color: 0x1a2a4a, intensity: 1.2 },
    moon:    { color: 0x3a5a8a, intensity: 0.35 },
    lampInt: 0.9,
};
const LIGHT = {
    bg:      0xdde8f0,
    fog:     0xdde8f0,
    grass:   0x3a7d44,
    road:    0x555555,
    ambient: { color: 0xffffff, intensity: 0.7 },
    moon:    { color: 0xfff4e0, intensity: 1.0 },
    lampInt: 0.0,   // lamps off in daylight
};

let isDark = true;

function toggleTheme() {
    isDark = !isDark;
    const T = isDark ? DARK : LIGHT;

    // scene colours
    scene.background.setHex(T.bg);
    scene.fog.color.setHex(T.fog);
    grass.material.color.setHex(T.grass);
    roadMat.color.setHex(T.road);

    // lights
    ambientRef.color.setHex(T.ambient.color);
    ambientRef.intensity = T.ambient.intensity;
    moonRef.color.setHex(T.moon.color);
    moonRef.intensity = T.moon.intensity;

    // street lamp point lights
    streetPtLights.forEach(pl => { pl.intensity = T.lampInt; });

    // body class for CSS UI panels
    document.body.classList.toggle("light", !isDark);

    // button label
    document.getElementById("theme-icon").textContent  = isDark ? "🌙" : "☀️";
    document.getElementById("theme-label").textContent = isDark ? "Dark Mode" : "Light Mode";
    document.getElementById("theme-icon").style.transform = isDark ? "rotate(0deg)" : "rotate(180deg)";
}

// spawn two cars immediately so there is something to see
spawnCar(); spawnCar();
requestLLMDecisions();
requestAnimationFrame(frame);
