import { describe, expect, it } from 'vitest';
import { emptyModel } from '../model/types';
import { analyze, autoSpans, beamLoads, kSlab, ssBeam, suggestWaist, tauC, template, withWaist } from './stair';

describe('stair statics and IS 456 tables', () => {
  it('simply supported UDL and partial load', () => {
    const r = ssBeam([{ a: 0, b: 4, w: 10 }], 4);
    expect(r.RA).toBeCloseTo(20);
    expect(r.M).toBeCloseTo(20);
    const r2 = ssBeam([{ a: 0, b: 1, w: 6 }], 4);
    expect(r2.RA).toBeCloseTo(5.25);
    expect(r2.RB).toBeCloseTo(0.75);
  });
  it('reads tables', () => {
    expect(tauC(0.5, 25)).toBeCloseTo(0.49);
    expect(kSlab(200)).toBeCloseTo(1.2);
  });
});

describe('templates', () => {
  it('dog-legged stair: two auto spans, each supported by beams at matching levels', () => {
    const m = template(emptyModel(), 'dog', 'Story1', 'B300x500', 'C400x400');
    expect(m.flights.length).toBe(2);
    expect(m.landings.length).toBe(1);
    expect(m.spans.length).toBe(2);
    for (const sp of m.spans) {
      const A = analyze(m, sp)!;
      expect(A.sup.every((s) => s.beam && !s.mismatch)).toBe(true);
    }
    const { warn } = beamLoads(m);
    expect(warn).toEqual([]);
  });
  it('quarter-turn without a beam past the landing: the first flight rests on the second span', () => {
    const t = template(emptyModel(), 'L', 'Story1', 'B300x500', 'C400x400');
    const m = autoSpans({ ...t, beams: t.beams.filter((b) => !(b.x1 === b.x2 && b.x1 > 0)) });
    const [s1, s2] = m.spans;
    // IS 456 cl 33.1(b): S1 ends half the landing width past F1's top step, not at the landing's far edge
    const f1 = m.flights[0];
    expect(s1.x2).toBe(Math.round(f1.x + (f1.n - 1) * f1.T + Math.min(f1.width / 2, 1000)));
    const A1 = analyze(m, s1)!,
      A2 = analyze(m, s2)!;
    expect(A1.sup[1].span).toBe(s2);
    expect(A2.tr.map((x) => x.from)).toEqual([s1]);
    // what S2 takes to its beams = its own slab load + S1's end reaction
    const own = A2.segs.reduce((a, g) => a + g.dl * (g.b - g.a), 0) * s2.width;
    expect((A2.D.RA + A2.D.RB) * s2.width).toBeCloseTo(own + A1.D.RB * s1.width);
    expect(beamLoads(m).warn).toEqual([]);
  });
});

describe('waist suggestion', () => {
  it('thin waist fails deflection; the suggested waist (≥ L/20) passes', () => {
    const t = template(emptyModel(), 'dog', 'Story1', 'B300x500', 'C400x400');
    const m = { ...t, flights: t.flights.map((f) => ({ ...f, t: 80 })) };
    const sp = m.spans[0];
    expect(analyze(m, sp)!.des.defl).toBe(false);
    const s = suggestWaist(m, sp)!;
    expect(s.t).toBeGreaterThanOrEqual(s.thumb);
    expect(analyze(withWaist(m, s.ids, s.t), sp)!.des.defl).toBe(true);
  });
});
