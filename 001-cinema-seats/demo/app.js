import * as THREE from 'three';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rad = (d) => (d * Math.PI) / 180;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const mulberry32 = (s) => () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const yuan = (n) => '¥' + n.toFixed(2);

/* ------------------------------------------------------------------ */
/* configuration                                                      */
/* ------------------------------------------------------------------ */
const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const FIRST_ROW_Z = -1.5;
const ROW_GAP = 1.2;
const SCREEN_Z = -6.1;
const SCREEN_Y = 2.7;
const SCREEN_W = 12;
const SCREEN_H = 5.6;
const SCREEN_CURVE = 1.05;
const EYE_Y = 1.26;
const LAST_ROW_Z = FIRST_ROW_Z + (ROWS.length - 1) * ROW_GAP;

const PRICE = { standard: 45, recliner: 68 };

const TIMES = [
  { label: '17:30', fmt: '2D', seed: 9121 },
  { label: '19:45', fmt: 'IMAX', seed: 4417 },
  { label: '22:15', fmt: '2D', seed: 7733 },
];
let activeTime = 1;

let selected = null;
let hovered = null;
let mode = 'map';
let anim = null;
let basePose = null;

/* ------------------------------------------------------------------ */
/* seat layout                                                        */
/* ------------------------------------------------------------------ */
const seats = [];
const seatByCode = new Map();

(function buildLayout() {
  ROWS.forEach((rowId, r) => {
    const recliner = r >= 7;
    const groups = recliner ? [3, 6, 3] : [3, 8, 3];
    const w = recliner ? 0.8 : 0.6;
    const gap = recliner ? 0.1 : 0.08;
    const aisle = recliner ? 0.7 : 0.8;

    let total = 0;
    groups.forEach((g, i) => {
      total += g * w + (g - 1) * gap + (i < groups.length - 1 ? aisle : 0);
    });

    let cursor = -total / 2;
    let num = 1;
    const zRow = FIRST_ROW_Z + r * ROW_GAP;

    groups.forEach((g) => {
      for (let k = 0; k < g; k++) {
        const x = cursor + w / 2;
        const z = zRow + 0.55 * Math.pow(x / 5.4, 2);
        const seat = {
          rowIndex: r, rowId, num, x, z, w, recliner,
          rot: Math.atan2(x, 11),
          taken: false, meshes: [], group: null,
        };
        seats.push(seat);
        seatByCode.set(`${rowId}${num}`, seat);
        cursor += w + gap;
        num += 1;
      }
      cursor += aisle;
    });
  });
})();

const centreX = 0;

/* ------------------------------------------------------------------ */
/* dom                                                                */
/* ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const el = {
  mapUI: $('mapUI'),
  seatUI: $('seatUI'),
  times: $('times'),
  screenHint: $('screenHint'),
  bbEyebrow: $('bbEyebrow'),
  bbDetail: $('bbDetail'),
  continueBtn: $('continueBtn'),
  backSeat: $('backSeat'),
  changeSeat: $('changeSeat'),
  bookBtn: $('bookBtn'),
  viewPillText: $('viewPillText'),
  cardLabel: $('cardLabel'),
  cardTitle: $('cardTitle'),
  cardSub: $('cardSub'),
  statDist: $('statDist'),
  statFov: $('statFov'),
  statOffset: $('statOffset'),
  statOffsetLabel: $('statOffsetLabel'),
  minimap: $('minimap'),
};

/* ------------------------------------------------------------------ */
/* renderer / scene                                                   */
/* ------------------------------------------------------------------ */
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060505);

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);

/* ------------------------------------------------------------------ */
/* materials                                                          */
/* ------------------------------------------------------------------ */
const fabric = () => new THREE.MeshStandardMaterial({
  color: 0x353230,
  roughness: 0.94,
  metalness: 0,
  emissive: 0x0a0505,
  emissiveIntensity: 1,
});

