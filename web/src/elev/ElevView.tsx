import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, sectionColor, colorKey, visibleModel, toast } from '../model/store';
import { useViewPatterns } from '../ui/LoadDialogs';
import { ColorLegend } from '../plan/layers';
import { fmt } from '../model/geom';
import { placeAt, storyElevations, uid, withDz, type Beam, type Grid, type Model } from '../model/types';
import { elevationAt, type Elevation } from './elevation';
import { autoSpans, nextNames } from '../stair/stair';
import type { Flight, FlightDir, Landing } from '../model/types';

const PAD = 60; // px around the drawing when fitting
const SNAP_PX = 10;

type SZ = { s: number; z: number };
type Snapped = SZ & { kind: string };

/**
 * Snap a point in elevation (s along the grid, z up): first to a key point (beam end, flight / landing corner),
 * else s and z each to the nearest station (grid, column face) and level (story, reference plane, stair level).
 */
function snapSZ(e: Elevation, p: SZ, k: number, last: SZ | null): Snapped {
  const tol = SNAP_PX / k;
  const pts: [number, number][] = [...e.beams.flatMap((b) => [[b.s0, b.z], [b.s1, b.z1]] as [number, number][]), ...e.stair.flatMap((x) => x.keys)];
  let best: [number, number] | null = null,
    bd = tol;
  for (const q of pts) {
    const d = Math.hypot(q[0] - p.s, q[1] - p.z);
    if (d < bd) (bd = d), (best = q);
  }
  if (best) return { s: best[0], z: best[1], kind: 'end' };
  const ss = [...e.grids.map((g) => g.s), ...e.columns.flatMap((c) => [c.s0, c.s1, (c.s0 + c.s1) / 2]), ...e.stair.flatMap((x) => x.keys.map((q) => q[0])), ...(last ? [last.s] : [])];
  const zs = [...e.levels.map((l) => l.z), ...e.refPlanes.map((l) => l.z), ...e.stair.flatMap((x) => x.keys.map((q) => q[1])), ...(last ? [last.z] : [])];
  const near = (v: number, c: number[]) => c.reduce<number | null>((a, x) => (Math.abs(x - v) < tol && (a === null || Math.abs(x - v) < Math.abs(a - v)) ? x : a), null);
  const s = near(p.s, ss),
    z = near(p.z, zs);
  return { s: s ?? Math.round(p.s / 10) * 10, z: z ?? Math.round(p.z / 10) * 10, kind: s !== null && z !== null ? 'station × level' : s !== null ? 'station' : z !== null ? 'level' : '' };
}

/** A beam on grid `g` from a to b (stations and elevations); it belongs to the story its lower end lies in. */
function pieceOnGrid(m: Model, g: Grid, a: SZ, b: SZ, section: string): Beam | null {
  const L = Math.hypot(g.x2 - g.x1, g.y2 - g.y1) || 1,
    ux = (g.x2 - g.x1) / L,
    uy = (g.y2 - g.y1) / L;
  const at = placeAt(m, Math.min(a.z, b.z));
  if (!at) return null;
  const top = storyElevations(m)[at.story].top;
  const beam = withDz({ id: uid(), story: at.story, x1: g.x1 + ux * a.s, y1: g.y1 + uy * a.s, x2: g.x1 + ux * b.s, y2: g.y1 + uy * b.s, section } as Beam, a.z - top);
  return Math.abs(b.z - a.z) > 1 ? { ...beam, dz2: b.z - top } : beam;
}

type Mode = 'none' | 'beam' | 'flight' | 'landing';
const MODES: [Mode, string, string][] = [
  ['beam', 'Beam', 'Draw a beam along this grid by clicking its points: each click adds a piece (level or sloped), so a cranked beam is one chain. Right-click ends the chain.'],
  ['flight', 'Flight', 'Click the bottom of the flight (its start at the lower level), then its top (the upper level). Risers are fitted to the rise; treads to the going.'],
  ['landing', 'Landing', 'Click the two ends of the landing at its level (e.g. on a reference plane).'],
];

/**
 * The plan band a stair element drawn on grid `g` occupies: along the grid from station a to c, across from
 * `off` to `off + width` on the chosen side. Null for a skewed grid (flights run along X or Y).
 */
