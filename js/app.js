import { detectLight } from "./light-engine.js";
import { getLocale, initI18n, translate } from "./i18n.mjs";
import { requestPersistentStorage } from "./model-cache.mjs";
import { circleFromBox, circleFromCenter, handlePoints, hitTest, moveRoi, resizeFromHandle } from "./roi-edit.mjs";
const t = (key, values) => translate(key, getLocale(), values);
initI18n();
// SAM用ライブラリは、SAM方式を選んだときだけ読み込む（軽量方式は外部通信なしで動く）
const MODELS = {
  slim: { label: "SlimSAM", id: "Xenova/slimsam-77-uniform", cls: "SamModel",
          lib: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2" },
  sam3: { label: "SAM 3 Tracker", id: "onnx-community/sam3-tracker-ONNX", cls: "Sam3TrackerModel",
          lib: "https://cdn.jsdelivr.net/npm/@huggingface/transformers" }
};
let samKey = "slim";
let tfMod = null, libUrl = null;
let AutoProcessor, RawImage, Tensor, env;
async function loadLib(url) {
  if (libUrl === url) return;
  const m = await import(url);
  tfMod = m; ({ AutoProcessor, RawImage, Tensor, env } = m); libUrl = url;
  env.allowLocalModels = false;
  env.useBrowserCache = typeof globalThis.caches !== "undefined";
  try { env.backends.onnx.wasm.numThreads = 1; } catch {}
}
const MAX_SIDE = 1024;

const $ = (id) => document.getElementById(id);
const view = $("view"), ctx = view.getContext("2d");
const drop = $("drop"), fileInput = $("file"), busy = $("busy");

let model = null, processor = null;
let W = 0, H = 0;
let base = null;                       // 元画像 (offscreen canvas)
let ovCanvas = null, ovCtx = null, ovImg = null;
let imageInputs = null, embeddings = null;
let labelMap = null;                   // 各画素の colony id (0 = なし)
const colonies = new Map();            // id -> {id,pixels,area,cx,cy,color,mult}
let nextId = 1;
let roi = null;                        // {cx,cy,r}
let mode = "roi";
let running = false, cancelFlag = false;
let renderQueued = false;
const newRec = () => ({ autoObjs: 0, autoTotal: 0, removedAuto: 0, thr: null, pol: null, ranAt: null, engine: null, samLabel: null });
let rec = newRec();
let imgInfo = { name: "", ow: 0, oh: 0 };
function resetRec() { rec = newRec(); }
function finishRec() {
  rec.autoObjs = colonies.size; rec.autoTotal = stats().total;
  rec.ranAt = nowStr(); rec.engine = engine; rec.samLabel = MODELS[samKey].label;
}
const nowStr = () => new Date().toLocaleString("sv-SE");
let engine = "light";

/* ---------- UI helpers ---------- */
const fmt = (v) => String(v);
function setProg(w) { $("runBar").style.width = w; $("mBar").style.width = w; }
function bindRange(id, suffix = "") {
  const el = $(id), out = $(id + "O");
  const upd = () => { out.textContent = el.value + suffix; };
  el.addEventListener("input", upd); upd();
}
bindRange("spacing", " px"); bindRange("minD", " px"); bindRange("maxD", " px"); bindRange("iou"); bindRange("sens", " ×");
if (matchMedia("(pointer:coarse)").matches) { $("spacing").value = 26; $("spacing").dispatchEvent(new Event("input")); }

let busyState = { key: "", values: {} };
let runStatusState = { key: "", values: {}, err: false };
let modelStatusState = { key: "model.waiting", values: {}, cls: "" };
function setBusy(key = "", values = {}) {
  busyState = { key, values };
  busy.style.display = key ? "block" : "none";
  busy.textContent = key ? t(key, values) : "";
}
function setRunStatus(key = "", values = {}, err = false) {
  runStatusState = { key, values, err };
  const e = $("runStatus"); e.textContent = key ? t(key, values) : ""; e.className = err ? "err" : "";
}
function setModelStatus(key, values = {}, cls = "") {
  modelStatusState = { key, values, cls };
  const e = $("modelStatus"); e.textContent = t(key, values); e.className = cls;
}

const hints = {
  roi: "hint.roi",
  add: "hint.add",
  remove: "hint.remove"
};
function setMode(m) {
  mode = m;
  $("mRoi").setAttribute("aria-pressed", m === "roi");
  $("mAdd").setAttribute("aria-pressed", m === "add");
  $("mDel").setAttribute("aria-pressed", m === "remove");
  view.className = m;
  view.style.cursor = "";
  if (base) queueRender();                                   // ハンドル表示の切替
  $("modeHint").textContent = t(hints[m]);
}
$("mRoi").onclick = () => setMode("roi");
$("mAdd").onclick = () => setMode("add");
$("mDel").onclick = () => setMode("remove");
$("clearRoi").onclick = () => { roi = null; queueRender(); };

function updateButtons() {
  const hasImg = !!base;
  const ready = hasImg && (engine === "light" || (!!embeddings && !!model));
  ["mRoi", "mAdd", "mDel", "clearRoi"].forEach((id) => { $(id).disabled = !hasImg; });
  $("mAdd").disabled = !ready || running;
  $("run").disabled = !ready || running;
  $("stop").disabled = !running;
  $("dlCsv").disabled = colonies.size === 0;
  $("dlPng").disabled = !hasImg;
  $("dlLog").disabled = !hasImg;
  $("mRun").disabled = running ? false : !ready;
  $("mRun").textContent = t(running ? "action.stop" : "action.run");
}

/* ---------- Model ---------- */
const isMobile = matchMedia("(pointer:coarse)").matches;
let modelPromise = null;
function ensureModel() { return (modelPromise ||= loadModel()); }
async function loadModel() {
  const cb = (d) => {
    if (d.status === "progress" && d.file) {
      const p = Math.round(d.progress || 0);
      setModelStatus("status.modelFile", { file: d.file.split("/").pop(), percent: p });
      $("modelBar").style.width = p + "%";
    }
  };
  const spec = MODELS[samKey];
  const load = async (opts) => {
    const Cls = tfMod[spec.cls];
    if (!Cls) throw new Error(t("status.modelClassMissing", { className: spec.cls }));
    const m = await Cls.from_pretrained(spec.id, { progress_callback: cb, ...opts });
    const pr = await AutoProcessor.from_pretrained(spec.id, { progress_callback: cb });
    return [m, pr];
  };
  try {
    setModelStatus("status.libraryLoading");
    await loadLib(spec.lib);
    await requestPersistentStorage(navigator.storage);
    setModelStatus("status.modelDownloading", { model: spec.label });
    // スマホのSlimSAMは量子化でメモリ節約 / SAM 3 はWebGPUが使えれば使う
    const first = samKey === "slim" ? (isMobile ? { dtype: "q8" } : {})
                                     : (navigator.gpu ? { device: "webgpu" } : {});
    try {
      [model, processor] = await load(first);
    } catch (e) {
      if (!Object.keys(first).length) throw e;
      console.warn("load with options failed, falling back", e);
      setModelStatus("status.modelRetry");
      [model, processor] = await load({});
    }
    $("modelBar").style.width = "100%";
    setModelStatus("status.modelReady", { model: spec.label }, "ok");
  } catch (e) {
    console.error(e);
    modelPromise = null;
    setModelStatus("status.modelError", { error: e.message || e }, "err");
  }
  updateButtons();
}
// スマホはカメラ起動中にタブが破棄されやすいので、写真を受け取るまでモデルを読み込まない
if (engine === "sam") ensureModel();
else setModelStatus("status.selectSam");

async function encodeImage() {
  if (!model || !processor || !base) return;
  setBusy("status.imageAnalyzing");
  try {
    const blob = await new Promise((r) => base.toBlob(r, "image/png"));
    const url = URL.createObjectURL(blob);
    const raw = await RawImage.read(url);
    URL.revokeObjectURL(url);
    imageInputs = await processor(raw);
    embeddings = await model.get_image_embeddings(imageInputs);
    setRunStatus("status.readyImage");
  } catch (e) {
    console.error(e);
    setRunStatus("status.imageAnalysisError", { error: e.message || e }, true);
  } finally {
    setBusy("");
    updateButtons();
  }
}

/* ---------- Image loading ---------- */
async function loadImage(file) {
  if (!file) return;
  cancelFlag = true;
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  } catch { setRunStatus("status.imageOpenError", {}, true); return; }
  const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  W = Math.round(img.naturalWidth * s); H = Math.round(img.naturalHeight * s);
  imgInfo = { name: file.name || "camera", ow: img.naturalWidth, oh: img.naturalHeight };
  resetRec();
  base = document.createElement("canvas"); base.width = W; base.height = H;
  base.getContext("2d").drawImage(img, 0, 0, W, H);
  URL.revokeObjectURL(url);

  ovCanvas = document.createElement("canvas"); ovCanvas.width = W; ovCanvas.height = H;
  ovCtx = ovCanvas.getContext("2d");
  ovImg = ovCtx.createImageData(W, H);

  view.width = W; view.height = H; view.hidden = false;
  drop.style.display = "none";

  colonies.clear(); nextId = 1;
  labelMap = new Int32Array(W * H);
  embeddings = null; imageInputs = null;
  const m = Math.min(W, H);
  roi = { cx: W / 2, cy: H / 2, r: m * 0.47 };
  setMode("roi");
  setRunStatus("");
  setProg("0");
  updateButtons(); queueRender(); updateCount();
  if (engine === "sam") {
    setBusy("status.modelPreparing");
    await ensureModel();
    setBusy("");
    if (model) await encodeImage();
  } else {
    setRunStatus("status.readyImage");
  }
}
const camInput = $("cam");
drop.addEventListener("click", () => fileInput.click());
$("dCam").addEventListener("click", (e) => { e.stopPropagation(); camInput.click(); });
$("dPick").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
$("camBtn").addEventListener("click", () => camInput.click());
$("pickBtn").addEventListener("click", () => fileInput.click());
camInput.addEventListener("change", () => { loadImage(camInput.files[0]); camInput.value = ""; });
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener("change", () => { loadImage(fileInput.files[0]); fileInput.value = ""; });
["dragenter", "dragover"].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
document.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) loadImage(f); });
$("view").addEventListener("dblclick", () => {}); // no-op
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.key === "o") fileInput.click();
  // 矢印キーでシャーレ範囲を微調整（Shiftで10px）
  const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (step && roi && base && mode === "roi" && !/^(SELECT|TEXTAREA)$/.test(e.target.tagName)) {
    e.preventDefault();
    const k = e.shiftKey ? 10 : 1;
    roi = moveRoi(roi, step[0] * k, step[1] * k); queueRender();
  }
});

