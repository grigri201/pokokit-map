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
          width: 48,
          height: 32,
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