function bandRect(g: Grid, a: number, c: number, off: number, width: number, side: 1 | -1) {
  if (g.dir === 'G') return null;
  const L = Math.hypot(g.x2 - g.x1, g.y2 - g.y1) || 1,
    ux = (g.x2 - g.x1) / L,
    uy = (g.y2 - g.y1) / L,
    nx = -uy * side,
    ny = ux * side;
  const pts = [a, c].flatMap((s) => [off, off + width].map((o) => ({ x: g.x1 + ux * s + nx * o, y: g.y1 + uy * s + ny * o })));
  const xs = pts.map((p) => p.x),
    ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), ux, uy };
}

function flightOnGrid(m: Model, g: Grid, a: SZ, b: SZ, off: number, side: 1 | -1): Flight | string {
  const [lo, hi] = a.z <= b.z ? [a, b] : [b, a];
  const H = hi.z - lo.z,
    L = Math.abs(hi.s - lo.s);
  if (H < 50) return 'Click the bottom, then the top of the flight at a higher level.';
  const n = Math.max(2, Math.round(H / m.stair.R));
  if (L < 100) return 'The flight needs a going along the grid.';
  const r = bandRect(g, lo.s, hi.s, off, m.stair.width, side);
  if (!r) return 'Flights run along X or Y: pick a grid parallel to X or Y.';
  const sg = Math.sign(hi.s - lo.s),
    alongX = Math.abs(r.ux) > 0.5;
  const dir = ((sg * (alongX ? r.ux : r.uy) > 0 ? '+' : '-') + (alongX ? 'x' : 'y')) as FlightDir;
  const round1 = (v: number) => Math.round(v * 10) / 10;
  return { id: uid(), name: nextNames(m.flights.map((f) => f.name), 'F')(), x: r.x, y: r.y, dir, n, R: round1(H / n), T: round1(L / (n - 1)), t: m.stair.t, width: m.stair.width, z0: lo.z };
}

function landingOnGrid(m: Model, g: Grid, a: SZ, b: SZ, off: number, side: 1 | -1): Landing | string {
  if (Math.abs(b.s - a.s) < 100) return 'Click the two ends of the landing along the grid.';
  const r = bandRect(g, a.s, b.s, off, m.stair.width, side);
  if (!r) return 'Landings are drawn on grids parallel to X or Y.';
  return { id: uid(), name: nextNames(m.landings.map((l) => l.name), 'L')(), x: r.x, y: r.y, w: r.w, h: r.h, z: a.z, t: m.stair.tl };
}

