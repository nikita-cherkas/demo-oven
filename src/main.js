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
// Dims passed at runtime from floor bbox (scale-independent)
function makeEmptyCabinet(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb8b8b8,
    metalness: 1,
    roughness: 0.16,
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
    const fb    = new THREE.Box3().setFromObject(floorMesh);
    floorY      = fb.max.y;
    const floorSz = new THREE.Vector3(); fb.getSize(floorSz);
    const floorCt = new THREE.Vector3(); fb.getCenter(floorCt);
    console.log('✓ floor y=', floorY.toFixed(3), 'sz=', floorSz.x.toFixed(2), floorSz.z.toFixed(2));

    // Long axis = row direction, short axis = depth from wall
    const alongZ  = floorSz.z >= floorSz.x;
    const rowLen  = alongZ ? floorSz.z : floorSz.x;
    const rowDepth = alongZ ? floorSz.x : floorSz.z;

    const NUM_CABS = 6;
    const cabW = rowLen   / NUM_CABS;   // width per cabinet along row
    const cabH = wSz.y    * 0.42;       // 42% of room height
    const cabD = rowDepth * 0.28;       // 28% of floor depth (against wall)

    const startAlong = (alongZ ? fb.min.z : fb.min.x) + cabW / 2;
    const wallPos    = (alongZ ? fb.min.x : fb.min.z) + cabD / 2;

    for (let i = 0; i < NUM_CABS; i++) {
      const cab = makeEmptyCabinet(
        alongZ ? cabD : cabW,
        cabH,
        alongZ ? cabW : cabD
      );
      cab.position.set(
        alongZ ? wallPos              : startAlong + i * cabW,
        floorY + cabH / 2,
        alongZ ? startAlong + i * cabW : wallPos
      );
      scene.add(cab);
    }
    console.log(`✓ ${NUM_CABS} cabinets placed (alongZ=${alongZ})`);
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