const matAvail = fabric();
const matTaken = fabric();
const matRecl = fabric();
const matArm = new THREE.MeshStandardMaterial({ color: 0x17120f, roughness: 0.85, metalness: 0.05 });
const matSelected = new THREE.MeshStandardMaterial({
  color: 0x5ce6a1, emissive: 0x1fcf84, emissiveIntensity: 0.5, roughness: 0.55, metalness: 0,
});
const matHover = new THREE.MeshStandardMaterial({ color: 0x4d4842, roughness: 0.9, metalness: 0 });

const COLOR = {
  avail: [new THREE.Color(0x2e2b27), new THREE.Color(0x8c1f26)],
  taken: [new THREE.Color(0x1a1816), new THREE.Color(0x331316)],
  recl: [new THREE.Color(0x4e272b), new THREE.Color(0x9e252d)],
  arm: [new THREE.Color(0x141010), new THREE.Color(0x2b0d10)],
};
let seatMix = 0;

function applyModeColors(t) {
  matAvail.color.lerpColors(COLOR.avail[0], COLOR.avail[1], t);
  matTaken.color.lerpColors(COLOR.taken[0], COLOR.taken[1], t);
  matRecl.color.lerpColors(COLOR.recl[0], COLOR.recl[1], t);
  matArm.color.lerpColors(COLOR.arm[0], COLOR.arm[1], t);
  matAvail.emissiveIntensity = matTaken.emissiveIntensity = matRecl.emissiveIntensity = 0.6 + t * 0.6;
  // overhead map: only the rim arc exists; the picture resolves once the camera
  // has turned toward the screen, so it never pops in over the seat map
  if (screenSurface) {
    const k = clamp((t - 0.18) / 0.62, 0, 1);
    const smooth = k * k * (3 - 2 * k);
    screenSurface.opacity = smooth;
    screenSurface.transparent = smooth < 0.999;
    screenSurface.depthWrite = smooth >= 0.999;
  }
  for (const s of rowLabels) s.material.opacity = 1 - t;
  if (mapWash) mapWash.intensity = lerp(220, 22, t);
}

/* ------------------------------------------------------------------ */
/* geometry helpers                                                   */
/* ------------------------------------------------------------------ */
const geomCache = new Map();
function seatGeoms(w, recliner) {
  const key = `${w.toFixed(2)}-${recliner}`;
  if (geomCache.has(key)) return geomCache.get(key);
  const g = {
    cushion: new RoundedBoxGeometry(w, 0.18, recliner ? 0.78 : 0.54, 3, 0.07),
    back: new RoundedBoxGeometry(w + 0.04, recliner ? 0.76 : 0.7, 0.19, 3, 0.08),
    armL: new RoundedBoxGeometry(0.11, 0.18, recliner ? 0.72 : 0.52, 2, 0.05),
    armR: new RoundedBoxGeometry(0.11, 0.18, recliner ? 0.72 : 0.52, 2, 0.05),
  };
  if (recliner) g.foot = new RoundedBoxGeometry(w * 0.94, 0.14, 0.42, 2, 0.06);
  geomCache.set(key, g);
  return g;
}

function setSeatMaterial(seat, mat) {
  for (const m of seat.meshes) m.material = mat;
}

function refreshSeat(seat) {
  if (seat === selected) setSeatMaterial(seat, matSelected);
  else if (seat.taken) setSeatMaterial(seat, matTaken);
  else if (seat.recliner) setSeatMaterial(seat, matRecl);
  else if (seat === hovered) setSeatMaterial(seat, matHover);
  else setSeatMaterial(seat, matAvail);
}

function buildSeat(seat) {
  const group = new THREE.Group();
  group.position.set(seat.x, 0, seat.z);
  group.rotation.y = seat.rot;

  const geoms = seatGeoms(seat.w, seat.recliner);
  const armX = seat.w / 2 + 0.055;

  const parts = [
    [geoms.cushion, 0, 0.42, -0.02, 0],
    [geoms.back, 0, seat.recliner ? 0.74 : 0.68, 0.24, 0.09],
    [geoms.armL, -armX, 0.53, 0.02, 0],
    [geoms.armR, armX, 0.53, 0.02, 0],
  ];
  if (seat.recliner) parts.push([geoms.foot, 0, 0.34, -0.6, 0]);

  for (const [geo, x, y, z, rx] of parts) {
    const mesh = new THREE.Mesh(geo, matAvail);
    mesh.position.set(x, y, z);
    if (rx) mesh.rotation.x = rx;
    mesh.userData.seat = seat;
    group.add(mesh);
    seat.meshes.push(mesh);
  }

  scene.add(group);
  seat.group = group;
  refreshSeat(seat);
}

