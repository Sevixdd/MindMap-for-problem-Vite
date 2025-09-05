import React, { useMemo, useRef, useState } from "react";

/* ---------- Visual + layout constants ---------- */
const ROOT_RADIUS = 110;
const CAUSE_RADIUS = 62;
const SUB_RADIUS = 46;

const WIDTH = 2400;
const HEIGHT = 1000;

const STROKE = "#64748b";        // circle outline (slate-500)
const STROKE_LIGHT = "#94a3b8";  // connectors (slate-400)
const STROKE_W = 3;
const TEXT = "#0f172a";

const ROOT_CAUSE_DISTANCE = 220;    // causes close to root
const CAUSE_SUB_DISTANCE  = 165;

const PADDING = 10;       // extra gap for collision solver
const ITERATIONS = 280;

const MIN_Z = 0.6;
const MAX_Z = 3;

/* ---------- Types ---------- */
type SubCause = { label: string; x?: number; y?: number; angle?: number };
type Cause = { label: string; subs: SubCause[]; x?: number; y?: number; angle?: number };
type Root = { label: string; x: number; y: number; causes: Cause[] };

type BubbleRef = { x: number; y: number; r: number; fixed?: boolean; _apply?: () => void };

type NodeKind = "root" | "cause" | "sub";
type NodeSide = "left" | "right";

type DragState =
  | { mode: "pan"; startX: number; startY: number; startPan: { x: number; y: number } }
  | {
      mode: "node";
      pointerId: number;
      side: NodeSide;
      kind: NodeKind;
      i: number;
      j?: number;
      offset: { dx: number; dy: number };
    };

/* ---------- Data ---------- */
const DATA: Root[] = [
  {
    label: "Inspiration Blockage",
    x: 580,
    y: 500,
    causes: [
      { label: "Time Scarcity", subs: [
        { label: "Solo creator juggling tasks" },
        { label: "No batching workflow" },
        { label: "Not leveraging automation (script→video)" },
      ]},
      { label: "Analysis Paralysis", subs: [
        { label: "Too many format options" },
        { label: "No presets / brand guardrails" },
        { label: "Not using Smart Posting guidance" },
      ]},
      { label: "Low Trend Visibility", subs: [
        { label: "Not using community template board" },
        { label: "No competitor/trend scan" },
        { label: "Platform changes unnoticed" },
      ]},
      { label: "Burnout / Fear", subs: [
        { label: "Perfectionism & over-editing" },
        { label: "On-camera anxiety" },
        { label: "No scripts/prompts to start" },
      ]},
      { label: "Weak Feedback Loop", subs: [
        { label: "Not reviewing analytics" },
        { label: "No A/B tests" },
        { label: "Ignoring engagement insights" },
      ]},
    ],
  },
  {
    label: "Low Engagement Score",
    x: 1620,
    y: 500,
    causes: [
      { label: "Weak Hook (first 3s)", subs: [
        { label: "Slow opening" },
        { label: "Unclear promise" },
        { label: "No pattern interrupt" },
      ]},
      { label: "Poor Retention Structure", subs: [
        { label: "Not using AI clipping" },
        { label: "Sparse B-roll / reframing" },
        { label: "Meandering script" },
      ]},
      { label: "Visual / Readability", subs: [
        { label: "Subtitle color contrast off" },
        { label: "Missing keyword highlighting" },
        { label: "Character positioning clashes with overlays" },
      ]},
      { label: "Audio / Background", subs: [
        { label: "Music too loud" },
        { label: "Mood mismatch" },
        { label: "Low mic quality" },
      ]},
      { label: "Format / Timing Mismatch", subs: [
        { label: "Wrong aspect ratio" },
        { label: "Length off for platform" },
        { label: "Posting at off-peak times (not scheduled)" },
      ]},
      { label: "Ignoring Data", subs: [
        { label: "Not leveraging Smart Posting scoring" },
        { label: "Small sample size" },
        { label: "Not comparing like-with-like features" },
      ]},
      { label: "Asset Quality", subs: [
        { label: "Generic / repetitive background video" },
        { label: "Low-resolution assets" },
        { label: "No branded cover/frame" },
      ]},
    ],
  },
];

