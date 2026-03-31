import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

// ── Renderer (product_builder/trailer settings) ───────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.5;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// ── Scene ─────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf1f1f1);
scene.background.colorSpace = THREE.SRGBColorSpace;

// ── Camera ────────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 500);
camera.position.set(0, 3, 8);

// ── Controls ──────────────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;

// ── Preloader ─────────────────────────────────────────────────────────────────
const preloaderEl  = document.getElementById('preloader');
const progressBarEl = document.getElementById('progress-bar');
const statusEl     = document.getElementById('loader-status');
let loadedCount = 0;
const TOTAL = 3; // hdri + trailer + gst

function setProgress(n, label) {
  progressBarEl.style.width = Math.round((n / TOTAL) * 100) + '%';
  if (label) statusEl.textContent = label;
}
function onLoaded(label) {
  loadedCount++;
  setProgress(loadedCount, label);
  if (loadedCount >= TOTAL) setTimeout(() => preloaderEl.classList.add('hidden'), 500);
}
setProgress(0, 'Loading environment…');

// ── HDRI env-map-6 (product_builder) ─────────────────────────────────────────
const pmrem = new THREE.PMREMGenerator(renderer);
new RGBELoader().load('./env-map-6.hdr', (hdrmap) => {
  const envmap = pmrem.fromEquirectangular(hdrmap);
  hdrmap.dispose();
  pmrem.dispose();
  scene.environment = envmap.texture;
  scene.environment.colorSpace = THREE.SRGBColorSpace;
  onLoaded('Loading trailer…');
});

// ── Lights (product_builder/trailer SceneLights.js) ───────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const spot = new THREE.SpotLight(0xffffff, 0.1);
spot.position.set(0, 20, 0);
spot.angle = 1;
spot.castShadow = true;
spot.shadow.bias = -0.0005;
spot.shadow.mapSize.set(1024, 1024);
spot.shadow.camera.near   = 0.1;
spot.shadow.camera.far    = 20;
spot.shadow.camera.top    =  20;
spot.shadow.camera.right  =  20;
spot.shadow.camera.left   = -20;
spot.shadow.camera.bottom = -20;
scene.add(spot);

// ── Empty cabinet factory (product_builder: use-cabinet-builder.js) ───────────
// HIGH cabinet: 24"w × 30"h × 29.8"d  |  1 inch = 0.0254 m
const IN = 0.0254;
const CAB_W = 24 * IN;   // 0.6096 m
const CAB_H = 30 * IN;   // 0.762  m
const CAB_D = 29.8 * IN; // 0.7569 m

function makeEmptyCabinet() {
  const geo = new THREE.BoxGeometry(CAB_W, CAB_H, CAB_D);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb8b8b8,
    metalness: 1,
    roughness: 0.16,
    // scene.environment applies automatically to all MeshStandardMaterial
    emissive: new THREE.Color('white'),
    emissiveIntensity: 0,
  });
  return new THREE.Mesh(geo, mat);
}

// ── Loaders ───────────────────────────────────────────────────────────────────
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

function findByName(root, name) {
  let found = null;
  root.traverse((o) => { if (!found && o.name === name) found = o; });
  return found;
}

// ── Load 16.glb ───────────────────────────────────────────────────────────────
loader.load('./models/16.glb', (gltf) => {
  const trailer = gltf.scene;

  // Center by X/Z, put floor on y=0
  const rawBox = new THREE.Box3().setFromObject(trailer);
  const rawCenter = new THREE.Vector3();
  rawBox.getCenter(rawCenter);
  trailer.position.set(-rawCenter.x, -rawBox.min.y, -rawCenter.z);

  trailer.traverse((child) => {
    if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
  });
  scene.add(trailer);

  // World bbox after repositioning
  const wb  = new THREE.Box3().setFromObject(trailer);
  const wSz = new THREE.Vector3(); wb.getSize(wSz);
  const wC  = new THREE.Vector3(); wb.getCenter(wC);
  const maxDim = Math.max(wSz.x, wSz.z);

  // Camera: wide angle, looking inside from the open side
  camera.position.set(wC.x + maxDim * 0.5, wC.y + wSz.y * 0.35, wb.max.z + maxDim * 0.9);
  controls.target.set(wC.x, wC.y - wSz.y * 0.05, wC.z);
  controls.maxDistance = maxDim * 5;
  controls.update();

  // ── Empty cabinets on main floor ──────────────────────────────────────────
  const floorMesh = findByName(trailer, 'floor');
  let floorY = wb.min.y; // fallback

  if (floorMesh) {
    const fb = new THREE.Box3().setFromObject(floorMesh);
    floorY = fb.max.y;
    console.log('✓ floor found, surface y =', floorY.toFixed(3));

    // Interior bounds from floor mesh
    const fb2 = new THREE.Box3().setFromObject(floorMesh);
    const floorSz = new THREE.Vector3(); fb2.getSize(floorSz);
    const floorCt = new THREE.Vector3(); fb2.getCenter(floorCt);

    // Row of cabinets along the back wall (min.z of floor)
    // Cabinets face toward the front (depth along Z)
    const numCabs = Math.max(1, Math.floor(floorSz.x / CAB_W));
    const totalW  = numCabs * CAB_W;
    const startX  = floorCt.x - totalW / 2 + CAB_W / 2;

    for (let i = 0; i < numCabs; i++) {
      const cab = makeEmptyCabinet();
      cab.position.set(
        startX + i * CAB_W,          // evenly spaced along X
        floorY + CAB_H / 2,          // sitting on floor surface
        fb2.min.z + CAB_D / 2        // flush against back wall
      );
      scene.add(cab);
    }
    console.log(`✓ ${numCabs} cabinets placed on floor`);
  } else {
    console.warn('⚠ "floor" mesh not found');
  }

  onLoaded('Loading equipment…');

  // ── Load GST model ────────────────────────────────────────────────────────
  loader.load('./models/GST_XLT2440-2-G.glb', (gstGltf) => {
    const gst = gstGltf.scene;
    gst.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });

    // Rotate 90° around Y
    gst.rotation.y = Math.PI / 2;

    const floorOven = findByName(trailer, 'floor_oven');

    if (floorOven) {
      const fb  = new THREE.Box3().setFromObject(floorOven);
      const fc  = new THREE.Vector3(); fb.getCenter(fc);

      // Add to scene at origin, compute rotated bbox, then center on floor_oven
      scene.add(gst);
      gst.position.set(0, 0, 0);
      const gb  = new THREE.Box3().setFromObject(gst);
      const gc  = new THREE.Vector3(); gb.getCenter(gc);

      gst.position.set(
        fc.x - gc.x,            // center GST.x on floor_oven center
        fb.max.y - gb.min.y,    // GST bottom sits on top of floor_oven
        fc.z - gc.z             // center GST.z on floor_oven center
      );
      console.log('✓ GST centered on floor_oven at', gst.position);
    } else {
      scene.add(gst);
      const gb = new THREE.Box3().setFromObject(gst);
      const gc = new THREE.Vector3(); gb.getCenter(gc);
      gst.position.set(wC.x - gc.x, wb.min.y - gb.min.y, wC.z - gc.z);
      console.warn('⚠ floor_oven not found — GST placed at trailer center');
    }

    onLoaded('Scene ready');
  }, undefined, (err) => { console.error('GST error:', err); onLoaded('Scene ready'); });

}, undefined, (err) => { console.error('Trailer error:', err); onLoaded('Trailer error'); });

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Loop ──────────────────────────────────────────────────────────────────────
(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();