seats.forEach(buildSeat);
const pickMeshes = seats.flatMap((s) => s.meshes);

/* ------------------------------------------------------------------ */
/* cinema screen                                                      */
/* ------------------------------------------------------------------ */
// Real still from 《生日快乐》(2026). Drawn onto a canvas first so the projection
// vignette and grain match the room, and so a missing file still yields black.
function stillTexture() {
  const W = 1680, H = 785;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const img = new Image();
  img.onload = () => {
    const scale = Math.max(W / img.width, H / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);

    // projection falloff in the corners
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.66);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);

    const rnd = mulberry32(77);
    for (let i = 0; i < 2600; i++) {
      const a = rnd() * 0.045;
      g.fillStyle = rnd() > 0.5 ? `rgba(255,248,236,${a})` : `rgba(20,14,10,${a})`;
      g.fillRect(rnd() * W, rnd() * H, 1.2, 1.2);
    }
    tex.needsUpdate = true;
  };
  img.src = 'assets/screen-still.jpg';
  return tex;
}

let screenSurface = null;

function buildScreen() {
  const geo = new THREE.PlaneGeometry(SCREEN_W, SCREEN_H, 64, 8);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, SCREEN_CURVE * Math.pow(x / (SCREEN_W / 2), 2));
  }
  geo.computeVertexNormals();

  const screenMat = new THREE.MeshBasicMaterial({
    map: stillTexture(), toneMapped: false,
    transparent: true, opacity: 0, depthWrite: false,
  });
  const screen = new THREE.Mesh(geo, screenMat);
  screen.position.set(0, SCREEN_Y, SCREEN_Z);
  scene.add(screen);
  screenSurface = screenMat;

  // glowing top rim — reads as the arc in the overhead map
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const x = -SCREEN_W / 2 + (SCREEN_W * i) / 48;
    pts.push(new THREE.Vector3(x, SCREEN_H / 2 + 0.03, SCREEN_CURVE * Math.pow(x / (SCREEN_W / 2), 2) + 0.01));
  }
  const rim = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.018, 6, false),
    new THREE.MeshBasicMaterial({ color: 0xfff6e8, toneMapped: false })
  );
  rim.position.set(0, SCREEN_Y, SCREEN_Z);
  scene.add(rim);

  const halo = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.06, 6, false),
    new THREE.MeshBasicMaterial({
      color: 0xffe9cc, transparent: true, opacity: 0.26,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    })
  );
  halo.position.set(0, SCREEN_Y, SCREEN_Z);
  scene.add(halo);
}
buildScreen();

/* ------------------------------------------------------------------ */
/* row letters + selected seat number                                 */
/* ------------------------------------------------------------------ */
function labelTexture(text, { color = '#7d766b', size = 92, weight = 500 } = {}) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.font = `${weight} ${size}px 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif`;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const rowLabels = [];
const labelX = Math.min(...seats.map((s) => s.x)) - 1.05;
for (const rowId of ROWS) {
  const rowSeats = seats.filter((s) => s.rowId === rowId);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: labelTexture(rowId), transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
  }));
  sprite.position.set(labelX, 0.22, rowSeats[0].z);
  sprite.scale.set(0.7, 0.7, 1);
  sprite.renderOrder = 2;
  scene.add(sprite);
  rowLabels.push(sprite);
}
const layoutHalfW = Math.max(...seats.map((s) => Math.abs(s.x)));

const numSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: labelTexture('4', { color: '#082014', size: 108, weight: 600 }),
  transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
}));
numSprite.scale.set(0.42, 0.42, 1);
numSprite.position.y = 0.52;
numSprite.visible = false;
scene.add(numSprite);