/* ---------- Geometry helpers ---------- */
const degToRad = (d: number) => (d * Math.PI) / 180;

function wrapLabel(label: string, maxChars = 18): string[] {
  const words = label.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const next = (current + " " + w).trim();
    if (next.length <= maxChars) current = next;
    else { if (current) lines.push(current); current = w; }
  }
  if (current) lines.push(current);
  return lines;
}

function layoutRoot(
  root: Root,
  causeRadius = ROOT_CAUSE_DISTANCE,
  spreadStart = -160,
  spreadEnd = 160
): (Cause & { x: number; y: number; angle: number })[] {
  const n = root.causes.length;
  const angleStep = (spreadEnd - spreadStart) / Math.max(1, n - 1);
  return root.causes.map((cause, i) => {
    const angle = spreadStart + i * angleStep;
    const x = root.x + causeRadius * Math.cos(degToRad(angle));
    const y = root.y + causeRadius * Math.sin(degToRad(angle));
    return { ...cause, x, y, angle };
  });
}

function layoutRootRight(
  root: Root,
  causeRadius = ROOT_CAUSE_DISTANCE,
  spreadStart = 20,
  spreadEnd = 340
): (Cause & { x: number; y: number; angle: number })[] {
  const n = root.causes.length;
  const angleStep = (spreadEnd - spreadStart) / Math.max(1, n - 1);
  return root.causes.map((cause, i) => {
    const angle = spreadStart + i * angleStep;
    const x = root.x + causeRadius * Math.cos(degToRad(angle));
    const y = root.y + causeRadius * Math.sin(degToRad(angle));
    return { ...cause, x, y, angle };
  });
}

function layoutSubs(
  cause: { x: number; y: number; angle: number; subs: SubCause[] },
  subRadius = CAUSE_SUB_DISTANCE
): (SubCause & { x: number; y: number; angle: number })[] {
  const n = cause.subs.length;
  const base = cause.angle;
  const spread = 80;
  const start = base - spread / 2;
  const step = spread / Math.max(1, n - 1);
  return cause.subs.map((sub, i) => {
    const a = start + i * step;
    const x = cause.x + subRadius * Math.cos(degToRad(a));
    const y = cause.y + subRadius * Math.sin(degToRad(a));
    return { ...sub, x, y, angle: a };
  });
}

/* ---------- Collision resolver ---------- */
function resolveCollisions(nodes: BubbleRef[], width: number, height: number) {
  for (let k = 0; k < ITERATIONS; k++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        let d = Math.hypot(dx, dy) || 0.01;
        const min = a.r + b.r + PADDING;
        if (d < min) {
          const overlap = min - d;
          const nx = dx / d, ny = dy / d;
          const pushA = b.fixed ? overlap : overlap / 2;
          const pushB = a.fixed ? overlap : overlap / 2;
          if (!a.fixed) { a.x += nx * pushA; a.y += ny * pushA; moved = true; }
          if (!b.fixed) { b.x -= nx * pushB; b.y -= ny * pushB; moved = true; }
        }
      }
    }
    for (const n of nodes) {
      if (!n.fixed) {
        n.x = Math.max(n.r + 2, Math.min(width - n.r - 2, n.x));
        n.y = Math.max(n.r + 2, Math.min(height - n.r - 2, n.y));
      }
    }
    if (!moved) break;
  }
  for (const n of nodes) n._apply?.();
}

