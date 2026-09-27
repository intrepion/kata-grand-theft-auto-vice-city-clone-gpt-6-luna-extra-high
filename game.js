import * as THREE from 'three';

const canvas = document.querySelector('#game');
const stage = document.querySelector('#stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#eea18d');
scene.fog = new THREE.FogExp2('#eea18d', 0.0085);
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 230);
const timer = new THREE.Timer();
timer.connect(document);
const ROAD = 6.8;
const roadX = [-48, -24, 0, 24, 48];
const roadZ = [-36, -12, 12, 36, 60];
const world = { minX: -66, maxX: 66, minZ: -54, maxZ: 70 };
const keys = new Set();
const tappedKeys = new Set();
const controlKeys = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ']);
const obstacles = [];
const traffic = [];
const police = [];
const buildingColors = ['#edc993', '#dfaa9a', '#9bb8b1', '#c5b8ce', '#e1d0a7', '#a7c2cb', '#d8b2b3'];
const carColors = ['#e8b849', '#df6577', '#62aaa5', '#6488b5', '#e9dfc2', '#a9729c', '#d7784b', '#649276'];
const materialCache = new Map();

const state = {
  cash: 250, health: 100, heat: 0, paused: false, driving: null,
  camYaw: 0, camOrbit: 0, camPitch: 0.48, camDistance: 8.6,
  cameraReturnDelay: 0, cameraTravelReverse: false,
  cameraManualLook: false, walkingInputActive: false, collisionWait: 0, hitWait: 0,
  toastTimer: 0, lastCrime: 0, elapsed: 0,
  job: { phase: 'pickup', from: { x: -24, z: -29, name: 'Ocean Drive' }, to: { x: 24, z: 17, name: 'Little Havana' }, reward: 350 }
};

function material(color, extra = {}) {
  const key = `${color}:${JSON.stringify(extra)}`;
  if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.78, ...extra }));
  return materialCache.get(key);
}

function box(parent, width, height, depth, color, x, y, z, options = {}) {
  const surface = options.material?.isMaterial ? options.material : material(color, options.material || {});
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), surface);
  mesh.position.set(x, y, z);
  mesh.castShadow = options.cast ?? true;
  mesh.receiveShadow = options.receive ?? true;
  parent.add(mesh);
  return mesh;
}

function cylinder(parent, top, bottom, height, color, x, y, z, segments = 9, options = {}) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, segments), material(color, options.material || {}));
  mesh.position.set(x, y, z);
  mesh.castShadow = options.cast ?? true;
  mesh.receiveShadow = options.receive ?? true;
  parent.add(mesh);
  return mesh;
}

function flat(parent, width, depth, color, x, y, z, options = {}) {
  return box(parent, width, options.height || 0.08, depth, color, x, y, z, options);
}

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

const hemi = new THREE.HemisphereLight('#fff0d3', '#647f70', 2.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffe0ad', 3.1);
sun.position.set(-32, 48, -8);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.camera.left = -65;
sun.shadow.camera.right = 65;
sun.shadow.camera.top = 65;
sun.shadow.camera.bottom = -65;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 150;
sun.shadow.bias = -0.0003;
scene.add(sun);
scene.add(sun.target);
const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(5.3, 24, 16), new THREE.MeshBasicMaterial({ color: '#ffd092' }));
sunDisc.position.set(-44, 19, -82);
scene.add(sunDisc);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 240), material('#91a98a'));
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.12, 5);
ground.receiveShadow = true;
scene.add(ground);

function addPalm(x, z, scale = 1, parent = scene) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);
  parent.add(group);
  cylinder(group, 0.17, 0.26, 4.1, '#896847', 0, 2.05, 0, 8);
  const crown = new THREE.Vector3(0, 4.05, 0);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4 + 0.2;
    const length = 2.55 + (i % 3) * 0.16;
    const outward = new THREE.Vector3(Math.sin(angle), -0.27 + (i % 2) * 0.06, Math.cos(angle)).normalize();
    const center = crown.clone().addScaledVector(outward, length * 0.5);
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.27, length, 7), material(i % 2 ? '#3d7355' : '#4d865a'));
    frond.position.copy(center);
    frond.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward.clone().negate());
    frond.castShadow = true;
    group.add(frond);
  }
  return group;
}

function addPark(left, right, top, bottom, seed) {
  const width = right - left, depth = bottom - top, cx = (left + right) / 2, cz = (top + bottom) / 2;
  flat(scene, width, depth, '#638d69', cx, 0.01, cz);
  flat(scene, width * 0.78, 1.5, '#c6b486', cx, 0.07, cz);
  flat(scene, 1.5, depth * 0.72, '#c6b486', cx, 0.08, cz);
  const random = rng(seed * 31 + 9);
  for (let i = 0; i < 9; i++) {
    addPalm(left + 1.5 + random() * (width - 3), top + 1.5 + random() * (depth - 3), 0.73 + random() * 0.17);
  }
  const bench = new THREE.Group(); bench.position.set(cx - 3, 0, cz + 2); scene.add(bench);
  box(bench, 1.7, 0.18, 0.5, '#bd8760', 0, 0.7, 0);
  box(bench, 1.65, 0.65, 0.14, '#9e694f', 0, 1.0, -0.18);
  for (const x of [-0.62, 0.62]) cylinder(bench, 0.06, 0.07, 0.7, '#364545', x, 0.35, 0, 7);
}

