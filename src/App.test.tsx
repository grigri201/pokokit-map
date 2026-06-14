import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import type { IslandAuthClient } from './auth/supabase-client';
import type { AppConfig } from './config';
import { createDefaultIslandDocument, islandRegionPalette, localIslandStorageKey } from './domain/island-document';
import { referenceIslandUnifiedLandColor } from './domain/island-terrain';
import type { StorageLike } from './persistence/local-island-store';

const config: AppConfig = {
  apiBaseUrl: 'https://api.test',
  appUrl: 'https://map.pokokit.com',
  supabaseUrl: undefined,
  supabasePublishableKey: undefined,
};

describe('Island Designer scaffold persistence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows a compact top-left tool group without the old Island Designer block', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    const toolbar = await screen.findByRole('group', { name: '主工具栏' });
    const loginButton = within(toolbar).getByRole('button', { name: '登录' });
    expect(loginButton).toHaveAttribute('aria-haspopup', 'dialog');
    expect(loginButton).toHaveAttribute('aria-expanded', 'false');
    const fileButton = within(toolbar).getByRole('button', { name: '文件' });
    expect(fileButton).toHaveAttribute('aria-expanded', 'false');
    expect(within(toolbar).queryByRole('button', { name: '导出' })).not.toBeInTheDocument();
    await userEvent.click(fileButton);
    const fileMenu = screen.getByRole('menu', { name: '文件菜单' });
    expect(fileButton).toHaveAttribute('aria-expanded', 'true');
    expect(within(fileMenu).getByRole('menuitem', { name: '导入背景图' })).toBeInTheDocument();
    expect(within(fileMenu).queryByRole('menuitem', { name: '导出' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('导入背景图')).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp,image/*');
    expect(screen.queryByText(/Island Designer/i)).not.toBeInTheDocument();
    expect(screen.queryByText('岛屿规划工作台')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '地图名称' })).toHaveValue('第一张岛屿地图');
    expect(screen.queryByText('Map 01')).not.toBeInTheDocument();
    expect(screen.queryByText('Grid')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存当前规划' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(23 * 23);
    expect(screen.getByTestId('map-cell-0-0')).toHaveAttribute('style', expect.stringContaining('--terrain-color: #3587d7'));
    expect(screen.getByTestId('map-cell-2-4')).toHaveAttribute('style', expect.stringContaining(`--terrain-color: ${referenceIslandUnifiedLandColor}`));
    expect(screen.getByTestId('map-cell-11-11')).toHaveAttribute('style', expect.stringContaining(`--terrain-color: ${referenceIslandUnifiedLandColor}`));
    expect(screen.getByTestId('map-cell-22-22')).toHaveAttribute('style', expect.stringContaining('--terrain-color: #3086d8'));
    expect(screen.queryByTestId('map-cell-23-0')).not.toBeInTheDocument();
    const mapSurface = screen.getByRole('grid', { name: '第一张巨大岛屿地图' });
    expect(mapSurface).toHaveAttribute('style', expect.stringContaining('--map-subcell-size: 3px'));
    expect(mapSurface).toHaveAttribute('style', expect.stringContaining('--map-display-cell-size: 48px'));
    expect(mapSurface).not.toHaveClass('show-subgrid');
    expect(screen.queryByLabelText('创建区域说明')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('选区操作菜单')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('待建造区域列表')).not.toBeInTheDocument();
  });

  it('opens an in-app login form instead of linking to Gallery', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} authClient={mockAuthClient()} />);

    const toolbar = await screen.findByRole('group', { name: '主工具栏' });
    await userEvent.click(within(toolbar).getByRole('button', { name: '登录' }));

    const form = screen.getByRole('form', { name: '登录表单' });
    expect(within(form).getByLabelText('邮箱')).toBeInTheDocument();
    expect(within(form).getByLabelText('密码')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: '注册' })).toBeInTheDocument();
    expect(within(toolbar).queryByRole('link', { name: '登录' })).not.toBeInTheDocument();
  });

  it('syncs Supabase login to the Pokokit domain session', async () => {
    const session = createSupabaseSession();
    const authClient = mockAuthClient({
      signIn: vi.fn(async () => ({ error: null, session })),
    });
    const fetcher = mockFetch([
      { data: { user: null } },
      { data: { user: { id: 'owner-1', email: 'owner@example.com' } } },
    ]);

    render(<App config={config} fetcher={fetcher} storage={memoryStorage()} authClient={authClient} />);

    const toolbar = await screen.findByRole('group', { name: '主工具栏' });
    await userEvent.click(within(toolbar).getByRole('button', { name: '登录' }));
    const form = screen.getByRole('form', { name: '登录表单' });
    await userEvent.type(within(form).getByLabelText('邮箱'), 'owner@example.com');
    await userEvent.type(within(form).getByLabelText('密码'), 'secret-password');
    await userEvent.click(within(form).getAllByRole('button', { name: '登录' }).at(-1)!);

    await waitFor(() => {
      expect(authClient.signIn).toHaveBeenCalledWith('owner@example.com', 'secret-password');
      expect(fetcher).toHaveBeenCalledWith(
        'https://api.test/api/v1/auth/session',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        }),
      );
    });
    expect(screen.getByText('发现本地匿名草稿')).toBeInTheDocument();
  });

  it('keeps local editing when Supabase login cannot sync a Pokokit domain session', async () => {
    const session = createSupabaseSession();
    const authClient = mockAuthClient({
      signIn: vi.fn(async () => ({ error: null, session })),
    });
    const fetcher = mockFetch([
      { data: { user: null } },
      { error: { code: 'server_error', message: 'session unavailable' }, status: 503 },
    ]);

    render(<App config={config} fetcher={fetcher} storage={memoryStorage()} authClient={authClient} />);

    const toolbar = await screen.findByRole('group', { name: '主工具栏' });
    await userEvent.click(within(toolbar).getByRole('button', { name: '登录' }));
    const form = screen.getByRole('form', { name: '登录表单' });
    await userEvent.type(within(form).getByLabelText('邮箱'), 'owner@example.com');
    await userEvent.type(within(form).getByLabelText('密码'), 'secret-password');
    await userEvent.click(within(form).getAllByRole('button', { name: '登录' }).at(-1)!);

    expect(await within(form).findByText('无法同步 Pokokit 登录状态，可继续本地编辑。')).toBeInTheDocument();
    expect(screen.queryByText('发现本地匿名草稿')).not.toBeInTheDocument();
    expect(toolbar.querySelector('.auth-menu-wrapper > .app-tool-button')).toHaveAttribute('title', '无法同步 Pokokit 登录状态，可继续本地编辑。');
  });

  it('uses the Chinese default map title when an empty title loses focus in a Chinese locale', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} locale="zh-CN" storage={memoryStorage()} />);

    const titleInput = await screen.findByRole('textbox', { name: '地图名称' });
    await userEvent.clear(titleInput);
    expect(titleInput).toHaveValue('');
    fireEvent.blur(titleInput);

    expect(titleInput).toHaveValue('云岛');
  });

  it('focuses the map title input from the edit icon button', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    const titleInput = await screen.findByRole('textbox', { name: '地图名称' });
    expect(titleInput).not.toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: '编辑地图名称' }));

    expect(titleInput).toHaveFocus();
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

  it('imports a background image and uses its sampled colors for the map terrain', async () => {
    const imageData = createImageDataFixture('#123456');
    paintImageDataCell(imageData, 2, 4, '#aabbcc');
    installImageImportStubs(imageData);
    const file = new File(['image-bytes'], 'island.png', { type: 'image/png' });

    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    const fileButton = await screen.findByRole('button', { name: '文件' });
    await userEvent.click(fileButton);
    await userEvent.click(screen.getByRole('menuitem', { name: '导入背景图' }));
    await userEvent.upload(screen.getByLabelText('导入背景图'), file);

    await waitFor(() => expect(screen.getByTestId('map-cell-0-0')).toHaveAttribute('style', expect.stringContaining('--terrain-color: #123456')));
    expect(screen.getByTestId('map-cell-2-4')).toHaveAttribute('style', expect.stringContaining('--terrain-color: #aabbcc'));
    expect(screen.getByRole('textbox', { name: '地图名称' })).toHaveValue('第一张岛屿地图');
    expect(screen.queryByRole('menu', { name: '文件菜单' })).not.toBeInTheDocument();
  });

  it('restores anonymous saved regions from localStorage after reload', async () => {
    const storage = memoryStorage();
    const fetcher = mockFetch([{ data: { user: null } }, { data: { user: null } }]);
    const { unmount } = render(<App config={config} fetcher={fetcher} storage={storage} />);

    await createRegionFromCells('营地区', 'map-cell-7-7');
    await waitFor(() => expect(storage.getItem(localIslandStorageKey)).toContain('营地区'));

    unmount();
    render(<App config={config} fetcher={fetcher} storage={storage} />);

    const list = await screen.findByLabelText('待建造区域列表');
    expect(within(list).getByRole('button', { name: '1 营地区' })).toBeInTheDocument();
    expect(within(list).queryByText('刷新后仍应恢复')).not.toBeInTheDocument();
    const restoredCell = screen.getByTestId('map-cell-7-7');
    expect(restoredCell).toHaveAttribute('data-region-id', 'region-1');
    fireEvent.focus(restoredCell);
    expect(screen.getByRole('tooltip')).toHaveTextContent('营地区');
    expect(screen.getByRole('tooltip')).toHaveTextContent('256 个小格');
  });

  it('clears conflicting localStorage documents instead of loading old region notes', async () => {
    const oldDocument = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    oldDocument.maps[0] = {
      ...oldDocument.maps[0]!,
      regions: [
        {
          id: 'region-1',
          label: '旧说明',
          note: '旧规划意图',
          color: islandRegionPalette[0],
          cells: [{ x: 1, y: 1 }],
          createdAt: '2026-06-13T00:00:00.000Z',
          updatedAt: '2026-06-13T00:00:00.000Z',
        },
      ],
    } as unknown as typeof oldDocument.maps[number];
    const storage = memoryStorage({ [localIslandStorageKey]: JSON.stringify(oldDocument) });

    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={storage} />);

    await screen.findByRole('group', { name: '主工具栏' });
    expect(storage.getItem(localIslandStorageKey) ?? '').not.toContain('旧规划意图');
    expect(screen.queryByLabelText('待建造区域列表')).not.toBeInTheDocument();
  });

  it('clears legacy local 48 by 32 maps instead of loading stale grid data', async () => {
    const legacyDocument = createDefaultIslandDocument('2026-06-13T00:00:00.000Z');
    legacyDocument.maps[0] = {
      ...legacyDocument.maps[0]!,
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
    };
    const storage = memoryStorage({ [localIslandStorageKey]: JSON.stringify(legacyDocument) });

    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={storage} />);

    await screen.findByRole('group', { name: '主工具栏' });
    expect(screen.getAllByRole('gridcell')).toHaveLength(23 * 23);
    expect(screen.getByTestId('map-cell-22-22')).not.toHaveAttribute('data-region-id');
    expect(screen.queryByTestId('map-cell-23-0')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('待建造区域列表')).not.toBeInTheDocument();
    await waitFor(() => {
      const saved = JSON.parse(storage.getItem(localIslandStorageKey)!);
      expect(saved.maps[0].grid).toEqual({ width: 368, height: 368 });
      expect(saved.maps[0].regions).toEqual([]);
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
    expect(surface).toHaveClass('show-medium-grid');
    expect(surface).not.toHaveClass('show-fine-grid');

    for (let index = 0; index < 12; index += 1) {
      fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    }
    expect(surface).toHaveClass('show-fine-grid');

    fireEvent.pointerDown(screen.getByTestId('map-cell-0-0'), { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 220, clientY: 220 });
    expect(surface.getAttribute('style')).not.toBe(afterWheelTransform);
    const afterCellPointerTransform = surface.getAttribute('style');

    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 220, clientY: 240 });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 220, clientY: 240 });
    expect(surface.getAttribute('style')).not.toBe(afterCellPointerTransform);
  });

  it('adjusts map zoom from the slider and resets to a full-map fit', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await screen.findByRole('group', { name: '主工具栏' });
    const canvas = screen.getByTestId('map-canvas');
    const surface = screen.getByRole('grid', { name: '第一张巨大岛屿地图' });
    const zoomSlider = screen.getByRole('slider', { name: '地图缩放' }) as HTMLInputElement;
    canvas.getBoundingClientRect = vi.fn(() => rectAt(0, 0, 1200, 1000));

    expect(zoomSlider).toHaveAttribute('min', '0.45');
    expect(zoomSlider).toHaveAttribute('max', '5');
    expect(zoomSlider.value).toBe('1');

    fireEvent.change(zoomSlider, { target: { value: '4' } });

    expect(zoomSlider.value).toBe('4');
    expect(surface).toHaveClass('show-fine-grid');
    expect(surface).toHaveAttribute('style', expect.stringContaining('--map-cell-size: 192px'));

    await userEvent.click(screen.getByRole('button', { name: '恢复初始 zoom' }));

    expect(zoomSlider.value).toBe(String(38 / 48));
    expect(surface).not.toHaveClass('show-subgrid');
    expect(surface).toHaveAttribute('style', expect.stringContaining('--map-cell-size: 38px'));
    expect(surface).toHaveAttribute('style', expect.stringContaining('transform: translate3d(150px, 50px, 0)'));
  });

  it('only shows the 1 by 1 grid after zoom reaches 4', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await screen.findByRole('group', { name: '主工具栏' });
    const canvas = screen.getByTestId('map-canvas');
    const surface = screen.getByRole('grid', { name: '第一张巨大岛屿地图' });

    for (let index = 0; index < 14; index += 1) {
      fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    }
    expect(surface).toHaveClass('show-medium-grid');
    expect(surface).not.toHaveClass('show-fine-grid');

    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    expect(surface).toHaveClass('show-fine-grid');

    for (let index = 0; index < 20; index += 1) {
      fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    }
    expect(surface).toHaveAttribute('style', expect.stringContaining('--map-cell-size: 240px'));
    expect(surface).toHaveAttribute('style', expect.stringContaining('--map-subcell-size: 15px'));
    expect(surface.getAttribute('style')).not.toContain('scale(');
  });

  it('keeps macro, medium, and fine grid levels selectable', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await screen.findByRole('group', { name: '主工具栏' });
    const canvas = screen.getByTestId('map-canvas');
    const surface = screen.getByRole('grid', { name: '第一张巨大岛屿地图' });
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
    expect(surface).toBeInTheDocument();
    expect(macroCell).toHaveClass('selected');

    expect(screen.getByLabelText('选区操作菜单')).toHaveTextContent('16×16');
    await userEvent.click(screen.getByRole('button', { name: '取消选区' }));
    for (let index = 0; index < 4; index += 1) {
      fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    }
    expect(surface).toHaveClass('show-medium-grid');
    fireEvent.pointerDown(macroCell, { clientX: 4, clientY: 4 });
    fireEvent.pointerUp(macroCell, { clientX: 4, clientY: 4 });
    const mediumSelection = macroCell.querySelector('.map-subcell.selected');
    expect(surface).toBeInTheDocument();
    expect(macroCell.querySelectorAll('.map-subcell.selected')).toHaveLength(1);
    expect(mediumSelection).toHaveAttribute('style', expect.stringContaining('grid-column: 1 / span 4'));

    await userEvent.click(screen.getByRole('button', { name: '取消选区' }));
    for (let index = 0; index < 12; index += 1) {
      fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    }
    expect(surface).toHaveClass('show-fine-grid');
    fireEvent.pointerDown(macroCell, { clientX: 4, clientY: 4 });
    fireEvent.pointerUp(macroCell, { clientX: 4, clientY: 4 });
    const fineSelection = macroCell.querySelector('.map-subcell.selected');
    expect(surface).toBeInTheDocument();
    expect(macroCell.querySelectorAll('.map-subcell.selected')).toHaveLength(1);
    expect(fineSelection).toHaveAttribute('style', expect.stringContaining('grid-column: 2 / span 1'));
  });

  it('supports drag selection across multiple cells in medium and fine grid levels', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await screen.findByRole('group', { name: '主工具栏' });
    const canvas = screen.getByTestId('map-canvas');
    const surface = screen.getByRole('grid', { name: '第一张巨大岛屿地图' });
    const start = screen.getByTestId('map-cell-2-3');
    const end = screen.getByTestId('map-cell-3-3');
    start.getBoundingClientRect = vi.fn(() => rectAt(0, 0, 48, 48));
    end.getBoundingClientRect = vi.fn(() => rectAt(48, 0, 48, 48));

    for (let index = 0; index < 4; index += 1) {
      fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    }
    expect(surface).toHaveClass('show-medium-grid');
    fireEvent.pointerDown(start, { clientX: 4, clientY: 4 });
    fireEvent.pointerEnter(end, { clientX: 52, clientY: 4 });
    fireEvent.pointerUp(end, { clientX: 52, clientY: 4 });
    expect(surface).toBeInTheDocument();
    expect(document.querySelectorAll('.map-subcell.selected').length).toBeGreaterThan(1);

    await userEvent.click(screen.getByRole('button', { name: '取消选区' }));
    for (let index = 0; index < 12; index += 1) {
      fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    }
    expect(surface).toHaveClass('show-fine-grid');
    fireEvent.pointerDown(start, { clientX: 4, clientY: 4 });
    fireEvent.pointerEnter(end, { clientX: 52, clientY: 4 });
    fireEvent.pointerUp(end, { clientX: 52, clientY: 4 });
    expect(surface).toBeInTheDocument();
    expect(document.querySelectorAll('.map-subcell.selected').length).toBeGreaterThan(1);
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

  it('creates a region from a single macro cell and renders a build badge', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await screen.findByRole('group', { name: '主工具栏' });
    const cell = screen.getByTestId('map-cell-2-3');
    fireEvent.pointerDown(cell);
    fireEvent.pointerUp(cell);

    expect(screen.queryByLabelText('已选择格子数量')).not.toBeInTheDocument();
    expect(screen.getByLabelText('选区操作菜单')).toHaveTextContent('16×16');
    await userEvent.click(screen.getByRole('button', { name: '命名选区' }));
    await userEvent.type(screen.getByLabelText('区域名称'), '入口花园');
    await userEvent.type(screen.getByLabelText('区域注释'), '这里放欢迎区和花圃');
    await userEvent.click(screen.getByRole('button', { name: '保存待建造区域' }));

    expect(cell).toHaveAttribute('data-region-id', 'region-1');
    expect(screen.getByRole('button', { name: '待建造区域 1：入口花园' })).toBeInTheDocument();
    const list = screen.getByLabelText('待建造区域列表');
    expect(within(list).getByRole('button', { name: '1 入口花园' })).toBeInTheDocument();
    expect(screen.queryByLabelText('选区操作菜单')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '文件' })).toHaveAttribute('title', '本地待保存');
  });

  it('automatically chooses a different color for adjacent regions', async () => {
    const storage = memoryStorage();
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={storage} />);

    await createRegionFromCells('入口花园', 'map-cell-2-3');

    const adjacentCell = screen.getByTestId('map-cell-3-3');
    fireEvent.pointerDown(adjacentCell);
    fireEvent.pointerUp(adjacentCell);

    await userEvent.click(screen.getByRole('button', { name: '命名选区' }));
    await userEvent.type(screen.getByLabelText('区域名称'), '邻近广场');
    await userEvent.click(screen.getByRole('button', { name: '保存待建造区域' }));

    await waitFor(() => {
      const saved = JSON.parse(storage.getItem(localIslandStorageKey)!);
      expect(saved.maps[0].regions[0].color).toBe(islandRegionPalette[0]);
      expect(saved.maps[0].regions[1].color).toBe(islandRegionPalette[1]);
    });
  });

  it('clears the current selection from the cancel icon', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await screen.findByRole('group', { name: '主工具栏' });
    const cell = screen.getByTestId('map-cell-2-3');
    fireEvent.pointerDown(cell);
    fireEvent.pointerUp(cell);

    expect(cell).toHaveClass('selected');
    expect(screen.getByLabelText('选区操作菜单')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '取消选区' }));

    expect(cell).not.toHaveClass('selected');
    expect(screen.queryByLabelText('选区操作菜单')).not.toBeInTheDocument();
  });

  it('creates a region from a 4 by 4 block after zooming into the medium grid', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await screen.findByRole('group', { name: '主工具栏' });
    const canvas = screen.getByTestId('map-canvas');
    const surface = screen.getByRole('grid', { name: '第一张巨大岛屿地图' });
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    expect(surface).toHaveClass('show-subgrid');
    expect(surface).toHaveClass('show-medium-grid');
    expect(surface).not.toHaveClass('show-fine-grid');

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

    await userEvent.click(screen.getByRole('button', { name: '命名选区' }));
    await userEvent.type(screen.getByLabelText('区域名称'), '小格入口');
    await userEvent.click(screen.getByRole('button', { name: '保存待建造区域' }));

    expect(macroCell.querySelectorAll('.map-subcell.saved')).toHaveLength(1);
    expect(macroCell.querySelector('.map-subcell.saved')).toHaveAttribute('style', expect.stringContaining('grid-column: 1 / span 4'));
    expect(screen.getByRole('button', { name: '待建造区域 1：小格入口' })).toBeInTheDocument();
  });

  it('creates a region from a single 1 by 1 subcell after zooming into the fine grid', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await screen.findByRole('group', { name: '主工具栏' });
    const canvas = screen.getByTestId('map-canvas');
    const surface = screen.getByRole('grid', { name: '第一张巨大岛屿地图' });
    for (let index = 0; index < 16; index += 1) {
      fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 });
    }
    expect(surface).toHaveClass('show-fine-grid');

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

    await userEvent.click(screen.getByRole('button', { name: '命名选区' }));
    await userEvent.type(screen.getByLabelText('区域名称'), '原子入口');
    await userEvent.click(screen.getByRole('button', { name: '保存待建造区域' }));

    expect(macroCell.querySelectorAll('.map-subcell.saved')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '待建造区域 1：原子入口' })).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: '命名选区' }));
    await userEvent.type(screen.getByLabelText('区域名称'), '市集区');
    await userEvent.click(screen.getByRole('button', { name: '保存待建造区域' }));

    expect(start).toHaveAttribute('data-region-id', 'region-1');
    expect(end).toHaveAttribute('data-region-id', 'region-1');
    fireEvent.focus(end);

    expect(screen.getByRole('tooltip')).toHaveTextContent('市集区');
    expect(screen.getByRole('tooltip')).toHaveTextContent('256 个小格');
  });

  it('lists saved region records and flashes the map region when selected', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await createRegionFromCells('市集区', 'map-cell-1-1', 'map-cell-3-2', '横向铺开摊位');

    const list = screen.getByLabelText('待建造区域列表');
    expect(within(list).getByText('市集区')).toBeInTheDocument();
    expect(within(list).queryByText('横向铺开摊位')).not.toBeInTheDocument();
    expect(within(list).queryByText('6 格')).not.toBeInTheDocument();
    expect(within(list).queryByText('Records')).not.toBeInTheDocument();
    expect(within(list).queryByText('说明记录')).not.toBeInTheDocument();
    expect(within(list).queryByText('暂无说明记录')).not.toBeInTheDocument();

    await userEvent.click(within(list).getByRole('button', { name: '1 市集区' }));

    expect(screen.getByTestId('map-cell-1-1')).toHaveClass('flash');
    expect(screen.getByTestId('map-cell-3-2')).toHaveClass('flash');
    const detail = screen.getByLabelText('市集区 注释');
    expect(detail).toHaveTextContent('横向铺开摊位');
    await userEvent.type(within(detail).getByLabelText('新增注释'), '加一个路灯');
    await userEvent.click(within(detail).getByRole('button', { name: '添加注释' }));
    expect(screen.getByLabelText('市集区 注释')).toHaveTextContent('加一个路灯');
  });

  it('deletes a region and its notes from the region detail popover', async () => {
    const storage = memoryStorage();
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={storage} />);

    await createRegionFromCells('流程区', 'map-cell-2-2', undefined, '第一条注释');
    const savedCell = screen.getByTestId('map-cell-2-2');
    fireEvent.click(savedCell);

    const detail = screen.getByLabelText('流程区 注释');
    expect(detail).toHaveTextContent('第一条注释');

    await userEvent.click(within(detail).getByRole('button', { name: '删除区域' }));

    expect(screen.queryByLabelText('流程区 注释')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('待建造区域列表')).not.toBeInTheDocument();
    expect(savedCell).not.toHaveAttribute('data-region-id');
    expect(savedCell).not.toHaveClass('saved');
    await waitFor(() => {
      const saved = JSON.parse(storage.getItem(localIslandStorageKey)!);
      expect(saved.maps[0].regions).toEqual([]);
    });
  });

  it('requires confirmation before deleting a region from the records panel', async () => {
    const storage = memoryStorage();
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={storage} />);

    await createRegionFromCells('住宅区', 'map-cell-4-4', undefined, '第一条注释');
    const savedCell = screen.getByTestId('map-cell-4-4');
    const list = screen.getByLabelText('待建造区域列表');

    await userEvent.click(within(list).getByRole('button', { name: '删除区域 住宅区' }));

    expect(within(list).getByRole('group', { name: '确认删除 住宅区' })).toBeInTheDocument();
    expect(savedCell).toHaveAttribute('data-region-id', 'region-1');

    await userEvent.click(within(list).getByRole('button', { name: '取消删除区域 住宅区' }));

    expect(within(list).queryByRole('group', { name: '确认删除 住宅区' })).not.toBeInTheDocument();
    expect(within(list).getByRole('button', { name: '删除区域 住宅区' })).toBeInTheDocument();
    expect(savedCell).toHaveAttribute('data-region-id', 'region-1');

    await userEvent.click(within(list).getByRole('button', { name: '删除区域 住宅区' }));
    await userEvent.click(within(list).getByRole('button', { name: '确认删除区域 住宅区' }));

    expect(screen.queryByLabelText('待建造区域列表')).not.toBeInTheDocument();
    expect(savedCell).not.toHaveAttribute('data-region-id');
    expect(savedCell).not.toHaveClass('saved');
    await waitFor(() => {
      const saved = JSON.parse(storage.getItem(localIslandStorageKey)!);
      expect(saved.maps[0].regions).toEqual([]);
    });
  });

  it('keeps the records panel hidden until there are regions and only renders titles', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await screen.findByRole('group', { name: '主工具栏' });
    expect(screen.queryByLabelText('待建造区域列表')).not.toBeInTheDocument();

    await createRegionFromCells('住宅区', 'map-cell-4-4', undefined, '');
    const list = screen.getByLabelText('待建造区域列表');
    expect(list).toHaveClass('region-records-panel');

    expect(within(list).getByRole('button', { name: '1 住宅区' })).toBeInTheDocument();
    expect(within(list).queryByText('不要被删除按钮触发定位')).not.toBeInTheDocument();
    expect(within(list).queryByText('1 格')).not.toBeInTheDocument();
    expect(within(list).queryByText('删除')).not.toBeInTheDocument();
  });

  it('shows tooltip content when a saved region cell receives keyboard focus', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await createRegionFromCells('灯塔区', 'map-cell-6-6');
    fireEvent.focus(screen.getByTestId('map-cell-6-6'));

    expect(screen.getByRole('tooltip')).toHaveTextContent('灯塔区');
    expect(screen.getByRole('tooltip')).toHaveTextContent('256 个小格');
  });

  it('opens region notes instead of the selection editor when clicking a saved region cell', async () => {
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={memoryStorage()} />);

    await createRegionFromCells('入口花园', 'map-cell-2-3', undefined, '初始注释');
    const savedCell = screen.getByTestId('map-cell-2-3');

    fireEvent.pointerDown(savedCell);
    fireEvent.pointerUp(savedCell);

    expect(screen.queryByLabelText('选区操作菜单')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('命名待建造区域')).not.toBeInTheDocument();
    expect(savedCell).not.toHaveClass('selected');
    const detail = screen.getByLabelText('入口花园 注释');
    expect(detail).toHaveTextContent('初始注释');

    await userEvent.click(within(detail).getByRole('button', { name: '取消注释' }));
    fireEvent.click(savedCell);

    expect(screen.queryByLabelText('选区操作菜单')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('命名待建造区域')).not.toBeInTheDocument();
    expect(screen.getByLabelText('入口花园 注释')).toHaveTextContent('初始注释');
  });

  it('edits a saved region by adding more selected cells from the detail popover', async () => {
    const storage = memoryStorage();
    render(<App config={config} fetcher={mockFetch([{ data: { user: null } }])} storage={storage} />);

    await createRegionFromCells('超级地球', 'map-cell-2-3', undefined, '第一条注释');
    const originalCell = screen.getByTestId('map-cell-2-3');
    const addedCell = screen.getByTestId('map-cell-3-3');

    fireEvent.click(originalCell);
    const detail = screen.getByLabelText('超级地球 注释');
    await userEvent.click(within(detail).getByRole('button', { name: '编辑区域格子' }));

    expect(screen.queryByLabelText('超级地球 注释')).not.toBeInTheDocument();
    expect(originalCell).toHaveClass('selected');
    const initialActionMenu = screen.getByLabelText('选区操作菜单');
    expect(initialActionMenu).toHaveTextContent('16×16');
    expect(within(initialActionMenu).getByRole('button', { name: '继续添加选区' })).toBeInTheDocument();
    expect(within(initialActionMenu).getByRole('button', { name: '编辑区域内容' })).toBeInTheDocument();
    expect(within(initialActionMenu).getByRole('button', { name: '取消选区' })).toBeInTheDocument();

    await userEvent.click(within(initialActionMenu).getByRole('button', { name: '编辑区域内容' }));
    const editForm = screen.getByLabelText('编辑待建造区域');
    expect(within(editForm).getByLabelText('区域名称')).toHaveValue('超级地球');
    expect(within(editForm).getByLabelText('区域注释')).toHaveValue('第一条注释');

    await userEvent.click(within(editForm).getByRole('button', { name: '取消编辑' }));
    fireEvent.click(originalCell);
    await userEvent.click(within(screen.getByLabelText('超级地球 注释')).getByRole('button', { name: '编辑区域格子' }));

    await userEvent.click(within(screen.getByLabelText('选区操作菜单')).getByRole('button', { name: '继续添加选区' }));
    fireEvent.pointerDown(addedCell);
    fireEvent.pointerUp(addedCell);

    const actionMenu = screen.getByLabelText('选区操作菜单');
    expect(actionMenu).toHaveTextContent('32×16');
    expect(screen.queryByLabelText('命名待建造区域')).not.toBeInTheDocument();

    await userEvent.click(within(actionMenu).getByRole('button', { name: '编辑区域内容' }));
    const expandedEditForm = screen.getByLabelText('编辑待建造区域');
    await userEvent.clear(within(expandedEditForm).getByLabelText('区域名称'));
    await userEvent.type(within(expandedEditForm).getByLabelText('区域名称'), '超级地球二期');
    await userEvent.clear(within(expandedEditForm).getByLabelText('区域注释'));
    await userEvent.type(within(expandedEditForm).getByLabelText('区域注释'), '更新后注释');
    await userEvent.click(within(expandedEditForm).getByRole('button', { name: '保存区域修改' }));

    expect(originalCell).toHaveAttribute('data-region-id', 'region-1');
    expect(addedCell).toHaveAttribute('data-region-id', 'region-1');
    expect(screen.getByLabelText('超级地球二期 注释')).toHaveTextContent('更新后注释');
    await waitFor(() => {
      const saved = JSON.parse(storage.getItem(localIslandStorageKey)!);
      expect(saved.maps[0].regions[0].label).toBe('超级地球二期');
      expect(saved.maps[0].regions[0].notes).toMatchObject([{ text: '更新后注释' }]);
      expect(saved.maps[0].regions[0].cells).toHaveLength(32 * 16);
    });
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

function createSupabaseSession(): Session {
  return {
    access_token: 'access-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    user: {
      app_metadata: {},
      aud: 'authenticated',
      created_at: '2026-06-13T00:00:00.000Z',
      email: 'owner@example.com',
      id: 'owner-1',
      user_metadata: {
        nickname: 'Owner',
      },
    },
  } as Session;
}

function mockAuthClient(overrides: Partial<IslandAuthClient> = {}): IslandAuthClient {
  return {
    getSession: vi.fn(async () => null),
    onSessionChange: vi.fn(() => () => {}),
    signIn: vi.fn(async () => ({ error: null, session: null })),
    signUp: vi.fn(async () => ({ error: null, session: null })),
    signOut: vi.fn(async () => {}),
    ...overrides,
  };
}

function createImageDataFixture(hexColor: string): ImageData {
  const data = new Uint8ClampedArray(23 * 23 * 4);
  for (let y = 0; y < 23; y += 1) {
    for (let x = 0; x < 23; x += 1) {
      paintImageDataCell({ data, width: 23, height: 23 } as ImageData, x, y, hexColor);
    }
  }
  return { data, width: 23, height: 23, colorSpace: 'srgb' } as ImageData;
}

function paintImageDataCell(imageData: ImageData, x: number, y: number, hexColor: string): void {
  const match = /^#([0-9a-f]{6})$/i.exec(hexColor);
  if (!match) {
    throw new Error(`Invalid test color: ${hexColor}`);
  }
  const value = Number.parseInt(match[1]!, 16);
  const offset = (y * imageData.width + x) * 4;
  imageData.data[offset] = (value >> 16) & 255;
  imageData.data[offset + 1] = (value >> 8) & 255;
  imageData.data[offset + 2] = value & 255;
  imageData.data[offset + 3] = 255;
}

function installImageImportStubs(imageData: ImageData): void {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:test-background'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal('Image', class {
    width = imageData.width;
    height = imageData.height;
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.(new Event('load')));
    }
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => imageData),
  } as unknown as CanvasRenderingContext2D);
}

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

function rectAt(x: number, y: number, width: number, height: number): DOMRect {
  return {
    bottom: y + height,
    height,
    left: x,
    right: x + width,
    top: y,
    width,
    x,
    y,
    toJSON: () => ({}),
  } as DOMRect;
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

async function createRegionFromCells(label: string, startTestId: string, endTestId?: string, note = '初始注释') {
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

  await userEvent.click(screen.getByRole('button', { name: '命名选区' }));
  await userEvent.clear(screen.getByLabelText('区域名称'));
  await userEvent.type(screen.getByLabelText('区域名称'), label);
  if (note) {
    await userEvent.type(screen.getByLabelText('区域注释'), note);
  }
  await userEvent.click(screen.getByRole('button', { name: '保存待建造区域' }));
}
