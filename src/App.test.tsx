import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('shows a compact top-left tool group without the old Island Designer block', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    const toolbar = await screen.findByRole('group', { name: '主工具栏' });
    expect(within(toolbar).getByRole('link', { name: '登录' })).toHaveAttribute('href', 'https://gallery.pokokit.com');
    expect(within(toolbar).getByRole('button', { name: '文件' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '导出' })).toBeInTheDocument();
    expect(screen.queryByText(/Island Designer/i)).not.toBeInTheDocument();
    expect(screen.queryByText('岛屿规划工作台')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '地图名称' })).toHaveValue('第一张岛屿地图');
    expect(screen.queryByText('Map 01')).not.toBeInTheDocument();
    expect(screen.queryByText('Grid')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存当前规划' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(23 * 23);
    expect(screen.getByTestId('map-cell-0-0')).toHaveAttribute('style', expect.stringContaining('--terrain-color: #3587d7'));
    expect(screen.getByTestId('map-cell-11-11')).toHaveAttribute('style', expect.stringContaining('--terrain-color: #e9bad1'));
    expect(screen.getByTestId('map-cell-22-22')).toHaveAttribute('style', expect.stringContaining('--terrain-color: #3086d8'));
    expect(screen.queryByTestId('map-cell-23-0')).not.toBeInTheDocument();
    const mapSurface = screen.getByRole('grid', { name: '第一张巨大岛屿地图' });
    expect(mapSurface).toHaveAttribute('style', expect.stringContaining('--map-subcell-size: 12px'));
    expect(mapSurface).not.toHaveClass('show-subgrid');
    const regionPanel = screen.getByLabelText('创建区域说明');
    expect(within(regionPanel).getAllByRole('textbox')).toHaveLength(2);
    expect(within(regionPanel).queryByLabelText('已选择格子数量')).not.toBeInTheDocument();
    expect(within(regionPanel).queryByText('Region')).not.toBeInTheDocument();
    expect(within(regionPanel).queryByText('未选择格子')).not.toBeInTheDocument();
    expect(within(regionPanel).queryByText('区域标题')).not.toBeInTheDocument();
    expect(within(regionPanel).queryByText('说明文字')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('说明记录列表')).not.toBeInTheDocument();
  });

  it('uses the Chinese default map title when an empty title loses focus in a Chinese locale', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} locale="zh-CN" storage={memoryStorage()} />);

    const titleInput = await screen.findByRole('textbox', { name: '地图名称' });
    await userEvent.clear(titleInput);
    expect(titleInput).toHaveValue('');
    fireEvent.blur(titleInput);

    expect(titleInput).toHaveValue('云岛');
  });

  it('uses the English default map title when an empty title loses focus outside Chinese locales', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} locale="en-US" storage={memoryStorage()} />);

    const titleInput = await screen.findByRole('textbox', { name: '地图名称' });
    await userEvent.clear(titleInput);
    fireEvent.blur(titleInput);

    expect(titleInput).toHaveValue('Cloud Island');
  });

  it('automatically writes anonymous plans to localStorage', async () => {
    const storage = memoryStorage();
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={storage} />);

    await screen.findByRole('group', { name: '主工具栏' });
    await waitFor(() => expect(storage.getItem(localIslandStorageKey)).not.toBeNull());

    const saved = storage.getItem(localIslandStorageKey);
    expect(JSON.parse(saved!)).toMatchObject({ version: 1, activeMapId: 'map-1' });
    expect(screen.getByRole('button', { name: '文件' })).toHaveAttribute('title', '已保存到此浏览器');
  });

  it('restores anonymous saved region notes from localStorage after reload', async () => {
    const storage = memoryStorage();
    const fetcher = mockFetch([{ data: { user: null } }, { data: { user: null } }]);
    const { unmount } = render(<App config={config} fetcher={fetcher} storage={storage} />);

    await createRegionFromCells('营地区', '刷新后仍应恢复', 'map-cell-7-7');
    await waitFor(() => expect(storage.getItem(localIslandStorageKey)).toContain('营地区'));

    unmount();
    render(<App config={config} fetcher={fetcher} storage={storage} />);

    const list = await screen.findByLabelText('说明记录列表');
    expect(within(list).getByRole('button', { name: '营地区' })).toBeInTheDocument();
    expect(within(list).queryByText('刷新后仍应恢复')).not.toBeInTheDocument();
    const restoredCell = screen.getByTestId('map-cell-7-7');
    expect(restoredCell).toHaveAttribute('data-region-id', 'region-1');
    fireEvent.focus(restoredCell);
    expect(screen.getByRole('tooltip')).toHaveTextContent('刷新后仍应恢复');
  });

  it('normalizes legacy local 48 by 32 maps to the 92 by 92 terrain grid', async () => {
    const legacyDocument = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    legacyDocument.maps[0] = {
      ...legacyDocument.maps[0]!,
      grid: { width: 48, height: 32 },
      regions: [
        {
          id: 'region-1',
          label: '旧区域',
          note: '只保留仍在地图内的格子',
          color: '#2f7dd1',
          cells: [{ x: 22, y: 22 }, { x: 23, y: 0 }, { x: 47, y: 31 }],
          createdAt: '2026-06-13T00:00:00.000Z',
          updatedAt: '2026-06-13T00:00:00.000Z',
        },
      ],
    };
    const storage = memoryStorage({ [localIslandStorageKey]: JSON.stringify(legacyDocument) });

    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={storage} />);

    await screen.findByRole('group', { name: '主工具栏' });
    expect(screen.getAllByRole('gridcell')).toHaveLength(23 * 23);
    expect(screen.getByTestId('map-cell-22-22')).toHaveAttribute('data-region-id', 'region-1');
    expect(screen.queryByTestId('map-cell-23-0')).not.toBeInTheDocument();
    await waitFor(() => {
      const saved = JSON.parse(storage.getItem(localIslandStorageKey)!);
      expect(saved.maps[0].grid).toEqual({ width: 92, height: 92 });
      expect(saved.maps[0].regions[0].cells).toHaveLength(4 * 4);
      expect(saved.maps[0].regions[0].cells[0]).toEqual({ x: 88, y: 88 });
    });
  });

  it('zooms with the wheel and only drags the map from non-cell space', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await screen.findByRole('group', { name: '主工具栏' });
    const canvas = screen.getByTestId('map-canvas');
    const surface = screen.getByRole('grid', { name: '第一张巨大岛屿地图' });
    const initialTransform = surface.getAttribute('style');

    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    expect(surface.getAttribute('style')).not.toBe(initialTransform);
    const afterWheelTransform = surface.getAttribute('style');
    expect(surface).not.toHaveClass('show-subgrid');

    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    expect(surface).toHaveClass('show-subgrid');

    fireEvent.pointerDown(screen.getByTestId('map-cell-0-0'), { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 220, clientY: 220 });
    expect(surface.getAttribute('style')).not.toBe(afterWheelTransform);
    const afterCellPointerTransform = surface.getAttribute('style');

    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 220, clientY: 240 });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 220, clientY: 240 });
    expect(surface.getAttribute('style')).not.toBe(afterCellPointerTransform);
  });

  it('handles unavailable localStorage without crashing the workbench', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={throwingStorage()} />);

    expect(await screen.findByRole('group', { name: '主工具栏' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: '第一张巨大岛屿地图' })).toBeInTheDocument();
  });

  it('shows recoverable auth restore failures without blocking local editing', async () => {
    render(<App config={config} fetcher={mockFetch([{ error: { code: 'server_error', message: 'Internal provider failure' }, status: 500 }])} storage={memoryStorage()} />);

    expect(await screen.findByRole('group', { name: '主工具栏' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: '第一张巨大岛屿地图' })).toBeInTheDocument();
  });

  it('creates a note region from a single macro cell and renders the overlay tooltip', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await screen.findByRole('group', { name: '主工具栏' });
    const cell = screen.getByTestId('map-cell-2-3');
    fireEvent.pointerDown(cell);
    fireEvent.pointerUp(cell);

    expect(screen.queryByLabelText('已选择格子数量')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('区域标题'), '入口花园');
    await userEvent.type(screen.getByLabelText('说明文字'), '这里放欢迎区和花圃');
    await userEvent.click(screen.getByRole('button', { name: '创建说明' }));

    expect(cell).toHaveAttribute('data-region-id', 'region-1');
    expect(screen.getAllByText('入口花园').length).toBeGreaterThan(0);
    expect(screen.getAllByText('这里放欢迎区和花圃').length).toBeGreaterThan(0);
    expect(screen.getByText('16 个格子')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '文件' })).toHaveAttribute('title', '本地待保存');
  });

  it('creates a note region from a single subcell after zooming into the subgrid', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await screen.findByRole('group', { name: '主工具栏' });
    const canvas = screen.getByTestId('map-canvas');
    const surface = screen.getByRole('grid', { name: '第一张巨大岛屿地图' });
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    expect(surface).toHaveClass('show-subgrid');

    const macroCell = screen.getByTestId('map-cell-2-3');
    macroCell.getBoundingClientRect = vi.fn(() => ({
      bottom: 48,
      height: 48,
      left: 0,
      right: 48,
      top: 0,
      width: 48,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    fireEvent.pointerDown(macroCell, { clientX: 4, clientY: 4 });
    fireEvent.pointerUp(macroCell, { clientX: 4, clientY: 4 });

    await userEvent.type(screen.getByLabelText('区域标题'), '小格入口');
    await userEvent.type(screen.getByLabelText('说明文字'), '只标记一个小格');
    await userEvent.click(screen.getByRole('button', { name: '创建说明' }));

    expect(screen.getByText('1 个格子')).toBeInTheDocument();
    expect(macroCell.querySelectorAll('.map-subcell.saved')).toHaveLength(1);
  });

  it('supports rectangular drag selection and saved region focus tooltip', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await screen.findByRole('group', { name: '主工具栏' });
    const start = screen.getByTestId('map-cell-1-1');
    const end = screen.getByTestId('map-cell-3-2');
    fireEvent.pointerDown(start);
    fireEvent.pointerEnter(end);
    fireEvent.pointerUp(end);

    expect(screen.queryByLabelText('已选择格子数量')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('区域标题'), '市集区');
    await userEvent.type(screen.getByLabelText('说明文字'), '横向铺开摊位');
    await userEvent.click(screen.getByRole('button', { name: '创建说明' }));

    expect(start).toHaveAttribute('data-region-id', 'region-1');
    expect(end).toHaveAttribute('data-region-id', 'region-1');
    fireEvent.focus(end);

    expect(screen.getByRole('tooltip')).toHaveTextContent('市集区');
    expect(screen.getByRole('tooltip')).toHaveTextContent('横向铺开摊位');
    expect(screen.getByRole('tooltip')).toHaveTextContent('96 个格子');
  });

  it('lists saved region records and flashes the map region when selected', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await createRegionFromCells('市集区', '横向铺开摊位', 'map-cell-1-1', 'map-cell-3-2');

    const list = screen.getByLabelText('说明记录列表');
    expect(within(list).getByText('市集区')).toBeInTheDocument();
    expect(within(list).queryByText('横向铺开摊位')).not.toBeInTheDocument();
    expect(within(list).queryByText('6 格')).not.toBeInTheDocument();
    expect(within(list).queryByText('Records')).not.toBeInTheDocument();
    expect(within(list).queryByText('说明记录')).not.toBeInTheDocument();
    expect(within(list).queryByText('暂无说明记录')).not.toBeInTheDocument();

    await userEvent.click(within(list).getByRole('button', { name: /市集区/ }));

    expect(screen.getByTestId('map-cell-1-1')).toHaveClass('flash');
    expect(screen.getByTestId('map-cell-3-2')).toHaveClass('flash');
    expect(screen.getByRole('tooltip')).toHaveTextContent('市集区');
    expect(screen.getByRole('tooltip')).toHaveTextContent('横向铺开摊位');
  });

  it('keeps the records panel hidden until there are regions and only renders titles', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await screen.findByRole('group', { name: '主工具栏' });
    expect(screen.queryByLabelText('说明记录列表')).not.toBeInTheDocument();

    await createRegionFromCells('住宅区', '不要被删除按钮触发定位', 'map-cell-4-4');
    const list = screen.getByLabelText('说明记录列表');

    expect(within(list).getByRole('button', { name: '住宅区' })).toBeInTheDocument();
    expect(within(list).queryByText('不要被删除按钮触发定位')).not.toBeInTheDocument();
    expect(within(list).queryByText('1 格')).not.toBeInTheDocument();
    expect(within(list).queryByText('删除')).not.toBeInTheDocument();
  });

  it('shows tooltip content when a saved region cell receives keyboard focus', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await createRegionFromCells('灯塔区', '键盘焦点也能看到说明', 'map-cell-6-6');
    fireEvent.focus(screen.getByTestId('map-cell-6-6'));

    expect(screen.getByRole('tooltip')).toHaveTextContent('灯塔区');
    expect(screen.getByRole('tooltip')).toHaveTextContent('键盘焦点也能看到说明');
  });

  it('restores a domain session and loads the first cloud island', async () => {
    const document = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    const fetcher = mockFetch([
      { data: { user: { id: 'owner-1' } } },
      { data: [{ id: 'island-1', owner_user_id: 'owner-1', name: 'Cloud island', document, created_at: '2026-06-13T00:00:00.000Z', updated_at: '2026-06-13T00:00:00.000Z' }] },
    ]);

    render(<App config={config} fetcher={fetcher} storage={memoryStorage()} />);

    const toolbar = await screen.findByRole('group', { name: '主工具栏' });
    expect(within(toolbar).getByRole('button', { name: 'owner-1' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '文件' })).toHaveAttribute('title', '已保存到 Pokokit Cloud');
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

    await screen.findByRole('group', { name: '主工具栏' });
    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith('https://api.test/api/v1/islands', expect.objectContaining({ method: 'POST', credentials: 'include' })));
  });

  it('shows recoverable cloud save errors', async () => {
    const fetcher = mockFetch([
      { data: { user: { id: 'owner-1' } } },
      { data: [] },
      { error: { code: 'auth_missing_token', message: 'Please sign in again.' }, status: 401 },
    ]);
    render(<App config={config} fetcher={fetcher} storage={memoryStorage()} />);

    await screen.findByRole('group', { name: '主工具栏' });
    await waitFor(() => expect(screen.getByRole('button', { name: '文件' })).toHaveAttribute('title', '保存失败'));
  });

  it('requires an explicit choice before uploading a local draft after login', async () => {
    const storage = memoryStorage();
    storage.setItem(localIslandStorageKey, JSON.stringify(createDefaultIslandDocument()));
    const fetcher = mockFetch([{ data: { user: { id: 'owner-1' } } }]);

    render(<App config={config} fetcher={fetcher} storage={storage} />);

    expect(await screen.findByText('发现本地匿名草稿')).toBeInTheDocument();
    const toolbar = screen.getByRole('group', { name: '主工具栏' });
    expect(within(toolbar).getByRole('button', { name: 'owner-1' })).toHaveAttribute('title', '当前继续本地保存');
    expect(screen.getByRole('button', { name: '保存到云端' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续本地' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '丢弃本地草稿' })).toBeInTheDocument();

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: '继续本地' }));

    expect(screen.queryByText('发现本地匿名草稿')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '文件' })).toHaveAttribute('title', '本地待保存');
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

async function createRegionFromCells(label: string, note: string, startTestId: string, endTestId?: string) {
  await screen.findByRole('group', { name: '主工具栏' });
  const start = screen.getByTestId(startTestId);
  fireEvent.pointerDown(start);
  if (endTestId) {
    const end = screen.getByTestId(endTestId);
    fireEvent.pointerEnter(end);
    fireEvent.pointerUp(end);
  } else {
    fireEvent.pointerUp(start);
  }

  await userEvent.clear(screen.getByLabelText('区域标题'));
  await userEvent.type(screen.getByLabelText('区域标题'), label);
  await userEvent.clear(screen.getByLabelText('说明文字'));
  await userEvent.type(screen.getByLabelText('说明文字'), note);
  await userEvent.click(screen.getByRole('button', { name: '创建说明' }));
}