/* ---------- SVG primitives ---------- */
const NodeCircle: React.FC<{
  x: number; y: number; r: number; label: string; fontSize?: number; bold?: boolean;
  onPointerDown?: (e: React.PointerEvent<SVGGElement>) => void;
}> = ({ x, y, r, label, fontSize = 14, bold = false, onPointerDown }) => {
  const lines = wrapLabel(label, Math.floor((r * 1.6) / (fontSize * 0.6)));
  const lineHeight = fontSize * 1.18;
  const totalH = lineHeight * lines.length;
  const startY = y - totalH / 2 + lineHeight * 0.85;
  return (
    <g
      filter="url(#softShadow)"
      onPointerDown={(e) => { e.stopPropagation(); onPointerDown?.(e); }}
      style={{ cursor: "move" }}
    >
      <circle cx={x} cy={y} r={r} fill="white" stroke={STROKE} strokeWidth={STROKE_W} />
      {lines.map((ln, idx) => (
        <text
          key={idx}
          x={x}
          y={startY + idx * lineHeight}
          textAnchor="middle"
          style={{ fontSize, fontWeight: bold ? 700 : 550, userSelect: "none" as const, letterSpacing: 0.2 }}
          fill={TEXT}
        >
          {ln}
        </text>
      ))}
    </g>
  );
};

const Connector: React.FC<{ x1: number; y1: number; x2: number; y2: number }> = ({ x1, y1, x2, y2 }) => (
  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={STROKE_LIGHT} strokeWidth={STROKE_W} />
);