function makeSignTexture(title, subtitle, color = '#ff5b8c') {
  const sign = document.createElement('canvas'); sign.width = 512; sign.height = 128;
  const g = sign.getContext('2d');
  g.fillStyle = '#17262d'; g.fillRect(0, 0, sign.width, sign.height);
  g.strokeStyle = color; g.lineWidth = 9; g.strokeRect(6, 6, sign.width - 12, sign.height - 12);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 48px Outfit, sans-serif'; g.fillStyle = '#fff1d3'; g.fillText(title, 256, 55);
  g.font = '500 19px "DM Mono", monospace'; g.fillStyle = color; g.fillText(subtitle, 256, 98);
  const texture = new THREE.CanvasTexture(sign);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addBuilding(x, z, width, depth, height, color, style, seed) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  scene.add(group);
  box(group, width + 0.28, 0.3, depth + 0.28, '#c1ad88', 0, 0.16, 0);
  box(group, width, height, depth, color, 0, height / 2 + 0.32, 0);
  box(group, width + 0.12, 0.27, depth + 0.12, style === 1 ? '#fbdec0' : '#d8c39a', 0, height + 0.34, 0);
  box(group, width * 0.72, 0.09, depth * 0.72, style === 2 ? '#7b9b98' : '#8b8877', 0, height + 0.53, 0);

  // Flat rooftop air-conditioning units, parapets, and water tanks add depth at street level.
  if (height > 8) {
    for (let i = 0; i < 2 + (seed % 2); i++) {
      box(group, 1.05, 0.65, 0.78, '#89908a', -width * 0.22 + i * 1.3, height + 0.91, -depth * 0.12);
      box(group, 1.12, 0.08, 0.84, '#c2c1ad', -width * 0.22 + i * 1.3, height + 1.27, -depth * 0.12);
    }
  }
  if (seed % 4 === 0) {
    cylinder(group, 0.56, 0.72, 1.9, '#c49a74', width * 0.28, height + 1.34, -depth * 0.23, 10);
  }

  const glass = material(style === 0 ? '#527b82' : style === 1 ? '#557779' : '#637d82', { roughness: 0.34, metalness: 0.12, emissive: '#29424a', emissiveIntensity: 0.12 });
  const warmGlass = material('#dfbb80', { roughness: 0.38, emissive: '#bd7e48', emissiveIntensity: 0.11 });
  const floors = Math.max(1, Math.floor((height - 1.8) / 2.2));
  const bays = Math.max(2, Math.floor((width - 1.3) / 1.7));
  for (let floor = 0; floor < floors; floor++) {
    const wy = 1.12 + floor * 2.15;
    for (let bay = 0; bay < bays; bay++) {
      const wx = -width / 2 + 0.92 + bay * ((width - 1.5) / Math.max(1, bays - 1));
      const paneMat = (bay + floor + seed) % 5 === 0 ? warmGlass : glass;
      box(group, 0.74, 0.82, 0.075, paneMat.color, wx, wy, depth / 2 + 0.065, { cast: false, material: paneMat });
    }
  }

  if (depth > 7) {
    for (let floor = 0; floor < Math.min(4, floors); floor++) {
      const wy = 1.2 + floor * 2.12;
      for (const side of [-1, 1]) {
        box(group, 0.065, 0.96, 0.88, '#527b82', side * (width / 2 + 0.04), wy, -depth * 0.22 + floor * 0.02, { cast: false });
      }
    }
  }

  // Ground-floor storefront and optional illuminated hotel/club sign.
  box(group, width * 0.76, 1.22, 0.12, '#f4d7a6', 0, 0.98, depth / 2 + 0.09, { cast: false });
  box(group, width * 0.64, 0.76, 0.17, '#467982', 0, 0.88, depth / 2 + 0.17, { cast: false, material: glass });
  if (seed % 3 === 0 || seed % 5 === 0) {
    const title = seed % 5 === 0 ? 'OCEAN HOTEL' : seed % 2 === 0 ? 'PALM CLUB' : 'HOTEL AZUL';
    const signMat = new THREE.MeshBasicMaterial({ map: makeSignTexture(title, 'COCKTAILS · MUSIC · 1986'), toneMapped: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(width - 0.6, 7.5), 1.72), signMat);
    sign.position.set(0, Math.min(height - 0.35, 4.4), depth / 2 + 0.22);
    group.add(sign);
    const glow = new THREE.PointLight('#ff5b89', 4.2, 10, 2);
    glow.position.set(0, Math.min(height - 0.6, 4.3), depth / 2 + 0.8);
    group.add(glow);
  }
  obstacles.push({ x: x - width / 2 - 0.35, z: z - depth / 2 - 0.35, w: width + 0.7, d: depth + 0.7 });
  return group;
}

function addPool(x, z, width = 6.5, depth = 4.1) {
  flat(scene, width + 1.2, depth + 1.2, '#d8c29a', x, 0.03, z);
  flat(scene, width, depth, '#42b8b3', x, 0.08, z);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.5, depth - 0.5), new THREE.MeshStandardMaterial({ color: '#74d4c8', roughness: 0.18, metalness: 0.12, transparent: true, opacity: 0.86 }));
  water.rotation.x = -Math.PI / 2; water.position.set(x, 0.16, z); scene.add(water);
  flat(scene, width * 0.6, 0.09, '#deefe0', x, 0.19, z + 0.2, { height: 0.025, cast: false, receive: false });
}

function makeStreetLamp(x, z, rotation = 0) {
  const group = new THREE.Group(); group.position.set(x, 0, z); group.rotation.y = rotation; scene.add(group);
  cylinder(group, 0.09, 0.14, 4.5, '#38464b', 0, 2.25, 0, 8);
  cylinder(group, 0.055, 0.075, 1.35, '#38464b', 0.39, 4.36, 0, 8).rotation.z = Math.PI / 2;
  box(group, 0.62, 0.16, 0.36, '#344247', 1.0, 4.3, 0);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffd28c' }));
  lamp.position.set(1.0, 4.16, 0); group.add(lamp);
}