/* ------------------------------------------------------------------ */
/* room                                                               */
/* ------------------------------------------------------------------ */
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0x0b0908, roughness: 0.96, metalness: 0 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, 0, 3);
scene.add(floor);

const backWall = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 14),
  new THREE.MeshStandardMaterial({ color: 0x080706, roughness: 1 })
);
backWall.position.set(0, 7, LAST_ROW_Z + 3.2);
backWall.rotation.y = Math.PI;
scene.add(backWall);

for (const side of [-1, 1]) {
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 14),
    new THREE.MeshStandardMaterial({ color: 0x070605, roughness: 1 })
  );
  wall.position.set(side * 9.5, 7, 2);
  wall.rotation.y = side * -Math.PI / 2;
  scene.add(wall);
}

/* ------------------------------------------------------------------ */
/* lights                                                             */
/* ------------------------------------------------------------------ */
scene.add(new THREE.AmbientLight(0xffe9d2, 0.5));
const hemi = new THREE.HemisphereLight(0x4b3d31, 0x070505, 0.42);
scene.add(hemi);

const topLight = new THREE.DirectionalLight(0xfff0dc, 1.05);
topLight.position.set(2, 30, 6);
scene.add(topLight);

// soft wash from the screen that also lifts the rear rows in seat view
const mapWash = new THREE.SpotLight(0xffd8ae, 220, 34, 0.42, 0.85, 1.6);
mapWash.position.set(0, 12, SCREEN_Z + 1.2);
mapWash.target.position.set(0, 0, 2.5);
scene.add(mapWash, mapWash.target);

const screenLight = new THREE.PointLight(0xffd0a0, 34, 22, 2);
screenLight.position.set(0, SCREEN_Y + 0.4, SCREEN_Z + 1.6);
scene.add(screenLight);

const fillLight = new THREE.PointLight(0xffa46a, 12, 18, 2);
fillLight.position.set(0, 4.5, LAST_ROW_Z + 2.5);
scene.add(fillLight);

/* ------------------------------------------------------------------ */
/* selection glow                                                     */
/* ------------------------------------------------------------------ */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  r.addColorStop(0, 'rgba(120,255,190,0.55)');
  r.addColorStop(0.4, 'rgba(92,230,161,0.22)');
  r.addColorStop(1, 'rgba(92,230,161,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const glow = new THREE.Mesh(
  new THREE.PlaneGeometry(3.4, 3.4),
  new THREE.MeshBasicMaterial({
    map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, opacity: 0.9, toneMapped: false,
  })
);
glow.rotation.x = -Math.PI / 2;
glow.position.y = 0.04;
glow.visible = false;
scene.add(glow);

/* ------------------------------------------------------------------ */
/* camera poses                                                       */
/* ------------------------------------------------------------------ */
// A pose is kept as look-at parameters rather than a quaternion: the overhead map
// rolls the camera 90° (up = -Z) while the seat view keeps it upright, and slerping
// between those two quaternions swings the camera off into empty space mid-flight.
function poseAt(pos, target, up, fov) {
  return {
    pos: pos.clone(),
    target: target.clone(),
    up: up.clone().normalize(),
    fov,
  };
}

function applyPose(pose) {
  camera.position.copy(pose.pos);
  camera.up.copy(pose.up);
  camera.lookAt(pose.target);
  camera.fov = pose.fov;
  camera.updateProjectionMatrix();
  basePose = pose;
}

const MAP_FOV = 32;
const MAP_TILT = 11; // degrees away from straight-down

