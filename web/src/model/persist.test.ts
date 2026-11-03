import { describe, expect, it } from 'vitest';
import { loaded } from './persist';
import { emptyModel } from './types';

describe('loading a saved model', () => {
  it('drops spans left on a story that no longer exists', () => {
    const m = emptyModel(),
      sp = { id: 's', name: 'S1', x1: 0, y1: 0, x2: 1000, y2: 0, width: 1000 };
    const r = loaded({ ...m, spans: [{ ...sp, story: m.stories[0].name }, { ...sp, id: 'x', name: 'S2', story: 'Gone' }] });
    expect(r.spans.map((s) => s.id)).toEqual(['s']);
  });
});