/* ---------- SAM segmentation of one point ---------- */
async function segmentAt(x, y) {
  const reshaper = typeof processor.reshape_input_points === "function"
    ? processor
    : (processor.image_processor || processor.components?.image_processor);
  const pts = reshaper.reshape_input_points(
    [[[x, y]]], imageInputs.original_sizes, imageInputs.reshaped_input_sizes
  );
  const labels = new Tensor("int64", new BigInt64Array([1n]), [1, 1, 1]);
  const out = await model({ ...embeddings, input_points: pts, input_labels: labels });
  const poster = typeof processor.post_process_masks === "function"
    ? processor
    : (processor.image_processor || processor.components?.image_processor);
  const masks = await poster.post_process_masks(
    out.pred_masks, imageInputs.original_sizes, imageInputs.reshaped_input_sizes
  );
  return { mask: masks[0], iou: Array.from(out.iou_scores.data) };
}

function params() {
  const minD = +$("minD").value, maxD = +$("maxD").value;
  return {
    minA: Math.PI / 4 * minD * minD,
    maxA: Math.PI / 4 * maxD * maxD,
    R: Math.ceil(maxD * 0.9) + 4,
    iouThr: +$("iou").value,
    spacing: +$("spacing").value
  };
}

// 3つの候補マスクからコロニーらしいものを選ぶ
function pickCandidate(res, x, y, P) {
  const data = res.mask.data;
  const dims = res.mask.dims;          // [1, 3, H, W]
  const K = dims[dims.length - 3], mh = dims[dims.length - 2], mw = dims[dims.length - 1];
  const x0 = Math.max(0, x - P.R), x1 = Math.min(mw - 1, x + P.R);
  const y0 = Math.max(0, y - P.R), y1 = Math.min(mh - 1, y + P.R);
  let best = null;
  for (let k = 0; k < K; k++) {
    if ((res.iou[k] ?? 0) < P.iouThr) continue;
    const off = k * mh * mw;
    const pixels = [];
    let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1, sx = 0, sy = 0, touches = false;
    for (let yy = y0; yy <= y1; yy++) {
      const row = off + yy * mw;
      for (let xx = x0; xx <= x1; xx++) {
        if (data[row + xx]) {
          pixels.push(yy * mw + xx);
          if (xx < minx) minx = xx; if (xx > maxx) maxx = xx;
          if (yy < miny) miny = yy; if (yy > maxy) maxy = yy;
          sx += xx; sy += yy;
          if ((xx === x0 && x0 > 0) || (xx === x1 && x1 < mw - 1) ||
              (yy === y0 && y0 > 0) || (yy === y1 && y1 < mh - 1)) touches = true;
        }
      }
    }
    const area = pixels.length;
    if (area < P.minA || area > P.maxA || touches) continue;
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    if (area / (bw * bh) < 0.5) continue;                       // 細長い/不規則な形を除外
    if (Math.max(bw, bh) / Math.min(bw, bh) > 2.4) continue;
    if (!(data[off + y * mw + x])) continue;                    // 指定点を含むこと
    if (!best || res.iou[k] > best.iou) {
      best = { pixels, area, iou: res.iou[k], cx: sx / area, cy: sy / area };
    }
  }
  return best;
}