function mapPose() {
  const cz = (SCREEN_Z + LAST_ROW_Z) / 2 + 0.1;
  const target = new THREE.Vector3(0, 0, cz);
  const dir = new THREE.Vector3(0, Math.cos(rad(MAP_TILT)), Math.sin(rad(MAP_TILT)));

  const halfW = layoutHalfW + 0.4;
  const probes = [
    // the screen arc must sit clear of the showtime chips
    new THREE.Vector3(0, SCREEN_Y + SCREEN_H / 2, SCREEN_Z),
    new THREE.Vector3(-SCREEN_W / 2.4, SCREEN_Y + SCREEN_H / 2 - 0.6, SCREEN_Z),
    new THREE.Vector3(SCREEN_W / 2.4, SCREEN_Y + SCREEN_H / 2 - 0.6, SCREEN_Z),
    // seats, plus the gutters that hold row letters
    new THREE.Vector3(-halfW - 0.9, 0.2, FIRST_ROW_Z),
    new THREE.Vector3(halfW, 0.2, FIRST_ROW_Z),
    new THREE.Vector3(-halfW - 0.9, 0.2, LAST_ROW_Z),
    new THREE.Vector3(halfW, 0.2, LAST_ROW_Z),
  ];

  const tester = new THREE.PerspectiveCamera(MAP_FOV, camera.aspect, 0.1, 400);
  const v = new THREE.Vector3();
  const fits = (dist) => {
    tester.position.copy(target).addScaledVector(dir, dist);
    tester.up.set(0, 0, -1);
    tester.lookAt(target);
    tester.updateMatrixWorld();
    tester.updateProjectionMatrix();
    for (const p of probes) {
      v.copy(p).project(tester);
      if (Math.abs(v.x) > 0.9 || Math.abs(v.y) > 0.86) return false;
    }
    return true;
  };

  let lo = 4, hi = 260;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid; else lo = mid;
  }

  const pos = target.clone().addScaledVector(dir, hi);
  return poseAt(pos, target, new THREE.Vector3(0, 0, -1), MAP_FOV);
}

function seatPose(seat) {
  // float just behind and above the chosen seat so it stays visible as the green marker
  const eye = new THREE.Vector3(seat.x, EYE_Y + 0.28, seat.z + (seat.recliner ? 1.46 : 1.3));
  const target = new THREE.Vector3(0, SCREEN_Y - 0.1, SCREEN_Z);
  const dist = Math.hypot(seat.x - centreX, eye.z - SCREEN_Z);
  // frame the screen like the reference: wide-angle, its width fills the viewport
  const screenAngle = (2 * Math.atan((SCREEN_W / 2) / dist) * 180) / Math.PI;
  const hfov = clamp(screenAngle * 1.06, 40, 88);
  const vfov = clamp(
    (2 * Math.atan(Math.tan(rad(hfov / 2)) / camera.aspect) * 180) / Math.PI,
    46,
    128
  );
  // aim slightly under the screen centre so it sits high in frame, seats below
  target.y -= clamp(dist * 0.13, 0, 1.6);
  return poseAt(eye, target, new THREE.Vector3(0, 1, 0), vfov);
}

function flyTo(pose, duration, onDone) {
  const p0 = camera.position.clone();
  const p2 = pose.pos.clone();
  const t0 = basePose ? basePose.target.clone() : pose.target.clone();

  // arcing over seat backs keeps the dolly from clipping through geometry, and a
  // control point well above both ends reads as a descent into the auditorium
  const ctrl = new THREE.Vector3(
    (p0.x + p2.x) * 0.5,
    Math.max(p0.y, p2.y) * 1.06 + 2.2,
    (p0.z + p2.z) * 0.5 - 1.4
  );

  anim = {
    start: performance.now(),
    duration,
    curve: new THREE.QuadraticBezierCurve3(p0, ctrl, p2),
    from: {
      target: t0,
      up: camera.up.clone(),
      fov: camera.fov,
    },
    to: {
      target: pose.target.clone(),
      up: pose.up.clone(),
      fov: pose.fov,
    },
    mixFrom: seatMix,
    mixTo: mode === 'seat' ? 1 : 0,
    onDone,
  };
}

/* ------------------------------------------------------------------ */
/* seat state                                                         */
/* ------------------------------------------------------------------ */
function refreshAllSeats() {
  seats.forEach(refreshSeat);
}

function rollAvailability(seed) {
  const rnd = mulberry32(seed);
  for (const row of ROWS) {
    let prevTaken = false;
    for (const seat of seats) {
      if (seat.rowId !== row) continue;
      const base = seat.recliner ? 0.24 : 0.13;
      const p = base + (prevTaken ? 0.34 : 0);
      seat.taken = rnd() < p;
      prevTaken = seat.taken;
    }
  }
}

