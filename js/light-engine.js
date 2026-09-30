function boxMean(src, mask, r, W, H) {
  const w1 = W + 1;
  const I = new Float64Array(w1 * (H + 1)), M = new Float64Array(w1 * (H + 1));
  for (let y = 0; y < H; y++) {
    let rs = 0, rm = 0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x, m = mask ? mask[i] : 1;
      rs += src[i] * m; rm += m;
      const j = (y + 1) * w1 + x + 1;
      I[j] = I[j - w1] + rs; M[j] = M[j - w1] + rm;
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      const a = y0 * w1 + x0, b = y0 * w1 + x1, c = y1 * w1 + x0, d = y1 * w1 + x1;
      const m = M[d] - M[b] - M[c] + M[a];
      out[y * W + x] = m > 0 ? (I[d] - I[b] - I[c] + I[a]) / m : 0;
    }
  }
  return out;
}
function otsuIdx(hist, total) {
  let sum = 0; for (let i = 0; i < hist.length; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = -1, idx = 0;
  for (let i = 0; i < hist.length; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sB += i * hist[i];
    const mB = sB / wB, mF = (sum - sB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; idx = i; }
  }
  return idx;
}
export function detectLight(rgba, W, H, o) {
  const n = W * H;
  const minA = Math.PI / 4 * o.minD * o.minD, maxA = Math.PI / 4 * o.maxD * o.maxD;
  const gray = new Float32Array(n), m = new Uint8Array(n), roi = o.roi;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, k = i * 4;
    gray[i] = 0.299 * rgba[k] + 0.587 * rgba[k + 1] + 0.114 * rgba[k + 2];
    if (!roi) m[i] = 1;
    else { const dx = x - roi.cx, dy = y - roi.cy; m[i] = dx * dx + dy * dy <= roi.r * roi.r ? 1 : 0; }
  }
  const sm = boxMean(gray, null, 1, W, H);
  const bg = boxMean(sm, m, Math.max(12, Math.round(o.maxD)), W, H);

  // 明暗の向き
  let pol = 1;
  if (o.polar === "bright") pol = 1;
  else if (o.polar === "dark") pol = -1;
  else {
    let cnt = 0, sum = 0;
    for (let i = 0; i < n; i++) if (m[i]) { sum += sm[i] - bg[i]; cnt++; }
    if (cnt) {
      const mean = sum / cnt; let s2 = 0, s3 = 0;
      for (let i = 0; i < n; i++) if (m[i]) { const d = sm[i] - bg[i] - mean; s2 += d * d; s3 += d * d * d; }
      pol = s3 >= 0 ? 1 : -1;
    }
  }

  // Otsu でしきい値
  const LO = -64, STEP = 0.75, hist = new Float64Array(256);
  const S = new Float32Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (!m[i]) continue;
    const v = pol * (sm[i] - bg[i]); S[i] = v;
    hist[Math.max(0, Math.min(255, Math.floor((v - LO) / STEP)))]++; total++;
  }
  if (!total) return { colonies: [], thr: 0, pol };
  let thr = (LO + (otsuIdx(hist, total) + 0.5) * STEP) / (o.sens || 1);
  thr = Math.max(thr, 5);
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = m[i] && S[i] > thr ? 1 : 0;

  // 連結成分 → 距離変換で重なりを分離
  const lab = new Int32Array(n), stack = new Int32Array(n), out = [];
  let cid = 0;
  const SQ = 1.4142;
  for (let s0 = 0; s0 < n; s0++) {
    if (!bin[s0] || lab[s0]) continue;
    cid++;
    let sp = 0; stack[sp++] = s0; lab[s0] = cid;
    const px = []; let x0 = W, x1 = -1, y0 = H, y1 = -1;
    while (sp) {
      const p = stack[--sp]; px.push(p);
      const x = p % W, y = (p / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          const q = yy * W + xx;
          if (bin[q] && !lab[q]) { lab[q] = cid; stack[sp++] = q; }
        }
      }
    }
    const area = px.length;
    if (area < minA || area > maxA * 8) continue;

    const bw = x1 - x0 + 3, bh = y1 - y0 + 3;
    const dt = new Float32Array(bw * bh), inside = new Uint8Array(bw * bh);
    for (const p of px) { const i = ((p / W) | 0) - y0 + 1; const j = i * bw + (p % W) - x0 + 1; inside[j] = 1; dt[j] = 1e6; }
    for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
      const i = y * bw + x; if (!inside[i]) continue;
      dt[i] = Math.min(dt[i], dt[i - 1] + 1, dt[i - bw] + 1, dt[i - bw - 1] + SQ, dt[i - bw + 1] + SQ);
    }
    for (let y = bh - 2; y >= 1; y--) for (let x = bw - 2; x >= 1; x--) {
      const i = y * bw + x; if (!inside[i]) continue;
      dt[i] = Math.min(dt[i], dt[i + 1] + 1, dt[i + bw] + 1, dt[i + bw + 1] + SQ, dt[i + bw - 1] + SQ);
    }
    const rmin = Math.max(1.5, o.minD * 0.35), cand = [];
    for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
      const v = dt[y * bw + x]; if (v < rmin) continue;
      let ok = true;
      for (let dy = -2; dy <= 2 && ok; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= bh) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= bw) continue;
          if (dt[yy * bw + xx] > v) { ok = false; break; }
        }
      }
      if (ok) cand.push([x, y, v]);
    }
    cand.sort((a, b) => b[2] - a[2]);
    const peaks = [];
    for (const c of cand) {
      let keep = true;
      for (const q of peaks) if (Math.hypot(c[0] - q[0], c[1] - q[1]) < q[2]) { keep = false; break; }
      if (keep) { peaks.push(c); if (peaks.length >= 300) break; }
    }
    if (!peaks.length) continue;

    let parts;
    if (peaks.length === 1) parts = [px];
    else {
      parts = peaks.map(() => []);
      for (const p of px) {
        const x = (p % W) - x0 + 1, y = ((p / W) | 0) - y0 + 1;
        let b = 0, bd = 1e18;
        for (let k = 0; k < peaks.length; k++) {
          const dx = x - peaks[k][0], dy = y - peaks[k][1], d = dx * dx + dy * dy;
          if (d < bd) { bd = d; b = k; }
        }
        parts[b].push(p);
      }
    }
    for (const part of parts) {
      const a = part.length;
      if (a < minA || a > maxA) continue;
      let bx0 = W, bx1 = -1, by0 = H, by1 = -1, sx = 0, sy = 0;
      for (const p of part) {
        const x = p % W, y = (p / W) | 0;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
        sx += x; sy += y;
      }
      const bw2 = bx1 - bx0 + 1, bh2 = by1 - by0 + 1;
      if (a / (bw2 * bh2) < 0.45 || Math.max(bw2, bh2) / Math.min(bw2, bh2) > 3) continue;
      out.push({ pixels: part, area: a, iou: 1, cx: sx / a, cy: sy / a });
    }
  }
  return { colonies: out, thr, pol };
}
