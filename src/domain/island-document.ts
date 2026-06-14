import { isIslandTerrainColors, referenceIslandGrid, referenceIslandMacroGrid, referenceIslandSubdivisions, type IslandTerrainColors } from './island-terrain';

export interface IslandCell {
  x: number;
  y: number;
}

export interface IslandRegionNote {
  id: string;
  text: string;
  createdAt: string;
}

export interface IslandRegion {
  id: string;
  label: string;
  color: string;
  cells: IslandCell[];
  notes: IslandRegionNote[];
  createdAt: string;
  updatedAt: string;
}

export interface IslandMap {
  id: string;
  name: string;
  order: number;
  grid: {
    width: number;
    height: number;
  };
  terrainColors?: IslandTerrainColors;
  regions: IslandRegion[];
}

export interface IslandDocumentV1 {
  version: 1;
  activeMapId: string;
  maps: IslandMap[];
  updatedAt: string;
}

export const localIslandStorageKey = 'pokokit.islandDesigner.document.v1';
export const islandRegionPalette = ['#d95f39', '#6f8f2f', '#c58a14', '#c94f7c', '#7a6a2e', '#e07a4f'] as const;

export interface CreateIslandRegionInput {
  id: string;
  label: string;
  note?: string;
  color: string;
  cells: IslandCell[];
  now?: string;
}

export type CreateIslandRegionResult =
  | { ok: true; document: IslandDocumentV1; region: IslandRegion }
  | { ok: false; message: string };

export type RemoveIslandRegionResult =
  | { ok: true; document: IslandDocumentV1; removed: IslandRegion }
  | { ok: false; message: string };

export type AppendIslandRegionNoteResult =
  | { ok: true; document: IslandDocumentV1; region: IslandRegion; note: IslandRegionNote }
  | { ok: false; message: string };

export type UpdateIslandRegionCellsResult =
  | { ok: true; document: IslandDocumentV1; region: IslandRegion }
  | { ok: false; message: string };

export function updateActiveIslandMapTerrainColors(
  document: IslandDocumentV1,
  terrainColors: IslandTerrainColors,
  now = new Date().toISOString(),
): IslandDocumentV1 {
  const activeMap = getActiveMap(document);
  return {
    ...document,
    updatedAt: now,
    maps: document.maps.map(map => (
      map.id === activeMap.id
        ? { ...map, terrainColors }
        : map
    )),
  };
}

export function createDefaultIslandDocument(now = new Date().toISOString()): IslandDocumentV1 {
  return {
    version: 1,
    activeMapId: 'map-1',
    maps: [
      {
        id: 'map-1',
        name: '第一张岛屿地图',
        order: 0,
        grid: {
          width: referenceIslandGrid.width,
          height: referenceIslandGrid.height,
        },
        regions: [],
      },
    ],
    updatedAt: now,
  };
}

export function getActiveMap(document: IslandDocumentV1): IslandMap {
  return document.maps.find(map => map.id === document.activeMapId) ?? document.maps[0] ?? createDefaultIslandDocument().maps[0]!;
}

export function normalizeIslandDocumentGrid(document: IslandDocumentV1, now = new Date().toISOString()): IslandDocumentV1 {
  let changed = false;
  const maps = document.maps.map(map => {
    const nextRegions: IslandRegion[] = [];
    const isCurrentGrid = map.grid.width === referenceIslandGrid.width && map.grid.height === referenceIslandGrid.height;
    for (const region of map.regions) {
      const cells = isCurrentGrid
        ? uniqueInBoundsCells(region.cells, referenceIslandGrid)
        : expandMacroCellsToSubcells(region.cells);
      const color = readNormalizedRegionColor(region.color, nextRegions.length);
      if (cells.length !== region.cells.length || !sameCells(cells, region.cells)) {
        changed = true;
      }
      if (color !== region.color) {
        changed = true;
      }
      if (cells.length > 0) {
        nextRegions.push(sameCells(cells, region.cells) && color === region.color ? region : { ...region, cells, color });
      }
    }
    if (nextRegions.length !== map.regions.length) {
      changed = true;
    }
    if (map.grid.width !== referenceIslandGrid.width || map.grid.height !== referenceIslandGrid.height) {
      changed = true;
    }
    return {
      ...map,
      grid: {
        width: referenceIslandGrid.width,
        height: referenceIslandGrid.height,
      },
      regions: nextRegions,
    };
  });

  return changed ? { ...document, maps, updatedAt: now } : document;
}