/* ---------- Component ---------- */
export default function ProblemCauseMap() {
  // Initial layouts
  const initialLeftCauses = useMemo(() => layoutRoot(DATA[0]), []);
  const initialRightCauses = useMemo(() => layoutRootRight(DATA[1]), []);
  const initialLeftSubs = useMemo(() => initialLeftCauses.map((c) => layoutSubs(c)), [initialLeftCauses]);
  const initialRightSubs = useMemo(() => initialRightCauses.map((c) => layoutSubs(c)), [initialRightCauses]);

  // Positions in state (so we can drag them)
  const [leftRootPos, setLeftRootPos] = useState({ x: DATA[0].x, y: DATA[0].y });
  const [rightRootPos, setRightRootPos] = useState({ x: DATA[1].x, y: DATA[1].y });
  const [leftCausesPos, setLeftCausesPos] = useState(initialLeftCauses);
  const [rightCausesPos, setRightCausesPos] = useState(initialRightCauses);
  const [leftSubsPos, setLeftSubsPos] = useState(initialLeftSubs);
  const [rightSubsPos, setRightSubsPos] = useState(initialRightSubs);

  // Re-run a collision pass for sub-causes (after drags)
  const collideSubs = () => {
    const Lsubs = leftSubsPos.map(arr => arr.map(s => ({ ...s })));
    const Rsubs = rightSubsPos.map(arr => arr.map(s => ({ ...s })));

    const nodes: BubbleRef[] = [
      { x: leftRootPos.x,  y: leftRootPos.y,  r: ROOT_RADIUS, fixed: true },
      { x: rightRootPos.x, y: rightRootPos.y, r: ROOT_RADIUS, fixed: true },
      ...leftCausesPos.map(c  => ({ x: c.x!,  y: c.y!,  r: CAUSE_RADIUS, fixed: true })),
      ...rightCausesPos.map(c => ({ x: c.x!,  y: c.y!,  r: CAUSE_RADIUS, fixed: true })),
    ];

    Lsubs.forEach((arr, i) => arr.forEach((s, j) => {
      const ref: BubbleRef = { x: s.x!, y: s.y!, r: SUB_RADIUS, _apply() { Lsubs[i][j].x = ref.x; Lsubs[i][j].y = ref.y; } };
      nodes.push(ref);
    }));
    Rsubs.forEach((arr, i) => arr.forEach((s, j) => {
      const ref: BubbleRef = { x: s.x!, y: s.y!, r: SUB_RADIUS, _apply() { Rsubs[i][j].x = ref.x; Rsubs[i][j].y = ref.y; } };
      nodes.push(ref);
    }));

    resolveCollisions(nodes, WIDTH, HEIGHT);
    setLeftSubsPos(Lsubs);
    setRightSubsPos(Rsubs);
  };

  /* ---- Zoom & pan ---- */
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);

  const clamp = (v:number, a:number, b:number) => Math.max(a, Math.min(b, v));
  const clampNode = (x:number, y:number, r:number) => ({
    x: Math.max(r + 2, Math.min(WIDTH  - r - 2, x)),
    y: Math.max(r + 2, Math.min(HEIGHT - r - 2, y)),
  });

  const clientToSvg = (clientX:number, clientY:number) => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * WIDTH,
      y: ((clientY - rect.top) / rect.height) * HEIGHT,
    };
  };

  const zoomAtPoint = (screenX:number, screenY:number, factor:number) => {
    const pt = clientToSvg(screenX, screenY);
    const newZ = clamp(zoom * factor, MIN_Z, MAX_Z);
    const worldX = (pt.x - pan.x) / zoom;
    const worldY = (pt.y - pan.y) / zoom;
    setZoom(newZ);
    setPan({ x: pt.x - worldX * newZ, y: pt.y - worldY * newZ });
  };

  const onWheel: React.WheelEventHandler<SVGSVGElement> = (e) => {
    e.preventDefault();
    const factor = Math.pow(1.0015, -e.deltaY);
    zoomAtPoint(e.clientX, e.clientY, factor);
  };

  // Pan start if clicking empty space
  const onSvgPointerDown: React.PointerEventHandler<SVGSVGElement> = (e) => {
    const svg = svgRef.current!;
    svg.setPointerCapture(e.pointerId);
    setDrag({ mode: "pan", startX: e.clientX, startY: e.clientY, startPan: { ...pan } });
  };

  // --- NEW: helpers to move a parent and shift its children by delta ---
  const moveRootWithChildren = (side: NodeSide, nx: number, ny: number) => {
    const clampRes = clampNode(nx, ny, ROOT_RADIUS);
    if (side === "left") {
      setLeftRootPos(prev => {
        const dx = clampRes.x - prev.x, dy = clampRes.y - prev.y;
        if (dx || dy) {
          setLeftCausesPos(prevC => prevC.map(c => clampNode(c.x! + dx, c.y! + dy, CAUSE_RADIUS) as any) as any);
          setLeftSubsPos(prevS => prevS.map(arr => arr.map(s => clampNode(s.x! + dx, s.y! + dy, SUB_RADIUS) as any) as any));
        }
        return clampRes;
      });
    } else {
      setRightRootPos(prev => {
        const dx = clampRes.x - prev.x, dy = clampRes.y - prev.y;
        if (dx || dy) {
          setRightCausesPos(prevC => prevC.map(c => clampNode(c.x! + dx, c.y! + dy, CAUSE_RADIUS) as any) as any);
          setRightSubsPos(prevS => prevS.map(arr => arr.map(s => clampNode(s.x! + dx, s.y! + dy, SUB_RADIUS) as any) as any));
        }
        return clampRes;
      });
    }
  };

  const moveCauseWithChildren = (side: NodeSide, i: number, nx: number, ny: number) => {
    const clampRes = clampNode(nx, ny, CAUSE_RADIUS);
    if (side === "left") {
      setLeftCausesPos(prev => {
        const curr = prev[i];
        const dx = clampRes.x - curr.x!, dy = clampRes.y - curr.y!;
        const copy = prev.slice();
        copy[i] = { ...curr, x: clampRes.x, y: clampRes.y };
        // shift that cause's subs
        setLeftSubsPos(prevS => {
          const sCopy = prevS.map(a => a.slice());
          sCopy[i] = sCopy[i].map(s => clampNode(s.x! + dx, s.y! + dy, SUB_RADIUS) as any);
          return sCopy as any;
        });
        return copy as any;
      });
    } else {
      setRightCausesPos(prev => {
        const curr = prev[i];
        const dx = clampRes.x - curr.x!, dy = clampRes.y - curr.y!;
        const copy = prev.slice();
        copy[i] = { ...curr, x: clampRes.x, y: clampRes.y };
        setRightSubsPos(prevS => {
          const sCopy = prevS.map(a => a.slice());
          sCopy[i] = sCopy[i].map(s => clampNode(s.x! + dx, s.y! + dy, SUB_RADIUS) as any);
          return sCopy as any;
        });
        return copy as any;
      });
    }
  };

  const onPointerMove: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!drag) return;

    if (drag.mode === "pan") {
      const a = clientToSvg(drag.startX, drag.startY);
      const b = clientToSvg(e.clientX, e.clientY);
      setPan({ x: drag.startPan.x + (b.x - a.x), y: drag.startPan.y + (b.y - a.y) });
      return;
    }

    // Node drag
    const pt = clientToSvg(e.clientX, e.clientY);
    const world = { x: (pt.x - pan.x) / zoom, y: (pt.y - pan.y) / zoom };
    const nx = world.x + drag.offset.dx;
    const ny = world.y + drag.offset.dy;

    if (drag.kind === "root") {
      moveRootWithChildren(drag.side, nx, ny);
    } else if (drag.kind === "cause") {
      moveCauseWithChildren(drag.side, drag.i, nx, ny);
    } else {
      // sub only
      const clamped = clampNode(nx, ny, SUB_RADIUS);
      if (drag.side === "left") {
        setLeftSubsPos(prev => {
          const copy = prev.map(a => a.slice());
          copy[drag.i][drag.j!] = { ...copy[drag.i][drag.j!], x: clamped.x, y: clamped.y };
          return copy;
        });
      } else {
        setRightSubsPos(prev => {
          const copy = prev.map(a => a.slice());
          copy[drag.i][drag.j!] = { ...copy[drag.i][drag.j!], x: clamped.x, y: clamped.y };
          return copy;
        });
      }
    }
  };

  const endDrag: React.PointerEventHandler<SVGSVGElement> = (e) => {
    const svg = svgRef.current!;
    try { svg.releasePointerCapture((e as any).pointerId); } catch {}
    const wasNode = drag?.mode === "node";
    setDrag(null);
    if (wasNode) collideSubs(); // tidy overlaps at the end
  };

  // Start node drag (called from NodeCircle)
  const startNodeDrag = (side: NodeSide, kind: NodeKind, i: number, j?: number) => (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    svg.setPointerCapture(e.pointerId);
    const pt = clientToSvg(e.clientX, e.clientY);
    const world = { x: (pt.x - pan.x) / zoom, y: (pt.y - pan.y) / zoom };

    let x = 0, y = 0;
    if (kind === "root") {
      const pos = side === "left" ? leftRootPos : rightRootPos;
      x = pos.x; y = pos.y;
    } else if (kind === "cause") {
      const pos = (side === "left" ? leftCausesPos : rightCausesPos)[i];
      x = pos.x!; y = pos.y!;
    } else {
      const pos = (side === "left" ? leftSubsPos : rightSubsPos)[i][j!];
      x = pos.x!; y = pos.y!;
    }

    setDrag({
      mode: "node",
      pointerId: e.pointerId,
      side, kind, i, j,
      offset: { dx: x - world.x, dy: y - world.y },
    });
  };

  const zoomIn = () => zoomAtPoint(WIDTH / 2, HEIGHT / 2, 1.2);
  const zoomOut = () => zoomAtPoint(WIDTH / 2, HEIGHT / 2, 1 / 1.2);
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  /* ---- Render ---- */
  return (
    <div style={{ padding: 24, background: "#f1f5f9", minHeight: "100vh" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Problem–Cause Map</h1>
          <p style={{ color: "#475569", margin: "6px 0 0" }}>
            Zoom: wheel • Pan: drag canvas • Move nodes: drag circles (children follow parents)
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={resetView} style={btn}>Reset View</button>
          <button onClick={zoomOut} style={btn}>–</button>
          <button onClick={zoomIn} style={btn}>+</button>
          <button onClick={() => window.print()} style={btn}>Print / Save as PDF</button>
        </div>
      </div>

      <div style={{ background: "white", border: "1px solid #cbd5e1", borderRadius: 16, boxShadow: "0 6px 24px rgba(2,6,23,0.06)", overflow: "hidden" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{ width: "100%", height: "80vh", touchAction: "none", cursor: drag?.mode === "pan" ? "grabbing" : "grab" }}
          onWheel={onWheel}
          onPointerDown={onSvgPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          <defs>
            <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="1.2" stdDeviation="1.2" floodOpacity="0.25"/>
            </filter>
          </defs>

          {/* Zoom+pan group */}
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {/* Connectors */}
            {leftCausesPos.map((c, i) => (
              <Connector key={`lc-${i}`} x1={leftRootPos.x} y1={leftRootPos.y} x2={c.x!} y2={c.y!} />
            ))}
            {leftSubsPos.map((arr, i) =>
              arr.map((s, j) => (
                <Connector key={`ls-${i}-${j}`} x1={leftCausesPos[i].x!} y1={leftCausesPos[i].y!} x2={s.x!} y2={s.y!} />
              ))
            )}
            {rightCausesPos.map((c, i) => (
              <Connector key={`rc-${i}`} x1={rightRootPos.x} y1={rightRootPos.y} x2={c.x!} y2={c.y!} />
            ))}
            {rightSubsPos.map((arr, i) =>
              arr.map((s, j) => (
                <Connector key={`rs-${i}-${j}`} x1={rightCausesPos[i].x!} y1={rightCausesPos[i].y!} x2={s.x!} y2={s.y!} />
              ))
            )}

            {/* Left root + nodes (draggable) */}
            <NodeCircle
              x={leftRootPos.x}
              y={leftRootPos.y}
              r={ROOT_RADIUS}
              label={DATA[0].label}
              fontSize={22}
              bold
              onPointerDown={startNodeDrag("left", "root", 0)}
            />
            {leftCausesPos.map((c, i) => (
              <NodeCircle
                key={`lcn-${i}`}
                x={c.x!}
                y={c.y!}
                r={CAUSE_RADIUS}
                label={DATA[0].causes[i].label}
                fontSize={16}
                bold
                onPointerDown={startNodeDrag("left", "cause", i)}
              />
            ))}
            {leftSubsPos.map((arr, i) =>
              arr.map((s, j) => (
                <NodeCircle
                  key={`lsn-${i}-${j}`}
                  x={s.x!}
                  y={s.y!}
                  r={SUB_RADIUS}
                  label={DATA[0].causes[i].subs[j].label}
                  fontSize={13.5}
                  onPointerDown={startNodeDrag("left", "sub", i, j)}
                />
              ))
            )}

            {/* Right root + nodes (draggable) */}
            <NodeCircle
              x={rightRootPos.x}
              y={rightRootPos.y}
              r={ROOT_RADIUS}
              label={DATA[1].label}
              fontSize={22}
              bold
              onPointerDown={startNodeDrag("right", "root", 0)}
            />
            {rightCausesPos.map((c, i) => (
              <NodeCircle
                key={`rcn-${i}`}
                x={c.x!}
                y={c.y!}
                r={CAUSE_RADIUS}
                label={DATA[1].causes[i].label}
                fontSize={16}
                bold
                onPointerDown={startNodeDrag("right", "cause", i)}
              />
            ))}
            {rightSubsPos.map((arr, i) =>
              arr.map((s, j) => (
                <NodeCircle
                  key={`rsn-${i}-${j}`}
                  x={s.x!}
                  y={s.y!}
                  r={SUB_RADIUS}
                  label={DATA[1].causes[i].subs[j].label}
                  fontSize={13.5}
                  onPointerDown={startNodeDrag("right", "sub", i, j)}
                />
              ))
            )}
          </g>
        </svg>
      </div>
    </div>
  );
}

/* simple button style */
const btn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  background: "white",
  cursor: "pointer",
};
