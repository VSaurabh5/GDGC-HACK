const phases = [
    { ns: "GREEN",  ew: "RED",    ms: 6000 },
    { ns: "YELLOW", ew: "RED",    ms: 2000 },
    { ns: "RED",    ew: "RED",    ms: 1000 },
    { ns: "RED",    ew: "GREEN",  ms: 6000 },
    { ns: "RED",    ew: "YELLOW", ms: 2000 },
    { ns: "RED",    ew: "RED",    ms: 1000 },
];
const cycleMs = phases.reduce((s, p) => s + p.ms, 0);

function currentPhase(now) {
    let t = now % cycleMs;
    for (const p of phases) { if (t < p.ms) return p; t -= p.ms; }
}
function getLightState(dir) {
    const p = currentPhase(performance.now());
    return (dir === "N" || dir === "S") ? p.ns : p.ew;
}

let lampMap = {};

function createTrafficLights() {

const postConfigs = [
    { dir:"N", x:C-H-30, z:C-H-70 },
    { dir:"S", x:C+H+8,  z:C+H+8  },
    { dir:"W", x:C-H-70, z:C+H+8  },
    { dir:"E", x:C+H+48, z:C-H-70 },
];
const postMat = new THREE.MeshStandardMaterial({ color:0x1e293b, metalness:0.8, roughness:0.3 });

postConfigs.forEach(cfg => {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(2,2.5,55,10), postMat);
    pole.position.y=27.5; pole.castShadow=true; g.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(14,38,12), postMat);
    head.position.set(0,42,0); g.add(head);

    const lampInfo = [
        { name:"RED",    col:0xff3b30, y:52 },
        { name:"YELLOW", col:0xffcc00, y:42 },
        { name:"GREEN",  col:0x34c759, y:32 },
    ];
    const lamps = {};
    lampInfo.forEach(info => {
        const mat = new THREE.MeshStandardMaterial({
            color:0x111111, emissive:0x000000, emissiveIntensity:0, roughness:0.3
        });
        const lm = new THREE.Mesh(new THREE.SphereGeometry(4,14,14), mat);
        lm.position.set(0, info.y-42, 5);
        head.add(lm);
        lamps[info.name] = { mat, baseColor:info.col };
    });
    lampMap[cfg.dir] = lamps;

    // Aim post at intersection centre
    const dx=C-cfg.x, dz=C-cfg.z;
    g.rotation.y = Math.atan2(dx,dz);
    g.position.set(cfg.x, 0, cfg.z);
    scene.add(g);
});

}

function updateLightVisuals() {
    ["N","S","E","W"].forEach(dir => {
        const state = getLightState(dir);
        const lamps = lampMap[dir];
        Object.keys(lamps).forEach(name => {
            const {mat,baseColor} = lamps[name];
            if (name===state) {
                mat.color.setHex(baseColor); mat.emissive.setHex(baseColor); mat.emissiveIntensity=0.9;
            } else {
                mat.color.setHex(0x111111); mat.emissive.setHex(0x000000); mat.emissiveIntensity=0;
            }
        });
    });
}

// ─── TREES ───────────────────────────────────────────────────────────────────