function selectSeat(seat) {
  if (!seat || seat.taken) return;
  if (selected) {
    const prev = selected;
    selected = null;
    refreshSeat(prev);
  }
  selected = seat;
  refreshSeat(seat);

  glow.visible = true;
  glow.position.set(seat.x, 0.04, seat.z);

  numSprite.material.map.dispose();
  numSprite.material.map = labelTexture(String(seat.num), { color: '#082014', size: 108, weight: 600 });
  numSprite.material.needsUpdate = true;
  numSprite.position.set(seat.x, 0.52, seat.z);
  numSprite.visible = true;

  updateBottomBar();
  drawMinimap();
}

function clearSelection() {
  if (selected) {
    const prev = selected;
    selected = null;
    refreshSeat(prev);
  }
  hovered = null;
  glow.visible = false;
  numSprite.visible = false;
  updateBottomBar();
}

function updateBottomBar() {
  if (!selected) {
    el.bbEyebrow.textContent = '请选择座位';
    el.bbDetail.textContent = '';
    el.continueBtn.disabled = true;
  } else {
    el.bbEyebrow.textContent = `${selected.rowId}排 · ${selected.num}座`;
    el.bbDetail.textContent = yuan(priceOf(selected));
    el.continueBtn.disabled = false;
  }
}

function priceOf(seat) {
  return seat.recliner ? PRICE.recliner : PRICE.standard;
}

function seatStats(seat) {
  const dist = Math.hypot(seat.x - centreX, seat.z - SCREEN_Z);
  const fov = Math.round((2 * Math.atan((SCREEN_W / 2) / dist) * 180) / Math.PI);
  const off = Math.abs(seat.x - centreX);
  return { dist, fov, off };
}

function applyCardData(seat) {
  const { dist, fov, off } = seatStats(seat);
  const label = dist < 8 ? '近距观影' : dist < 11.2 ? '黄金视角' : '全景观影';
  el.cardLabel.textContent = label;
  el.cardTitle.textContent = `${seat.rowId}排 ${seat.num}座`;
  el.cardSub.textContent = `${seat.recliner ? '躺椅座' : '标准座'} · ${yuan(priceOf(seat))}`;
  el.statDist.textContent = `${dist.toFixed(1)} 米`;
  el.statFov.textContent = `${fov}°`;
  el.statOffset.textContent = off < 0.05 ? '0.0 米' : `${off.toFixed(1)} 米`;
  el.statOffsetLabel.textContent = off < 0.05 ? '正中' : seat.x < 0 ? '偏左' : '偏右';
  el.viewPillText.textContent = `${seat.rowId}${seat.num}座视角`;
  el.bookBtn.textContent = `确认购票 · ${yuan(priceOf(seat))}`;
}

/* ------------------------------------------------------------------ */
/* minimap (2d)                                                       */
/* ------------------------------------------------------------------ */
function drawMinimap() {
  const c = el.minimap;
  const W = c.width, H = c.height;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);

  const x0 = -6.2, x1 = 6.2;
  const z0 = SCREEN_Z - 1.2, z1 = LAST_ROW_Z + 1.0;
  const padX = 10, padTop = 18, padBottom = 8;
  const mx = (x) => padX + ((x - x0) / (x1 - x0)) * (W - padX * 2);
  const my = (z) => padTop + ((z - z0) / (z1 - z0)) * (H - padTop - padBottom);

  // screen arc
  g.strokeStyle = 'rgba(255,245,230,0.5)';
  g.lineWidth = 1.4;
  g.beginPath();
  const arc = [];
  for (let i = 0; i <= 20; i++) {
    const x = -SCREEN_W / 2 + (SCREEN_W * i) / 20;
    arc.push([x, SCREEN_Z + SCREEN_CURVE * Math.pow(x / (SCREEN_W / 2), 2)]);
  }
  arc.forEach(([x, z], i) => {
    const px = mx(x), py = my(z);
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  });
  g.stroke();

  for (const seat of seats) {
    const px = mx(seat.x), py = my(seat.z);
    let color = '#4a463f';
    if (seat.taken) color = '#2a2724';
    else if (seat.recliner) color = '#5f3337';
    const wpx = seat.w * (W - padX * 2) / (x1 - x0) * 0.72;
    if (seat === selected) {
      g.fillStyle = '#5ce6a1';
      g.shadowColor = 'rgba(92,230,161,0.9)';
      g.shadowBlur = 8;
    } else {
      g.fillStyle = color;
      g.shadowBlur = 0;
    }
    g.beginPath();
    const hpx = seat.recliner ? 3.4 : 2.7;
    g.roundRect(px - wpx / 2, py - hpx / 2, wpx, hpx, 1.2);
    g.fill();
    g.shadowBlur = 0;
  }
}