function inRoi(x, y) {
  if (!roi) return true;
  const dx = x - roi.cx, dy = y - roi.cy;
  return dx * dx + dy * dy <= roi.r * roi.r;
}

function addColony(c, maxOverlap = 0.3) {
  if (!inRoi(c.cx, c.cy)) return false;
  let ov = 0;
  for (const p of c.pixels) if (labelMap[p] > 0) ov++;
  if (ov / c.pixels.length > maxOverlap) return false;
  const id = nextId++;
  c.id = id;
  const hue = (id * 137.508) % 360;
  c.color = hslToRgb(hue / 360, 0.85, 0.55);
  c.mult = 1;
  for (const p of c.pixels) if (labelMap[p] === 0) labelMap[p] = id;
  colonies.set(id, c);
  return true;
}
function removeColony(id) {
  const c = colonies.get(id); if (!c) return;
  for (const p of c.pixels) if (labelMap[p] === id) labelMap[p] = 0;
  colonies.delete(id);
}
function hslToRgb(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/* ---------- Auto detection ---------- */
async function runAuto() {
  if (engine === "light") return runLight();
  if (running || !embeddings) return;
  const P = params();
  colonies.clear(); nextId = 1; labelMap.fill(0); resetRec();

  const pts = [];
  let row = 0;
  for (let y = P.spacing / 2; y < H; y += P.spacing, row++) {
    for (let x = P.spacing / 2 + (row % 2 ? P.spacing / 2 : 0); x < W; x += P.spacing) {
      const xi = Math.round(x), yi = Math.round(y);
      if (inRoi(xi, yi)) pts.push([xi, yi]);
    }
  }
  if (!pts.length) { setRunStatus("status.noPoints", {}, true); return; }

  running = true; cancelFlag = false; updateButtons();
  const t0 = performance.now();
  let done = 0;
  let wl = null;
  try { wl = await navigator.wakeLock?.request("screen"); } catch {}
  try {
    for (const [x, y] of pts) {
      if (cancelFlag) break;
      done++;
      if (labelMap[y * W + x] === 0) {
        const res = await segmentAt(x, y);
        const cand = pickCandidate(res, x, y, P);
        if (cand) { cand.src = "auto"; addColony(cand); }
      }
      if (done % 4 === 0) {
        setProg((done / pts.length * 100).toFixed(1) + "%");
        const el = (performance.now() - t0) / 1000;
        const eta = el / done * (pts.length - done);
        setRunStatus("status.progress", { done, total: pts.length, seconds: Math.ceil(eta) });
        updateCount(); queueRender();
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    setProg("100%");
    setRunStatus(cancelFlag ? "status.stopped" : "status.done", {
      seconds: ((performance.now() - t0) / 1000).toFixed(1)
    });
  } catch (e) {
    console.error(e);
    setRunStatus("status.detectionError", { error: e.message || e }, true);
  } finally {
    try { wl?.release(); } catch {}
    finishRec();
    running = false; updateButtons(); updateCount(); queueRender();
  }
}
$("run").onclick = runAuto;
$("stop").onclick = () => { cancelFlag = true; };
$("mRun").onclick = () => { running ? (cancelFlag = true) : runAuto(); };
$("cluster").addEventListener("change", () => { updateCount(); queueRender(); });

/* ---------- Light engine (no SAM) ---------- */


async function runLight() {
  if (running || !base) return;
  colonies.clear(); nextId = 1; labelMap.fill(0); resetRec();
  running = true; cancelFlag = false; updateButtons();
  setBusy("status.detecting"); setRunStatus(""); setProg("30%");
  await new Promise((r) => setTimeout(r, 40));
  try {
    const rgba = base.getContext("2d").getImageData(0, 0, W, H).data;
    const res = detectLight(rgba, W, H, {
      roi, minD: +$("minD").value, maxD: +$("maxD").value,
      sens: +$("sens").value, polar: $("polar").value
    });
    for (const c of res.colonies) { c.src = "auto"; addColony(c); }
    rec.thr = res.thr; rec.pol = res.pol;
    setProg("100%");
    setRunStatus("status.lightDone", {
      polarity: t(res.pol > 0 ? "status.polarityBright" : "status.polarityDark")
    });
  } catch (e) {
    console.error(e);
    setRunStatus("status.detectionError", { error: e.message || e }, true);
  } finally {
    setBusy(""); finishRec(); running = false; updateButtons(); updateCount(); queueRender();
  }
}

/* ---------- Counting ---------- */
function stats() {
  const list = [...colonies.values()];
  if (!list.length) return { n: 0, total: 0, extra: 0, med: 0 };
  const areas = list.map((c) => c.area).sort((a, b) => a - b);
  const med = areas[Math.floor(areas.length / 2)];
  const useCluster = $("cluster").checked && list.length >= 5;
  let total = 0;
  for (const c of list) {
    c.mult = useCluster && c.area > 1.7 * med ? Math.max(1, Math.round(c.area / med)) : 1;
    total += c.mult;
  }
  return { n: list.length, total, extra: total - list.length, med };
}
function updateCount() {
  const s = stats();
  const shown = s.n ? s.total : (base ? "0" : "–");
  $("total").textContent = shown; $("mTotal").textContent = shown;
  $("sub").textContent = s.n
    ? (s.extra > 0 ? t("status.countAndExtra", { count: s.n, extra: s.extra }) : t("status.countOnly", { count: s.n }))
    : "";
  updateButtons();
}

/* ---------- Rendering ---------- */
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}
function render() {
  if (!base) return;
  ctx.globalAlpha = 1;
  ctx.drawImage(base, 0, 0);

  const d = ovImg.data; d.fill(0);
  for (const c of colonies.values()) {
    const [r, g, b] = c.color, id = c.id;
    for (const p of c.pixels) {
      if (labelMap[p] !== id) continue;
      const x = p % W, y = (p / W) | 0;
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
        labelMap[p - 1] !== id || labelMap[p + 1] !== id ||
        labelMap[p - W] !== id || labelMap[p + W] !== id;
      const o = p * 4;
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = edge ? 255 : 105;
    }
  }
  ovCtx.putImageData(ovImg, 0, 0);
  ctx.drawImage(ovCanvas, 0, 0);

  // 換算した塊のラベル
  ctx.font = `bold ${Math.max(11, Math.round(W / 70))}px sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const c of colonies.values()) {
    if (c.mult > 1) {
      const t = "×" + c.mult;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.75)";
      ctx.strokeText(t, c.cx, c.cy);
      ctx.fillStyle = "#fff"; ctx.fillText(t, c.cx, c.cy);
    }
  }

  if (roi) {
    ctx.save();
    ctx.lineWidth = Math.max(2, W / 400);
    ctx.setLineDash([10, 7]);
    ctx.strokeStyle = "#ffd166";
    ctx.beginPath(); ctx.arc(roi.cx, roi.cy, roi.r, 0, Math.PI * 2); ctx.stroke();
    if (mode === "roi") {                                     // PowerPoint風のリサイズハンドル
      const hs = Math.max(4, 5 * pxScale());
      ctx.setLineDash([]); ctx.fillStyle = "#fff"; ctx.lineWidth = Math.max(1, hs / 3);
      for (const [hx, hy] of Object.values(handlePoints(roi))) {
        ctx.fillRect(hx - hs, hy - hs, 2 * hs, 2 * hs); ctx.strokeRect(hx - hs, hy - hs, 2 * hs, 2 * hs);
      }
    }
    ctx.restore();
  }
}

/* ---------- Pointer interaction ---------- */
function toImg(e) {
  const r = view.getBoundingClientRect();
  return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height];
}
// シャーレ範囲：空き領域ドラッグで作成（Alt/Ctrlで中心から）、内側で移動、ハンドルで反対側固定のリサイズ
const HANDLE_PX = 12;                                         // ハンドル当たり半径（画面px）
const pxScale = () => W / view.getBoundingClientRect().width; // 画面px → 画像px
const ROI_CURSORS = { move: "move", create: "crosshair", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
let drag = null;                                              // {kind, dir?, start:[x,y], roi0, fromCenter}
view.addEventListener("pointerdown", (e) => {
  if (!base || mode !== "roi") return;
  const [x, y] = toImg(e);
  const hit = hitTest(roi, x, y, HANDLE_PX * pxScale());
  drag = { ...hit, start: [x, y], roi0: roi, fromCenter: e.altKey || e.ctrlKey };
  view.setPointerCapture(e.pointerId);
  if (hit.kind === "create") { roi = circleFromBox(x, y, x, y); queueRender(); }
});
view.addEventListener("click", async (e) => {
  if (!base) return;
  const [x, y] = toImg(e);
  if (mode === "remove") {
    let id = labelMap[Math.round(y) * W + Math.round(x)];
    if (!id) {
      let bd = 20 * 20;
      for (const c of colonies.values()) {
        const d2 = (c.cx - x) ** 2 + (c.cy - y) ** 2;
        if (d2 < bd) { bd = d2; id = c.id; }
      }
    }
    if (id) { const cc = colonies.get(id); if (cc && cc.src !== "manual") rec.removedAuto++; removeColony(id); updateCount(); queueRender(); }
  } else if (mode === "add" && engine === "light") {
    const list = [...colonies.values()];
    let rad = (+$("minD").value + +$("maxD").value) / 4;
    if (list.length) {
      const ar = list.map((c) => c.area).sort((a, b) => a - b);
      rad = Math.sqrt(ar[Math.floor(ar.length / 2)] / Math.PI);
    }
    const pixels = [], cx = Math.round(x), cy = Math.round(y), ri = Math.ceil(rad);
    for (let yy = cy - ri; yy <= cy + ri; yy++) for (let xx = cx - ri; xx <= cx + ri; xx++) {
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && (xx - cx) ** 2 + (yy - cy) ** 2 <= rad * rad) pixels.push(yy * W + xx);
    }
    if (pixels.length && addColony({ pixels, area: pixels.length, iou: 1, cx, cy, src: "manual" }, 0.5)) {
      updateCount(); queueRender(); setRunStatus("status.addedCircle");
    } else setRunStatus("status.addUnavailable", {}, true);
  } else if (mode === "add") {
    if (running || !embeddings) return;
    const xi = Math.round(x), yi = Math.round(y);
    setBusy("status.segmenting");
    try {
      const P = params();
      P.iouThr = Math.min(P.iouThr, 0.7);
      const res = await segmentAt(xi, yi);
      const cand = pickCandidate(res, xi, yi, P);
      if (cand) cand.src = "manual";
      if (cand && addColony(cand, 0.5)) { updateCount(); queueRender(); setRunStatus("status.added"); }
      else setRunStatus("status.notFound", {}, true);
    } catch (err) { console.error(err); setRunStatus("status.error", { error: err.message || err }, true); }
    finally { setBusy(""); }
  }
});
view.addEventListener("pointermove", (e) => {
  if (!base || mode !== "roi") return;
  const [x, y] = toImg(e);
  if (!drag) {
    const hit = hitTest(roi, x, y, HANDLE_PX * pxScale());
    view.style.cursor = ROI_CURSORS[hit.dir || hit.kind];
    return;
  }
  const [x0, y0] = drag.start;
  if (drag.kind === "create") roi = drag.fromCenter ? circleFromCenter(x0, y0, x, y) : circleFromBox(x0, y0, x, y);
  else if (drag.kind === "move") roi = moveRoi(drag.roi0, x - x0, y - y0);
  else roi = resizeFromHandle(drag.roi0, drag.dir, x, y);
  queueRender();
});
view.addEventListener("pointerup", () => { drag = null; });
view.addEventListener("pointercancel", () => { drag = null; });
view.addEventListener("pointerleave", () => { if (!drag) view.style.cursor = ""; });

/* ---------- Export ---------- */
function download(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const BOM = "\ufeff";
const csvCell = (v) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
function methodName() {
  const e = rec.engine || engine;
  return e === "light" ? t("method.light") : (rec.samLabel || MODELS[samKey].label);
}
function manualAlive() { let n = 0; for (const c of colonies.values()) if (c.src === "manual") n++; return n; }
function buildRecord() {
  const st = stats(), e = rec.engine || engine;
  const rows = [
    [t("record.timestamp"), nowStr()],
    [t("record.imageName"), imgInfo.name],
    [t("record.originalSize"), `${imgInfo.ow}×${imgInfo.oh}`],
    [t("record.analysisSize"), `${W}×${H}`],
    [t("record.method"), methodName()],
    [t("record.diameter"), `${$("minD").value}–${$("maxD").value}`],
  ];
  if (e === "light") {
    rows.push([t("record.polaritySetting"), t(`polar.${$("polar").value}`)]);
    if (rec.pol != null) rows.push([t("record.detectedPolarity"), t(rec.pol > 0 ? "polar.bright" : "polar.dark")]);
    rows.push([t("record.sensitivity"), $("sens").value]);
    if (rec.thr != null) rows.push([t("record.threshold"), rec.thr.toFixed(1)]);
  } else {
    rows.push([t("record.spacing"), $("spacing").value], [t("record.iou"), $("iou").value]);
  }
  rows.push(
    [t("record.cluster"), t($("cluster").checked ? "record.yes" : "record.no")],
    [t("record.roi"), roi ? t("record.roiCenter", {
      x: roi.cx.toFixed(0), y: roi.cy.toFixed(0), radius: roi.r.toFixed(0)
    }) : t("record.none")],
    [t("record.autoObjects"), rec.autoObjs],
    [t("record.autoCount"), rec.autoTotal],
    [t("record.removed"), rec.removedAuto],
    [t("record.manual"), manualAlive()],
    [t("record.finalObjects"), st.n],
    [t("record.finalCount"), st.total],
    [t("record.clusterExtra"), st.extra]
  );
  return rows;
}
$("dlCsv").onclick = () => {
  stats();
  const lines = ["id,x_px,y_px,area_px,equiv_diameter_px,count,source"];
  let i = 1;
  for (const c of colonies.values()) {
    lines.push([i++, c.cx.toFixed(1), c.cy.toFixed(1), c.area,
      (2 * Math.sqrt(c.area / Math.PI)).toFixed(1), c.mult, c.src || "auto"].join(","));
  }
  download("colonies.csv", new Blob([BOM + lines.join("\n")], { type: "text/csv" }));
};
$("dlLog").onclick = () => {
  const lines = [t("record.csvHeading"), ...buildRecord().map(([k, v]) => csvCell(k) + "," + csvCell(v))];
  download("colony_record.csv", new Blob([BOM + lines.join("\n")], { type: "text/csv" }));
};
$("dlPng").onclick = () => {
  render();
  const st = stats();
  const fs = Math.max(12, Math.round(W / 55)), bandH = Math.round(fs * 3.8);
  const c = document.createElement("canvas"); c.width = W; c.height = H + bandH;
  const x = c.getContext("2d");
  x.drawImage(view, 0, 0);
  x.fillStyle = "#14262b"; x.fillRect(0, H, W, bandH);
  x.fillStyle = "#ffffff"; x.textBaseline = "top";
  x.font = `bold ${fs}px sans-serif`;
  const annotation = t("export.annotation", {
    method: methodName(), auto: rec.autoTotal, removed: rec.removedAuto,
    added: manualAlive(), total: st.total
  });
  x.fillText(annotation, fs * 0.6, H + fs * 0.5, Math.max(1, W - fs * 1.2));
  x.font = `${Math.round(fs * 0.85)}px sans-serif`; x.fillStyle = "#b9d3d2";
  x.fillText(`${nowStr()}　${imgInfo.name}`, fs * 0.6, H + fs * 2.1);
  c.toBlob((b) => download("colonies_result.png", b), "image/png");
};

/* ---------- Help popovers ---------- */
const HELP = {
  samModel: ["help.samModel.title", ["help.samModel.slim", "help.samModel.sam3", "help.samModel.tip"]],
  engine: ["help.engine.title", ["help.engine.light", "help.engine.sam", "help.engine.tip"]],
  polar: ["help.polar.title", ["help.polar.1", "help.polar.2", "help.polar.tip"]],
  sens: ["help.sens.title", ["help.sens.1", "help.sens.2", "help.sens.tip"]],
  spacing: ["help.spacing.title", ["help.spacing.1", "help.spacing.2", "help.spacing.tip"]],
  minD: ["help.minD.title", ["help.minD.1", "help.minD.2", "help.minD.tip"]],
  maxD: ["help.maxD.title", ["help.maxD.1", "help.maxD.2", "help.maxD.tip"]],
  iou: ["help.iou.title", ["help.iou.1", "help.iou.2", "help.iou.tip"]],
  cluster: ["help.cluster.title", ["help.cluster.1", "help.cluster.2", "help.cluster.tip"]]
};
const pop = $("pop");
let popBtn = null;
function closePop() {
  pop.style.display = "none";
  if (popBtn) { popBtn.setAttribute("aria-expanded", "false"); popBtn = null; }
}
function openPop(btn) {
  const h = HELP[btn.dataset.help]; if (!h) return;
  closePop();
  popBtn = btn; btn.setAttribute("aria-expanded", "true");
  pop.innerHTML = `<b>${t(h[0])}</b>` + h[1].map((key) => `<p>${t(key)}</p>`).join("");
  pop.style.display = "block";
  const r = btn.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = Math.min(Math.max(8, r.left - 12), window.innerWidth - pw - 8);
  let top = r.bottom + 8;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 8);
  pop.style.left = left + "px"; pop.style.top = top + "px";
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".help");
  if (btn) { e.preventDefault(); popBtn === btn ? closePop() : openPop(btn); return; }
  if (!pop.contains(e.target)) closePop();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { const b = popBtn; closePop(); if (b) b.focus(); } });
window.addEventListener("scroll", closePop, true);
window.addEventListener("resize", closePop);
document.addEventListener("localechange", () => {
  closePop();
  setMode(mode);
  setBusy(busyState.key, busyState.values);
  setRunStatus(runStatusState.key, runStatusState.values, runStatusState.err);
  setModelStatus(modelStatusState.key, modelStatusState.values, modelStatusState.cls);
  updateCount();
});

document.body.dataset.engine = engine;
$("samModel").addEventListener("change", async () => {
  samKey = $("samModel").value;
  cancelFlag = true;
  try { await model?.dispose?.(); } catch {}
  model = null; processor = null; embeddings = null; imageInputs = null; modelPromise = null;
  $("modelBar").style.width = "0";
  closePop(); updateButtons();
  if (engine === "sam") {
    setBusy("status.modelPreparing");
    await ensureModel();
    setBusy("");
    if (model && base) await encodeImage();
  }
});
document.querySelectorAll('input[name="engine"]').forEach((r) => {
  r.checked = r.value === engine;
  r.addEventListener("change", async () => {
    if (!r.checked) return;
    engine = r.value;
    document.body.dataset.engine = engine;
    closePop(); updateButtons();
    if (engine === "sam") {
      if (isMobile) setRunStatus("status.mobileWarning", {}, true);
      if (base && !embeddings) {
        setBusy("status.modelPreparing");
        await ensureModel();
        setBusy("");
        if (model) await encodeImage();
      } else ensureModel();
    } else {
      setRunStatus("status.ready");
    }
  });
});

setMode("roi");
updateButtons();
