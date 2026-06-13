import { referenceIslandGrid, referenceIslandMacroGrid, referenceIslandSubdivisions } from './island-terrain';

export interface IslandCell {
  x: number;
  y: number;
}

export interface IslandRegion {
  id: string;
  label: string;
  note: string;
  color: string;
  cells: IslandCell[];
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
  regions: IslandRegion[];
}

export interface IslandDocumentV1 {
  version: 1;
  activeMapId: string;
  maps: IslandMap[];
  updatedAt: string;
}

export const localIslandStorageKey = 'pokokit.islandDesigner.document.v1';
export const islandRegionPalette = ['#2f7dd1', '#d95f39', '#6f8f2f', '#8b5cc7', '#c58a14'] as const;

export interface CreateIslandRegionInput {
  id: string;
  label: string;
  note: string;
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
      if (cells.length !== region.cells.length || !sameCells(cells, region.cells)) {
        changed = true;
      }
      if (cells.length > 0) {
        nextRegions.push(sameCells(cells, region.cells) ? region : { ...region, cells });
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
  const note = input.note.trim();
  const now = input.now ?? new Date().toISOString();

  if (!label) {
    return { ok: false, message: '请填写区域标题。' };
  }
  if (!note) {
    return { ok: false, message: '请填写区域说明。' };
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
    note,
    color: input.color,
    cells,
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
  const width = value.grid.width;
  const height = value.grid.height;
  return (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    value.regions.every(isIslandRegion)
  );
}

function isIslandRegion(value: unknown): value is IslandRegion {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string' || typeof value.note !== 'string' || typeof value.color !== 'string' || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' || !Array.isArray(value.cells)) {
    return false;
  }
  return value.cells.every(cell => isRecord(cell) && Number.isInteger(cell.x) && Number.isInteger(cell.y));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAllowedRegionColor(color: string): boolean {
  return islandRegionPalette.some(candidate => candidate === color);
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
