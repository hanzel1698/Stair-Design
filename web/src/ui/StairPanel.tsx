import { toast, useApp } from '../model/store';
import { startMovePick } from '../plan/tools';
import { beamEndsZ, placeAt, storyElevations, withDz, type Beam, type Flight, type Landing, type Model, type Span, type StairParams } from '../model/types';
import { Modal } from './Dialogs';
import { analyze, beamLoads, beamName, frame, gridRef } from '../stair/stair';

type Field<T> = [keyof T & string, string, ('text' | 'num' | string[])?];

const FLIGHT: Field<Flight>[] = [
  ['name', 'Name', 'text'],
  ['dir', 'Up direction', ['+x', '-x', '+y', '-y']],
  ['n', 'Risers'],
  ['R', 'Riser (mm)'],
  ['T', 'Tread (mm)'],
  ['t', 'Waist (mm)'],
  ['width', 'Width (mm)'],
  ['z0', 'Bottom level (mm)'],
  ['x', 'X min corner (mm)'],
  ['y', 'Y min corner (mm)'],
];
const LANDING: Field<Landing>[] = [
  ['name', 'Name', 'text'],
  ['z', 'Top level (mm)'],
  ['t', 'Thickness (mm)'],
  ['x', 'X min (mm)'],
  ['y', 'Y min (mm)'],
  ['w', 'Size along X (mm)'],
  ['h', 'Size along Y (mm)'],
];
const SPAN: Field<Span>[] = [
  ['name', 'Name', 'text'],
  ['width', 'Strip width (mm)'],
  ['x1', 'X1'],
  ['y1', 'Y1'],
  ['x2', 'X2'],
  ['y2', 'Y2'],
];
export const PARAMS: Field<StairParams>[] = [
  ['fck', 'Concrete fck (MPa)', ['15', '20', '25', '30', '35', '40']],
  ['fy', 'Steel fy (MPa)', ['250', '415', '500', '550']],
  ['cover', 'Clear cover (mm)'],
  ['bar', 'Main bar Ø (mm)', ['8', '10', '12', '16', '20']],
  ['dbar', 'Distribution bar Ø (mm)', ['8', '10', '12']],
  ['ff', 'Floor finish (kN/m²)'],
  ['ll', 'Live load (kN/m²)'],
  ['gc', 'Concrete unit wt (kN/m³)'],
  ['gf', 'Load factor γf'],
  ['T', 'Default tread (mm)'],
  ['R', 'Target riser (mm)'],
  ['width', 'Default flight width (mm)'],
  ['t', 'Default waist (mm)'],
  ['tl', 'Default landing t (mm)'],
];

