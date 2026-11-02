import { describe, expect, it } from 'vitest';
import { emptyModel } from '../model/types';
import { template } from './stair';
import { resultsHtml } from '../ui/StairPanel';

describe('report drawings', () => {
  it('every stair template gets plan, elevations, unit-weight, section and loading figures', () => {
    for (const k of ['straight', 'L', 'dog', 'open'] as const) {
      const m = template(emptyModel(), k, 'Story1', 'B300x500', 'C400x400');
      const h = resultsHtml(m);
      const figs = h.match(/<svg /g)?.length ?? 0;
      // plan + one elevation per flight + step details + landing blocks + section & loading per span + beams
      expect(figs).toBeGreaterThanOrEqual(1 + m.flights.length + 1 + 2 * m.spans.length);
      expect(h).not.toMatch(/NaN|undefined/);
    }
  });
});
