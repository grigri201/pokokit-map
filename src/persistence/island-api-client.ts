import { currentIslandMapId, getActiveMap, isIslandDocumentV1, normalizeIslandDocumentGrid, type IslandCell, type IslandDocumentV1, type IslandRegion, type IslandRegionNote } from '../domain/island-document';
import { referenceIslandWaterColor, type IslandTerrainColors } from '../domain/island-terrain';

export interface IslandRecord {
  id: string;
  owner_user_id: string;
  name: string;
  document: IslandDocumentV1;
  created_at: string;
  updated_at: string;
}

export interface CloudMapRecord {
  islandId: string;
  mapId: string;
  name: string;
  document: IslandDocumentV1;
  created_at: string;
  updated_at: string;
}

export interface IslandApiClientOptions {
  apiBaseUrl: string;
  fetcher?: typeof fetch;
  getAccessToken?: () => Promise<string | null>;
}

export class IslandApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'IslandApiError';
  }
}

export class IslandApiClient {
  private readonly apiBaseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly getAccessToken: (() => Promise<string | null>) | undefined;

  constructor(options: IslandApiClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, '');
    this.fetcher = options.fetcher ?? fetch;
    this.getAccessToken = options.getAccessToken;
  }

  async listIslands(): Promise<IslandRecord[]> {
    const response = await this.request('/api/v1/islands', { method: 'GET' });
    const data = await readData(response);
    return Array.isArray(data) ? data.filter(isIslandRecord) : [];
  }

  async createIsland(input: { name: string; document: IslandDocumentV1 }): Promise<IslandRecord> {
    const response = await this.request('/api/v1/islands', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return readIslandRecord(await readData(response));
  }

  async updateIsland(id: string, input: { name?: string; document?: IslandDocumentV1 }): Promise<IslandRecord> {
    const response = await this.request(`/api/v1/islands/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return readIslandRecord(await readData(response));
  }

  async getCloudMap(): Promise<CloudMapRecord | null> {
    try {
      const response = await this.request(`/api/v1/maps/${encodeURIComponent(currentIslandMapId)}`, { method: 'GET' });
      return readCloudMapRecord(await readData(response));
    } catch (error) {
      if (error instanceof IslandApiError && error.status === 404 && error.code === 'map_not_found') {
        return null;
      }
      if (error instanceof IslandApiError && error.status === 404 && error.code === 'not_found') {
        const legacy = await this.listIslands();
        return legacy[0] ? islandRecordToCloudMapRecord(legacy[0]) : null;
      }
      throw error;
    }
  }

  async saveCloudMap(document: IslandDocumentV1, existing: CloudMapRecord | null): Promise<CloudMapRecord> {
    const normalized = normalizeIslandDocumentGrid(document);
    try {
      const response = await this.request(`/api/v1/maps/${encodeURIComponent(currentIslandMapId)}`, {
        method: 'PUT',
        body: JSON.stringify(documentToCloudMapPayload(normalized)),
      });
      return readCloudMapRecord(await readData(response));
    } catch (error) {
      if (error instanceof IslandApiError && error.status === 404 && error.code === 'not_found') {
        const name = getActiveMap(normalized).name;
        const island = existing
          ? await this.updateIsland(existing.islandId, { name, document: normalized })
          : await this.createIsland({ name, document: normalized });
        return islandRecordToCloudMapRecord(island);
      }
      throw error;
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const accessToken = await this.readAccessToken();
    const response = await this.fetcher(`${this.apiBaseUrl}${path}`, {
      ...init,
      credentials: accessToken ? 'omit' : 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const error = await readError(response);
      throw new IslandApiError(error.code, error.message, response.status);
    }
    return response;
  }

  private async readAccessToken(): Promise<string | null> {
    if (!this.getAccessToken) {
      return null;
    }
    try {
      const token = await this.getAccessToken();
      return token?.trim() || null;
    } catch {
      return null;
    }
  }
}

async function readData(response: Response): Promise<unknown> {
  const value: unknown = await response.json();
  if (isRecord(value) && 'data' in value) {
    return value.data;
  }
  throw new IslandApiError('invalid_api_response', 'Island API returned an invalid response.', response.status);
}

async function readError(response: Response): Promise<{ code: string; message: string }> {
  try {
    const value: unknown = await response.json();
    if (isRecord(value) && isRecord(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string') {
      return { code: value.error.code, message: value.error.message };
    }
  } catch {
    // Fall through to safe error.
  }
  return { code: 'island_api_error', message: 'Island API request failed.' };
}

function readIslandRecord(value: unknown): IslandRecord {
  if (isIslandRecord(value)) {
    return value;
  }
  throw new IslandApiError('invalid_api_response', 'Island API returned an invalid island record.', 200);
}

function readCloudMapRecord(value: unknown): CloudMapRecord {
  if (isCloudMapApiRecord(value)) {
    const document = cloudMapApiRecordToDocument(value);
    return {
      islandId: value.islandId,
      mapId: value.mapId,
      name: value.name,
      document,
      created_at: value.created_at,
      updated_at: value.updated_at,
    };
  }
  throw new IslandApiError('invalid_api_response', 'Map API returned an invalid map record.', 200);
}

function isIslandRecord(value: unknown): value is IslandRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.owner_user_id === 'string' &&
    typeof value.name === 'string' &&
    isIslandDocumentV1(value.document) &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}

function islandRecordToCloudMapRecord(record: IslandRecord): CloudMapRecord {
  const document = normalizeIslandDocumentGrid(record.document);
  const activeMap = getActiveMap(document);
  return {
    islandId: record.id,
    mapId: activeMap.id,
    name: activeMap.name,
    document,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function documentToCloudMapPayload(document: IslandDocumentV1): Record<string, unknown> {
  const activeMap = getActiveMap(document);
  return {
    mapId: currentIslandMapId,
    name: activeMap.name,
    backgroundColor: activeMap.backgroundColor ?? referenceIslandWaterColor,
    grid: activeMap.grid,
    terrainColors: activeMap.terrainColors,
    selectedAreas: activeMap.regions.map(region => ({
      id: region.id,
      title: region.label,
      color: region.color,
      cells: region.cells,
      notes: region.notes.map(note => ({
        id: note.id,
        text: note.text,
        createdAt: note.createdAt,
      })),
      createdAt: region.createdAt,
      updatedAt: region.updatedAt,
    })),
    updatedAt: document.updatedAt,
  };
}

interface CloudMapApiRecord {
  islandId: string;
  mapId: string;
  name: string;
  backgroundColor: string | null;
  grid: {
    width: number;
    height: number;
  };
  terrainColors?: IslandTerrainColors;
  selectedAreas: Array<{
    id: string;
    title: string;
    color: string;
    cells: IslandCell[];
    notes: IslandRegionNote[];
    createdAt: string;
    updatedAt: string;
  }>;
  updatedAt: string;
  created_at: string;
  updated_at: string;
}

function isCloudMapApiRecord(value: unknown): value is CloudMapApiRecord {
  return (
    isRecord(value) &&
    typeof value.islandId === 'string' &&
    typeof value.mapId === 'string' &&
    typeof value.name === 'string' &&
    (value.backgroundColor === null || isHexColor(value.backgroundColor)) &&
    isRecord(value.grid) &&
    Number.isInteger(value.grid.width) &&
    Number.isInteger(value.grid.height) &&
    (value.terrainColors === undefined || isTerrainColors(value.terrainColors)) &&
    Array.isArray(value.selectedAreas) &&
    value.selectedAreas.every(isCloudMapArea) &&
    typeof value.updatedAt === 'string' &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}

function isCloudMapArea(value: unknown): value is CloudMapApiRecord['selectedAreas'][number] {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    isHexColor(value.color) &&
    Array.isArray(value.cells) &&
    value.cells.every(isIslandCell) &&
    Array.isArray(value.notes) &&
    value.notes.every(isIslandRegionNote) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function cloudMapApiRecordToDocument(record: CloudMapApiRecord): IslandDocumentV1 {
  const document: IslandDocumentV1 = {
    version: 1,
    activeMapId: record.mapId,
    maps: [
      {
        id: record.mapId,
        name: record.name,
        order: 0,
        grid: record.grid,
        backgroundColor: record.backgroundColor ?? referenceIslandWaterColor,
        ...(record.terrainColors ? { terrainColors: record.terrainColors } : {}),
        regions: record.selectedAreas.map(areaToRegion),
      },
    ],
    updatedAt: record.updatedAt,
  };
  const normalized = normalizeIslandDocumentGrid(document);
  if (!isIslandDocumentV1(normalized)) {
    throw new IslandApiError('invalid_api_response', 'Map API returned an invalid map document.', 200);
  }
  return normalized;
}

function areaToRegion(area: CloudMapApiRecord['selectedAreas'][number]): IslandRegion {
  return {
    id: area.id,
    label: area.title,
    color: area.color,
    cells: area.cells,
    notes: area.notes,
    createdAt: area.createdAt,
    updatedAt: area.updatedAt,
  };
}

function isIslandCell(value: unknown): value is IslandCell {
  return isRecord(value) && Number.isInteger(value.x) && Number.isInteger(value.y);
}

function isIslandRegionNote(value: unknown): value is IslandRegionNote {
  return isRecord(value) && typeof value.id === 'string' && typeof value.text === 'string' && typeof value.createdAt === 'string';
}

function isTerrainColors(value: unknown): value is IslandTerrainColors {
  return Array.isArray(value) && value.length > 0 && value.every(row => Array.isArray(row) && row.every(isHexColor));
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
