/**
 * HTML page that runs inside a WebView in Expo Go: camera via getUserMedia and
 * pose estimation with MediaPipe Pose Landmarker (Tasks Vision, WebAssembly/WebGL),
 * entirely on the device. Only landmark coordinates are posted back to React Native
 * (window.ReactNativeWebView.postMessage); video frames never leave the WebView.
 *
 * The library and the model are downloaded from public CDNs on first use
 * (pinned versions below) and then cached by the WebView.
 */

export const TASKS_VISION_VERSION = '1.1.1';

export interface PoseHtmlConfig {
  /** Base URL of the @mediapipe/tasks-vision package (vision_bundle.mjs + wasm/). */
  assetsBase: string;
  modelUrl: string;
  /** Faster-to-download model used until the full one is in the cache (first run only). */
  liteModelUrl: string;
  facingMode: 'user' | 'environment';
  /** MediaPipe landmark indices used by the exercise (drawn larger in the skeleton). */
  highlight: number[];
  /** Minimum visibility to draw a point: upper body / legs (hips, knees, ankles, feet). */
  minScore: number;
  legMinScore: number;
}

export const DEFAULT_ASSETS_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}`;
export const DEFAULT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
/** Smaller (5.8 MB vs 9.4 MB) and faster model used only to start quickly on the very first run. */
export const DEFAULT_LITE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/**
 * JS shared by the camera page and the prefetch page: a PERSISTENT asset cache (Cache
 * Storage of the page origin, unlike the HTTP cache it is not evicted after max-age=3600
 * or for large files) and the choice of the WebAssembly build (SIMD or not, as MediaPipe does).
 */
const ASSET_JS = `
const ASSET_CACHE = 'rc-assets-v1';
let cacheP = null;
const openCache = () => (cacheP ??= (self.caches ? caches.open(ASSET_CACHE).catch(() => null) : Promise.resolve(null)));
async function isCached(url) {
  const c = await openCache();
  return !!(c && (await c.match(url)));
}
/** Bytes of url: from the persistent cache, else downloaded once and stored. */
async function cachedBytes(url) {
  const c = await openCache();
  if (c) {
    const hit = await c.match(url);
    if (hit) return hit.arrayBuffer();
  }
  const r = await fetch(url, { mode: 'cors' });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  const buf = await r.arrayBuffer();
  if (c) await c.put(url, new Response(buf.slice(0), { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
  return buf;
}
const SIMD_TEST = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]);
async function wasmName() {
  try { await WebAssembly.instantiate(SIMD_TEST); return 'vision_wasm_internal'; }
  catch { return 'vision_wasm_nosimd_internal'; }
}
`;

export function buildPoseHtml(config: PoseHtmlConfig): string {
  // JSON.stringify output is safe inside a <script> as long as "</" is escaped.
  const cfg = JSON.stringify(config).replace(/</g, '\\u003c');
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}
  #stage{position:absolute;inset:0}
  video,canvas{position:absolute;inset:0;width:100%;height:100%}
  /* Fill the screen (what is visible is always inside the analysed frame). */
  video{object-fit:cover}
  /* Hidden until the first frame has been analysed: no flash of a small/black video. */
  #stage.loading{visibility:hidden}
  .mirror{transform:scaleX(-1)}
</style>
</head><body>
<div id="stage" class="loading"><video id="video" playsinline muted autoplay></video><canvas id="overlay"></canvas></div>
<script type="module">
const cfg = ${cfg};
const post = (o) => {
  const s = JSON.stringify(o);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
  else if (window.__rcPost) window.__rcPost(s);
};
window.addEventListener('error', (e) => post({ type: 'error', message: String(e.message || e) }));
window.addEventListener('unhandledrejection', (e) => post({ type: 'error', message: String(e.reason && e.reason.message || e.reason) }));

const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
if (cfg.facingMode === 'user') stage.classList.add('mirror');

// Body skeleton (no face mesh): arms, torso, legs and feet. Leg bones are drawn thicker.
const EDGES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[27,31],[28,30],[30,32],[28,32]];
const POINTS = [0,11,12,13,14,15,16,23,24,25,26,27,28,29,30,31,32];
const isLeg = (i) => i >= 23;
const minOf = (i) => (isLeg(i) ? cfg.legMinScore : cfg.minScore);
const shown = (lm, i) => (lm[i].visibility ?? 0) >= minOf(i);

function draw(lm) {
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) { canvas.width = cw * dpr; canvas.height = ch * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!lm) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  const s = Math.max(cw / vw, ch / vh); // object-fit: cover
  const ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
  const P = (i) => [ox + lm[i].x * vw * s, oy + lm[i].y * vh * s, lm[i].visibility ?? 0];
  // Only confidently detected points are drawn (no red "uncertain" clutter).
  ctx.lineCap = 'round';
  for (const pass of [0, 1]) {
    for (const [a, b] of EDGES) {
      if (!shown(lm, a) || !shown(lm, b)) continue;
      const p = P(a), q = P(b);
      const w = isLeg(a) && isLeg(b) ? 6 : 4;
      ctx.lineWidth = pass === 0 ? w + 3 : w;
      ctx.strokeStyle = pass === 0 ? 'rgba(0,0,0,0.35)' : 'rgba(198,255,61,0.9)';
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    }
  }
  for (const i of POINTS) {
    if (!shown(lm, i)) continue;
    const p = P(i);
    const big = cfg.highlight.includes(i);
    const r = big ? 7 : 4.5;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#C6FF3D';
    ctx.lineWidth = big ? 3 : 2;
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

${ASSET_JS}
const toUrl = (buf, type) => URL.createObjectURL(new Blob([buf], { type }));
const OPTIONS = {
  runningMode: 'VIDEO',
  numPoses: 1,
  // Lower than the 0.5 defaults: the person is found sooner and kept while moving fast;
  // weak points are still rejected later by the per-point visibility thresholds.
  minPoseDetectionConfidence: 0.35,
  minPosePresenceConfidence: 0.35,
  minTrackingConfidence: 0.35,
};

async function main() {
  post({ type: 'status', state: 'loading' });
  // 1) Camera, library, WebAssembly and model are all requested AT ONCE (MediaPipe on its
  //    own would download the WebAssembly and the model one after the other).
  const camera = navigator.mediaDevices
    .getUserMedia({ audio: false, video: { facingMode: cfg.facingMode, width: { ideal: 640 }, height: { ideal: 480 } } })
    .then((stream) => ({ stream }), (e) => ({ error: e }));
  const fullCached = await isCached(cfg.modelUrl);
  // First run: start with the small model, fetch the full one in the background.
  const startModelUrl = fullCached ? cfg.modelUrl : cfg.liteModelUrl;
  const name = await wasmName();
  const bundleP = cachedBytes(cfg.assetsBase + '/vision_bundle.mjs');
  const loaderP = cachedBytes(cfg.assetsBase + '/wasm/' + name + '.js');
  const wasmP = cachedBytes(cfg.assetsBase + '/wasm/' + name + '.wasm');
  const modelP = cachedBytes(startModelUrl);
  const filesetP = Promise.all([loaderP, wasmP]).then(([loader, wasm]) => ({
    wasmLoaderPath: toUrl(loader, 'text/javascript'),
    wasmBinaryPath: toUrl(wasm, 'application/wasm'),
  }));
  const visionP = bundleP.then((b) => import(toUrl(b, 'text/javascript')));
  let delegate = 'GPU';
  const make = async (modelBuf) => {
    const [vision, fileset] = await Promise.all([visionP, filesetP]);
    const opts = (d) => ({ ...OPTIONS, baseOptions: { modelAssetBuffer: new Uint8Array(modelBuf), delegate: d } });
    if (delegate === 'GPU') {
      try { return await vision.PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
      catch (e) { delegate = 'CPU'; }
    }
    return vision.PoseLandmarker.createFromOptions(fileset, opts('CPU'));
  };
  const landmarkerP = modelP.then(make);
  landmarkerP.catch(() => {});

  // 2) Show the picture as soon as the camera runs; detection joins when the model is ready.
  const cam = await camera;
  if (cam.error) {
    const e = cam.error;
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    post({ type: 'error', code: denied ? 'camera-denied' : 'camera', message: String(e && e.message || e) });
    return;
  }
  video.srcObject = cam.stream;
  await video.play().catch(() => {});
  stage.classList.remove('loading');
  post({ type: 'status', state: 'camera' });

  let landmarker = await landmarkerP;
  if (!fullCached) {
    // 3) Upgrade to the full model in the background (cached for every later start).
    cachedBytes(cfg.modelUrl)
      .then(make)
      .then((full) => { const old = landmarker; landmarker = full; old.close(); post({ type: 'status', state: 'model', model: 'full' }); })
      .catch(() => {});
  }

  let lastTime = -1;
  let tickError = false;
  let first = true;
  const tick = () => {
    if (video.readyState >= 2 && video.currentTime !== lastTime && video.videoWidth > 0) {
      lastTime = video.currentTime;
      const t0 = performance.now();
      let res;
      try {
        res = landmarker.detectForVideo(video, t0);
      } catch (e) {
        // Never let one failed frame stop the loop.
        if (!tickError) { tickError = true; post({ type: 'log', message: 'detect: ' + String(e && e.message || e) }); }
        requestAnimationFrame(tick);
        return;
      }
      const ms = performance.now() - t0;
      const lm = res.landmarks && res.landmarks[0];
      let flat = null;
      if (lm) {
        flat = new Array(lm.length * 3);
        for (let i = 0; i < lm.length; i++) {
          flat[i * 3] = Math.round(lm[i].x * 1e4) / 1e4;
          flat[i * 3 + 1] = Math.round(lm[i].y * 1e4) / 1e4;
          flat[i * 3 + 2] = Math.round((lm[i].visibility ?? 0) * 1e3) / 1e3;
        }
      }
      if (first) {
        first = false;
        post({ type: 'status', state: 'ready', delegate, model: fullCached ? 'full' : 'lite' });
      }
      post({ type: 'pose', t: t0, w: video.videoWidth, h: video.videoHeight, ms, lm: flat });
      draw(lm);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
main().catch((e) => post({ type: 'error', message: String(e && e.message || e) }));
</script>
</body></html>`;
}

/**
 * Invisible page that only downloads the MediaPipe library, WebAssembly and the full model
 * into the persistent asset cache (no camera), so opening an exercise later starts quickly.
 * Same base URL (origin) as the camera page, so both use the same cache.
 */
export function buildPrefetchHtml(assetsBase: string = DEFAULT_ASSETS_BASE, modelUrl: string = DEFAULT_MODEL_URL): string {
  const cfg = JSON.stringify({ assetsBase, modelUrl }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
const cfg = ${cfg};
const post = (o) => {
  const s = JSON.stringify(o);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
  else if (window.__rcPost) window.__rcPost(s);
};
${ASSET_JS}
(async () => {
  const name = await wasmName();
  const urls = [cfg.assetsBase + '/vision_bundle.mjs', cfg.assetsBase + '/wasm/' + name + '.js', cfg.assetsBase + '/wasm/' + name + '.wasm', cfg.modelUrl];
  await Promise.all(urls.map(cachedBytes));
})().then(() => post({ type: 'prefetch', ok: true }), (e) => post({ type: 'prefetch', ok: false, message: String(e) }));
</script></body></html>`;
}