function Form<T extends object>({ obj, fields, onSet }: { obj: T; fields: Field<T>[]; onSet: (k: keyof T, v: string | number) => void }) {
  return (
    <div className="stair-form">
      {fields.map(([k, label, ty]) => {
        const v = obj[k] as unknown as string | number;
        const set = (raw: string) => {
          const num = ty !== 'text' && !(Array.isArray(ty) && isNaN(+raw));
          if (num && !Number.isFinite(+raw)) return;
          onSet(k, num ? +raw : raw);
        };
        return (
          <label key={k}>
            <span>{label}</span>
            {Array.isArray(ty) ? (
              <select value={String(v)} onChange={(e) => set(e.target.value)}>
                {ty.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              // key on the value so an undo or another edit refreshes the field
              <input key={String(v)} type={ty === 'text' ? 'text' : 'number'} defaultValue={v} onBlur={(e) => e.target.value !== String(v) && set(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            )}
          </label>
        );
      })}
    </div>
  );
}

const patch = <K extends 'flights' | 'landings' | 'spans'>(kind: K, id: string, k: string, v: string | number) =>
  useApp.getState().commit((m) => ({ ...m, [kind]: (m[kind] as { id: string }[]).map((x) => (x.id === id ? { ...x, [k]: k === 'n' ? Math.max(2, Math.round(+v)) : v, ...(kind === 'spans' ? { auto: false } : {}) } : x)) }));

function pickWidth(id: string) {
  const panel = useApp.getState().panel;
  if (panel !== 'plan' && panel !== 'split') return toast('Switch to the plan view to pick the width.');
  startMovePick((dx, dy) => patch('spans', id, 'width', Math.round(Math.hypot(dx, dy))), ['Strip width: click the first edge point (snaps to flight edges, beams...). Esc returns without it.', 'Strip width: click the opposite edge point; the distance becomes the width.']);
}

/** Levels of a beam's two ends, absolute; changing one re-places the beam on the story its lower end lies in. */
function setBeamEndsZ(m: Model, b: Beam, z1: number, z2: number): Model {
  const at = placeAt(m, Math.min(z1, z2));
  if (!at) return m;
  const top = storyElevations(m)[at.story].top;
  const { dz2: _, ...rest } = b;
  const nb = withDz({ ...rest, story: at.story } as Beam, z1 - top);
  return { ...m, beams: m.beams.map((x) => (x.id === b.id ? (Math.abs(z2 - z1) > 1 ? { ...nb, dz2: z2 - top } : nb) : x)) };
}

/** Properties of one selected flight, landing, span or beam (end levels: makes a level beam sloped). */
export function StairProps() {
  const m = useApp((s) => s.model);
  const sel = useApp((s) => s.selection);
  if (sel.length !== 1) return null;
  const id = sel[0];
  const f = m.flights.find((x) => x.id === id),
    l = m.landings.find((x) => x.id === id),
    sp = m.spans.find((x) => x.id === id),
    b = m.beams.find((x) => x.id === id);
  if (f) {
    const F = frame(f);
    return (
      <div className="section">
        <h4>Flight {f.name}</h4>
        <Form obj={f} fields={FLIGHT} onSet={(k, v) => patch('flights', id, k, v)} />
        <div className="small muted">
          Going {F.L.toFixed(0)} · rise {F.H.toFixed(0)} · top +{(f.z0 + F.H).toFixed(0)} · slope {((Math.atan(f.R / f.T) * 180) / Math.PI).toFixed(1)}° · 2R+T = {(2 * f.R + f.T).toFixed(0)}
        </div>
      </div>
    );
  }
  if (l)
    return (
      <div className="section">
        <h4>Landing {l.name}</h4>
        <Form obj={l} fields={LANDING} onSet={(k, v) => patch('landings', id, k, v)} />
      </div>
    );
  if (sp) {
    const A = analyze(m, sp);
    return (
      <div className="section">
        <h4>Span {sp.name}</h4>
        <Form obj={sp} fields={SPAN} onSet={(k, v) => patch('spans', id, k, v)} />
        <button onClick={() => pickWidth(id)} title="Click two points in the plan (e.g. the two edges of the flight); the distance between them becomes the strip width">⌖ Pick strip width on plan</button>
        {A && (
          <div className="small muted">
            Span {A.L.toFixed(3)} m · supports {A.sup.map((s) => (s.beam ? beamName(m, s.beam) : s.span ? `on ${s.span.name}` : '—')).join(' → ')}{A.tr.length ? ` · carries ${A.tr.map((t) => t.from.name).join(', ')}` : ''} · Mu {A.U.M.toFixed(2)} kNm/m{sp.auto ? ' · auto (editing makes it manual)' : ''}
          </div>
        )}
      </div>
    );
  }
  if (b) {
    const z = beamEndsZ(storyElevations(m), b);
    if (!z) return null;
    const ends = { z1: Math.round(z[0]), z2: Math.round(z[1]) };
    return (
      <div className="section">
        <h4>Beam {beamName(m, b)} levels</h4>
        <Form obj={ends} fields={[['z1', 'Top at start (mm)'], ['z2', 'Top at end (mm)']]} onSet={(k, v) => useApp.getState().commit((mm) => setBeamEndsZ(mm, b, k === 'z1' ? +v : z[0], k === 'z2' ? +v : z[1]))} />
        <div className="small muted">Different end levels make a sloped piece; chain pieces in the elevation to crank a beam.</div>
      </div>
    );
  }
  return null;
}

export function StairParamsDialog() {
  const p = useApp((s) => s.model.stair);
  return (
    <Modal title="Stair design parameters">
      <Form obj={p} fields={PARAMS} onSet={(k, v) => useApp.getState().commit((m) => ({ ...m, stair: { ...m.stair, [k]: +v } }))} />
    </Modal>
  );
}

// ---------- results report (IS 456) ----------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f2 = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const okS = (b: boolean) => (b ? '<span class="ok">OK</span>' : '<span class="ng">NOT OK</span>');

function beamTag(m: Model, b: Beam) {
  const z = beamEndsZ(storyElevations(m), b)!;
  return `${beamName(m, b)} ${b.section}`.trim() + (Math.abs(z[1] - z[0]) > 1 ? ` (+${z[0].toFixed(0)} → +${z[1].toFixed(0)})` : ` (+${z[0].toFixed(0)})`);
}

export function resultsHtml(m: Model) {
  const p = m.stair,
    { out, warn } = beamLoads(m);
  let h = `<h2>Stair loads on beams</h2>
<div class="info">Unfactored line loads (kN/m) to apply as uniform distributed loads on each beam, in two load cases: <b>Stair Dead</b> (waist / landing self weight + steps + finishes) and <b>Stair Live</b>. Distances in m from the beam start (X1, Y1). A cranked beam is listed piece by piece.</div>
<table><tr><th>Beam</th><th>Grid</th><th>Length (m)</th><th>From span</th><th>Start (m)</th><th>End (m)</th><th>Dead (kN/m)</th><th>Live (kN/m)</th><th>Factored (kN/m)</th></tr>`;
  for (const [b, rows] of out) {
    const L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 1000;
    if (!rows.length) continue;
    rows.forEach((r, i) => (h += `<tr><td>${i ? '' : esc(beamTag(m, b))}</td><td>${i ? '' : esc(gridRef(m, b))}</td><td>${i ? '' : f2(L)}</td><td>${esc(r.sp.name)}</td><td>${f2(r.a / 1000)}</td><td>${f2(r.b / 1000)}</td><td>${f2(r.dl)}</td><td>${f2(r.ll)}</td><td>${f2(r.fu)}</td></tr>`));
  }
  h += '</table>';
  if (warn.length) h += '<div class="card"><b class="ng">Warnings</b><ul>' + warn.map((w) => `<li>${esc(w)}</li>`).join('') + '</ul></div>';
  h += `<h2>Slab design — IS 456:2000</h2><div class="info">M${p.fck} / Fe${p.fy}, clear cover ${p.cover} mm, main Ø${p.bar}, distribution Ø${p.dbar}, finishes ${p.ff} kN/m², live ${p.ll} kN/m², γc ${p.gc} kN/m³, γf ${p.gf}. Each span is a 1 m wide simply supported strip; effective span = c/c of supports measured horizontally (cl 33.1); depth = waist normal to the soffit (cl 33.3).</div>`;
  for (const sp of m.spans) {
    const A = analyze(m, sp);
    if (!A) {
      h += `<div class="card">${esc(sp.name)}: too short.</div>`;
      continue;
    }
    const d = A.des;
    h += `<div class="card"><h4>${esc(sp.name)} — effective span ${f2(A.L, 3)} m, strip width ${f2(sp.width / 1000)} m</h4>
<div class="info">Supports: ${A.sup.map((s) => (s.beam ? esc(beamTag(m, s.beam)) : s.span ? `rests on span ${esc(s.span.name)} at ${f2(s.at!)} m` : 'none (wall/other)')).join(' → ')}</div>
<table><tr><th>Element</th><th>From (m)</th><th>To (m)</th><th>Length (m)</th><th>Slab SW</th><th>Steps</th><th>Finish</th><th>Share</th><th>DL (kN/m²)</th><th>LL (kN/m²)</th><th>wu (kN/m²)</th></tr>`;
    for (const s of A.segs) h += `<tr><td>${esc(s.it.name)} (${'n' in s.it ? 'flight' : 'landing'}, t=${s.it.t})</td><td>${f2(s.a)}</td><td>${f2(s.b)}</td><td>${f2(s.b - s.a)}</td><td>${f2(s.ld.ws)}</td><td>${f2(s.ld.st)}</td><td>${f2(s.ld.ff)}</td><td>${s.k === 1 ? '100%' : '50% (cl 33.2)'}</td><td>${f2(s.dl)}</td><td>${f2(s.ll)}</td><td>${f2(p.gf * (s.dl + s.ll))}</td></tr>`;
    for (const t of A.tr) h += `<tr><td>Reaction of span ${esc(t.from.name)} (${t.end ? 'end' : 'start'})</td><td>${f2(t.a)}</td><td>${f2(t.b)}</td><td>${f2(t.b - t.a)}</td><td>—</td><td>—</td><td>—</td><td>100%</td><td>${f2(t.dl)}</td><td>${f2(t.ll)}</td><td>${f2(p.gf * (t.dl + t.ll))}</td></tr>`;
    h += `</table><table><tr><th>Per m width</th><th>Dead</th><th>Live</th><th>Factored</th></tr>
<tr><td>Reaction at start (kN/m)</td><td>${f2(A.D.RA)}</td><td>${f2(A.LL.RA)}</td><td>${f2(A.U.RA)}</td></tr>
<tr><td>Reaction at end (kN/m)</td><td>${f2(A.D.RB)}</td><td>${f2(A.LL.RB)}</td><td>${f2(A.U.RB)}</td></tr>
<tr><td>Max moment (kNm/m)</td><td>${f2(A.D.M)}</td><td>${f2(A.LL.M)}</td><td>${f2(A.U.M)} at x = ${f2(A.U.x)} m</td></tr></table>
<div class="calc">D = ${d.D} mm,  d = D − cover − Ø/2 = ${d.D} − ${p.cover} − ${p.bar / 2} = ${f2(d.d, 1)} mm
Mu = ${f2(d.Mu)} kNm/m;  xu,max/d = ${f2(d.xr, 3)};  Mu,lim = ${f2(d.Q, 3)}·b·d² = ${f2(d.Mlim)} kNm/m  → ${okS(d.flex)}${d.flex ? '' : `  (d required ≥ ${f2(d.dReq, 0)} mm — increase the waist)`}
Ast,req = ${f2(d.Ast, 0)} mm²/m;  Ast,min = ${p.fy > 250 ? '0.12' : '0.15'}% bD = ${f2(d.Amin, 0)} mm²/m
Main bars: Ø${p.bar} @ ${d.s} c/c  (max ${f2(d.sMax, 0)})  → Ast,prov = ${f2(d.Aprov, 0)} mm²/m
Distribution: Ø${p.dbar} @ ${d.sd} c/c  (max ${f2(d.sdMax, 0)})  → ${f2(d.Adprov, 0)} mm²/m
Shear: Vu = ${f2(d.Vu)} kN/m;  τv = ${f2(d.tv, 3)} MPa;  pt = ${f2(d.pt, 3)}%;  τc = ${f2(d.tc, 3)};  k·τc = ${f2(d.k * d.tc, 3)}  → ${okS(d.shear)};  τv ≤ 0.5τc,max = ${f2(d.tcmax / 2, 2)} → ${okS(d.shearMax)}
Deflection: fs = ${f2(d.fs, 0)} MPa;  kt = ${f2(d.kt)};  allowable l/d = 20 × kt = ${f2(d.ldAllow, 1)};  actual = ${f2(d.ld, 1)}  → ${okS(d.defl)}</div>
<b>Provide:</b> ${d.D} mm waist, Ø${p.bar} @ ${d.s} c/c main, Ø${p.dbar} @ ${d.sd} c/c distribution ${d.flex && d.shear && d.shearMax && d.defl ? '<span class="ok">— all checks OK</span>' : '<span class="ng">— revise</span>'}</div>`;
  }
  if (!m.spans.length) h += '<div class="info">No spans yet — draw spans or use Stair → Auto spans.</div>';
  h += '<h2>Flight geometry</h2><table><tr><th>Flight</th><th>Risers</th><th>R (mm)</th><th>T (mm)</th><th>2R+T</th><th>Going (m)</th><th>Rise (m)</th><th>Levels (mm)</th></tr>';
  for (const f of m.flights) {
    const F = frame(f),
      c = 2 * f.R + f.T;
    h += `<tr><td>${esc(f.name)}</td><td>${f.n}</td><td>${f.R}</td><td>${f.T}</td><td>${c.toFixed(0)} ${c < 550 || c > 700 ? '<span class="ng">(550–700)</span>' : ''}</td><td>${f2(F.L / 1000)}</td><td>${f2(F.H / 1000, 3)}</td><td>${f.z0.toFixed(0)} → ${(f.z0 + F.H).toFixed(0)}</td></tr>`;
  }
  return h + '</table>';
}

export function StairResultsDialog() {
  const m = useApp((s) => s.model);
  return (
    <Modal wide title="Stair design results" footer={<><button onClick={() => downloadCsv(m)}>Beam loads CSV</button><button onClick={() => printReport(m)}>Print report</button></>}>
      <div className="report-inline report" style={{ position: 'static', maxHeight: '70vh' }} dangerouslySetInnerHTML={{ __html: resultsHtml(m) }} />
    </Modal>
  );
}

function download(name: string, txt: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function downloadCsv(m: Model) {
  const { out } = beamLoads(m),
    L = ['Beam,Section,Grid,Load case,Start (m),End (m),Load (kN/m),Span'];
  for (const [b, rows] of out)
    for (const r of rows)
      for (const [c, v] of [
        ['Stair Dead', r.dl],
        ['Stair Live', r.ll],
      ] as const)
        L.push([beamName(m, b), b.section, `"${gridRef(m, b)}"`, c, f2(r.a / 1000, 3), f2(r.b / 1000, 3), f2(v, 3), r.sp.name].join(','));
  download('stair-beam-loads.csv', L.join('\n'), 'text/csv');
}

function printReport(m: Model) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><title>Stair design report</title><style>body{font:12px system-ui;margin:20px}table{border-collapse:collapse;margin:6px 0}th,td{border:1px solid #999;padding:2px 6px;text-align:right}td:first-child,th:first-child{text-align:left}.calc{font-family:monospace;white-space:pre-wrap}.ok{color:#15803d}.ng{color:#c62828}.card{border:1px solid #ccc;padding:8px;margin:8px 0}.info{color:#555}</style>${resultsHtml(m)}`);
  w.document.close();
  w.print();
}
