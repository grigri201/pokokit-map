import { describe, expect, it } from 'vitest';

import {
  createDefaultIslandDocument,
  createIslandRegion,
  islandRegionPalette,
  nextIslandRegionId,
  removeIslandRegion,
} from './island-document';

describe('island document region creation', () => {
  it('rejects empty region input', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');

    expect(createIslandRegion(document, {
      id: 'region-1',
      label: '',
      note: '需要花园',
      color: islandRegionPalette[0],
      cells: [{ x: 1, y: 1 }],
      now: '2026-06-13T01:00:00.000Z',
    })).toEqual({ ok: false, message: '请填写区域标题。' });

    expect(createIslandRegion(document, {
      id: 'region-1',
      label: '花园区',
      note: ' ',
      color: islandRegionPalette[0],
      cells: [{ x: 1, y: 1 }],
      now: '2026-06-13T01:00:00.000Z',
    })).toEqual({ ok: false, message: '请填写区域说明。' });
  });

  it('rejects empty selections and colors outside the palette', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');

    expect(createIslandRegion(document, {
      id: 'region-1',
      label: '花园区',
      note: '需要花园',
      color: '#000000',
      cells: [{ x: 1, y: 1 }],
    })).toEqual({ ok: false, message: '请选择可用的区域颜色。' });

    expect(createIslandRegion(document, {
      id: 'region-1',
      label: '花园区',
      note: '需要花园',
      color: islandRegionPalette[0],
      cells: [{ x: -1, y: 2 }],
    })).toEqual({ ok: false, message: '请先选择地图格子。' });
  });

  it('adds a sanitized region to the active map', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    const result = createIslandRegion(document, {
      id: 'region-1',
      label: '  花园区  ',
      note: '  入口附近需要花园  ',
      color: islandRegionPalette[1],
      cells: [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 50, y: 1 }],
      now: '2026-06-13T01:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.region).toMatchObject({
      id: 'region-1',
      label: '花园区',
      note: '入口附近需要花园',
      color: islandRegionPalette[1],
      cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      createdAt: '2026-06-13T01:00:00.000Z',
      updatedAt: '2026-06-13T01:00:00.000Z',
    });
    expect(result.document.updatedAt).toBe('2026-06-13T01:00:00.000Z');
    expect(result.document.maps[0]?.regions).toEqual([result.region]);
  });

  it('generates the next region id without colliding with loaded documents', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    const first = createIslandRegion(document, {
      id: 'region-1',
      label: '花园区',
      note: '入口附近需要花园',
      color: islandRegionPalette[1],
      cells: [{ x: 1, y: 1 }],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    expect(nextIslandRegionId(first.document.maps[0]?.regions ?? [], 1)).toBe('region-2');
  });

  it('removes a region from the active map', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    const created = createIslandRegion(document, {
      id: 'region-1',
      label: '花园区',
      note: '入口附近需要花园',
      color: islandRegionPalette[1],
      cells: [{ x: 1, y: 1 }],
      now: '2026-06-13T01:00:00.000Z',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const removed = removeIslandRegion(created.document, 'region-1', '2026-06-13T02:00:00.000Z');

    expect(removed.ok).toBe(true);
    if (!removed.ok) {
      return;
    }
    expect(removed.removed.id).toBe('region-1');
    expect(removed.document.maps[0]?.regions).toEqual([]);
    expect(removed.document.updatedAt).toBe('2026-06-13T02:00:00.000Z');
  });

  it('keeps the document unchanged when removing a missing region', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    const result = removeIslandRegion(document, 'missing-region', '2026-06-13T02:00:00.000Z');

    expect(result).toEqual({ ok: false, message: '未找到要删除的区域说明。' });
    expect(document.updatedAt).toBe('2026-06-13T00:00:00.000Z');
    expect(document.maps[0]?.regions).toEqual([]);
  });
});
