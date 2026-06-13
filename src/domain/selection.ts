import type { IslandCell } from './island-document';

export interface GridBounds {
  width: number;
  height: number;
}

export interface SelectionState {
  anchor: IslandCell | null;
  focus: IslandCell | null;
  cells: IslandCell[];
  dragging: boolean;
}

export const emptySelection: SelectionState = {
  anchor: null,
  focus: null,
  cells: [],
  dragging: false,
};

export function beginSelectionDrag(cell: IslandCell, bounds: GridBounds): SelectionState {
  const clamped = clampCell(cell, bounds);
  return {
    anchor: clamped,
    focus: clamped,
    cells: [clamped],
    dragging: true,
  };
}

export function updateSelectionDrag(state: SelectionState, cell: IslandCell, bounds: GridBounds): SelectionState {
  if (!state.anchor) {
    return beginSelectionDrag(cell, bounds);
  }
  const focus = clampCell(cell, bounds);
  return {
    anchor: state.anchor,
    focus,
    cells: cellsInRect(state.anchor, focus, bounds),
    dragging: true,
  };
}

export function endSelectionDrag(state: SelectionState, cell: IslandCell, bounds: GridBounds): SelectionState {
  const updated = updateSelectionDrag(state, cell, bounds);
  return {
    ...updated,
    dragging: false,
  };
}

export function clearSelection(): SelectionState {
  return emptySelection;
}

export function cellsInRect(start: IslandCell, end: IslandCell, bounds: GridBounds): IslandCell[] {
  const a = clampCell(start, bounds);
  const b = clampCell(end, bounds);
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const cells: IslandCell[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}

export function clampCell(cell: IslandCell, bounds: GridBounds): IslandCell {
  return {
    x: clampInteger(cell.x, 0, bounds.width - 1),
    y: clampInteger(cell.y, 0, bounds.height - 1),
  };
}

export function cellKey(cell: IslandCell): string {
  return `${cell.x}:${cell.y}`;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}
