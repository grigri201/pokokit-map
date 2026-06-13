import { describe, expect, it } from 'vitest';

import {
  beginSelectionDrag,
  cellsInRect,
  clampCell,
  endSelectionDrag,
  updateSelectionDrag,
} from './selection';

const bounds = { width: 5, height: 4 };

describe('selection helpers', () => {
  it('selects a single stable grid cell', () => {
    expect(beginSelectionDrag({ x: 2, y: 1 }, bounds)).toMatchObject({
      anchor: { x: 2, y: 1 },
      focus: { x: 2, y: 1 },
      cells: [{ x: 2, y: 1 }],
      dragging: true,
    });
  });

  it('computes rectangle cells for forward and reverse drags', () => {
    expect(cellsInRect({ x: 1, y: 1 }, { x: 3, y: 2 }, bounds)).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);

    expect(cellsInRect({ x: 3, y: 2 }, { x: 1, y: 1 }, bounds)).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);
  });

  it('clamps selection to grid bounds', () => {
    expect(clampCell({ x: -4, y: 10 }, bounds)).toEqual({ x: 0, y: 3 });

    const selected = endSelectionDrag(
      updateSelectionDrag(beginSelectionDrag({ x: 3, y: 2 }, bounds), { x: 9, y: 9 }, bounds),
      { x: 9, y: 9 },
      bounds,
    );

    expect(selected.focus).toEqual({ x: 4, y: 3 });
    expect(selected.cells).toEqual([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
    ]);
    expect(selected.dragging).toBe(false);
  });
});
