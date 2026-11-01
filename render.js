const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById("c").appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020408);
scene.fog = new THREE.FogExp2(0x020408, 0.0007);

const camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 1, 3000);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI/2 - 0.05;
controls.minDistance = 200; controls.maxDistance = 1400;

// Night lighting — dim ambient + weak blue moon directional
const ambientRef = new THREE.AmbientLight(0x1a2a4a, 1.2);
scene.add(ambientRef);
const moonRef = new THREE.DirectionalLight(0x3a5a8a, 0.35);
const moon = moonRef;
moon.position.set(400,800,400); moon.castShadow = true;
moon.shadow.mapSize.set(2048,2048);
moon.shadow.camera.left = moon.shadow.camera.bottom = -600;
moon.shadow.camera.right = moon.shadow.camera.top = 600;
moon.shadow.camera.near = 100; moon.shadow.camera.far = 1800;
moon.shadow.bias = -0.0005;
scene.add(moon);

window.addEventListener("resize", () => {
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

// ─── CAMERA PRESETS ──────────────────────────────────────────────────────────
let cameraMode = "perspective";
function setCam(mode) {
    cameraMode = mode;
    document.querySelectorAll("#cam-btns button").forEach(b => b.classList.remove("active"));
    document.getElementById("cam-"+mode).classList.add("active");
    if (mode==="perspective") {
        controls.enabled = true;
        camera.position.set(400,650,950); controls.target.set(400,0,400); controls.update();
    } else if (mode==="topdown") {
        controls.enabled = true;
        camera.position.set(400,950,400.1); controls.target.set(400,0,400); controls.update();
    } else { // chase
        controls.enabled = false;
    }
}
setCam("perspective");
document.getElementById("cam-perspective").onclick = () => setCam("perspective");
document.getElementById("cam-topdown").onclick    = () => setCam("topdown");
document.getElementById("cam-chase").onclick      = () => setCam("chase");

// ─── BUILD 3D ROAD ───────────────────────────────────────────────────────────
// Grass
const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(2400,2400),
    new THREE.MeshStandardMaterial({ color:0x0a1a0e, roughness:0.95 })
);
grass.rotation.x = -Math.PI/2; grass.position.set(400,-1,400);
grass.receiveShadow = true; scene.add(grass);

// Road surfaces
const roadMat = new THREE.MeshStandardMaterial({ color:0x111318, roughness:0.85 });
const addPlane = (w,d,x,z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w,d), roadMat);
    m.rotation.x=-Math.PI/2; m.position.set(x,0,z); m.receiveShadow=true; scene.add(m);
};
addPlane(ROAD, SIZE, C, C);   // vertical
addPlane(SIZE, ROAD, C, C);   // horizontal

// Sidewalk corners (raised curb)
const curbMat = new THREE.MeshStandardMaterial({ color:0x94a3b8, roughness:0.6 });
const cs = (SIZE-ROAD)/2, co = cs/2;
[[co,co],[SIZE-co,co],[co,SIZE-co],[SIZE-co,SIZE-co]].forEach(([x,z])=>{
    const m = new THREE.Mesh(new THREE.BoxGeometry(cs,3,cs), curbMat);
    m.position.set(x,1.5,z); m.receiveShadow=true; scene.add(m);
});

// Road markings
const wMat  = new THREE.MeshBasicMaterial({ color:0xffffff });
const yMat  = new THREE.MeshBasicMaterial({ color:0xf5c518 });
const dMat  = new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:0.85 });
const MY = 0.3; // just above road

// Stop lines (matching 2D exactly)
const stopLine = (x,z,w,d) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w,d), wMat);
    m.rotation.x=-Math.PI/2; m.position.set(x,MY,z); scene.add(m);
};
stopLine(C-H/2, C-H, H, 5);    // from North
stopLine(C+H/2, C+H, H, 5);    // from South
stopLine(C-H,   C+H/2, 5, H);  // from West
stopLine(C+H,   C-H/2, 5, H);  // from East

// Yellow centre lines
const yl = (x,z,w,d) => {
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),yMat);
    m.rotation.x=-Math.PI/2; m.position.set(x,MY,z); scene.add(m);
};
yl(C,(C-H)/2,         3, C-H);
yl(C, SIZE-(C-H)/2,   3, C-H);
yl((C-H)/2,  C,       C-H, 3);
yl(SIZE-(C-H)/2, C,   C-H, 3);