function addUmbrella(x, z, color) {
  cylinder(scene, 0.025, 0.035, 1.8, '#a38b68', x, 0.9, z, 6, { cast: false });
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.58, 10), material(color));
  cap.position.set(x, 1.95, z);
  cap.castShadow = true; scene.add(cap);
  cylinder(scene, 0.14, 0.2, 0.36, '#e4d4b0', x, 0.2, z, 8, { cast: false });
}

function buildWorld() {
  // Atlantic, sand, and a low seawall on the west edge.
  flat(scene, 56, 210, '#258b91', -94, -0.04, 4, { height: 0.1, receive: false });
  flat(scene, 10, 210, '#d7c08f', -61, 0.0, 4, { height: 0.14 });
  flat(scene, 0.48, 210, '#ebe0ba', -55.7, 0.23, 4, { height: 0.48 });
  flat(scene, 1.5, 210, '#b49c76', -54.7, 0.13, 4, { height: 0.26 });
  for (let i = 0; i < 39; i++) {
    const z = -96 + i * 5;
    const ripple = box(scene, 0.045, 0.015, 1.1 + (i % 3) * 0.35, i % 2 ? '#58b1a6' : '#75c1af', -102 + (i % 7) * 2.6, 0.04, z, { cast: false, receive: false, material: { transparent: true, opacity: 0.46 } });
    ripple.userData.baseX = ripple.position.x;
    ripple.userData.phase = i * 0.78;
    ripple.name = 'ocean-ripple';
  }
  for (let z = -48; z <= 66; z += 14) addPalm(-58.5, z, 0.92);
  for (let z = -45; z <= 61; z += 11) addUmbrella(-63.7 + (z % 3) * 0.55, z, ['#f6d779', '#ff6b93', '#75c9bd'][Math.abs(z / 11) % 3 | 0]);

  // Broad asphalt boulevards, pale sidewalks, medians, and painted crossings.
  for (const x of roadX) {
    flat(scene, ROAD, 170, '#555d5e', x, 0.02, 6, { height: 0.12 });
    for (const side of [-1, 1]) {
      flat(scene, 1.45, 170, '#c4b38e', x + side * 4.05, 0.04, 6, { height: 0.18 });
      flat(scene, 0.13, 170, '#8e9085', x + side * 3.24, 0.12, 6, { height: 0.06, cast: false });
    }
    for (let z = -78; z <= 86; z += 4.5) flat(scene, 0.13, 1.85, '#d5bd7d', x, 0.1, z, { height: 0.035, cast: false, receive: false });
    for (let z = -56; z <= 70; z += 22) {
      makeStreetLamp(x - 4.9, z, 0);
      makeStreetLamp(x + 4.9, z + 10, Math.PI);
    }
  }
  for (const z of roadZ) {
    flat(scene, 160, ROAD, '#555d5e', 0, 0.03, z, { height: 0.13 });
    for (const side of [-1, 1]) {
      flat(scene, 160, 1.45, '#c4b38e', 0, 0.05, z + side * 4.0, { height: 0.18 });
      flat(scene, 160, 0.13, '#8e9085', 0, 0.12, z + side * 3.2, { height: 0.06, cast: false });
    }
    for (let x = -72; x <= 72; x += 4.5) flat(scene, 1.85, 0.13, '#d5bd7d', x, 0.1, z, { height: 0.035, cast: false, receive: false });
  }
  for (const x of roadX) for (const z of roadZ) {
    for (let i = -3; i <= 3; i++) {
      flat(scene, 0.34, 2.3, '#eee5ce', x - ROAD / 2 + 0.8 + i * 0.78, 0.11, z - ROAD / 2 - 0.5, { height: 0.04, cast: false });
      flat(scene, 2.3, 0.34, '#eee5ce', x + ROAD / 2 + 0.5, 0.11, z - ROAD / 2 + 0.8 + i * 0.78, { height: 0.04, cast: false });
    }
  }

  // Each city block gets a distinct low-rise/promenade footprint with parks and pools.
  for (let row = 0; row < roadZ.length - 1; row++) {
    for (let col = 0; col < roadX.length - 1; col++) {
      const left = roadX[col] + 4.85, right = roadX[col + 1] - 4.85;
      const top = roadZ[row] + 4.85, bottom = roadZ[row + 1] - 4.85;
      const width = right - left, depth = bottom - top, cx = (left + right) / 2, cz = (top + bottom) / 2;
      const seed = row * 9 + col * 5 + 1;
      if ((row === 1 && col === 2) || (row === 2 && col === 0)) {
        addPark(left, right, top, bottom, seed);
        continue;
      }
      if ((row + col) % 5 === 0) addPool(cx + width * 0.19, cz - depth * 0.16, 4.5, 3.2);
      const random = rng(seed * 8731);
      const firstWidth = 6.15 + random() * 1.2;
      const secondWidth = 6.05 + random() * 1.2;
      const firstDepth = 6.3 + random() * 1.7;
      const secondDepth = 6.0 + random() * 1.6;
      const h1 = 5.1 + random() * 9.2;
      const h2 = 4.6 + random() * 6.7;
      addBuilding(cx - width * 0.24, cz + depth * 0.13, firstWidth, firstDepth, h1, buildingColors[seed % buildingColors.length], seed % 3, seed);
      addBuilding(cx + width * 0.24, cz - depth * 0.12, secondWidth, secondDepth, h2, buildingColors[(seed + 2) % buildingColors.length], (seed + 1) % 3, seed + 2);
      if (seed % 3 === 1) addPalm(cx + width * 0.43, cz + depth * 0.4, 0.76);
    }
  }
}

buildWorld();

