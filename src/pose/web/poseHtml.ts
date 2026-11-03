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
  facingMode: 'user' | 'environment';
  debug: boolean;
  /** MediaPipe landmark indices to highlight in the debug overlay. */
  highlight: number[];
  minScore: number;
}

export const DEFAULT_ASSETS_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}`;
export const DEFAULT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

export function buildPoseHtml(config: PoseHtmlConfig): string {
  // JSON.stringify output is safe inside a <script> as long as "</" is escaped.
  const cfg = JSON.stringify(config).replace(/</g, '\\u003c');
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
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

const EDGES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[0,2],[0,5],[2,7],[5,8]];
const POINTS = [0,2,5,7,8,11,12,13,14,15,16,23,24,25,26,27,28];
let debug = cfg.debug;
window.__rc = { setDebug(v) { debug = !!v; if (!debug) ctx.clearRect(0, 0, canvas.width, canvas.height); } };

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
  ctx.lineWidth = 3;
  for (const [a, b] of EDGES) {
    const p = P(a), q = P(b);
    ctx.strokeStyle = Math.min(p[2], q[2]) >= cfg.minScore ? '#22c55e' : 'rgba(249,115,22,0.6)';
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
  }
  for (const i of POINTS) {
    const p = P(i);
    const big = cfg.highlight.includes(i);
    ctx.fillStyle = p[2] >= cfg.minScore ? (big ? '#2563eb' : '#60a5fa') : '#ef4444';
    ctx.beginPath(); ctx.arc(p[0], p[1], big ? 7 : 4, 0, Math.PI * 2); ctx.fill();
  }
}

async function main() {
  post({ type: 'status', state: 'loading' });
  // Camera and model load IN PARALLEL (the model is ~10 MB + ~13 MB WebAssembly on first use;
  // afterwards both come from the cache).
  const camera = navigator.mediaDevices
    .getUserMedia({ audio: false, video: { facingMode: cfg.facingMode, width: { ideal: 640 }, height: { ideal: 480 } } })
    .then((stream) => ({ stream }), (e) => ({ error: e }));
  const model = (async () => {
    const vision = await import(cfg.assetsBase + '/vision_bundle.mjs');
    const fileset = await vision.FilesetResolver.forVisionTasks(cfg.assetsBase + '/wasm');
    const make = (delegate) => vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: cfg.modelUrl, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    try { return { landmarker: await make('GPU'), delegate: 'GPU' }; }
    catch (e) { return { landmarker: await make('CPU'), delegate: 'CPU' }; }
  })();

  const cam = await camera;
  if (cam.error) {
    const e = cam.error;
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    post({ type: 'error', code: denied ? 'camera-denied' : 'camera', message: String(e && e.message || e) });
    return;
  }
  video.srcObject = cam.stream;
  const playing = video.play();
  const { landmarker, delegate } = await model;
  await playing;

  let lastTime = -1;
  let first = true;
  const tick = () => {
    if (video.readyState >= 2 && video.currentTime !== lastTime && video.videoWidth > 0) {
      lastTime = video.currentTime;
      const t0 = performance.now();
      const res = landmarker.detectForVideo(video, t0);
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
        // Show the picture only now: camera running, model loaded, first frame analysed.
        first = false;
        stage.classList.remove('loading');
        post({ type: 'status', state: 'ready', delegate });
      }
      post({ type: 'pose', t: t0, w: video.videoWidth, h: video.videoHeight, ms, lm: flat });
      if (debug) draw(lm);
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
 * Invisible page that only downloads the MediaPipe library, WebAssembly and model into
 * the WebView HTTP cache (no camera), so opening an exercise later starts quickly.
 * Uses the same base URL as the camera page (WebKit partitions its cache per site).
 */
export function buildPrefetchHtml(assetsBase: string = DEFAULT_ASSETS_BASE, modelUrl: string = DEFAULT_MODEL_URL): string {
  const urls = JSON.stringify([
    `${assetsBase}/vision_bundle.mjs`,
    `${assetsBase}/wasm/vision_wasm_internal.js`,
    `${assetsBase}/wasm/vision_wasm_internal.wasm`,
    modelUrl,
  ]).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
const post = (o) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(o));
Promise.all(${urls}.map((u) => fetch(u, { cache: 'force-cache', mode: 'cors' }).then((r) => r.arrayBuffer())))
  .then(() => post({ type: 'prefetch', ok: true }), (e) => post({ type: 'prefetch', ok: false, message: String(e) }));
</script></body></html>`;
}