/* ------------------------------------------------------------------ */
/* showtime chips                                                     */
/* ------------------------------------------------------------------ */
function renderTimes() {
  el.times.innerHTML = '';
  TIMES.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = 'time' + (i === activeTime ? ' active' : '');
    b.innerHTML = `<b>${t.label}</b><span>${t.fmt}</span>`;
    b.addEventListener('click', () => {
      if (i === activeTime || mode !== 'map' || anim) return;
      activeTime = i;
      renderTimes();
      clearSelection();
      rollAvailability(TIMES[i].seed);
      refreshAllSeats();
      drawMinimap();
    });
    el.times.appendChild(b);
  });
}

/* ------------------------------------------------------------------ */
/* transitions                                                        */
/* ------------------------------------------------------------------ */
function enterSeatView(seat) {
  if (!seat || anim) return;
  applyCardData(seat);
  drawMinimap();
  mode = 'seat';
  document.body.dataset.mode = 'seat';
  glow.visible = false;
  numSprite.visible = false;
  flyTo(seatPose(seat), 1550, () => {
    applyPose(seatPose(seat));
  });
}

function backToMap() {
  if (anim) return;
  mode = 'map';
  document.body.dataset.mode = 'map';
  if (selected) {
    glow.visible = true;
    numSprite.visible = true;
  }
  flyTo(mapPose(), 1200, () => {
    applyPose(mapPose());
  });
}

function jumpToSeatView(seat) {
  selectSeat(seat);
  applyCardData(seat);
  mode = 'seat';
  document.body.dataset.mode = 'seat';
  seatMix = 1;
  applyModeColors(1);
  applyPose(seatPose(seat));
  drawMinimap();
  glow.visible = false;
  numSprite.visible = false;
}

/* ------------------------------------------------------------------ */
/* input                                                              */
/* ------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pickSeat(clientX, clientY) {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(pickMeshes, false);
  return hits.length ? hits[0].object.userData.seat : null;
}

let downX = 0, downY = 0, downT = 0;

canvas.addEventListener('pointerdown', (e) => {
  downX = e.clientX; downY = e.clientY; downT = performance.now();
});

canvas.addEventListener('pointerup', (e) => {
  if (mode !== 'map' || anim) return;
  const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
  if (moved > 9 || performance.now() - downT > 700) return;
  const seat = pickSeat(e.clientX, e.clientY);
  if (seat) selectSeat(seat);
});

let lastHover = 0;
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' || mode !== 'map' || anim) return;
  const now = performance.now();
  if (now - lastHover < 40) return;
  lastHover = now;

  const seat = pickSeat(e.clientX, e.clientY);
  if (seat === hovered) return;
  const prev = hovered;
  hovered = null;
  if (prev && prev !== selected) refreshSeat(prev);
  if (seat && !seat.taken && seat !== selected) {
    hovered = seat;
    refreshSeat(seat);
  }
  canvas.style.cursor = seat && !seat.taken ? 'pointer' : 'default';
});

canvas.addEventListener('pointerleave', () => {
  if (hovered) {
    const prev = hovered;
    hovered = null;
    refreshSeat(prev);
  }
});

el.continueBtn.addEventListener('click', () => {
  if (!selected || mode !== 'map') return;
  enterSeatView(selected);
});

el.changeSeat.addEventListener('click', backToMap);
el.backSeat.addEventListener('click', backToMap);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (mode === 'seat') backToMap();
    else clearSelection();
  } else if (e.key === 'Enter' && mode === 'map' && selected) {
    enterSeatView(selected);
  }
});

el.bookBtn.addEventListener('click', () => {
  const original = el.bookBtn.textContent;
  el.bookBtn.textContent = '已出票 ✓';
  el.bookBtn.disabled = true;
  setTimeout(() => {
    el.bookBtn.textContent = original;
    el.bookBtn.disabled = false;
  }, 1400);
});

/* ------------------------------------------------------------------ */
/* layout / resize                                                    */
/* ------------------------------------------------------------------ */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (!anim) {
    if (mode === 'seat' && selected) applyPose(seatPose(selected));
    else applyPose(mapPose());
  }
  drawMinimap();
}
window.addEventListener('resize', resize);