export function createIslandRegion(document: IslandDocumentV1, input: CreateIslandRegionInput): CreateIslandRegionResult {
  const activeMap = getActiveMap(document);
  const label = input.label.trim();
  const now = input.now ?? new Date().toISOString();

  if (!label) {
    return { ok: false, message: '请填写区域标题。' };
  }
  if (!isAllowedRegionColor(input.color)) {
    return { ok: false, message: '请选择可用的区域颜色。' };
  }

  const cells = uniqueInBoundsCells(input.cells, activeMap.grid);
  if (cells.length === 0) {
    return { ok: false, message: '请先选择地图格子。' };
  }

  const region: IslandRegion = {
    id: input.id,
    label,
    color: input.color,
    cells,
    notes: createInitialRegionNotes(input.id, input.note, now),
    createdAt: now,
    updatedAt: now,
  };
  return {
    ok: true,
    region,
    document: {
      ...document,
      updatedAt: now,
      maps: document.maps.map(map => (
        map.id === activeMap.id
          ? { ...map, regions: [...map.regions, region] }
          : map
      )),
    },
  };
}

export function appendIslandRegionNote(document: IslandDocumentV1, regionId: string, text: string, now = new Date().toISOString()): AppendIslandRegionNoteResult {
  const activeMap = getActiveMap(document);
  const noteText = text.trim();
  if (!noteText) {
    return { ok: false, message: '请填写注释。' };
  }

  const region = activeMap.regions.find(candidate => candidate.id === regionId);
  if (!region) {
    return { ok: false, message: '未找到待建造区域。' };
  }

  const note: IslandRegionNote = {
    id: `${regionId}-note-${region.notes.length + 1}`,
    text: noteText,
    createdAt: now,
  };
  const updatedRegion = {
    ...region,
    notes: [...region.notes, note],
    updatedAt: now,
  };

  return {
    ok: true,
    region: updatedRegion,
    note,
    document: {
      ...document,
      updatedAt: now,
      maps: document.maps.map(map => (
        map.id === activeMap.id
          ? { ...map, regions: map.regions.map(candidate => candidate.id === regionId ? updatedRegion : candidate) }
          : map
      )),
    },
  };
}

export function updateIslandRegionCells(document: IslandDocumentV1, regionId: string, cells: IslandCell[], now = new Date().toISOString()): UpdateIslandRegionCellsResult {
  const activeMap = getActiveMap(document);
  const region = activeMap.regions.find(candidate => candidate.id === regionId);
  if (!region) {
    return { ok: false, message: '未找到待建造区域。' };
  }

  const normalizedCells = uniqueInBoundsCells(cells, activeMap.grid);
  if (normalizedCells.length === 0) {
    return { ok: false, message: '请先选择地图格子。' };
  }

  const updatedRegion = {
    ...region,
    cells: normalizedCells,
    updatedAt: now,
  };

  return {
    ok: true,
    region: updatedRegion,
    document: {
      ...document,
      updatedAt: now,
      maps: document.maps.map(map => (
        map.id === activeMap.id
          ? { ...map, regions: map.regions.map(candidate => candidate.id === regionId ? updatedRegion : candidate) }
          : map
      )),
    },
  };
}

export function nextIslandRegionId(regions: IslandRegion[], seed = 1): string {
  const existing = new Set(regions.map(region => region.id));
  let index = Math.max(1, Math.trunc(seed));
  while (existing.has(`region-${index}`)) {
    index += 1;
  }
  return `region-${index}`;
}

