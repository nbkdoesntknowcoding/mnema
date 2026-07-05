// apps/web/src/components/graph/environment.ts

// Pre-compute star field positions once (static, never recalculated)
export interface Star { x: number; y: number; r: number; a: number; }

export function generateStars(canvasW: number, canvasH: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < 200; i++) {
    stars.push({
      x: Math.random() * canvasW,
      y: Math.random() * canvasH,
      r: Math.random() * 0.8 + 0.2,
      a: Math.random() * 0.35 + 0.05,
    });
  }
  return stars;
}

// Draw stars onto the canvas background (called before nodes/edges render)
export function drawStars(ctx: CanvasRenderingContext2D, stars: Star[]): void {
  ctx.save();
  for (const s of stars) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, 2 * Math.PI);
    ctx.fillStyle = `rgba(255,255,255,${s.a})`;
    ctx.fill();
  }
  ctx.restore();
}

// Brain boundary shell — 2D projection of the 3D brain shape.
// Pre-computed ellipse points with the same MRI proportions as before.
// Called once after onEngineStop with the graph's bounding radius.
export interface BrainPoint { x: number; y: number; }

export function generateBrainShell(
  cx: number,          // graph centre X in graph coords
  cy: number,          // graph centre Y in graph coords
  graphRadius: number, // actual radius of settled graph
): BrainPoint[] {
  const r    = graphRadius * 1.5;
  const pts: BrainPoint[] = [];
  const golden = Math.PI * (1 + Math.sqrt(5));

  for (let i = 0; i < 600; i++) {
    const t    = i / 600;
    const incl = Math.acos(1 - 2 * t);
    const azim = golden * i;
    // Project 3D brain shape onto XY plane (top-down view)
    let x = 0.83 * Math.sin(incl) * Math.cos(azim);
    const y = 1.00 * Math.sin(incl) * Math.sin(azim);

    // Frontal/occipital narrowing (z-axis mapped to y in 2D top view)
    if (y < -0.65) { const f = (-y - 0.65) / 0.35; x *= (1 - 0.25 * f); }
    if (y > 0.65)  { const f = (y - 0.65) / 0.35;  x *= (1 - 0.35 * f); }

    // Interhemispheric fissure (centre dip at x≈0)
    // In top-down view this is a slight inward curve at the midline
    const fissure = 0.05 * Math.exp(-Math.pow(x / 0.07, 2));
    if (x > 0) x -= fissure;
    else x += fissure;

    pts.push({ x: cx + x * r, y: cy + y * r });
  }
  return pts;
}

// Draw brain shell dots onto the canvas
export function drawBrainShell(
  ctx: CanvasRenderingContext2D,
  pts: BrainPoint[],
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(123,158,196,0.28)';
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.2, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}