/** Elevation along one grid line: levels, crossing grids, columns, beams, slabs, flights and landings; draws cranked beams. */
export function ElevView() {
  const model = useApp((s) => visibleModel(s));
  const grids = useApp((s) => s.model.grids);
  const gridId = useApp((s) => s.elevGrid);
  const selection = useApp((s) => s.selection);
  const colorBy = useApp((s) => s.colorBy);
  const patterns = useViewPatterns();
  const [tol, setTol] = useState(300);
  const [names, setNames] = useState(true);
  const [wire, setWire] = useState(false);
  const [mode, setMode] = useState<Mode>('none');
  const draw = mode !== 'none';
  const [side, setSide] = useState<1 | -1>(1);
  const [off, setOff] = useState(0);
  const [chain, setChain] = useState<SZ | null>(null);
  const [cur, setCur] = useState<Snapped | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ k: 0.05, tx: 0, ty: 0 }); // screen = (k·s + tx, −k·z + ty)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const grid = grids.find((g) => g.id === gridId) ?? grids[0];
  const e = useMemo(() => (grid ? elevationAt(model, grid, tol) : null), [model, grid, tol]);
  const sel = useMemo(() => new Set(selection), [selection]);

  useEffect(() => {
    const el = host.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Esc ends the chain, then leaves the tool
  useEffect(() => {
    const kd = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (chain) setChain(null);
      else setMode('none');
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [chain]);
  useEffect(() => setChain(null), [grid?.id, draw]);

  const extent = () => {
    if (!e || !grid) return null;
    const ss = [0, Math.hypot(grid.x2 - grid.x1, grid.y2 - grid.y1), ...e.grids.map((g) => g.s), ...e.columns.flatMap((c) => [c.s0, c.s1]), ...e.beams.flatMap((b) => [b.s0, b.s1]), ...e.stair.filter((x) => x.near).flatMap((x) => x.pts.map((p) => p[0]))];
    // frame what is drawn (a stair is short next to the whole building), else every level
    const content = [...e.beams.flatMap((b) => [b.z, b.z1, b.z - b.depth]), ...e.stair.filter((x) => x.near).flatMap((x) => x.pts.map((p) => p[1]))];
    const zs = content.length ? [...content, ...[...e.levels, ...e.refPlanes].map((l) => l.z).filter((z) => z >= Math.min(...content) - 1 && z <= Math.max(...content) + 1)] : [...e.levels, ...e.refPlanes].map((l) => l.z);
    return { s0: Math.min(...ss), s1: Math.max(...ss), z0: Math.min(...zs), z1: Math.max(...zs) };
  };
  const fit = () => {
    const x = extent();
    if (!x) return;
    // room on the left for level names, on the right for reference plane names and on top for grid bubbles
    const left = 90,
      right = 30 + (e?.refPlanes.length ? 90 : 0),
      top = PAD + 50;
    const k = Math.min((size.w - left - right) / Math.max(x.s1 - x.s0, 1), (size.h - top - PAD) / Math.max(x.z1 - x.z0, 1));
    setView({ k, tx: left + ((size.w - left - right) - k * (x.s1 - x.s0)) / 2 - k * x.s0, ty: top + ((size.h - top - PAD) + k * (x.z1 - x.z0)) / 2 + k * x.z0 });
  };
  // refit when the grid changes or the view is resized
  useEffect(fit, [grid?.id, size.w, size.h]);

  const X = (s: number) => view.k * s + view.tx;
  const Y = (z: number) => -view.k * z + view.ty;
  const toSZ = (ev: React.PointerEvent): SZ => {
    const r = host.current!.getBoundingClientRect();
    return { s: (ev.clientX - r.left - view.tx) / view.k, z: (view.ty - (ev.clientY - r.top)) / view.k };
  };

  const pick = (id: string, ev: React.PointerEvent) => {
    if (drag.current?.moved || draw) return;
    const st = useApp.getState();
    st.setSelection(ev.shiftKey ? (st.selection.includes(id) ? st.selection.filter((x) => x !== id) : [...st.selection, id]) : [id]);
  };

  const clickDraw = (ev: React.PointerEvent) => {
    if (!e || !grid) return;
    const p = snapSZ(e, toSZ(ev), view.k, chain);
    if (!chain) return setChain(p);
    const st = useApp.getState();
    if (mode === 'flight' || mode === 'landing') {
      const x = mode === 'flight' ? flightOnGrid(st.model, grid, chain, p, off, side) : landingOnGrid(st.model, grid, chain, p, off, side);
      if (typeof x === 'string') return toast(x);
      // auto spans follow every change, so the design picks the new piece up
      st.commit((m) => autoSpans('n' in x ? { ...m, flights: [...m.flights, x] } : { ...m, landings: [...m.landings, x as Landing] }));
      st.setSelection([x.id]);
      // a flight's top is where the next landing or flight starts
      return setChain(null);
    }
    if (Math.abs(p.s - chain.s) < 1) return toast('A beam piece needs some length along the grid (a vertical piece is a column).');
    const b = pieceOnGrid(st.model, grid, chain, p, st.active.beam);
    if (!b) return toast('No stories defined.');
    st.commit((m) => autoSpans({ ...m, beams: [...m.beams, b] }));
    st.setSelection([...st.selection.filter((id) => st.model.beams.some((x) => x.id === id)), b.id]);
    setChain(p);
  };

  const byId = useMemo(() => new Map([...model.columns, ...model.beams, ...model.slabs].map((x) => [x.id, x])), [model]);
  const shown = useMemo(() => (e ? [...e.columns, ...e.beams, ...e.cuts].flatMap((x) => byId.get(x.id) ?? []) : []), [e, byId]);
  const fill = (id: string, def: string) => {
    if (sel.has(id)) return 'var(--sel)';
    const k = colorKey(byId.get(id) ?? { section: '' }, colorBy, patterns);
    return k === null ? def : sectionColor(k);
  };

  const x = extent();
  const sl = x ? X(x.s0) - 30 : 0,
    sr = x ? X(x.s1) + 30 : 0;
  const bubbleY = x ? Y(x.z1) - 34 : 0;
  const poly = (pts: [number, number][]) => pts.map(([s, z]) => `${X(s)},${Y(z)}`).join(' ');

  return (
    <div
      className="elev-view"
      ref={host}
      style={{ cursor: draw ? 'crosshair' : undefined }}
      onWheel={(ev) => {
        const r = host.current!.getBoundingClientRect();
        const px = ev.clientX - r.left,
          py = ev.clientY - r.top;
        const f = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
        setView((v) => ({ k: v.k * f, tx: px - (px - v.tx) * f, ty: py - (py - v.ty) * f }));
      }}
      onContextMenu={(ev) => (ev.preventDefault(), setChain(null))}
      onPointerDown={(ev) => {
        if ((ev.target as HTMLElement).closest('.bar')) return;
        drag.current = { x: ev.clientX, y: ev.clientY, moved: false };
      }}
      onPointerMove={(ev) => {
        if (draw && e && !(ev.target as HTMLElement).closest('.bar')) setCur(snapSZ(e, toSZ(ev), view.k, chain));
        const d = drag.current;
        if (!d || !ev.buttons) return;
        const dx = ev.clientX - d.x,
          dy = ev.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 3) return;
        d.moved = true;
        d.x = ev.clientX;
        d.y = ev.clientY;
        setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
      }}
      onPointerUp={(ev) => {
        const clicked = drag.current && !drag.current.moved && ev.button === 0;
        if (clicked && draw && !(ev.target as HTMLElement).closest('.bar')) clickDraw(ev);
        // a click on empty space clears the selection
        else if (clicked && ev.target === ev.currentTarget.querySelector('svg')) useApp.getState().setSelection([]);
        setTimeout(() => (drag.current = null));
      }}
      onPointerLeave={() => setCur(null)}
    >
      <div className="bar">
        <label title="Grid line to look along">
          Grid{' '}
          <select value={grid?.id ?? ''} onChange={(ev) => useApp.getState().setElevGrid(ev.target.value)}>
            {grids.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label title="Show members whose centreline is within this distance of the grid line">
          Within ±{' '}
          <input type="number" min={0} step={50} value={tol} style={{ width: 64 }} onChange={(ev) => setTol(Math.max(0, +ev.target.value || 0))} /> mm
        </label>
        <button onClick={fit}>Fit</button>
        <button className={names ? 'on' : ''} title="Show section names" onClick={() => setNames(!names)}>
          Names
        </button>
        <button className={wire ? 'on' : ''} title="Show members as centrelines instead of their section sizes" onClick={() => setWire(!wire)}>
          Centrelines
        </button>
        <span className="seg" role="group" aria-label="Draw">
          {MODES.map(([k, l, t]) => (
            <button key={k} className={mode === k ? 'on' : ''} title={t + ' Snaps to levels, reference planes, grids, column faces, flight and landing corners and beam ends. Esc leaves the tool.'} onClick={() => setMode(mode === k ? 'none' : k)}>
              {l}
            </button>
          ))}
        </span>
        {(mode === 'flight' || mode === 'landing') && (
          <>
            <label title="Which side of the grid line the stair lies on (in plan)">
              Side{' '}
              <select value={side} onChange={(ev) => setSide(+ev.target.value as 1 | -1)}>
                <option value={1}>left of grid</option>
                <option value={-1}>right of grid</option>
              </select>
            </label>
            <label title="Gap between the grid line and the stair edge, mm">
              Offset <input type="number" step={50} value={off} style={{ width: 60 }} onChange={(ev) => setOff(+ev.target.value || 0)} />
            </label>
          </>
        )}
      </div>
      {!grid || !e || !x ? (
        <div className="muted" style={{ padding: '60px 20px' }}>
          No grids yet. Draw grids in the plan, then pick one here to see its elevation.
        </div>
      ) : (
        <svg width={size.w} height={size.h}>
          <g className="nosel">
            {e.levels.map((l) => (
              <g key={l.name}>
                <line x1={sl} x2={sr} y1={Y(l.z)} y2={Y(l.z)} stroke="var(--grid)" strokeDasharray="6 4" />
                <text x={sl - 6} y={Y(l.z)} dy={-3} textAnchor="end" fill="var(--gridText)" fontSize={12}>
                  {l.name}
                </text>
                <text x={sl - 6} y={Y(l.z)} dy={12} textAnchor="end" fill="var(--muted)" fontSize={11}>
                  {l.z >= 0 ? '+' : ''}
                  {fmt(l.z)}
                </text>
              </g>
            ))}
            {e.refPlanes.map((l, i) => (
              <g key={'rp' + i}>
                <line x1={sl} x2={sr} y1={Y(l.z)} y2={Y(l.z)} stroke="var(--accent2)" strokeOpacity={0.7} strokeDasharray="14 4 2 4" />
                <text x={sr + 6} y={Y(l.z)} dy={4} fill="var(--accent2)" fontSize={11}>
                  {l.name} {l.z >= 0 ? '+' : ''}
                  {fmt(l.z)}
                </text>
              </g>
            ))}
            {e.grids.map((g) => (
              <g key={g.id}>
                <line x1={X(g.s)} x2={X(g.s)} y1={bubbleY + 12} y2={Y(x.z0) + 20} stroke="var(--grid)" strokeDasharray="10 4 2 4" />
                <circle cx={X(g.s)} cy={bubbleY} r={12} fill="var(--bg)" stroke="var(--grid)" />
                <text x={X(g.s)} y={bubbleY} dy={4} textAnchor="middle" fill="var(--gridText)" fontSize={12}>
                  {g.label}
                </text>
              </g>
            ))}
            {e.grids.slice(1).map((g, i) => {
              const a = e.grids[i].s,
                y = Y(x.z0) + 34;
              return (
                <g key={'d' + g.id}>
                  <line x1={X(a)} x2={X(g.s)} y1={y} y2={y} stroke="var(--dim)" />
                  <text x={(X(a) + X(g.s)) / 2} y={y} dy={-4} textAnchor="middle" fill="var(--dim)" fontSize={11}>
                    {fmt(g.s - a)}
                  </text>
                </g>
              );
            })}
          </g>
          {/* flights and landings: solid when within the tolerance of the grid, faint when seen beyond it */}
          <g style={{ cursor: draw ? undefined : 'pointer' }}>
            {e.stair.map((st) => {
              const s = sel.has(st.id),
                fl = st.kind === 'flight';
              return (
                <g key={st.id} opacity={st.near ? 1 : 0.35} onPointerUp={(ev) => pick(st.id, ev)}>
                  <polygon points={poly(st.pts)} fill={s ? 'var(--selFill)' : fl ? 'var(--flight)' : 'var(--landing)'} stroke={s ? 'var(--sel)' : fl ? 'var(--flightEdge)' : 'var(--landingEdge)'} strokeWidth={s ? 2 : 1} />
                  {st.risers && <path d={st.risers.zs.map((z) => `M${X(st.risers!.s0)} ${Y(z)}H${X(st.risers!.s1)}`).join('')} stroke="var(--flightEdge)" strokeWidth={0.5} />}
                  {names && (
                    <text x={X(st.pts.reduce((a, p) => a + p[0], 0) / st.pts.length)} y={Y(Math.max(...st.pts.map((p) => p[1])))} dy={-4} textAnchor="middle" fontSize={11} fill={fl ? 'var(--flightEdge)' : 'var(--landingEdge)'} className="halo nosel">
                      {st.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
          {wire ? (
            // centrelines as in the 3D wireframe; members sit on their level, cut beams show as points
            <g strokeWidth={2.5} style={{ cursor: 'pointer' }}>
              {e.slabs.map((s, i) => (
                <line key={s.id + i} x1={X(s.s0)} x2={X(s.s1)} y1={Y(s.z)} y2={Y(s.z)} stroke={sel.has(s.id) ? 'var(--sel)' : 'var(--slabEdge)'} strokeWidth={7} strokeOpacity={0.45} onPointerUp={(ev) => pick(s.id, ev)} />
              ))}
              {e.beams.map((b) => (
                <line key={b.id} x1={X(b.s0)} x2={X(b.s1)} y1={Y(b.z)} y2={Y(b.z1)} stroke={fill(b.id, 'var(--beam)')} onPointerUp={(ev) => pick(b.id, ev)} />
              ))}
              {e.cuts.map((b) => (
                <circle key={b.id} cx={X((b.s0 + b.s1) / 2)} cy={Y(b.z)} r={4} fill={fill(b.id, 'var(--beam)')} stroke="var(--text)" strokeWidth={1} onPointerUp={(ev) => pick(b.id, ev)} />
              ))}
              {e.columns.map((c) => (
                <line key={c.id} x1={X((c.s0 + c.s1) / 2)} x2={X((c.s0 + c.s1) / 2)} y1={Y(c.z0)} y2={Y(c.z1)} stroke={fill(c.id, 'var(--col)')} onPointerUp={(ev) => pick(c.id, ev)} />
              ))}
            </g>
          ) : (
            <>
              {e.slabs.map((s, i) => (
                <rect key={s.id + i} x={X(s.s0)} y={Y(s.z)} width={view.k * (s.s1 - s.s0)} height={Math.max(view.k * s.t, 1.5)} fill={sel.has(s.id) ? 'var(--sel)' : 'var(--slabEdge)'} onPointerUp={(ev) => pick(s.id, ev)} style={{ cursor: 'pointer' }} />
              ))}
              {e.beams.map((b) => (
                <polygon
                  key={b.id}
                  points={poly([
                    [b.s0, b.z],
                    [b.s1, b.z1],
                    [b.s1, b.z1 - b.depth],
                    [b.s0, b.z - b.depth],
                  ])}
                  fill={fill(b.id, 'var(--beam)')}
                  fillOpacity={0.75}
                  stroke="var(--colEdge)"
                  onPointerUp={(ev) => pick(b.id, ev)}
                  style={{ cursor: 'pointer' }}
                />
              ))}
              {e.cuts.map((b) => (
                <rect key={b.id} x={X(b.s0)} y={Y(b.z)} width={view.k * (b.s1 - b.s0)} height={view.k * b.depth} fill={fill(b.id, 'var(--beam)')} fillOpacity={0.9} stroke="var(--text)" strokeDasharray="3 2" onPointerUp={(ev) => pick(b.id, ev)} style={{ cursor: 'pointer' }} />
              ))}
              {e.columns.map((c) => (
                <rect key={c.id} x={X(c.s0)} y={Y(c.z1)} width={view.k * (c.s1 - c.s0)} height={view.k * (c.z1 - c.z0)} fill={fill(c.id, 'var(--col)')} fillOpacity={0.75} stroke="var(--colEdge)" onPointerUp={(ev) => pick(c.id, ev)} style={{ cursor: 'pointer' }} />
              ))}
            </>
          )}
          {names && (
            <g className="nosel" fontSize={11}>
              {e.beams.map((b) => (
                <text key={b.id} x={X((b.s0 + b.s1) / 2)} y={Y((b.z + b.z1) / 2)} dy={-4} textAnchor="middle" fill="var(--label)" className="halo">
                  {b.section}
                  {Math.abs(b.z1 - b.z) > 1 ? `  ${fmt(b.z)}→${fmt(b.z1)}` : ''}
                </text>
              ))}
              {e.columns.map((c) => (
                <text key={c.id} transform={`translate(${X(c.s1) + 4} ${Y((c.z0 + c.z1) / 2)}) rotate(-90)`} textAnchor="middle" dy={10} fill="var(--labelCol)" className="halo">
                  {c.section}
                </text>
              ))}
            </g>
          )}
          {draw && (
            <g className="nosel" pointerEvents="none">
              {chain && cur && <line x1={X(chain.s)} y1={Y(chain.z)} x2={X(cur.s)} y2={Y(cur.z)} stroke="#ffc850" strokeWidth={2} strokeDasharray="6 3" />}
              {chain && <circle cx={X(chain.s)} cy={Y(chain.z)} r={4} fill="#ffc850" />}
              {cur && (
                <>
                  <rect x={X(cur.s) - 5} y={Y(cur.z) - 5} width={10} height={10} fill="none" stroke="#39ff9a" strokeWidth={1.5} />
                  <text x={X(cur.s) + 12} y={Y(cur.z) + 20} fill="#ffc850" fontSize={12} className="halo">
                    {`s ${fmt(cur.s)}  z ${fmt(cur.z)}`}
                    {chain ? `  ·  Δs ${fmt(cur.s - chain.s)}  Δz ${fmt(cur.z - chain.z)}  ${fmt((Math.atan2(cur.z - chain.z, Math.abs(cur.s - chain.s) || 1) * 180) / Math.PI, 1)}°` : ''}
                    {cur.kind ? `  [${cur.kind}]` : ''}
                  </text>
                </>
              )}
            </g>
          )}
        </svg>
      )}
      {draw && (
        <div className="elev-hint">
          {mode === 'beam' && (chain ? 'Click the next point (level or sloped piece). Right-click ends the chain.' : `Click the start of the beam on this grid. Section: ${useApp.getState().active.beam}`)}
          {mode === 'flight' && (chain ? 'Click the top of the flight (on the upper level).' : `Click the bottom of the flight. Width ${useApp.getState().model.stair.width} mm, target riser ${useApp.getState().model.stair.R} mm.`)}
          {mode === 'landing' && (chain ? 'Click the other end of the landing.' : 'Click one end of the landing at its level.')}
        </div>
      )}
      <ColorLegend items={shown} colorBy={colorBy} patterns={patterns} />
    </div>
  );
}