export function removeIslandRegion(document: IslandDocumentV1, regionId: string, now = new Date().toISOString()): RemoveIslandRegionResult {
  const activeMap = getActiveMap(document);
  const removed = activeMap.regions.find(region => region.id === regionId);
  if (!removed) {
    return { ok: false, message: '未找到要删除的区域说明。' };
  }

  return {
    ok: true,
    removed,
    document: {
      ...document,
      updatedAt: now,
      maps: document.maps.map(map => (
        map.id === activeMap.id
          ? { ...map, regions: map.regions.filter(region => region.id !== regionId) }
          : map
      )),
    },
  };
}

export function isIslandDocumentV1(value: unknown): value is IslandDocumentV1 {
  if (!isRecord(value) || value.version !== 1 || typeof value.activeMapId !== 'string' || typeof value.updatedAt !== 'string' || !Array.isArray(value.maps)) {
    return false;
  }
  if (!value.maps.some(map => isRecord(map) && map.id === value.activeMapId)) {
    return false;
  }
  return value.maps.every(isIslandMap);
}

function isIslandMap(value: unknown): value is IslandMap {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.order !== 'number' || !isRecord(value.grid) || !Array.isArray(value.regions)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'terrainColors') && !isIslandTerrainColors(value.terrainColors)) {
    return false;
  }
  const width = value.grid.width;
  const height = value.grid.height;
  return (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width === referenceIslandGrid.width &&
    height === referenceIslandGrid.height &&
    value.regions.every(isIslandRegion)
  );
}

function isIslandRegion(value: unknown): value is IslandRegion {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string' || typeof value.color !== 'string' || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' || !Array.isArray(value.cells) || !Array.isArray(value.notes)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'note')) {
    return false;
  }
  return (
    value.cells.every(cell => isRecord(cell) && Number.isInteger(cell.x) && Number.isInteger(cell.y)) &&
    value.notes.every(isIslandRegionNote)
  );
}

function isIslandRegionNote(value: unknown): value is IslandRegionNote {
  return isRecord(value) && typeof value.id === 'string' && typeof value.text === 'string' && typeof value.createdAt === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAllowedRegionColor(color: string): boolean {
  return islandRegionPalette.some(candidate => candidate === color);
}

function readNormalizedRegionColor(color: string, regionIndex: number): string {
  if (isAllowedRegionColor(color) && !isBlueHue(color)) {
    return color;
  }
  return islandRegionPalette[regionIndex % islandRegionPalette.length] ?? islandRegionPalette[0];
}

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

function createInitialRegionNotes(regionId: string, note: string | undefined, now: string): IslandRegionNote[] {
  const text = note?.trim();
  return text ? [{ id: `${regionId}-note-1`, text, createdAt: now }] : [];
}

function uniqueInBoundsCells(cells: IslandCell[], grid: IslandMap['grid']): IslandCell[] {
  const seen = new Set<string>();
  const result: IslandCell[] = [];
  for (const cell of cells) {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 || cell.y < 0 || cell.x >= grid.width || cell.y >= grid.height) {
      continue;
    }
    const key = `${cell.x}:${cell.y}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ x: cell.x, y: cell.y });
  }
  return result;
}

function expandMacroCellsToSubcells(cells: IslandCell[]): IslandCell[] {
  const seen = new Set<string>();
  const result: IslandCell[] = [];
  for (const cell of cells) {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 || cell.y < 0 || cell.x >= referenceIslandMacroGrid.width || cell.y >= referenceIslandMacroGrid.height) {
      continue;
    }
    const baseX = cell.x * referenceIslandSubdivisions;
    const baseY = cell.y * referenceIslandSubdivisions;
    for (let y = 0; y < referenceIslandSubdivisions; y += 1) {
      for (let x = 0; x < referenceIslandSubdivisions; x += 1) {
        const subcell = { x: baseX + x, y: baseY + y };
        const key = `${subcell.x}:${subcell.y}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(subcell);
        }
      }
    }
  }
  return result;
}

function sameCells(left: IslandCell[], right: IslandCell[]): boolean {
  return left.length === right.length && left.every((cell, index) => cell.x === right[index]?.x && cell.y === right[index]?.y);
}
