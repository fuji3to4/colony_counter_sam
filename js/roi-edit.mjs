// シャーレ範囲（円 {cx,cy,r}）の PowerPoint 風編集ロジック。座標はすべて画像ピクセル。
export const MIN_R = 5;

export function handlePoints({ cx, cy, r }) {
  return { n: [cx, cy - r], e: [cx + r, cy], s: [cx, cy + r], w: [cx - r, cy] };
}

// tol: ハンドルの当たり半径（画像ピクセル）
export function hitTest(roi, x, y, tol) {
  if (!roi) return { kind: "create" };
  for (const [dir, [hx, hy]] of Object.entries(handlePoints(roi))) {
    if ((x - hx) ** 2 + (y - hy) ** 2 <= tol * tol) return { kind: "handle", dir };
  }
  if ((x - roi.cx) ** 2 + (y - roi.cy) ** 2 <= roi.r * roi.r) return { kind: "move" };
  return { kind: "create" };
}

// ドラッグ矩形に内接する円（長辺基準、始点の角を固定）
export function circleFromBox(x0, y0, x1, y1) {
  const r = Math.max(MIN_R, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2);
  return { cx: x0 + Math.sign(x1 - x0 || 1) * r, cy: y0 + Math.sign(y1 - y0 || 1) * r, r };
}

export function circleFromCenter(cx, cy, x, y) {
  return { cx, cy, r: Math.max(MIN_R, Math.hypot(x - cx, y - cy)) };
}

// 反対側のハンドルを固定してリサイズ。反対側を越えたら最小半径で止める。
export function resizeFromHandle({ cx, cy, r }, dir, x, y) {
  switch (dir) {
    case "e": { const f = cx - r, nr = Math.max(MIN_R, (x - f) / 2); return { cx: f + nr, cy, r: nr }; }
    case "w": { const f = cx + r, nr = Math.max(MIN_R, (f - x) / 2); return { cx: f - nr, cy, r: nr }; }
    case "s": { const f = cy - r, nr = Math.max(MIN_R, (y - f) / 2); return { cx, cy: f + nr, r: nr }; }
    case "n": { const f = cy + r, nr = Math.max(MIN_R, (f - y) / 2); return { cx, cy: f - nr, r: nr }; }
    default: return { cx, cy, r };
  }
}

export function moveRoi({ cx, cy, r }, dx, dy) {
  return { cx: cx + dx, cy: cy + dy, r };
}