// Dashed lane dividers
const DLEN=16, GAP=14;
function dashedLine(sx,sz,ex,ez,vert) {
    const total = vert ? Math.abs(ez-sz) : Math.abs(ex-sx);
    let cur=0;
    while(cur<total) {
        const len=Math.min(DLEN, total-cur);
        const geo = vert ? new THREE.PlaneGeometry(2,len) : new THREE.PlaneGeometry(len,2);
        const m=new THREE.Mesh(geo,dMat); m.rotation.x=-Math.PI/2;
        if(vert) m.position.set(sx, MY, sz<ez ? sz+cur+len/2 : sz-cur-len/2);
        else     m.position.set(sx<ex ? sx+cur+len/2 : sx-cur-len/2, MY, sz);
        scene.add(m); cur+=DLEN+GAP;
    }
}
for (const o of [-H/2, H/2]) {
    dashedLine(C+o, 0,   C+o, C-H, true);
    dashedLine(C+o, C+H, C+o, SIZE, true);
    dashedLine(0,   C+o, C-H, C+o, false);
    dashedLine(C+H, C+o, SIZE, C+o, false);
}

// ─── TRAFFIC LIGHT POSTS ─────────────────────────────────────────────────────
// Matching original drawLight positions:
// N: (C-H-30, C-H-70)  S: (C+H+8, C+H+8)  W: (C-H-70, C+H+8)  E: (C+H+48, C-H-70)

createTrafficLights();

const trunkM = new THREE.MeshStandardMaterial({ color:0x5c4033, roughness:0.9 });
const leafM  = new THREE.MeshStandardMaterial({ color:0x1e5e3a, roughness:0.6, flatShading:true });
[[100,100],[220,80],[80,220],[250,250],
 [700,100],[580,80],[720,220],[550,250],
 [100,700],[220,720],[80,580],[250,550],
 [700,700],[580,720],[720,580],[550,550]].forEach(([x,z],i)=>{
    const s=0.8+(i%3)*0.2;
    const g=new THREE.Group();
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(4*s,6*s,25*s,6),trunkM);
    trunk.position.y=12.5*s; trunk.castShadow=true; g.add(trunk);
    const leaves=new THREE.Mesh(new THREE.ConeGeometry(22*s,45*s,6),leafM);
    leaves.position.y=25*s+22.5*s; leaves.castShadow=true; g.add(leaves);
    g.position.set(x,0,z); scene.add(g);
});

// ─── STREET LAMPS along road edges ───────────────────────────────────────────
const lampPoleMat  = new THREE.MeshStandardMaterial({ color:0x1e2a3a, metalness:0.9, roughness:0.2 });
const lampGlowMat  = new THREE.MeshStandardMaterial({ color:0xfff4cc, emissive:0xfff4aa, emissiveIntensity:1.2, roughness:0.1 });

// positions: [x, z]  along both sides of the vertical and horizontal roads
const streetPtLights = [];
const streetLampPositions = [
    // vertical road — west edge
    [C-H-10, 60], [C-H-10, 160], [C-H-10, 260],
    [C-H-10, 540], [C-H-10, 640], [C-H-10, 740],
    // vertical road — east edge
    [C+H+10, 60], [C+H+10, 160], [C+H+10, 260],
    [C+H+10, 540], [C+H+10, 640], [C+H+10, 740],
    // horizontal road — north edge
    [60,  C-H-10], [160, C-H-10], [260, C-H-10],
    [540, C-H-10], [640, C-H-10], [740, C-H-10],
    // horizontal road — south edge
    [60,  C+H+10], [160, C+H+10], [260, C+H+10],
    [540, C+H+10], [640, C+H+10], [740, C+H+10],
];

streetLampPositions.forEach(([x, z]) => {
    const g = new THREE.Group();
    // pole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 40, 8), lampPoleMat);
    pole.position.y = 20; pole.castShadow = true; g.add(pole);
    // arm
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 14, 6), lampPoleMat);
    arm.rotation.z = Math.PI / 2; arm.position.set(7, 40, 0); g.add(arm);
    // glow bulb
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(3, 10, 10), lampGlowMat);
    bulb.position.set(14, 40, 0); g.add(bulb);
    // point light — warm yellow cone downward
    const ptLight = new THREE.PointLight(0xfff4aa, 0.9, 120);
    ptLight.position.set(14, 39, 0);
    g.add(ptLight);
    streetPtLights.push(ptLight);

    g.position.set(x, 0, z);
    scene.add(g);
});

// ─── CAR MESHES ──────────────────────────────────────────────────────────────
