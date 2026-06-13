import { isIslandDocumentV1, type IslandDocumentV1 } from '../domain/island-document';

export interface IslandRecord {
  id: string;
  owner_user_id: string;
  name: string;
  document: IslandDocumentV1;
  created_at: string;
  updated_at: string;
}

export interface IslandApiClientOptions {
  apiBaseUrl: string;
  fetcher?: typeof fetch;
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

  constructor(options: IslandApiClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, '');
    this.fetcher = options.fetcher ?? fetch;
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

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await this.fetcher(`${this.apiBaseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const error = await readError(response);
      throw new IslandApiError(error.code, error.message, response.status);
    }
    return response;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
