import { describe, expect, it } from 'vitest';

import {
  createDefaultIslandDocument,
  createIslandRegion,
  currentIslandMapId,
  hashIslandDocumentSnapshot,
  islandRegionLabelMaxLength,
  islandRegionPalette,
  isIslandDocumentV1,
  nextIslandRegionId,
  normalizeIslandDocumentGrid,
  removeIslandRegion,
  updateActiveIslandMapTerrainColors,
  updateIslandRegion,
} from './island-document';
import { referenceIslandGrid, referenceIslandSubdivisions, referenceIslandTerrainGrid } from './island-terrain';

describe('island document region creation', () => {
  it('creates the default reference island grid', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');

    expect(document.activeMapId).toBe(currentIslandMapId);
    expect(document.maps[0]?.id).toBe(currentIslandMapId);
    expect(document.maps[0]?.grid).toEqual(referenceIslandGrid);
  });

  it('normalizes legacy single-map ids to the current cloud island id', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    const { backgroundColor: _backgroundColor, ...legacyMap } = document.maps[0]!;
    const legacy = {
      ...document,
      activeMapId: 'map-1',
      maps: [
        {
          ...legacyMap,
          id: 'map-1',
        },
      ],
    };

    const normalized = normalizeIslandDocumentGrid(legacy, '2026-06-13T01:00:00.000Z');

    expect(normalized.activeMapId).toBe(currentIslandMapId);
    expect(normalized.maps[0]?.id).toBe(currentIslandMapId);
    expect(normalized.maps[0]?.backgroundColor).toBe('#2d8be8');
  });

  it('hashes meaningful saved content without timestamp-only drift', () => {
    const first = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    const second = {
      ...first,
      updatedAt: '2026-06-13T01:00:00.000Z',
      maps: first.maps.map(map => ({
        ...map,
        regions: map.regions.map(region => ({
          ...region,
          updatedAt: '2026-06-13T01:00:00.000Z',
        })),
      })),
    };
    const renamed = {
      ...first,
      maps: first.maps.map(map => ({ ...map, name: 'Renamed island' })),
    };

    expect(hashIslandDocumentSnapshot(first)).toBe(hashIslandDocumentSnapshot(second));
    expect(hashIslandDocumentSnapshot(first)).not.toBe(hashIslandDocumentSnapshot(renamed));
  });

  it('keeps region marker colors away from blue hues', () => {
    expect(islandRegionPalette.every(color => !isBlueHue(color))).toBe(true);
  });

  it('stores imported terrain colors on the active map', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    const terrainColors = Array.from({ length: referenceIslandTerrainGrid.height }, () =>
      Array.from({ length: referenceIslandTerrainGrid.width }, () => '#aabbcc'),
    );

    const updated = updateActiveIslandMapTerrainColors(document, terrainColors, '2026-06-13T01:00:00.000Z');

    expect(updated.updatedAt).toBe('2026-06-13T01:00:00.000Z');
    expect(updated.maps[0]?.terrainColors?.[0]?.[0]).toBe('#aabbcc');
    expect(isIslandDocumentV1(updated)).toBe(true);
  });

  it('normalizes legacy grid documents to the reference island grid', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    const legacyDocument = {
      ...document,
      maps: [
        {
          ...document.maps[0]!,
          grid: { width: 48, height: 32 },
          regions: [
            {
              id: 'region-1',
              label: '旧区域',
              color: islandRegionPalette[0],
              cells: [{ x: 22, y: 22 }, { x: 23, y: 0 }, { x: 47, y: 31 }],
              notes: [],
              createdAt: '2026-06-13T00:00:00.000Z',
              updatedAt: '2026-06-13T00:00:00.000Z',
            },
          ],
        },
      ],
    };

    const normalized = normalizeIslandDocumentGrid(legacyDocument, '2026-06-13T01:00:00.000Z');

    expect(normalized.updatedAt).toBe('2026-06-13T01:00:00.000Z');
    expect(normalized.maps[0]?.grid).toEqual(referenceIslandGrid);
    expect(normalized.maps[0]?.regions[0]?.cells).toHaveLength(referenceIslandSubdivisions * referenceIslandSubdivisions);
    expect(normalized.maps[0]?.regions[0]?.cells[0]).toEqual({ x: 352, y: 352 });
    expect(normalized.maps[0]?.regions[0]?.cells.at(-1)).toEqual({ x: 367, y: 367 });
  });

  it('normalizes old blue region colors to the non-blue palette', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    const staleColorDocument = {
      ...document,
      maps: [
        {
          ...document.maps[0]!,
          regions: [
            {
              id: 'region-1',
              label: '旧蓝色区域',
              color: '#2f7dd1',
              cells: [{ x: 1, y: 1 }],
              notes: [],
              createdAt: '2026-06-13T00:00:00.000Z',
              updatedAt: '2026-06-13T00:00:00.000Z',
            },
          ],
        },
      ],
    };

    const normalized = normalizeIslandDocumentGrid(staleColorDocument, '2026-06-13T01:00:00.000Z');

    expect(normalized.updatedAt).toBe('2026-06-13T01:00:00.000Z');
    expect(normalized.maps[0]?.regions[0]?.color).toBe(islandRegionPalette[0]);
    expect(isBlueHue(normalized.maps[0]?.regions[0]?.color ?? '')).toBe(false);
  });

  it('rejects empty region input', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');

    expect(createIslandRegion(document, {
      id: 'region-1',
      label: '',
      color: islandRegionPalette[0],
      cells: [{ x: 1, y: 1 }],
      now: '2026-06-13T01:00:00.000Z',
    })).toEqual({ ok: false, message: '请填写区域标题。' });
  });

  it('rejects empty selections and colors outside the palette', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');

    expect(createIslandRegion(document, {
      id: 'region-1',
      label: '花园区',
      color: '#000000',
      cells: [{ x: 1, y: 1 }],
    })).toEqual({ ok: false, message: '请选择可用的区域颜色。' });

    expect(createIslandRegion(document, {
      id: 'region-1',
      label: '花园区',
      color: islandRegionPalette[0],
      cells: [{ x: -1, y: 2 }],
    })).toEqual({ ok: false, message: '请先选择地图格子。' });
  });

  it('adds a sanitized region to the active map', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    const result = createIslandRegion(document, {
      id: 'region-1',
      label: '  花园区  ',
      color: islandRegionPalette[1],
      cells: [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 500, y: 1 }],
      now: '2026-06-13T01:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.region).toMatchObject({
      id: 'region-1',
      label: '花园区',
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
      color: islandRegionPalette[1],
      cells: [{ x: 1, y: 1 }],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    expect(nextIslandRegionId(first.document.maps[0]?.regions ?? [], 1)).toBe('region-2');
  });

  it('limits region labels to 100 characters', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    const longLabel = '花'.repeat(120);
    const result = createIslandRegion(document, {
      id: 'region-1',
      label: longLabel,
      color: islandRegionPalette[1],
      cells: [{ x: 1, y: 1 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.region.label).toHaveLength(islandRegionLabelMaxLength);
    expect(result.region.label).toBe('花'.repeat(100));
  });

  it('updates an existing region label and cells while preserving notes by default', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    const created = createIslandRegion(document, {
      id: 'region-1',
      label: '花园区',
      note: '旧注释',
      color: islandRegionPalette[1],
      cells: [{ x: 1, y: 1 }],
      now: '2026-06-13T01:00:00.000Z',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const updated = updateIslandRegion(created.document, {
      regionId: 'region-1',
      label: '  新花园区  ',
      cells: [{ x: 2, y: 2 }, { x: 2, y: 2 }, { x: 999, y: 2 }],
      now: '2026-06-13T02:00:00.000Z',
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) {
      return;
    }
    expect(updated.region).toMatchObject({
      id: 'region-1',
      label: '新花园区',
      color: islandRegionPalette[1],
      cells: [{ x: 2, y: 2 }],
      notes: [{ id: 'region-1-note-1', text: '旧注释' }],
      createdAt: '2026-06-13T01:00:00.000Z',
      updatedAt: '2026-06-13T02:00:00.000Z',
    });
    expect(updated.document.maps[0]?.regions).toEqual([updated.region]);
  });

  it('removes a region from the active map', () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    const created = createIslandRegion(document, {
      id: 'region-1',
      label: '花园区',
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

function isBlueHue(hexColor: string): boolean {
  const match = /^#([0-9a-f]{6})$/i.exec(hexColor);
  if (!match) {
    return false;
  }

  const value = Number.parseInt(match[1]!, 16);
  const red = ((value >> 16) & 255) / 255;
  const green = ((value >> 8) & 255) / 255;
  const blue = (value & 255) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) {
    return false;
  }

  let hue = 0;
  if (max === red) {
    hue = 60 * (((green - blue) / delta) % 6);
  } else if (max === green) {
    hue = 60 * ((blue - red) / delta + 2);
  } else {
    hue = 60 * ((red - green) / delta + 4);
  }
  hue = hue < 0 ? hue + 360 : hue;
  return hue >= 180 && hue <= 260;
}