function makePerson() {
  const root = new THREE.Group();
  const shirt = material('#e9f0db', { roughness: 0.9 });
  const pants = material('#35516b', { roughness: 0.92 });
  const skin = material('#d8a17c', { roughness: 0.85 });
  const hair = material('#33272c', { roughness: 0.9 });
  const shoes = material('#262f35');
  box(root, 0.78, 1.05, 0.47, '#e9f0db', 0, 1.52, 0);
  box(root, 0.78, 0.46, 0.49, '#e65f83', 0, 1.32, 0.02);
  box(root, 0.66, 0.14, 0.51, '#f1d9a9', 0, 1.03, 0);
  const head = new THREE.Group(); head.position.set(0, 2, 0); root.add(head);
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.31, 14, 12), skin); headMesh.position.set(0, 0.29, 0.02); head.add(headMesh);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.315, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.56), hair); hairCap.position.set(0, 0.39, -0.015); head.add(hairCap);
  box(head, 0.12, 0.18, 0.11, '#f0c27f', 0, 0.31, 0.29, { cast: false });
  const leftArm = new THREE.Group(); leftArm.position.set(-0.51, 1.9, 0); root.add(leftArm);
  box(leftArm, 0.23, 0.86, 0.25, '#f1eee0', 0, -0.39, 0);
  const rightArm = new THREE.Group(); rightArm.position.set(0.51, 1.9, 0); root.add(rightArm);
  box(rightArm, 0.23, 0.86, 0.25, '#f1eee0', 0, -0.39, 0);
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(side * 0.2, 1.03, 0); root.add(leg);
    box(leg, 0.29, 0.91, 0.35, '#35516b', 0, -0.39, 0);
    box(leg, 0.31, 0.18, 0.5, '#262f35', 0, -0.83, 0.075);
    legs.push(leg);
  }
  root.userData.limbs = { head, leftArm, rightArm, legs };
  root.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
  scene.add(root);
  return root;
}

function makeCar(color = '#e8b849', type = 'civilian') {
  const root = new THREE.Group();
  const paint = material(type === 'police' ? '#ebe7d6' : color, { roughness: 0.43, metalness: 0.22 });
  const glass = material('#466875', { roughness: 0.24, metalness: 0.25 });
  const rubber = material('#20272a', { roughness: 0.95 });
  const chrome = material('#c6c7b8', { metalness: 0.72, roughness: 0.3 });
  const frontLamp = new THREE.MeshBasicMaterial({ color: '#ffe1a2' });
  box(root, 1.9, 0.55, 3.7, paint, 0, 0.72, 0);
  box(root, 1.63, 0.24, 1.0, paint, 0, 1.09, 1.22);
  box(root, 1.37, 0.73, 1.65, type === 'police' ? '#f2efe4' : color, 0, 1.22, -0.04);
  box(root, 1.2, 0.58, 1.42, glass, 0, 1.32, -0.05, { cast: false });
  box(root, 1.8, 0.1, 0.35, paint, 0, 0.95, -1.62);
  box(root, 1.8, 0.1, 0.36, paint, 0, 0.95, 1.62);
  for (const x of [-0.57, 0.57]) {
    for (const z of [-1.08, 1.12]) {
      const window = box(root, 0.06, 0.43, 0.54, glass, x, 1.29, z, { cast: false });
      if (x < 0) window.position.x = -0.69; else window.position.x = 0.69;
    }
  }
  for (const x of [-0.97, 0.97]) {
    for (const z of [-1.14, 1.14]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.24, 12), rubber);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(x, 0.42, z); wheel.castShadow = true; root.add(wheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.25, 10), chrome);
      hub.rotation.z = Math.PI / 2; hub.position.set(x * 1.01, 0.42, z); root.add(hub);
    }
  }
  for (const x of [-0.63, 0.63]) {
    box(root, 0.32, 0.2, 0.08, '#f9e7bd', x, 0.77, 1.88, { cast: false, material: frontLamp });
    box(root, 0.28, 0.19, 0.08, '#d8494d', x, 0.75, -1.88, { cast: false });
    box(root, 0.12, 0.13, 0.05, chrome, x * 1.18, 0.77, 1.91, { cast: false });
  }
  if (type === 'police') {
    box(root, 0.94, 0.16, 0.3, '#2e3f48', 0, 1.72, 0.0);
    const red = box(root, 0.34, 0.13, 0.22, '#ec4262', -0.26, 1.84, 0, { cast: false, material: { emissive: '#e83258', emissiveIntensity: 0.8 } });
    const blue = box(root, 0.34, 0.13, 0.22, '#3b94e9', 0.26, 1.84, 0, { cast: false, material: { emissive: '#387fe5', emissiveIntensity: 0.8 } });
    root.userData.sirens = [red, blue];
  }
  root.traverse(object => { if (object.isMesh) object.receiveShadow = true; });
  scene.add(root);
  return root;
}

const avatar = makePerson();
const player = { x: -48, z: -32.3, yaw: 0, speed: 0, health: 100, group: avatar, isPlayer: true };
avatar.position.set(player.x, 0, player.z);

function addVehicle(x, z, yaw, options = {}) {
  const type = options.type || 'civilian';
  const color = options.color || carColors[Math.floor(Math.random() * carColors.length)];
  const car = {
    x, z, yaw, speed: options.speed || 0, parked: options.parked ?? true,
    color,
    type, axis: options.axis || 'z', direction: options.direction || 1,
    group: makeCar(color, type),
    isPlayer: false
  };
  car.group.position.set(x, 0, z); car.group.rotation.y = yaw;
  if (car.parked) car.group.userData.parked = true;
  if (type === 'police') police.push(car); else traffic.push(car);
  return car;
}

