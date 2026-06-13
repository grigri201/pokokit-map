import {
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { restoreDomainSession, type DomainSessionUser } from './auth/domain-session';
import {
  createDefaultIslandDocument,
  createIslandRegion,
  getActiveMap,
  normalizeIslandDocumentGrid,
  islandRegionPalette,
  nextIslandRegionId,
  type IslandCell,
  type IslandDocumentV1,
  type IslandRegion,
} from './domain/island-document';
import {
  getReferenceIslandMacroCellColor,
  referenceIslandMacroGrid,
  referenceIslandSubdivisions,
} from './domain/island-terrain';
import {
  beginSelectionDrag,
  cellKey,
  clearSelection,
  endSelectionDrag,
  updateSelectionDrag,
} from './domain/selection';
import { readAppConfig, type AppConfig } from './config';
import { IslandApiClient, IslandApiError, type IslandRecord } from './persistence/island-api-client';
import {
  clearLocalIslandDocument,
  loadLocalIslandDocument,
  saveLocalIslandDocument,
  type StorageLike,
} from './persistence/local-island-store';

type AuthState =
  | { status: 'checking' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: DomainSessionUser }
  | { status: 'error'; message: string };

type SaveState = 'idle' | 'pending' | 'saved' | 'error';
type PersistenceMode = 'local' | 'cloud';

interface RegionDraft {
  label: string;
  note: string;
  color: string;
}

interface RegionTooltip {
  region: IslandRegion;
  cellCount: number;
}

interface MapView {
  zoom: number;
  panX: number;
  panY: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

interface SubcellOverlay {
  cell: IslandCell;
  localX: number;
  localY: number;
  region?: IslandRegion;
  selected: boolean;
}

interface MacroCellState {
  overlays: SubcellOverlay[];
  region: IslandRegion | undefined;
  selected: boolean;
}

interface AppProps {
  config?: AppConfig;
  fetcher?: typeof fetch;
  locale?: string;
  storage?: StorageLike;
}

const mapCellSize = 48;
const mapCellGap = 1;
const mapCellStride = mapCellSize + mapCellGap;
const mapSubCellSize = mapCellSize / referenceIslandSubdivisions;
const minMapZoom = 0.45;
const maxMapZoom = 2.4;
const minSubgridZoom = 1.35;

export function App({ config = readAppConfig(), fetcher = fetch, locale = readBrowserLocale(), storage = window.localStorage }: AppProps) {
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' });
  const [document, setDocument] = useState<IslandDocumentV1>(() => createDefaultIslandDocument());
  const [cloudRecord, setCloudRecord] = useState<IslandRecord | null>(null);
  const [mode, setMode] = useState<PersistenceMode>('local');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [migrationDraft, setMigrationDraft] = useState<IslandDocumentV1 | null>(null);
  const [selection, setSelection] = useState(clearSelection);
  const [regionDraft, setRegionDraft] = useState<RegionDraft>({ label: '', note: '', color: islandRegionPalette[0] });
  const [regionError, setRegionError] = useState<string | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<RegionTooltip | null>(null);
  const [regionSequence, setRegionSequence] = useState(1);
  const [focusedRegionId, setFocusedRegionId] = useState<string | null>(null);
  const [flashRegionId, setFlashRegionId] = useState<string | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [mapView, setMapView] = useState<MapView>({ zoom: 1, panX: 380, panY: 108 });
  const mapCellRefs = useRef(new Map<string, HTMLButtonElement>());
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const mapDragRef = useRef<DragState | null>(null);
  const macroSelectionDragRef = useRef<IslandCell | null>(null);
  const lastSavedDocumentRef = useRef<IslandDocumentV1 | null>(null);
  const cloudRecordRef = useRef<IslandRecord | null>(null);

  const apiClient = useMemo(() => new IslandApiClient({ apiBaseUrl: config.apiBaseUrl, fetcher }), [config.apiBaseUrl, fetcher]);

  useEffect(() => {
    cloudRecordRef.current = cloudRecord;
  }, [cloudRecord]);

  const loadCloudIsland = useCallback(async () => {
    setSaveState('pending');
    try {
      const islands = await apiClient.listIslands();
      const first = islands[0] ?? null;
      if (first) {
        const loadedDocument = normalizeIslandDocumentGrid(first.document);
        setCloudRecord({ ...first, document: loadedDocument });
        setDocument(loadedDocument);
        setSaveState('saved');
      } else {
        setCloudRecord(null);
        setDocument(createDefaultIslandDocument());
        setSaveState('idle');
      }
      setErrorMessage(null);
    } catch (error) {
      setSaveState('error');
      setErrorMessage(readSafeError(error, '无法载入云端岛屿，可稍后重试。'));
    }
  }, [apiClient]);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const local = loadLocalIslandDocument(storage);
      const localDocument = local.ok && local.value ? normalizeIslandDocumentGrid(local.value) : null;
      if (!local.ok) {
        setErrorMessage(local.message);
      }

      const session = await restoreDomainSession(config.apiBaseUrl, fetcher);
      if (cancelled) {
        return;
      }

      if (session.status === 'authenticated') {
        setAuth({ status: 'authenticated', user: session.user });
        if (localDocument) {
          setDocument(localDocument);
          setMigrationDraft(localDocument);
          setMode('local');
          setSaveState('idle');
          setBootstrapped(true);
          return;
        }
        setMode('cloud');
        await loadCloudIsland();
        setBootstrapped(true);
        return;
      }

      setMode('local');
      setAuth(session.status === 'error' ? { status: 'error', message: session.message } : { status: 'anonymous' });
      setDocument(localDocument ?? createDefaultIslandDocument());
      setSaveState('idle');
      setBootstrapped(true);
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [config.apiBaseUrl, fetcher, loadCloudIsland, storage]);

  useEffect(() => {
    if (!flashRegionId) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => setFlashRegionId(null), 1100);
    return () => window.clearTimeout(timeoutId);
  }, [flashRegionId]);

  const saveNow = useCallback(async (documentToSave = document) => {
    setSaveState('pending');
    if (mode === 'cloud' && auth.status === 'authenticated') {
      try {
        const currentCloudRecord = cloudRecordRef.current;
        const saved = currentCloudRecord
          ? await apiClient.updateIsland(currentCloudRecord.id, { name: 'My island plan', document: documentToSave })
          : await apiClient.createIsland({ name: 'My island plan', document: documentToSave });
        setCloudRecord(saved);
        setSaveState('saved');
        setErrorMessage(null);
        lastSavedDocumentRef.current = documentToSave;
      } catch (error) {
        setSaveState('error');
        setErrorMessage(readSafeError(error, '保存到 Pokokit Cloud 失败，可重试。'));
      }
      return;
    }

    const saved = saveLocalIslandDocument(documentToSave, storage);
    setSaveState(saved.ok ? 'saved' : 'error');
    setErrorMessage(saved.ok ? null : saved.message);
    if (saved.ok) {
      lastSavedDocumentRef.current = documentToSave;
    }
  }, [apiClient, auth.status, document, mode, storage]);

  useEffect(() => {
    if (!bootstrapped || migrationDraft || lastSavedDocumentRef.current === document) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      void saveNow(document);
    }, 450);
    return () => window.clearTimeout(timeoutId);
  }, [bootstrapped, document, migrationDraft, saveNow]);

  const saveLocalDraftToCloud = useCallback(async () => {
    if (!migrationDraft || auth.status !== 'authenticated') {
      return;
    }
    setMode('cloud');
    setSaveState('pending');
    try {
      const saved = cloudRecord
        ? await apiClient.updateIsland(cloudRecord.id, { name: 'My island plan', document: migrationDraft })
        : await apiClient.createIsland({ name: 'My island plan', document: migrationDraft });
      setCloudRecord(saved);
      setDocument(saved.document);
      clearLocalIslandDocument(storage);
      setMigrationDraft(null);
      setSaveState('saved');
      setErrorMessage(null);
    } catch (error) {
      setSaveState('error');
      setMode('local');
      setErrorMessage(readSafeError(error, '本地草稿保存到云端失败，可继续本地编辑或重试。'));
    }
  }, [apiClient, auth.status, cloudRecord, migrationDraft, storage]);

  const continueLocalDraft = useCallback(() => {
    setMode('local');
    setMigrationDraft(null);
    setSaveState('idle');
  }, []);

  const discardLocalDraft = useCallback(async () => {
    clearLocalIslandDocument(storage);
    setMigrationDraft(null);
    setMode(auth.status === 'authenticated' ? 'cloud' : 'local');
    if (auth.status === 'authenticated') {
      await loadCloudIsland();
    } else {
      setDocument(createDefaultIslandDocument());
    }
  }, [auth.status, loadCloudIsland, storage]);

  const activeMap = getActiveMap(document);
  const macroCells = useMemo(() => {
    const cells: IslandCell[] = [];
    for (let y = 0; y < referenceIslandMacroGrid.height; y += 1) {
      for (let x = 0; x < referenceIslandMacroGrid.width; x += 1) {
        cells.push({ x, y });
      }
    }
    return cells;
  }, []);
  const selectedCellKeys = useMemo(() => new Set(selection.cells.map(cellKey)), [selection.cells]);
  const regionByCell = useMemo(() => {
    const map = new Map<string, IslandRegion>();
    for (const region of activeMap.regions) {
      for (const cell of region.cells) {
        map.set(cellKey(cell), region);
      }
    }
    return map;
  }, [activeMap.regions]);
  const isCloud = mode === 'cloud' && auth.status === 'authenticated';
  const isAuthenticatedLocal = mode === 'local' && auth.status === 'authenticated';
  const statusLabel = saveState === 'pending'
    ? '保存中'
    : saveState === 'saved'
      ? isCloud ? '已保存到 Pokokit Cloud' : '已保存到此浏览器'
      : saveState === 'error'
        ? '保存失败'
        : isCloud ? '云端待保存' : '本地待保存';
  const accountLabel = auth.status === 'authenticated' ? auth.user.email ?? auth.user.id : '登录';
  const canCreateRegion = selection.cells.length > 0 && regionDraft.label.trim().length > 0 && regionDraft.note.trim().length > 0;
  const showSubgrid = mapView.zoom >= minSubgridZoom;
  const mapStyle = {
    '--grid-width': referenceIslandMacroGrid.width,
    '--map-cell-size': `${mapCellSize}px`,
    '--map-cell-gap': `${mapCellGap}px`,
    '--map-subcell-size': `${mapSubCellSize}px`,
  } as CSSProperties;

  const handleCellPointerDown = useCallback((macroCell: IslandCell, event: ReactPointerEvent<HTMLButtonElement>) => {
    setActiveTooltip(null);
    setRegionError(null);
    if (showSubgrid) {
      macroSelectionDragRef.current = null;
      setSelection(beginSelectionDrag(resolveSubcellFromPointer(event, macroCell), activeMap.grid));
      return;
    }
    macroSelectionDragRef.current = macroCell;
    setSelection(createMacroSelection(macroCell, macroCell, true));
  }, [activeMap.grid, showSubgrid]);

  const handleCellPointerMove = useCallback((macroCell: IslandCell, event: ReactPointerEvent<HTMLButtonElement>) => {
    const subcell = showSubgrid ? resolveSubcellFromPointer(event, macroCell) : null;
    setSelection(current => {
      if (!current.dragging) {
        return current;
      }
      if (showSubgrid) {
        return updateSelectionDrag(current, subcell ?? macroCellToSubcell(macroCell, 0, 0), activeMap.grid);
      }
      return macroSelectionDragRef.current
        ? createMacroSelection(macroSelectionDragRef.current, macroCell, true)
        : current;
    });
  }, [activeMap.grid, showSubgrid]);

  const handleCellPointerUp = useCallback((macroCell: IslandCell, event: ReactPointerEvent<HTMLButtonElement>) => {
    const subcell = showSubgrid ? resolveSubcellFromPointer(event, macroCell) : null;
    setSelection(current => {
      if (showSubgrid) {
        return endSelectionDrag(current, subcell ?? macroCellToSubcell(macroCell, 0, 0), activeMap.grid);
      }
      return macroSelectionDragRef.current
        ? createMacroSelection(macroSelectionDragRef.current, macroCell, false)
        : { ...current, dragging: false };
    });
    macroSelectionDragRef.current = null;
  }, [activeMap.grid, showSubgrid]);

  const showRegionTooltip = useCallback((region: IslandRegion | undefined) => {
    if (region) {
      setActiveTooltip({ region, cellCount: region.cells.length });
    }
  }, []);

  const createRegion = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const regionId = nextIslandRegionId(activeMap.regions, regionSequence);
    const result = createIslandRegion(document, {
      id: regionId,
      label: regionDraft.label,
      note: regionDraft.note,
      color: regionDraft.color,
      cells: selection.cells,
    });
    if (!result.ok) {
      setRegionError(result.message);
      return;
    }

    setDocument(result.document);
    setSelection(clearSelection());
    setRegionDraft({ label: '', note: '', color: regionDraft.color });
    setRegionError(null);
    setActiveTooltip({ region: result.region, cellCount: result.region.cells.length });
    setRegionSequence(current => current + 1);
    setSaveState('idle');
    setErrorMessage(null);
  }, [activeMap.regions, document, regionDraft.color, regionDraft.label, regionDraft.note, regionSequence, selection.cells]);

  const selectRegion = useCallback((region: IslandRegion) => {
    const firstCell = region.cells[0];
    if (firstCell) {
      const macroCell = subcellToMacroCell(firstCell);
      const element = mapCellRefs.current.get(cellKey(macroCell));
      if (typeof element?.scrollIntoView === 'function') {
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      }
      const canvas = mapCanvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const center = subcellWorldCenter(firstCell);
        setMapView(current => ({
          ...current,
          panX: rect.width / 2 - center.x * current.zoom,
          panY: rect.height / 2 - center.y * current.zoom,
        }));
      }
    }
    setFocusedRegionId(region.id);
    setFlashRegionId(region.id);
    setActiveTooltip({ region, cellCount: region.cells.length });
  }, []);

  const renameActiveMap = useCallback((name: string) => {
    setDocument(current => ({
      ...current,
      updatedAt: new Date().toISOString(),
      maps: current.maps.map(map => (
        map.id === current.activeMapId
          ? { ...map, name }
          : map
      )),
    }));
    setSaveState('idle');
  }, []);

  const ensureActiveMapTitle = useCallback((name: string) => {
    const trimmedName = name.trim();
    renameActiveMap(trimmedName || defaultMapTitleForLocale(locale));
  }, [locale, renameActiveMap]);

  const handleCanvasWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointX = event.clientX - rect.left;
    const pointY = event.clientY - rect.top;
    setMapView(current => {
      const nextZoom = clamp(current.zoom * (event.deltaY > 0 ? 0.9 : 1.1), minMapZoom, maxMapZoom);
      const worldX = (pointX - current.panX) / current.zoom;
      const worldY = (pointY - current.panY) / current.zoom;
      return {
        zoom: nextZoom,
        panX: pointX - worldX * nextZoom,
        panY: pointY - worldY * nextZoom,
      };
    });
  }, []);

  const handleCanvasPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('.map-cell')) {
      return;
    }
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    mapDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: mapView.panX,
      originY: mapView.panY,
    };
  }, [mapView.panX, mapView.panY]);

  const handleCanvasPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = mapDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    setMapView(current => ({
      ...current,
      panX: drag.originX + event.clientX - drag.startX,
      panY: drag.originY + event.clientY - drag.startY,
    }));
  }, []);

  const endCanvasDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (mapDragRef.current?.pointerId === event.pointerId) {
      mapDragRef.current = null;
    }
  }, []);

  const mapSurfaceStyle = {
    ...mapStyle,
    transform: `translate(${mapView.panX}px, ${mapView.panY}px) scale(${mapView.zoom})`,
  } as CSSProperties;
  const mapSurfaceClassName = showSubgrid ? 'map-surface show-subgrid' : 'map-surface';

  return (
    <main className="workspace">
      <section className="map-workbench" aria-label="第一张岛屿地图">
        <div
          className="map-canvas"
          ref={mapCanvasRef}
          onWheel={handleCanvasWheel}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={endCanvasDrag}
          onPointerCancel={endCanvasDrag}
          aria-label="可滚动缩放拖动的岛屿编辑区"
          data-testid="map-canvas"
        >
          <div className={mapSurfaceClassName} role="grid" aria-label="第一张巨大岛屿地图" style={mapSurfaceStyle}>
            {macroCells.map(cell => {
              const key = cellKey(cell);
              const macroState = readMacroCellState(cell, selectedCellKeys, regionByCell, showSubgrid);
              const region = macroState.region;
              const selected = macroState.selected;
              const cellStyle = {
                '--terrain-color': getReferenceIslandMacroCellColor(cell),
                ...(region ? { '--region-color': region.color } : {}),
              } as CSSProperties;
              const className = [
                'map-cell',
                !showSubgrid && selected ? 'selected' : '',
                !showSubgrid && region ? 'saved' : '',
                !showSubgrid && region?.id === focusedRegionId ? 'focused' : '',
                !showSubgrid && region?.id === flashRegionId ? 'flash' : '',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={key}
                  type="button"
                  role="gridcell"
                  className={className}
                  style={cellStyle}
                  ref={element => {
                    if (element) {
                      mapCellRefs.current.set(key, element);
                    } else {
                      mapCellRefs.current.delete(key);
                    }
                  }}
                  data-testid={`map-cell-${cell.x}-${cell.y}`}
                  data-region-id={region?.id}
                  aria-label={region ? `格子 ${cell.x + 1},${cell.y + 1}：${region.label}` : `格子 ${cell.x + 1},${cell.y + 1}`}
                  aria-selected={selected}
                  onPointerDown={event => handleCellPointerDown(cell, event)}
                  onPointerEnter={event => handleCellPointerMove(cell, event)}
                  onPointerMove={event => handleCellPointerMove(cell, event)}
                  onPointerUp={event => handleCellPointerUp(cell, event)}
                  onMouseEnter={() => showRegionTooltip(region)}
                  onFocus={() => showRegionTooltip(region)}
                  onClick={() => showRegionTooltip(region)}
                >
                  {showSubgrid && macroState.overlays.length > 0 ? (
                    <span className="subcell-layer" aria-hidden="true">
                      {macroState.overlays.map(overlay => {
                        const overlayClassName = [
                          'map-subcell',
                          overlay.selected ? 'selected' : '',
                          overlay.region ? 'saved' : '',
                          overlay.region?.id === focusedRegionId ? 'focused' : '',
                          overlay.region?.id === flashRegionId ? 'flash' : '',
                        ].filter(Boolean).join(' ');
                        return (
                          <span
                            key={cellKey(overlay.cell)}
                            className={overlayClassName}
                            style={{
                              ...(overlay.region ? { '--region-color': overlay.region.color } : {}),
                              gridColumn: overlay.localX + 1,
                              gridRow: overlay.localY + 1,
                            } as CSSProperties}
                          />
                        );
                      })}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
        {activeTooltip ? (
          <aside className="map-tooltip floating-panel" role="tooltip">
            <strong>{activeTooltip.region.label}</strong>
            <span>{activeTooltip.region.note}</span>
            <small>{activeTooltip.cellCount} 个格子</small>
          </aside>
        ) : null}
      </section>

      <div className="floating-panel app-button-group" role="group" aria-label="主工具栏">
        {auth.status === 'authenticated' ? (
          <button className="app-tool-button" type="button" title={isAuthenticatedLocal ? '当前继续本地保存' : statusLabel}>
            {accountLabel}
          </button>
        ) : (
          <a className="app-tool-button" href={config.signInUrl} title={auth.status === 'error' ? auth.message : statusLabel}>登录</a>
        )}
        <button className="app-tool-button" type="button" title={statusLabel}>文件</button>
        <button className="app-tool-button" type="button">导出</button>
      </div>

      {migrationDraft ? (
        <section className="floating-panel migration-panel migration-popover" aria-label="本地草稿处理">
          <strong>发现本地匿名草稿</strong>
          <p>选择后才会处理这份草稿，不会自动上传。</p>
          <button type="button" onClick={() => void saveLocalDraftToCloud()}>保存到云端</button>
          <button type="button" onClick={continueLocalDraft}>继续本地</button>
          <button type="button" onClick={() => void discardLocalDraft()}>丢弃本地草稿</button>
        </section>
      ) : null}

      <div
        className="floating-panel map-toolbar"
        style={{ '--map-title-ch': Math.max(activeMap.name.length + 1, 8) } as CSSProperties}
      >
        <input
          className="map-title-input"
          aria-label="地图名称"
          value={activeMap.name}
          onChange={event => renameActiveMap(event.target.value)}
          onBlur={event => ensureActiveMapTitle(event.currentTarget.value)}
        />
      </div>

      <section className="floating-panel region-panel" aria-label="创建区域说明">
        <form onSubmit={createRegion}>
          <div className="region-inputs">
            <input
              aria-label="区域标题"
              value={regionDraft.label}
              onChange={event => setRegionDraft(current => ({ ...current, label: event.target.value }))}
              placeholder="例如：入口花园"
            />
            <input
              aria-label="说明文字"
              value={regionDraft.note}
              onChange={event => setRegionDraft(current => ({ ...current, note: event.target.value }))}
              placeholder="记录规划意图"
            />
          </div>
          <div className="region-form-row">
            <div className="swatch-group" role="group" aria-label="区域颜色">
              {islandRegionPalette.map(color => (
                <button
                  key={color}
                  type="button"
                  className={color === regionDraft.color ? 'swatch selected' : 'swatch'}
                  style={{ '--swatch-color': color } as CSSProperties}
                  aria-label={`选择颜色 ${color}`}
                  aria-pressed={color === regionDraft.color}
                  onClick={() => setRegionDraft(current => ({ ...current, color }))}
                />
              ))}
            </div>
            <button className="secondary-action" type="submit" disabled={!canCreateRegion}>创建说明</button>
          </div>
          {regionError ? <p className="safe-error compact">{regionError}</p> : null}
        </form>
      </section>

      {activeMap.regions.length > 0 ? (
        <aside className="floating-panel region-records-panel" aria-label="说明记录列表">
          <ul className="region-list">
            {activeMap.regions.map(region => (
              <li key={region.id} className={focusedRegionId === region.id ? 'active' : undefined}>
                <button
                  type="button"
                  className="region-list-main"
                  onClick={() => selectRegion(region)}
                  onFocus={() => setActiveTooltip({ region, cellCount: region.cells.length })}
                >
                  {region.label}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </main>
  );
}

function readSafeError(error: unknown, fallback: string): string {
  if (error instanceof IslandApiError) {
    return error.message;
  }
  return fallback;
}

function readMacroCellState(
  macroCell: IslandCell,
  selectedCellKeys: Set<string>,
  regionByCell: Map<string, IslandRegion>,
  includeOverlays: boolean,
): MacroCellState {
  let selected = false;
  let firstRegion: IslandRegion | undefined;
  const overlays: SubcellOverlay[] = [];
  for (let localY = 0; localY < referenceIslandSubdivisions; localY += 1) {
    for (let localX = 0; localX < referenceIslandSubdivisions; localX += 1) {
      const cell = macroCellToSubcell(macroCell, localX, localY);
      const key = cellKey(cell);
      const region = regionByCell.get(key);
      const isSelected = selectedCellKeys.has(key);
      selected ||= isSelected;
      firstRegion ??= region;
      if (includeOverlays && (isSelected || region)) {
        overlays.push({ cell, localX, localY, ...(region ? { region } : {}), selected: isSelected });
      }
    }
  }
  return { overlays, region: firstRegion, selected };
}

function createMacroSelection(startMacro: IslandCell, focusMacro: IslandCell, dragging: boolean) {
  const cells = cellsInMacroRect(startMacro, focusMacro);
  return {
    anchor: macroCellToSubcell(startMacro, 0, 0),
    focus: macroCellToSubcell(focusMacro, referenceIslandSubdivisions - 1, referenceIslandSubdivisions - 1),
    cells,
    dragging,
  };
}

function cellsInMacroRect(startMacro: IslandCell, focusMacro: IslandCell): IslandCell[] {
  const minX = Math.min(startMacro.x, focusMacro.x);
  const maxX = Math.max(startMacro.x, focusMacro.x);
  const minY = Math.min(startMacro.y, focusMacro.y);
  const maxY = Math.max(startMacro.y, focusMacro.y);
  const cells: IslandCell[] = [];
  for (let macroY = minY; macroY <= maxY; macroY += 1) {
    for (let localY = 0; localY < referenceIslandSubdivisions; localY += 1) {
      for (let macroX = minX; macroX <= maxX; macroX += 1) {
        for (let localX = 0; localX < referenceIslandSubdivisions; localX += 1) {
          cells.push(macroCellToSubcell({ x: macroX, y: macroY }, localX, localY));
        }
      }
    }
  }
  return cells;
}

function macroCellToSubcell(macroCell: IslandCell, localX: number, localY: number): IslandCell {
  return {
    x: macroCell.x * referenceIslandSubdivisions + localX,
    y: macroCell.y * referenceIslandSubdivisions + localY,
  };
}

function subcellToMacroCell(cell: IslandCell): IslandCell {
  return {
    x: Math.floor(cell.x / referenceIslandSubdivisions),
    y: Math.floor(cell.y / referenceIslandSubdivisions),
  };
}

function resolveSubcellFromPointer(event: ReactPointerEvent<HTMLButtonElement>, macroCell: IslandCell): IslandCell {
  const rect = event.currentTarget.getBoundingClientRect();
  const localX = clamp(Math.floor(((event.clientX - rect.left) / rect.width) * referenceIslandSubdivisions), 0, referenceIslandSubdivisions - 1);
  const localY = clamp(Math.floor(((event.clientY - rect.top) / rect.height) * referenceIslandSubdivisions), 0, referenceIslandSubdivisions - 1);
  return macroCellToSubcell(macroCell, localX, localY);
}

function subcellWorldCenter(cell: IslandCell): { x: number; y: number } {
  const macroCell = subcellToMacroCell(cell);
  const localX = cell.x % referenceIslandSubdivisions;
  const localY = cell.y % referenceIslandSubdivisions;
  return {
    x: macroCell.x * mapCellStride + localX * mapSubCellSize + mapSubCellSize / 2,
    y: macroCell.y * mapCellStride + localY * mapSubCellSize + mapSubCellSize / 2,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readBrowserLocale(): string {
  return navigator.languages[0] ?? navigator.language ?? 'en';
}

function defaultMapTitleForLocale(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? '云岛' : 'Cloud Island';
}