/* ------------------------------------------------------------------ */
/* loop                                                               */
/* ------------------------------------------------------------------ */
const hintWorld = new THREE.Vector3(0, 0, SCREEN_Z + 1.45);
const hintProjected = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const lookUp = new THREE.Vector3();

function placeScreenHint() {
  hintProjected.copy(hintWorld).project(camera);
  const x = (hintProjected.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-hintProjected.y * 0.5 + 0.5) * window.innerHeight;
  el.screenHint.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
}

function tick(now) {
  requestAnimationFrame(tick);

  if (anim) {
    const k = clamp((now - anim.start) / anim.duration, 0, 1);
    const ep = easeInOutCubic(k);
    const ea = easeInOutCubic(clamp((k - 0.1) / 0.9, 0, 1));

    camera.position.copy(anim.curve.getPoint(ep));
    lookTarget.lerpVectors(anim.from.target, anim.to.target, ea);
    lookUp.lerpVectors(anim.from.up, anim.to.up, ea).normalize();
    camera.up.copy(lookUp);
    camera.lookAt(lookTarget);
    camera.fov = lerp(anim.from.fov, anim.to.fov, easeInOutCubic(clamp(k * 0.9 + 0.05, 0, 1)));
    camera.updateProjectionMatrix();

    seatMix = lerp(anim.mixFrom, anim.mixTo, easeInOutCubic(clamp((k - 0.02) / 0.62, 0, 1)));
    applyModeColors(seatMix);

    if (k >= 1) {
      const done = anim.onDone;
      anim = null;
      if (done) done();
    }
  } else if (basePose) {
    // deliberately static: any sub-pixel camera drift makes the high-contrast
    // seat edges shimmer frame to frame, which reads as flickering
    camera.position.copy(basePose.pos);
    camera.up.copy(basePose.up);
    camera.lookAt(basePose.target);
    camera.fov = basePose.fov;
    camera.updateProjectionMatrix();
  }

  placeScreenHint();
  screenLight.intensity = lerp(4, 34, seatMix);

  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ */
/* boot                                                               */
/* ------------------------------------------------------------------ */
renderTimes();
rollAvailability(TIMES[activeTime].seed);
refreshAllSeats();
applyModeColors(0);
resize();
applyPose(mapPose());
drawMinimap();
requestAnimationFrame(tick);

/* deep links for demos / testing: ?seat=B4&view=seat */
const params = new URLSearchParams(location.search);
const seatCode = params.get('seat');
if (seatCode) {
  const seat = seatByCode.get(seatCode.toUpperCase());
  if (seat && !seat.taken) {
    if (params.get('view') === 'seat') jumpToSeatView(seat);
    else selectSeat(seat);
  }
}

window.__demo = {
  seats, seatByCode, selectSeat, enterSeatView, backToMap, jumpToSeatView, refreshAllSeats,
  camera, cameraPose: () => ({ p: camera.position.toArray(), fov: camera.fov, aspect: camera.aspect }),
  proj: (x, y, z) => new THREE.Vector3(x, y, z).project(camera).toArray(),
  pick: pickSeat,
};