// The first car is always within a few steps of the opening character.
addVehicle(-50.4, -32.0, 0, { parked: true, color: '#e9b64f' });
for (let i = 0; i < 9; i++) {
  const vertical = i % 2 === 0;
  if (vertical) {
    const lane = roadX[(i * 2 + 1) % roadX.length];
    const z = -47 + (i * 13.1) % 109;
    const yaw = i % 4 < 2 ? 0 : Math.PI;
    addVehicle(lane + (i % 3 - 1) * 1.65, z, yaw, { parked: false, speed: 4.4 + (i % 4) * 1.05, axis: 'z', direction: yaw === 0 ? 1 : -1, color: carColors[(i + 2) % carColors.length] });
  } else {
    const lane = roadZ[(i * 2 + 1) % roadZ.length];
    const x = -58 + (i * 14.3) % 115;
    const yaw = i % 4 < 2 ? Math.PI / 2 : -Math.PI / 2;
    addVehicle(x, lane + (i % 3 - 1) * 1.6, yaw, { parked: false, speed: 4.0 + (i % 3) * 1.4, axis: 'x', direction: yaw > 0 ? 1 : -1, color: carColors[(i + 4) % carColors.length] });
  }
}
for (let i = 0; i < 7; i++) {
  if (i % 2 === 0) addVehicle(roadX[(i + 2) % roadX.length] + (i % 3 - 1) * 1.45, -43 + i * 14.2, i % 4 < 2 ? 0 : Math.PI, { parked: true, color: carColors[(i + 1) % carColors.length] });
  else addVehicle(-55 + i * 14.5, roadZ[(i + 1) % roadZ.length] + 1.1, Math.PI / 2, { parked: true, color: carColors[(i + 3) % carColors.length] });
}

function makeMarker() {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.95, 8.5, 18, 1, true), new THREE.MeshBasicMaterial({ color: '#ff5588', transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.y = 4.3; group.add(beam);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.52, 0.085, 8, 32), new THREE.MeshBasicMaterial({ color: '#ff5e91' }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.55; group.add(ring);
  const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), new THREE.MeshBasicMaterial({ color: '#ffcc8e' }));
  cap.position.y = 2.8; group.add(cap);
  const light = new THREE.PointLight('#ff518e', 8, 12); light.position.y = 2.5; group.add(light);
  scene.add(group);
  return { group, ring, cap };
}
const missionMarker = makeMarker();

function collides(x, z, radius = 0.7) {
  if (x < -55.2 || x < world.minX + 1 || x > world.maxX - 1 || z < world.minZ + 1 || z > world.maxZ - 1) return true;
  return obstacles.some(o => {
    const nx = THREE.MathUtils.clamp(x, o.x, o.x + o.w);
    const nz = THREE.MathUtils.clamp(z, o.z, o.z + o.d);
    return Math.hypot(x - nx, z - nz) < radius;
  });
}

function focusObject() { return state.driving || player; }
function horizontalDistance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

