import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { createDefaultIslandDocument, localIslandStorageKey } from './domain/island-document';
import type { StorageLike } from './persistence/local-island-store';

const config = {
  apiBaseUrl: 'https://api.test',
  signInUrl: 'https://gallery.pokokit.com',
  supabaseUrl: 'https://project.supabase.co',
  supabasePublishableKey: 'sb_publishable_test',
};

describe('Island Designer scaffold persistence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a persistent anonymous local-only disclosure', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    expect(await screen.findByText(/未登录：仅保存在此浏览器 localStorage/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '登录同步' })).toHaveAttribute('href', 'https://gallery.pokokit.com');
    expect(screen.getByRole('button', { name: '保存当前规划' })).toBeInTheDocument();
  });

  it('writes anonymous saves to localStorage', async () => {
    const storage = memoryStorage();
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={storage} />);

    await screen.findByText(/未登录：仅保存在此浏览器 localStorage/);
    await userEvent.click(screen.getByRole('button', { name: '保存当前规划' }));

    const saved = storage.getItem(localIslandStorageKey);
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!)).toMatchObject({ version: 1, activeMapId: 'map-1' });
    expect(await screen.findByText('已保存到此浏览器')).toBeInTheDocument();
  });

  it('handles unavailable localStorage without crashing the workbench', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={throwingStorage()} />);

    expect(await screen.findByText(/无法访问本地保存/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '第一张巨大岛屿地图骨架' })).toBeInTheDocument();
  });

  it('shows recoverable auth restore failures without blocking local editing', async () => {
    render(<App config={config} fetcher={mockFetch([{ error: { code: 'server_error', message: 'Internal provider failure' }, status: 500 }])} storage={memoryStorage()} />);

    expect(await screen.findByText('无法恢复云端登录状态，可继续本地编辑。')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '第一张巨大岛屿地图骨架' })).toBeInTheDocument();
    expect(screen.getByText('本地待保存')).toBeInTheDocument();
  });

  it('restores a domain session and loads the first cloud island', async () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    const fetcher = mockFetch([
      { data: { user: { id: 'owner-1' } } },
      { data: [{ id: 'island-1', owner_user_id: 'owner-1', name: 'Cloud island', document, created_at: '2026-06-13T00:00:00.000Z', updated_at: '2026-06-13T00:00:00.000Z' }] },
    ]);

    render(<App config={config} fetcher={fetcher} storage={memoryStorage()} />);

    expect(await screen.findByText(/已登录：保存到 Pokokit Cloud/)).toBeInTheDocument();
    expect(screen.getByText('owner-1')).toBeInTheDocument();
    expect(screen.getByText('已保存到 Pokokit Cloud')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith('https://api.test/api/v1/auth/session', expect.objectContaining({ credentials: 'include' }));
    expect(fetcher).toHaveBeenCalledWith('https://api.test/api/v1/islands', expect.objectContaining({ credentials: 'include' }));
  });

  it('creates a cloud island when a logged-in user saves without an existing record', async () => {
    const fetcher = mockFetch([
      { data: { user: { id: 'owner-1' } } },
      { data: [] },
      { data: { id: 'island-1', owner_user_id: 'owner-1', name: 'My island plan', document: createDefaultIslandDocument(), created_at: '2026-06-13T00:00:00.000Z', updated_at: '2026-06-13T00:00:00.000Z' } },
    ]);
    render(<App config={config} fetcher={fetcher} storage={memoryStorage()} />);

    await screen.findByText('云端待保存');
    await userEvent.click(screen.getByRole('button', { name: '保存当前规划' }));

    expect(await screen.findByText('已保存到 Pokokit Cloud')).toBeInTheDocument();
    expect(fetcher).toHaveBeenLastCalledWith('https://api.test/api/v1/islands', expect.objectContaining({ method: 'POST', credentials: 'include' }));
  });

  it('shows recoverable cloud save errors', async () => {
    const fetcher = mockFetch([
      { data: { user: { id: 'owner-1' } } },
      { data: [] },
      { error: { code: 'auth_missing_token', message: 'Please sign in again.' }, status: 401 },
    ]);
    render(<App config={config} fetcher={fetcher} storage={memoryStorage()} />);

    await screen.findByText('云端待保存');
    await userEvent.click(screen.getByRole('button', { name: '保存当前规划' }));

    expect(await screen.findByText('Please sign in again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试保存' })).toBeInTheDocument();
  });

  it('requires an explicit choice before uploading a local draft after login', async () => {
    const storage = memoryStorage();
    storage.setItem(localIslandStorageKey, JSON.stringify(createDefaultIslandDocument()));
    const fetcher = mockFetch([{ data: { user: { id: 'owner-1' } } }]);

    render(<App config={config} fetcher={fetcher} storage={storage} />);

    expect(await screen.findByText('发现本地匿名草稿')).toBeInTheDocument();
    expect(screen.getByText('已登录：当前继续本地保存，草稿不会自动同步到云端')).toBeInTheDocument();
    expect(screen.queryByText('已登录：保存到 Pokokit Cloud')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存到云端' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续本地' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '丢弃本地草稿' })).toBeInTheDocument();

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: '继续本地' }));

    expect(screen.queryByText('发现本地匿名草稿')).not.toBeInTheDocument();
    expect(screen.getByText('本地待保存')).toBeInTheDocument();
  });
});

function mockFetch(items: Array<Record<string, unknown> & { status?: number }>) {
  const queue = [...items];
  return vi.fn<typeof fetch>(async () => {
    const next = queue.shift() ?? { data: { user: null } };
    return new Response(JSON.stringify(next.status && next.status >= 400 ? { error: next.error } : { data: next.data }), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: key => {
      values.delete(key);
    },
  };
}

function throwingStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error('storage blocked');
    },
    setItem: () => {
      throw new Error('storage blocked');
    },
    removeItem: () => {
      throw new Error('storage blocked');
    },
  };
}