function showToast(message) {
  const toast = document.querySelector('#toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
}

function enterExitVehicle() {
  if (state.driving) {
    const car = state.driving;
    const sideX = Math.cos(car.yaw), sideZ = -Math.sin(car.yaw);
    let x = car.x + sideX * 2.25, z = car.z + sideZ * 2.25;
    if (collides(x, z, 0.55)) { x = car.x - sideX * 2.25; z = car.z - sideZ * 2.25; }
    player.x = x; player.z = z; player.yaw = car.yaw; player.speed = 0;
    player.group.position.set(x, 0, z); player.group.rotation.y = player.yaw; player.group.visible = true;
    car.speed = 0; car.parked = true; car.group.userData.parked = true;
    state.camYaw = car.yaw + state.camOrbit;
    state.camOrbit = 0;
    state.cameraReturnDelay = 0;
    state.cameraTravelReverse = false;
    state.cameraManualLook = true;
    state.walkingInputActive = false;
    state.driving = null; state.camDistance = 8.6;
    showToast('OUT ON THE STREET. KEEP MOVING.');
    return;
  }
  let best = 4.25, nearest = null;
  for (const car of traffic) {
    const d = horizontalDistance(player, car);
    if (d < best) { best = d; nearest = car; }
  }
  if (!nearest) { showToast('NO RIDE CLOSE ENOUGH. WALK A LITTLE.'); return; }
  nearest.parked = false;
  nearest.group.userData.parked = false;
  state.camOrbit = 0;
  state.cameraReturnDelay = 0;
  state.cameraTravelReverse = false;
  state.walkingInputActive = false;
  state.driving = nearest;
  player.group.visible = false;
  state.camDistance = 10.6;
  showToast('NICE RIDE. MAKE IT COUNT.');
}

function spawnPolice() {
  if (police.length >= Math.min(4, Math.ceil(state.heat))) return;
  const focus = focusObject();
  const roadVertical = Math.random() > 0.5;
  let x, z, yaw;
  if (roadVertical) {
    x = roadX.reduce((best, lane) => Math.abs(lane - focus.x) < Math.abs(best - focus.x) ? lane : best, roadX[0]);
    z = THREE.MathUtils.clamp(focus.z + (Math.random() > 0.5 ? -1 : 1) * 25, world.minZ + 5, world.maxZ - 5);
    yaw = z < focus.z ? 0 : Math.PI;
  } else {
    z = roadZ.reduce((best, lane) => Math.abs(lane - focus.z) < Math.abs(best - focus.z) ? lane : best, roadZ[0]);
    x = THREE.MathUtils.clamp(focus.x + (Math.random() > 0.5 ? -1 : 1) * 25, world.minX + 5, world.maxX - 5);
    yaw = x < focus.x ? Math.PI / 2 : -Math.PI / 2;
  }
  addVehicle(x, z, yaw, { type: 'police', parked: false, speed: 8, axis: roadVertical ? 'z' : 'x', direction: 1 });
}

function updateWalking(dt) {
  const forwardInput = (isControlDown('w') || isControlDown('arrowup') ? 1 : 0) - (isControlDown('s') || isControlDown('arrowdown') ? 1 : 0);
  const sideInput = (isControlDown('a') || isControlDown('arrowleft') ? 1 : 0) - (isControlDown('d') || isControlDown('arrowright') ? 1 : 0);
  const cameraYaw = state.camYaw;
  const forwardX = Math.sin(cameraYaw), forwardZ = Math.cos(cameraYaw);
  const rightX = Math.cos(cameraYaw), rightZ = -Math.sin(cameraYaw);
  let dx = forwardX * forwardInput + rightX * sideInput;
  let dz = forwardZ * forwardInput + rightZ * sideInput;
  const length = Math.hypot(dx, dz);
  if (length > 0) {
    if (!state.walkingInputActive) state.cameraManualLook = false;
    state.walkingInputActive = true;
    dx /= length; dz /= length;
    const nx = player.x + dx * 6.2 * dt, nz = player.z + dz * 6.2 * dt;
    if (!collides(nx, player.z, 0.55)) player.x = nx;
    if (!collides(player.x, nz, 0.55)) player.z = nz;
    const strafeAmount = dx * rightX + dz * rightZ;
    const targetYaw = cameraYaw + strafeAmount * 0.35;
    const yawDelta = Math.atan2(Math.sin(targetYaw - player.yaw), Math.cos(targetYaw - player.yaw));
    player.yaw += yawDelta * (1 - Math.exp(-dt * 12));
  } else {
    state.walkingInputActive = false;
  }
  player.group.position.set(player.x, 0, player.z);
  player.group.rotation.y = player.yaw;
  const stride = length ? Math.sin(state.elapsed * 10.5) * 0.48 : 0;
  const limbs = player.group.userData.limbs;
  const headYaw = Math.atan2(Math.sin(cameraYaw - player.yaw), Math.cos(cameraYaw - player.yaw));
  limbs.head.rotation.set(state.camPitch - 0.48, headYaw, 0);
  limbs.leftArm.rotation.x = stride;
  limbs.rightArm.rotation.x = -stride;
  limbs.legs[0].rotation.x = -stride;
  limbs.legs[1].rotation.x = stride;
}

function updateDriving(dt) {
  const car = state.driving;
  const throttle = (isControlDown('w') || isControlDown('arrowup') ? 1 : 0) - (isControlDown('s') || isControlDown('arrowdown') ? 1 : 0);
  const steer = (isControlDown('a') || isControlDown('arrowleft') ? 1 : 0) - (isControlDown('d') || isControlDown('arrowright') ? 1 : 0);
  const handbrake = isControlDown(' ');
  car.speed += throttle * 13.5 * dt;
  car.speed *= Math.pow(handbrake ? 0.88 : 0.988, dt * 60);
  car.speed = THREE.MathUtils.clamp(car.speed, -8.5, 23.5);
  if (handbrake) car.speed *= Math.pow(0.95, dt * 60);
  if (car.speed < -0.35) state.cameraTravelReverse = true;
  else if (car.speed > 0.35) state.cameraTravelReverse = false;
  const steeringAuthority = Math.min(Math.abs(car.speed) / 6, 1);
  car.yaw += steer * Math.sign(car.speed || 1) * steeringAuthority * 1.35 * dt;
  const nx = car.x + Math.sin(car.yaw) * car.speed * dt;
  const nz = car.z + Math.cos(car.yaw) * car.speed * dt;
  if (collides(nx, nz, 1.05)) {
    car.speed *= -0.2;
    if (Math.abs(car.speed) > 2.8 && state.collisionWait <= 0) {
      state.heat = Math.min(5, state.heat + 1);
      state.health = Math.max(22, state.health - 8);
      state.collisionWait = 1.5;
      state.lastCrime = state.elapsed;
      showToast('YOU CLIPPED A BUILDING. THE COPS NOTICED.');
    }
  } else { car.x = nx; car.z = nz; }
  car.group.position.set(car.x, 0, car.z);
  car.group.rotation.y = car.yaw;
}

function updateTraffic(dt) {
  for (const car of traffic) {
    if (car.parked || car === state.driving) continue;
    if (car.axis === 'z') {
      car.z += car.direction * car.speed * dt;
      if (car.z > world.maxZ + 3) car.z = world.minZ - 3;
      if (car.z < world.minZ - 3) car.z = world.maxZ + 3;
    } else {
      car.x += car.direction * car.speed * dt;
      if (car.x > world.maxX + 3) car.x = world.minX - 3;
      if (car.x < world.minX - 3) car.x = world.maxX + 3;
    }
    car.group.position.set(car.x, 0, car.z);
  }
}

function updatePolice(dt) {
  while (police.length < Math.ceil(state.heat) && state.heat >= 0.3) spawnPolice();
  for (let i = police.length - 1; i >= 0; i--) {
    const cop = police[i];
    const focus = focusObject();
    const dx = focus.x - cop.x, dz = focus.z - cop.z;
    const desiredYaw = Math.atan2(dx, dz);
    const difference = THREE.MathUtils.euclideanModulo(desiredYaw - cop.yaw + Math.PI, Math.PI * 2) - Math.PI;
    cop.yaw += THREE.MathUtils.clamp(difference, -1.2 * dt, 1.2 * dt);
    cop.speed = Math.min(13.5 + state.heat * 1.15, cop.speed + 3 * dt);
    const nx = cop.x + Math.sin(cop.yaw) * cop.speed * dt;
    const nz = cop.z + Math.cos(cop.yaw) * cop.speed * dt;
    if (!collides(nx, nz, 1.2)) { cop.x = nx; cop.z = nz; }
    else cop.yaw += Math.PI * 0.72;
    cop.group.position.set(cop.x, 0, cop.z); cop.group.rotation.y = cop.yaw;
    for (const siren of cop.group.userData.sirens || []) siren.material.emissiveIntensity = Math.sin(state.elapsed * 13 + (siren.position.x > 0 ? Math.PI : 0)) > 0 ? 1.2 : 0.16;
    if (horizontalDistance(cop, focus) < 2.25 && state.hitWait <= 0) {
      state.health = Math.max(0, state.health - 12); state.hitWait = 1.4; showToast('WATCH YOUR BACK!');
    }
    if (state.heat <= 0.01 && horizontalDistance(cop, focus) > 26) {
      scene.remove(cop.group); police.splice(i, 1);
    }
  }
}

function updateMission() {
  const target = state.job.phase === 'pickup' ? state.job.from : state.job.to;
  const distance = horizontalDistance(focusObject(), target);
  if (distance > 2.5) return;
  if (state.job.phase === 'pickup') {
    state.job.phase = 'drop';
    showToast('ENVELOPE SECURED. NOW GET IT TO LITTLE HAVANA.');
  } else {
    const stops = [
      { x: -48, z: 16, name: 'Ocean Drive' }, { x: -24, z: 55, name: 'Downtown' },
      { x: 48, z: -31, name: 'Vice Point' }, { x: 0, z: -7, name: 'Arts District' },
      { x: 24, z: 55, name: 'South Beach' }, { x: 48, z: 17, name: 'Little Havana' }
    ];
    state.cash += state.job.reward;
    state.heat = Math.max(0, state.heat - 1);
    state.job.phase = 'pickup';
    state.job.from = stops[Math.floor(Math.random() * stops.length)];
    state.job.to = stops.filter(stop => stop !== state.job.from)[Math.floor(Math.random() * (stops.length - 1))];
    showToast(`DELIVERY COMPLETE. +$${state.job.reward} CASH.`);
  }
}

function updateWorld(dt) {
  state.elapsed += dt;
  if (state.paused) { tappedKeys.clear(); return; }
  if (state.driving) updateDriving(dt); else updateWalking(dt);
  tappedKeys.clear();
  updateTraffic(dt);
  updatePolice(dt);
  state.collisionWait = Math.max(0, state.collisionWait - dt);
  state.hitWait = Math.max(0, state.hitWait - dt);
  if (state.heat > 0 && state.elapsed - state.lastCrime > 2.5) state.heat = Math.max(0, state.heat - dt * 0.055);
  if (state.health <= 0) {
    state.health = 100; state.heat = 0; state.cash = Math.max(0, state.cash - 100);
    player.x = -48; player.z = -32.3; player.yaw = 0;
    if (state.driving) { state.driving.group.userData.parked = true; state.driving.parked = true; state.driving.speed = 0; }
    state.driving = null; player.group.visible = true; police.splice(0).forEach(cop => scene.remove(cop.group));
    showToast('ROUGH NIGHT. YOU LOST $100 AND GOT BACK UP.');
  }
  updateMission();
}

function updateMarker() {
  const target = state.job.phase === 'pickup' ? state.job.from : state.job.to;
  missionMarker.group.position.set(target.x, 0.05, target.z);
  const pulse = 1 + Math.sin(state.elapsed * 3.5) * 0.1;
  missionMarker.ring.scale.setScalar(pulse);
  missionMarker.ring.rotation.z += 0.01;
  missionMarker.cap.position.y = 2.75 + Math.sin(state.elapsed * 2.6) * 0.28;
  missionMarker.cap.rotation.y += 0.018;
  missionMarker.group.visible = !state.paused;
}

function updateCamera(dt) {
  const focus = focusObject();
  if (state.driving) {
    state.cameraReturnDelay = Math.max(0, state.cameraReturnDelay - dt);
    if (state.cameraReturnDelay === 0) {
      const targetOrbit = state.cameraTravelReverse ? Math.PI : 0;
      const orbitDelta = Math.atan2(Math.sin(targetOrbit - state.camOrbit), Math.cos(targetOrbit - state.camOrbit));
      state.camOrbit += orbitDelta * (1 - Math.exp(-dt * 2));
    }
  }
  if (!state.driving && !state.walkingInputActive && !state.cameraManualLook) {
    const yawDelta = Math.atan2(Math.sin(player.yaw - state.camYaw), Math.cos(player.yaw - state.camYaw));
    state.camYaw += yawDelta * (1 - Math.exp(-dt * 5.5));
  }
  const yaw = state.driving ? focus.yaw + state.camOrbit : state.camYaw;
  const distance = state.camDistance;
  const horizontal = Math.cos(state.camPitch) * distance;
  const target = new THREE.Vector3(focus.x, state.driving ? 1.45 : 1.65, focus.z);
  const desired = new THREE.Vector3(
    focus.x - Math.sin(yaw) * horizontal,
    target.y + Math.sin(state.camPitch) * distance,
    focus.z - Math.cos(yaw) * horizontal
  );
  camera.position.lerp(desired, 1 - Math.exp(-dt * 5.5));
  camera.lookAt(target);
}

function drawMinimap() {
  const mini = document.querySelector('#minimap');
  const c = mini.getContext('2d');
  const w = mini.width, h = mini.height;
  c.clearRect(0, 0, w, h); c.fillStyle = '#31564f'; c.fillRect(0, 0, w, h);
  const sx = (x) => (x - world.minX) / (world.maxX - world.minX) * w;
  const sz = (z) => (z - world.minZ) / (world.maxZ - world.minZ) * h;
  c.fillStyle = '#258b91'; c.fillRect(0, 0, sx(-56), h);
  c.fillStyle = '#cfbc92'; c.fillRect(sx(-56), 0, sx(-54.8) - sx(-56), h);
  c.fillStyle = '#747b75';
  for (const x of roadX) c.fillRect(sx(x - ROAD / 2), 0, sx(x + ROAD / 2) - sx(x - ROAD / 2), h);
  for (const z of roadZ) c.fillRect(0, sz(z - ROAD / 2), w, sz(z + ROAD / 2) - sz(z - ROAD / 2));
  const target = state.job.phase === 'pickup' ? state.job.from : state.job.to;
  c.fillStyle = '#ff5e91'; c.beginPath(); c.arc(sx(target.x), sz(target.z), 3.3, 0, Math.PI * 2); c.fill();
  for (const cop of police) { c.fillStyle = '#69a8f2'; c.fillRect(sx(cop.x) - 1.5, sz(cop.z) - 1.5, 3, 3); }
  const focus = focusObject();
  c.save(); c.translate(sx(focus.x), sz(focus.z)); c.rotate(-focus.yaw);
  c.fillStyle = '#6af5d8'; c.beginPath(); c.moveTo(0, -5); c.lineTo(3.2, 3.2); c.lineTo(0, 1.7); c.lineTo(-3.2, 3.2); c.closePath(); c.fill(); c.restore();
}

function updateHud() {
  document.querySelector('#cash').textContent = state.cash.toLocaleString('en-US');
  const count = Math.ceil(state.heat);
  const stars = document.querySelector('#stars');
  stars.innerHTML = Array.from({ length: 5 }, (_, i) => `<span class="${i < count ? 'lit' : ''}">${i < count ? '★' : '☆'}</span>`).join(' ');
  stars.setAttribute('aria-label', `${count} wanted stars`);
  document.querySelector('#health-fill').style.width = `${state.health}%`;
  document.querySelector('#health-value').textContent = Math.round(state.health);
  const target = state.job.phase === 'pickup' ? state.job.from : state.job.to;
  document.querySelector('#mission-phase').textContent = state.job.phase === 'pickup' ? 'SIDE HUSTLE 01' : 'SIDE HUSTLE 01 / DELIVERY';
  document.querySelector('#mission-title').textContent = state.job.phase === 'pickup' ? 'A little delivery' : 'Take it to the club';
  document.querySelector('#mission-copy').textContent = state.job.phase === 'pickup' ? 'Collect the envelope at Ocean Drive. Drop it off before the sun goes down.' : 'The package is yours. Get it to the club in Little Havana and keep a low profile.';
  document.querySelector('#mission-distance').textContent = `${Math.round(horizontalDistance(focusObject(), target))} M TO ${state.job.phase === 'pickup' ? 'PICKUP' : 'DROP'}`;
  document.querySelector('#mission-reward').textContent = `+$${state.job.reward}`;
  document.querySelector('#mission-card .mission-live').textContent = state.job.phase === 'pickup' ? 'AVAILABLE' : 'IN PROGRESS';
  const focus = focusObject();
  document.querySelector('#district').textContent = focus.x < -34 ? 'OCEAN DRIVE' : focus.x < 15 ? 'ARTS DISTRICT' : focus.z > 8 ? 'LITTLE HAVANA' : 'VICE POINT';
  const speed = state.driving ? Math.round(Math.abs(state.driving.speed) * 4.1) : 0;
  document.querySelector('#speed').textContent = String(speed).padStart(2, '0');
  document.querySelector('#needle').style.transform = `rotate(${-130 + Math.min(speed / 96, 1) * 260}deg)`;
  document.querySelector('#vehicle-mode').textContent = state.driving ? 'COUPE' : 'ON FOOT';
  document.querySelector('#gear').textContent = state.driving ? (state.driving.speed < -0.5 ? 'REV' : speed > 0 ? 'DRIVE' : 'IDLE') : 'WALK';
  document.querySelector('#move-hint').textContent = state.driving ? 'DRIVE' : 'MOVE';
  drawMinimap();
}

function resize() {
  const bounds = stage.getBoundingClientRect();
  renderer.setSize(bounds.width, bounds.height, false);
  camera.aspect = bounds.width / Math.max(bounds.height, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
window.addEventListener('resize', resize);

let pointer = null;
canvas.addEventListener('pointerdown', (event) => {
  canvas.focus({ preventScroll: true });
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add('looking');
});
canvas.addEventListener('pointermove', (event) => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
  if (state.driving) {
    state.camOrbit -= dx * 0.007;
    state.cameraReturnDelay = 1.1;
  }
  else { state.camYaw -= dx * 0.007; state.cameraManualLook = true; }
  state.camPitch = THREE.MathUtils.clamp(state.camPitch + dy * 0.0035, 0.22, 0.86);
  pointer.x = event.clientX; pointer.y = event.clientY;
});
function releasePointer() { pointer = null; canvas.classList.remove('looking'); }
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('wheel', (event) => {
  event.preventDefault(); state.camDistance = THREE.MathUtils.clamp(state.camDistance + event.deltaY * 0.007, 5.4, 15.5);
}, { passive: false });

function isControlDown(key) { return keys.has(key) || tappedKeys.has(key); }

function eventKey(event) { return event.key.toLowerCase(); }

document.addEventListener('keydown', (event) => {
  const key = eventKey(event);
  if (controlKeys.has(key)) event.preventDefault();
  if (key === 'p' && !keys.has(key)) {
    state.paused = !state.paused;
    document.querySelector('#pause-overlay').hidden = !state.paused;
  }
  if (key === 'e' && !keys.has(key) && !state.paused) enterExitVehicle();
  if (!keys.has(key) && controlKeys.has(key)) tappedKeys.add(key);
  keys.add(key);
});
document.addEventListener('keyup', event => keys.delete(eventKey(event)));
function clearKeyboardInput() { keys.clear(); tappedKeys.clear(); }
window.addEventListener('blur', clearKeyboardInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearKeyboardInput(); });
document.querySelector('#restart').addEventListener('click', () => window.location.reload());

function animate() {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.04);
  updateWorld(dt);
  updateMarker();
  updateCamera(dt);
  for (let i = 0; i < scene.children.length; i++) {
    const object = scene.children[i];
    if (object.name === 'ocean-ripple') object.position.x = object.userData.baseX + Math.sin(state.elapsed * 0.6 + object.userData.phase) * 0.42;
  }
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

resize();
updateHud();
requestAnimationFrame(animate);
