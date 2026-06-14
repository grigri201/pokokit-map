import {
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Session } from '@supabase/supabase-js';

import { clearDomainSession, restoreDomainSession, syncDomainSession, type DomainSessionUser } from './auth/domain-session';
import { createIslandAuthClient, type IslandAuthClient } from './auth/supabase-client';
import {
  appendIslandRegionNote,
  createDefaultIslandDocument,
  createIslandRegion,
  getActiveMap,
  normalizeIslandDocumentGrid,
  islandRegionPalette,
  nextIslandRegionId,
  removeIslandRegion,
  updateActiveIslandMapTerrainColors,
  updateIslandRegion,
  type IslandCell,
  type IslandDocumentV1,
  type IslandRegion,
} from './domain/island-document';
import {
  getReferenceIslandMacroCellColor,
  referenceIslandMacroGrid,
  referenceIslandSubdivisions,
  sampleReferenceIslandTerrainColorsFromImageData,
  type IslandTerrainColors,
} from './domain/island-terrain';
import {
  cellKey,
  clearSelection,
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
type MapDetailLevel = 'macro' | 'medium' | 'fine';
type SelectionPopoverMode = 'actions' | 'name' | null;

interface RegionDraft {
  label: string;
}

interface RegionTooltip {
  region: IslandRegion;
  cellCount: number;
  anchor: {
    x: number;
    y: number;
  };
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

interface SelectionDragState {
  anchor: IslandCell;
  blockSize: number;
}

interface SubcellOverlay {
  cell: IslandCell;
  localX: number;
  localY: number;
  spanSize: number;
  region?: IslandRegion;
  selected: boolean;
}

interface MacroCellState {
  overlays: SubcellOverlay[];
  region: IslandRegion | undefined;
  regionCellCount: number;
  selected: boolean;
}

interface RegionTooltipInfo {
  region: IslandRegion;
  cellCount: number;
}

interface SelectionBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

interface FloatingAnchor {
  x: number;
  y: number;
}

interface AppProps {
  config?: AppConfig;
  fetcher?: typeof fetch;
  locale?: string;
  storage?: StorageLike;
  authClient?: IslandAuthClient | null;
}

const mapCellSize = 48;
const mapCellGap = 1;
const mapSurfaceBorder = 1;
const mapFitPadding = 48;
const mapCellStride = mapCellSize + mapCellGap;
const mapSubCellSize = mapCellSize / referenceIslandSubdivisions;
const minMapZoom = 0.45;
const maxMapZoom = 5;
const defaultMapZoom = 1;
const mediumGridZoom = 1.15;
const fineGridZoom = 4;
const mediumDetailBlockSize = 4;

export function App({ config = readAppConfig(), fetcher = fetch, locale = readBrowserLocale(), storage = window.localStorage, authClient: providedAuthClient }: AppProps) {
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' });
  const [document, setDocument] = useState<IslandDocumentV1>(() => createDefaultIslandDocument());
  const [cloudRecord, setCloudRecord] = useState<IslandRecord | null>(null);
  const [mode, setMode] = useState<PersistenceMode>('local');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [migrationDraft, setMigrationDraft] = useState<IslandDocumentV1 | null>(null);
  const [selection, setSelection] = useState(clearSelection);
  const [regionDraft, setRegionDraft] = useState<RegionDraft>({ label: '' });
  const [regionError, setRegionError] = useState<string | null>(null);
  const [selectionPopoverMode, setSelectionPopoverMode] = useState<SelectionPopoverMode>(null);
  const [activeRegionDetailId, setActiveRegionDetailId] = useState<string | null>(null);
  const [regionNoteDraft, setRegionNoteDraft] = useState('');
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<RegionTooltip | null>(null);
  const [regionSequence, setRegionSequence] = useState(1);
  const [focusedRegionId, setFocusedRegionId] = useState<string | null>(null);
  const [flashRegionId, setFlashRegionId] = useState<string | null>(null);
  const [pendingDeleteRegionId, setPendingDeleteRegionId] = useState<string | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [mapView, setMapView] = useState<MapView>({ zoom: defaultMapZoom, panX: 380, panY: 108 });
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [authMenuOpen, setAuthMenuOpen] = useState(false);
  const [authFormMode, setAuthFormMode] = useState<'signIn' | 'signUp'>('signIn');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authNickname, setAuthNickname] = useState('');
  const [authFormError, setAuthFormError] = useState<string | null>(null);
  const [authFormNotice, setAuthFormNotice] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const mapCellRefs = useRef(new Map<string, HTMLButtonElement>());
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const mapTitleInputRef = useRef<HTMLInputElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const mapDragRef = useRef<DragState | null>(null);
  const selectionDragRef = useRef<SelectionDragState | null>(null);
  const lockedSelectionCellsRef = useRef<IslandCell[]>([]);
  const lastSavedDocumentRef = useRef<IslandDocumentV1 | null>(null);
  const cloudRecordRef = useRef<IslandRecord | null>(null);

  const apiClient = useMemo(() => new IslandApiClient({ apiBaseUrl: config.apiBaseUrl, fetcher }), [config.apiBaseUrl, fetcher]);
  const defaultAuthClient = useMemo(() => createIslandAuthClient(config), [config.supabasePublishableKey, config.supabaseUrl]);
  const authClient = providedAuthClient === undefined ? defaultAuthClient : providedAuthClient;

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

      let session = await restoreDomainSession(config.apiBaseUrl, fetcher);
      if (session.status !== 'authenticated' && authClient) {
        const supabaseSession = await authClient.getSession().catch(() => null);
        if (supabaseSession) {
          session = await syncDomainSession(config.apiBaseUrl, supabaseSession.access_token, fetcher);
        }
      }
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
  }, [authClient, config.apiBaseUrl, fetcher, loadCloudIsland, storage]);

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

  const completeAuthSession = useCallback(async (session: Session) => {
    const syncedSession = await syncDomainSession(config.apiBaseUrl, session.access_token, fetcher);
    if (syncedSession.status !== 'authenticated') {
      const message = syncedSession.status === 'error'
        ? syncedSession.message
        : '无法同步 Pokokit 登录状态，可继续本地编辑。';
      setAuth({ status: 'error', message });
      setAuthFormError(message);
      setAuthFormNotice(null);
      setMode('local');
      setSaveState('idle');
      return;
    }

    setAuth({ status: 'authenticated', user: syncedSession.user });
    setAuthFormError(null);
    setAuthFormNotice(null);
    setAuthMenuOpen(false);

    if (mode === 'local') {
      setMigrationDraft(document);
      setSaveState('idle');
      return;
    }

    setMode('cloud');
    await loadCloudIsland();
  }, [config.apiBaseUrl, document, fetcher, loadCloudIsland, mode]);

  const submitAuthForm = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authClient || authPending) {
      setAuthFormError('认证未配置。');
      return;
    }

    setAuthPending(true);
    setAuthFormError(null);
    setAuthFormNotice(null);
    try {
      const result = authFormMode === 'signIn'
        ? await authClient.signIn(authEmail, authPassword)
        : await authClient.signUp(authEmail, authPassword, normalizeNickname(authNickname, authEmail), config.appUrl);
      if (result.error) {
        setAuthFormError(result.error);
        return;
      }
      if (result.session) {
        await completeAuthSession(result.session);
        return;
      }
      setAuthFormNotice('请检查邮箱完成注册。');
    } finally {
      setAuthPending(false);
    }
  }, [authClient, authEmail, authFormMode, authNickname, authPassword, authPending, completeAuthSession, config.appUrl]);

  const signOut = useCallback(async () => {
    if (authPending) {
      return;
    }
    setAuthPending(true);
    const cleared = await clearDomainSession(config.apiBaseUrl, fetcher);
    await authClient?.signOut();
    setAuth({ status: 'anonymous' });
    setMode('local');
    setCloudRecord(null);
    setMigrationDraft(null);
    setAuthMenuOpen(false);
    setAuthFormError(cleared.ok ? null : cleared.message);
    setAuthPending(false);
  }, [authClient, authPending, config.apiBaseUrl, fetcher]);

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
  const suggestedRegionColor = useMemo(
    () => chooseRegionColorForSelection(selection.cells, activeMap.regions, activeMap.grid),
    [activeMap.grid, activeMap.regions, selection.cells],
  );
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
  const canSaveRegionDraft = selection.cells.length > 0 && regionDraft.label.trim().length > 0;
  const focusMapTitleInput = useCallback(() => {
    mapTitleInputRef.current?.focus();
  }, []);
  const mapDetailLevel = readMapDetailLevel(mapView.zoom);
  const mapDetailBlockSize = readMapDetailBlockSize(mapDetailLevel);
  const showSubgrid = mapDetailLevel !== 'macro';
  const displayMapCellSize = readDisplayMapCellSize(mapView.zoom);
  const displayMapSubCellSize = displayMapCellSize / referenceIslandSubdivisions;
  const mapDisplayCellSize = displayMapSubCellSize * mapDetailBlockSize;
  const mapStyle = {
    '--grid-width': referenceIslandMacroGrid.width,
    '--map-cell-size': `${displayMapCellSize}px`,
    '--map-cell-gap': `${mapCellGap}px`,
    '--map-subcell-size': `${displayMapSubCellSize}px`,
    '--map-display-cell-size': `${mapDisplayCellSize}px`,
    '--map-grid-line-width': '1px',
  } as CSSProperties;
  const selectionBounds = useMemo(() => readSelectionBounds(selection.cells), [selection.cells]);
  const selectionAnchor = selectionBounds ? readFloatingAnchorFromBounds(selectionBounds, mapView) : null;
  const activeRegionDetail = activeRegionDetailId ? activeMap.regions.find(region => region.id === activeRegionDetailId) ?? null : null;
  const activeRegionDetailAnchor = activeRegionDetail ? readFloatingAnchorFromCells(activeRegionDetail.cells, mapView) : null;
  const zoomPercent = ((mapView.zoom - minMapZoom) / (maxMapZoom - minMapZoom)) * 100;
  const mediumGridZoomPercent = ((mediumGridZoom - minMapZoom) / (maxMapZoom - minMapZoom)) * 100;
  const fineGridZoomPercent = ((fineGridZoom - minMapZoom) / (maxMapZoom - minMapZoom)) * 100;

  const zoomMapAtPoint = useCallback((zoom: number, point: { x: number; y: number } | null) => {
    setMapView(current => {
      const nextZoom = clamp(zoom, minMapZoom, maxMapZoom);
      if (!point) {
        return { ...current, zoom: nextZoom };
      }
      const worldX = displayPointToBaseMapPoint(point.x - current.panX, current.zoom);
      const worldY = displayPointToBaseMapPoint(point.y - current.panY, current.zoom);
      return {
        zoom: nextZoom,
        panX: snapScreenPixel(point.x - baseMapPointToDisplayPoint(worldX, nextZoom)),
        panY: snapScreenPixel(point.y - baseMapPointToDisplayPoint(worldY, nextZoom)),
      };
    });
  }, []);

  const readCanvasCenterPoint = useCallback(() => {
    const canvas = mapCanvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return { x: rect.width / 2, y: rect.height / 2 };
  }, []);

  const handleZoomSliderChange = useCallback((event: FormEvent<HTMLInputElement>) => {
    zoomMapAtPoint(Number(event.currentTarget.value), readCanvasCenterPoint());
  }, [readCanvasCenterPoint, zoomMapAtPoint]);

  const resetMapZoom = useCallback(() => {
    const canvas = mapCanvasRef.current;
    if (!canvas) {
      setMapView({ zoom: defaultMapZoom, panX: 380, panY: 108 });
      return;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      setMapView({ zoom: defaultMapZoom, panX: 380, panY: 108 });
      return;
    }

    setMapView(readFitMapView(rect));
  }, []);

  const openRegionDetail = useCallback((region: IslandRegion) => {
    selectionDragRef.current = null;
    lockedSelectionCellsRef.current = [];
    setSelection(clearSelection());
    setSelectionPopoverMode(null);
    setRegionDraft({ label: '' });
    setRegionNoteDraft('');
    setRegionError(null);
    setActiveTooltip(null);
    setFocusedRegionId(region.id);
    setFlashRegionId(region.id);
    setPendingDeleteRegionId(null);
    setEditingRegionId(null);
    setActiveRegionDetailId(region.id);
  }, []);

  const handleCellPointerDown = useCallback((macroCell: IslandCell, event: ReactPointerEvent<HTMLButtonElement>) => {
    setActiveTooltip(null);
    setRegionError(null);
    const regionInfo = readRegionTooltipInfoFromPointer(event, macroCell, mapDetailBlockSize, regionByCell);
    if (regionInfo && regionInfo.region.id !== editingRegionId) {
      openRegionDetail(regionInfo.region);
      return;
    }

    setActiveRegionDetailId(null);
    setPendingDeleteRegionId(null);
    setSelectionPopoverMode(null);
    const anchor = resolveSelectionAnchor(event, macroCell, mapDetailBlockSize);
    selectionDragRef.current = { anchor, blockSize: mapDetailBlockSize };
    setSelection(createAccumulatedBlockSelection(anchor, anchor, mapDetailBlockSize, true, activeMap.grid, lockedSelectionCellsRef.current));
  }, [activeMap.grid, editingRegionId, mapDetailBlockSize, openRegionDetail, regionByCell]);

  const handleCellPointerMove = useCallback((macroCell: IslandCell, event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = selectionDragRef.current;
    if (!drag) {
      return;
    }
    const focus = resolveSelectionAnchor(event, macroCell, drag.blockSize);
    setSelection(current => {
      if (!current.dragging) {
        return current;
      }
      return createAccumulatedBlockSelection(
        drag.anchor,
        focus,
        drag.blockSize,
        true,
        activeMap.grid,
        lockedSelectionCellsRef.current,
      );
    });
  }, [activeMap.grid]);

  const handleCellPointerUp = useCallback((macroCell: IslandCell, event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = selectionDragRef.current;
    const focus = drag ? resolveSelectionAnchor(event, macroCell, drag.blockSize) : null;
    if (!drag || !focus) {
      setSelection(current => ({ ...current, dragging: false }));
      selectionDragRef.current = null;
      return;
    }

    setSelection(current => {
      return createAccumulatedBlockSelection(
        drag.anchor,
        focus,
        drag.blockSize,
        false,
        activeMap.grid,
        lockedSelectionCellsRef.current,
      );
    });
    selectionDragRef.current = null;
    setSelectionPopoverMode('actions');
  }, [activeMap.grid]);

  const showRegionTooltip = useCallback((info: RegionTooltipInfo | null, element: HTMLElement | null) => {
    if (!info) {
      setActiveTooltip(null);
      return;
    }
    setActiveTooltip({ region: info.region, cellCount: info.cellCount, anchor: readTooltipAnchor(element) });
  }, []);

  const handleCellClick = useCallback((macroCell: IslandCell, event: { clientX: number; clientY: number; currentTarget: HTMLButtonElement }) => {
    const regionInfo = readRegionTooltipInfoFromPointer(event, macroCell, mapDetailBlockSize, regionByCell);
    if (regionInfo && regionInfo.region.id !== editingRegionId) {
      openRegionDetail(regionInfo.region);
      return;
    }
    showRegionTooltip(null, null);
  }, [editingRegionId, mapDetailBlockSize, openRegionDetail, regionByCell, showRegionTooltip]);

  const submitRegionDraft = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editingRegionId) {
      const result = updateIslandRegion(document, {
        regionId: editingRegionId,
        label: regionDraft.label,
        cells: selection.cells,
      });
      if (!result.ok) {
        setRegionError(result.message);
        return;
      }

      setDocument(result.document);
      setSelection(clearSelection());
      lockedSelectionCellsRef.current = [];
      setSelectionPopoverMode(null);
      setRegionDraft({ label: '' });
      setRegionError(null);
      setActiveTooltip(null);
      setActiveRegionDetailId(result.region.id);
      setFocusedRegionId(result.region.id);
      setFlashRegionId(result.region.id);
      setEditingRegionId(null);
      setSaveState('idle');
      setErrorMessage(null);
      return;
    }

    const regionId = nextIslandRegionId(activeMap.regions, regionSequence);
    const result = createIslandRegion(document, {
      id: regionId,
      label: regionDraft.label,
      color: suggestedRegionColor,
      cells: selection.cells,
    });
    if (!result.ok) {
      setRegionError(result.message);
      return;
    }

    setDocument(result.document);
    setSelection(clearSelection());
    lockedSelectionCellsRef.current = [];
    setSelectionPopoverMode(null);
    setRegionDraft({ label: '' });
    setRegionError(null);
    setActiveTooltip(null);
    setActiveRegionDetailId(null);
    setFocusedRegionId(result.region.id);
    setFlashRegionId(result.region.id);
    setEditingRegionId(null);
    setRegionSequence(current => current + 1);
    setSaveState('idle');
    setErrorMessage(null);
  }, [activeMap.regions, document, editingRegionId, regionDraft.label, regionSequence, selection.cells, suggestedRegionColor]);

  const clearTransientMapUi = useCallback(() => {
    setRegionDraft({ label: '' });
    lockedSelectionCellsRef.current = [];
    setSelection(clearSelection());
    setSelectionPopoverMode(null);
    setRegionError(null);
    setActiveTooltip(null);
    setActiveRegionDetailId(null);
    setRegionNoteDraft('');
    setPendingDeleteRegionId(null);
    setEditingRegionId(null);
  }, []);

  const openImportFilePicker = useCallback(() => {
    importFileInputRef.current?.click();
  }, []);

  const importBackgroundImage = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) {
      return;
    }

    try {
      const terrainColors = await readTerrainColorsFromImageFile(file);
      setDocument(current => updateActiveIslandMapTerrainColors(current, terrainColors));
      clearTransientMapUi();
      setFileMenuOpen(false);
      setSaveState('idle');
      setErrorMessage(null);
    } catch {
      setFileMenuOpen(false);
      setErrorMessage('导入背景图失败，请选择有效的图片文件。');
    }
  }, [clearTransientMapUi]);

  const cancelRegionDraft = useCallback(() => {
    setRegionDraft({ label: '' });
    lockedSelectionCellsRef.current = [];
    setSelection(clearSelection());
    setSelectionPopoverMode(null);
    setRegionError(null);
    setActiveTooltip(null);
    setEditingRegionId(null);
  }, []);

  const lockCurrentSelection = useCallback(() => {
    lockedSelectionCellsRef.current = selection.cells;
    setSelectionPopoverMode(null);
    setRegionError(null);
    setActiveTooltip(null);
  }, [selection.cells]);

  const showRegionDraftPopover = useCallback(() => {
    if (editingRegionId) {
      const editingRegion = activeMap.regions.find(region => region.id === editingRegionId);
      if (editingRegion) {
        setRegionDraft({
          label: editingRegion.label,
        });
      }
    }
    setSelectionPopoverMode('name');
    setRegionError(null);
    setActiveTooltip(null);
  }, [activeMap.regions, editingRegionId]);

  const startEditingRegionCells = useCallback(() => {
    if (!activeRegionDetail) {
      return;
    }
    const firstCell = activeRegionDetail.cells[0] ?? null;
    const lastCell = activeRegionDetail.cells.at(-1) ?? firstCell;
    lockedSelectionCellsRef.current = activeRegionDetail.cells;
    setSelection({
      anchor: firstCell,
      focus: lastCell,
      cells: activeRegionDetail.cells,
      dragging: false,
    });
    setRegionDraft({
      label: activeRegionDetail.label,
    });
    setEditingRegionId(activeRegionDetail.id);
    setSelectionPopoverMode('actions');
    setActiveRegionDetailId(null);
    setRegionNoteDraft('');
    setPendingDeleteRegionId(null);
    setRegionError(null);
    setActiveTooltip(null);
  }, [activeRegionDetail]);

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
          panX: snapScreenPixel(rect.width / 2 - baseMapPointToDisplayPoint(center.x, current.zoom)),
          panY: snapScreenPixel(rect.height / 2 - baseMapPointToDisplayPoint(center.y, current.zoom)),
        }));
      }
    }
    openRegionDetail(region);
  }, [openRegionDetail]);

  const appendRegionNote = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeRegionDetailId) {
      return;
    }
    const result = appendIslandRegionNote(document, activeRegionDetailId, regionNoteDraft);
    if (!result.ok) {
      setRegionError(result.message);
      return;
    }
    setDocument(result.document);
    setRegionNoteDraft('');
    setRegionError(null);
    setSaveState('idle');
    setErrorMessage(null);
  }, [activeRegionDetailId, document, regionNoteDraft]);

  const deleteRegionById = useCallback((regionId: string) => {
    const result = removeIslandRegion(document, regionId);
    if (!result.ok) {
      setRegionError(result.message);
      return;
    }

    setDocument(result.document);
    if (activeRegionDetailId === regionId) {
      setActiveRegionDetailId(null);
      setRegionNoteDraft('');
    }
    if (editingRegionId === regionId) {
      setEditingRegionId(null);
      lockedSelectionCellsRef.current = [];
      setSelection(clearSelection());
      setSelectionPopoverMode(null);
    }
    setRegionError(null);
    setActiveTooltip(null);
    if (focusedRegionId === regionId) {
      setFocusedRegionId(null);
    }
    if (flashRegionId === regionId) {
      setFlashRegionId(null);
    }
    setPendingDeleteRegionId(null);
    setSaveState('idle');
    setErrorMessage(null);
  }, [activeRegionDetailId, document, editingRegionId, flashRegionId, focusedRegionId]);

  const deleteActiveRegion = useCallback(() => {
    if (!activeRegionDetailId) {
      return;
    }
    deleteRegionById(activeRegionDetailId);
  }, [activeRegionDetailId, deleteRegionById]);

  const requestRegionListDelete = useCallback((regionId: string) => {
    setPendingDeleteRegionId(regionId);
    setRegionError(null);
  }, []);

  const cancelRegionListDelete = useCallback(() => {
    setPendingDeleteRegionId(null);
    setRegionError(null);
  }, []);

  const closeRegionDetail = useCallback(() => {
    setActiveRegionDetailId(null);
    setRegionNoteDraft('');
    setRegionError(null);
    setEditingRegionId(null);
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

  const handleCanvasWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const canvas = mapCanvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const pointX = event.clientX - rect.left;
    const pointY = event.clientY - rect.top;
    zoomMapAtPoint(mapView.zoom * (event.deltaY > 0 ? 0.9 : 1.1), { x: pointX, y: pointY });
  }, [mapView.zoom, zoomMapAtPoint]);

  useEffect(() => {
    const canvas = mapCanvasRef.current;
    if (!canvas) {
      return undefined;
    }
    canvas.addEventListener('wheel', handleCanvasWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleCanvasWheel);
  }, [handleCanvasWheel]);

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
      panX: snapScreenPixel(drag.originX + event.clientX - drag.startX),
      panY: snapScreenPixel(drag.originY + event.clientY - drag.startY),
    }));
  }, []);

  const endCanvasDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (mapDragRef.current?.pointerId === event.pointerId) {
      mapDragRef.current = null;
    }
  }, []);

  const mapSurfaceStyle = {
    ...mapStyle,
    transform: `translate3d(${snapScreenPixel(mapView.panX)}px, ${snapScreenPixel(mapView.panY)}px, 0)`,
  } as CSSProperties;
  const mapSurfaceClassName = [
    'map-surface',
    showSubgrid ? 'show-subgrid' : '',
    mapDetailLevel === 'medium' ? 'show-medium-grid' : '',
    mapDetailLevel === 'fine' ? 'show-fine-grid' : '',
  ].filter(Boolean).join(' ');

  return (
    <main className="workspace">
      <section className="map-workbench" aria-label="第一张岛屿地图">
        <div
          className="map-canvas"
          ref={mapCanvasRef}
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
              const macroState = readMacroCellState(cell, selectedCellKeys, regionByCell, showSubgrid, mapDetailBlockSize);
              const region = macroState.region;
              const selected = macroState.selected;
              const cellStyle = {
                '--terrain-color': getReferenceIslandMacroCellColor(cell, activeMap.terrainColors),
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
                  onMouseEnter={event => showRegionTooltip(readRegionTooltipInfoFromPointer(event, cell, mapDetailBlockSize, regionByCell), event.currentTarget)}
                  onFocus={event => showRegionTooltip(readRegionTooltipInfoFromMacroState(macroState), event.currentTarget)}
                  onClick={event => handleCellClick(cell, event)}
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
                              gridColumn: `${overlay.localX + 1} / span ${overlay.spanSize}`,
                              gridRow: `${overlay.localY + 1} / span ${overlay.spanSize}`,
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
        {activeMap.regions.map((region, index) => {
          const anchor = readRegionBadgeAnchor(region.cells, mapView);
          return (
            <button
              key={region.id}
              type="button"
              className="region-badge"
              style={{
                '--region-badge-left': `${anchor.x}px`,
                '--region-badge-top': `${anchor.y}px`,
                '--region-color': region.color,
              } as CSSProperties}
              aria-label={`待建造区域 ${index + 1}：${region.label}`}
              title={region.label}
              onClick={() => selectRegion(region)}
            >
              {index + 1}
            </button>
          );
        })}
        {activeTooltip ? (
          <aside
            className="map-tooltip floating-panel"
            role="tooltip"
            style={{
              '--tooltip-left': `${activeTooltip.anchor.x}px`,
              '--tooltip-top': `${activeTooltip.anchor.y}px`,
              '--tooltip-color': activeTooltip.region.color,
            } as CSSProperties}
          >
            <strong>{activeTooltip.region.label}</strong>
            <small>{activeTooltip.cellCount} 个小格</small>
          </aside>
        ) : null}
        <div
          className="zoom-control"
          aria-label="地图缩放控件"
          style={{
            '--zoom-percent': `${zoomPercent}%`,
            '--zoom-medium-marker': `${mediumGridZoomPercent}%`,
            '--zoom-fine-marker': `${fineGridZoomPercent}%`,
          } as CSSProperties}
        >
          <div className="floating-panel zoom-slider-card">
            <input
              className="zoom-slider"
              type="range"
              min={minMapZoom}
              max={maxMapZoom}
              step="0.01"
              value={mapView.zoom}
              aria-label="地图缩放"
              aria-valuetext={`${Math.round(mapView.zoom * 100)}%`}
              onInput={handleZoomSliderChange}
              onChange={handleZoomSliderChange}
            />
          </div>
          <button
            className="floating-panel zoom-reset-button"
            type="button"
            aria-label="恢复初始 zoom"
            title="恢复初始 zoom"
            onClick={resetMapZoom}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M8 3H3v5" />
              <path d="M16 3h5v5" />
              <path d="M21 16v5h-5" />
              <path d="M3 16v5h5" />
              <path d="M9 9 3.8 3.8" />
              <path d="m15 9 5.2-5.2" />
              <path d="m15 15 5.2 5.2" />
              <path d="M9 15 3.8 20.2" />
            </svg>
          </button>
        </div>
      </section>

      <div className="floating-panel app-button-group" role="group" aria-label="主工具栏">
        <div className="auth-menu-wrapper">
          <button
            className="app-tool-button"
            type="button"
            title={auth.status === 'error' ? auth.message : isAuthenticatedLocal ? '当前继续本地保存' : statusLabel}
            aria-haspopup="dialog"
            aria-expanded={authMenuOpen}
            onClick={() => {
              setAuthMenuOpen(current => !current);
              setFileMenuOpen(false);
              setAuthFormError(null);
              setAuthFormNotice(null);
            }}
          >
            {accountLabel}
          </button>
          {authMenuOpen ? (
            auth.status === 'authenticated' ? (
              <div className="floating-panel auth-popover account-popover" role="dialog" aria-label="账户菜单">
                <strong>{accountLabel}</strong>
                <button className="auth-submit-button" type="button" disabled={authPending} onClick={() => void signOut()}>
                  退出登录
                </button>
                {authFormError ? <p className="safe-error compact">{authFormError}</p> : null}
              </div>
            ) : (
              <form className="floating-panel auth-popover" aria-label="登录表单" onSubmit={event => void submitAuthForm(event)}>
                <div className="auth-mode-tabs" role="group" aria-label="登录模式">
                  <button
                    type="button"
                    className={`auth-mode-tab${authFormMode === 'signIn' ? ' active' : ''}`}
                    aria-pressed={authFormMode === 'signIn'}
                    onClick={() => {
                      setAuthFormMode('signIn');
                      setAuthFormError(null);
                      setAuthFormNotice(null);
                    }}
                  >
                    登录
                  </button>
                  <button
                    type="button"
                    className={`auth-mode-tab${authFormMode === 'signUp' ? ' active' : ''}`}
                    aria-pressed={authFormMode === 'signUp'}
                    onClick={() => {
                      setAuthFormMode('signUp');
                      setAuthFormError(null);
                      setAuthFormNotice(null);
                    }}
                  >
                    注册
                  </button>
                </div>
                <label>
                  <span>邮箱</span>
                  <input value={authEmail} type="email" autoComplete="email" onChange={event => setAuthEmail(event.target.value)} />
                </label>
                {authFormMode === 'signUp' ? (
                  <label>
                    <span>昵称</span>
                    <input value={authNickname} type="text" autoComplete="nickname" maxLength={80} onChange={event => setAuthNickname(event.target.value)} />
                  </label>
                ) : null}
                <label>
                  <span>密码</span>
                  <input
                    value={authPassword}
                    type="password"
                    autoComplete={authFormMode === 'signUp' ? 'new-password' : 'current-password'}
                    minLength={authFormMode === 'signUp' ? 6 : undefined}
                    onChange={event => setAuthPassword(event.target.value)}
                  />
                </label>
                <button className="auth-submit-button" type="submit" disabled={authPending}>
                  {authFormMode === 'signUp' ? '注册' : '登录'}
                </button>
                {authFormNotice ? <p className="safe-notice compact">{authFormNotice}</p> : null}
                {authFormError ? <p className="safe-error compact">{authFormError}</p> : null}
              </form>
            )
          ) : null}
        </div>
        <div className="file-menu-wrapper">
          <button
            className="app-tool-button"
            type="button"
            title={statusLabel}
            aria-haspopup="menu"
            aria-expanded={fileMenuOpen}
            onClick={() => {
              setFileMenuOpen(current => !current);
              setAuthMenuOpen(false);
            }}
          >
            文件
          </button>
          <input
            ref={importFileInputRef}
            className="file-import-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/*"
            aria-label="导入背景图"
            onChange={event => void importBackgroundImage(event)}
          />
          {fileMenuOpen ? (
            <div className="floating-panel file-menu" role="menu" aria-label="文件菜单">
              <button className="file-menu-item" type="button" role="menuitem" onClick={openImportFilePicker}>导入背景图</button>
            </div>
          ) : null}
        </div>
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
        <div className="map-title-control">
          <input
            ref={mapTitleInputRef}
            className="map-title-input"
            aria-label="地图名称"
            value={activeMap.name}
            onChange={event => renameActiveMap(event.target.value)}
            onBlur={event => ensureActiveMapTitle(event.currentTarget.value)}
          />
          <button
            className="map-title-edit-button"
            type="button"
            aria-label="编辑地图名称"
            title="编辑地图名称"
            onClick={focusMapTitleInput}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        </div>
      </div>

      {selectionPopoverMode && selectionBounds && selectionAnchor ? (
        <aside
          className={`floating-panel selection-popover ${selectionPopoverMode === 'name' ? 'name-mode' : 'action-mode'}`}
          aria-label={selectionPopoverMode === 'name' ? editingRegionId ? '编辑待建造区域' : '命名待建造区域' : '选区操作菜单'}
          style={{
            '--selection-popover-left': `${selectionAnchor.x}px`,
            '--selection-popover-top': `${selectionAnchor.y}px`,
          } as CSSProperties}
        >
          {selectionPopoverMode === 'actions' ? (
            <>
              <strong className="selection-size">{formatSelectionSize(selectionBounds)}</strong>
              <div className="selection-command-row">
                <button className="icon-action" type="button" aria-label="继续添加选区" title="继续添加选区" onClick={lockCurrentSelection}>+</button>
                <button
                  className="icon-action confirm"
                  type="button"
                  aria-label={editingRegionId ? '编辑区域内容' : '命名选区'}
                  title={editingRegionId ? '编辑区域内容' : '命名选区'}
                  onClick={showRegionDraftPopover}
                >
                  ✓
                </button>
                <button className="icon-action cancel" type="button" aria-label="取消选区" title="取消选区" onClick={cancelRegionDraft}>×</button>
              </div>
            </>
          ) : (
            <form onSubmit={submitRegionDraft}>
              <input
                className="region-title-input"
                aria-label="区域名称"
                value={regionDraft.label}
                onChange={event => setRegionDraft(current => ({ ...current, label: event.target.value }))}
                placeholder="例如：入口花园"
                maxLength={100}
              />
              <div className="selection-command-row">
                <button
                  className="icon-action confirm"
                  type="submit"
                  disabled={!canSaveRegionDraft}
                  aria-label={editingRegionId ? '保存区域修改' : '保存待建造区域'}
                  title={editingRegionId ? '保存区域修改' : '保存待建造区域'}
                >
                  ✓
                </button>
                <button
                  className="icon-action cancel"
                  type="button"
                  aria-label={editingRegionId ? '取消编辑' : '取消命名'}
                  title={editingRegionId ? '取消编辑' : '取消命名'}
                  onClick={cancelRegionDraft}
                >
                  ×
                </button>
              </div>
              {regionError ? <p className="safe-error compact">{regionError}</p> : null}
            </form>
          )}
        </aside>
      ) : null}

      {activeRegionDetail && activeRegionDetailAnchor ? (
        <aside
          className="floating-panel region-detail-popover"
          aria-label={`${activeRegionDetail.label} 注释`}
          style={{
            '--region-detail-left': `${activeRegionDetailAnchor.x}px`,
            '--region-detail-top': `${activeRegionDetailAnchor.y}px`,
            '--region-color': activeRegionDetail.color,
          } as CSSProperties}
        >
          <strong>{activeRegionDetail.label}</strong>
          {activeRegionDetail.notes.length > 0 ? (
            <ul className="region-note-list">
              {activeRegionDetail.notes.map(note => (
                <li key={note.id}>{note.text}</li>
              ))}
            </ul>
          ) : null}
          <form className="region-note-form" onSubmit={appendRegionNote}>
            <input
              aria-label="新增注释"
              value={regionNoteDraft}
              onChange={event => setRegionNoteDraft(event.target.value)}
              placeholder="添加更多注释"
            />
            <button className="icon-action" type="button" aria-label="编辑区域格子" title="编辑区域格子" onClick={startEditingRegionCells}>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button className="icon-action danger" type="button" aria-label="删除区域" title="删除区域" onClick={deleteActiveRegion}>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="m6 6 1 14h10l1-14" />
                <path d="M10 11v5" />
                <path d="M14 11v5" />
              </svg>
            </button>
            <button className="icon-action confirm" type="submit" disabled={!regionNoteDraft.trim()} aria-label="添加注释" title="添加注释">✓</button>
            <button className="icon-action cancel" type="button" aria-label="取消注释" title="取消注释" onClick={closeRegionDetail}>×</button>
          </form>
          {regionError ? <p className="safe-error compact">{regionError}</p> : null}
        </aside>
      ) : null}

      {activeMap.regions.length > 0 ? (
        <aside className="floating-panel region-records-panel" aria-label="待建造区域列表">
          <ul className="region-list">
            {activeMap.regions.map((region, index) => (
              <li key={region.id} className={focusedRegionId === region.id ? 'active' : undefined}>
                <button
                  type="button"
                  className="region-list-main"
                  aria-label={`${index + 1} ${region.label}`}
                  onClick={() => selectRegion(region)}
                >
                  <span>{index + 1}</span>
                  {region.label}
                </button>
                {pendingDeleteRegionId === region.id ? (
                  <div className="region-list-delete-confirm" role="group" aria-label={`确认删除 ${region.label}`}>
                    <button
                      type="button"
                      className="region-list-icon confirm"
                      aria-label={`确认删除区域 ${region.label}`}
                      title="确认删除"
                      onClick={() => deleteRegionById(region.id)}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className="region-list-icon cancel"
                      aria-label={`取消删除区域 ${region.label}`}
                      title="取消删除"
                      onClick={cancelRegionListDelete}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="region-list-icon danger"
                    aria-label={`删除区域 ${region.label}`}
                    title="删除区域"
                    onClick={() => requestRegionListDelete(region.id)}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="m6 6 1 14h10l1-14" />
                      <path d="M10 11v5" />
                      <path d="M14 11v5" />
                    </svg>
                  </button>
                )}
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
  overlayBlockSize: number,
): MacroCellState {
  let selected = false;
  let firstRegion: IslandRegion | undefined;
  const regionCounts = new Map<string, number>();
  const overlays: SubcellOverlay[] = [];
  for (let localY = 0; localY < referenceIslandSubdivisions; localY += 1) {
    for (let localX = 0; localX < referenceIslandSubdivisions; localX += 1) {
      const cell = macroCellToSubcell(macroCell, localX, localY);
      const key = cellKey(cell);
      const region = regionByCell.get(key);
      const isSelected = selectedCellKeys.has(key);
      selected ||= isSelected;
      firstRegion ??= region;
      if (region) {
        regionCounts.set(region.id, (regionCounts.get(region.id) ?? 0) + 1);
      }
    }
  }
  if (includeOverlays) {
    for (let localY = 0; localY < referenceIslandSubdivisions; localY += overlayBlockSize) {
      for (let localX = 0; localX < referenceIslandSubdivisions; localX += overlayBlockSize) {
        const overlay = readSubcellOverlayBlock(macroCell, localX, localY, overlayBlockSize, selectedCellKeys, regionByCell);
        if (overlay) {
          overlays.push(overlay);
        }
      }
    }
  }
  return { overlays, region: firstRegion, regionCellCount: firstRegion ? regionCounts.get(firstRegion.id) ?? 0 : 0, selected };
}

function readSubcellOverlayBlock(
  macroCell: IslandCell,
  localX: number,
  localY: number,
  blockSize: number,
  selectedCellKeys: Set<string>,
  regionByCell: Map<string, IslandRegion>,
): SubcellOverlay | null {
  let selected = false;
  let region: IslandRegion | undefined;
  for (let y = localY; y < localY + blockSize; y += 1) {
    for (let x = localX; x < localX + blockSize; x += 1) {
      const cell = macroCellToSubcell(macroCell, x, y);
      selected ||= selectedCellKeys.has(cellKey(cell));
      region ??= regionByCell.get(cellKey(cell));
    }
  }
  if (!selected && !region) {
    return null;
  }
  return {
    cell: macroCellToSubcell(macroCell, localX, localY),
    localX,
    localY,
    spanSize: blockSize,
    ...(region ? { region } : {}),
    selected,
  };
}

function readMapDetailLevel(zoom: number): MapDetailLevel {
  if (zoom >= fineGridZoom) {
    return 'fine';
  }
  if (zoom >= mediumGridZoom) {
    return 'medium';
  }
  return 'macro';
}

function readMapDetailBlockSize(level: MapDetailLevel): number {
  if (level === 'fine') {
    return 1;
  }
  if (level === 'medium') {
    return mediumDetailBlockSize;
  }
  return referenceIslandSubdivisions;
}

function createBlockSelection(start: IslandCell, focus: IslandCell, blockSize: number, dragging: boolean, grid: IslandDocumentV1['maps'][number]['grid']) {
  const cells = cellsInBlockRect(start, focus, blockSize, grid);
  return {
    anchor: start,
    focus: {
      x: Math.min(focus.x + blockSize - 1, grid.width - 1),
      y: Math.min(focus.y + blockSize - 1, grid.height - 1),
    },
    cells,
    dragging,
  };
}

function createAccumulatedBlockSelection(
  start: IslandCell,
  focus: IslandCell,
  blockSize: number,
  dragging: boolean,
  grid: IslandDocumentV1['maps'][number]['grid'],
  lockedCells: IslandCell[],
) {
  const selection = createBlockSelection(start, focus, blockSize, dragging, grid);
  if (lockedCells.length === 0) {
    return selection;
  }
  return {
    ...selection,
    cells: mergeSelectionCells(lockedCells, selection.cells, grid),
  };
}

function cellsInBlockRect(start: IslandCell, focus: IslandCell, blockSize: number, grid: IslandDocumentV1['maps'][number]['grid']): IslandCell[] {
  const minX = Math.max(0, Math.min(start.x, focus.x));
  const maxX = Math.min(grid.width - 1, Math.max(start.x, focus.x) + blockSize - 1);
  const minY = Math.max(0, Math.min(start.y, focus.y));
  const maxY = Math.min(grid.height - 1, Math.max(start.y, focus.y) + blockSize - 1);
  const cells: IslandCell[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}

function mergeSelectionCells(a: IslandCell[], b: IslandCell[], grid: IslandDocumentV1['maps'][number]['grid']): IslandCell[] {
  const seen = new Set<string>();
  const cells: IslandCell[] = [];
  for (const cell of [...a, ...b]) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= grid.width || cell.y >= grid.height) {
      continue;
    }
    const key = cellKey(cell);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    cells.push(cell);
  }
  return cells;
}

function readSelectionBounds(cells: IslandCell[]): SelectionBounds | null {
  if (cells.length === 0) {
    return null;
  }
  let minX = cells[0]!.x;
  let minY = cells[0]!.y;
  let maxX = cells[0]!.x;
  let maxY = cells[0]!.y;
  for (const cell of cells) {
    minX = Math.min(minX, cell.x);
    minY = Math.min(minY, cell.y);
    maxX = Math.max(maxX, cell.x);
    maxY = Math.max(maxY, cell.y);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function formatSelectionSize(bounds: SelectionBounds): string {
  return `${bounds.width}×${bounds.height}`;
}

function readRegionBadgeAnchor(cells: IslandCell[], mapView: MapView): FloatingAnchor {
  const bounds = readSelectionBounds(cells);
  if (!bounds) {
    return { x: 16, y: 96 };
  }
  const right = readSubcellDisplayLeft(bounds.maxX, mapView.zoom) + readDisplayMapSubCellSize(mapView.zoom);
  const top = readSubcellDisplayTop(bounds.minY, mapView.zoom);
  return {
    x: snapScreenPixel(mapView.panX + right + 8),
    y: snapScreenPixel(mapView.panY + top + 8),
  };
}

function readFloatingAnchorFromCells(cells: IslandCell[], mapView: MapView): FloatingAnchor {
  const bounds = readSelectionBounds(cells);
  return bounds ? readFloatingAnchorFromBounds(bounds, mapView) : { x: 16, y: 96 };
}

function readFloatingAnchorFromBounds(bounds: SelectionBounds, mapView: MapView): FloatingAnchor {
  const right = readSubcellDisplayLeft(bounds.maxX, mapView.zoom) + readDisplayMapSubCellSize(mapView.zoom);
  const top = readSubcellDisplayTop(bounds.minY, mapView.zoom);
  const rawX = mapView.panX + right + 10;
  const rawY = mapView.panY + top - 10;
  const maxX = typeof window === 'undefined' ? 980 : window.innerWidth - 288;
  const maxY = typeof window === 'undefined' ? 680 : window.innerHeight - 190;
  return {
    x: snapScreenPixel(clamp(rawX, 12, Math.max(12, maxX))),
    y: snapScreenPixel(clamp(rawY, 56, Math.max(56, maxY))),
  };
}

function resolveSelectionAnchor(event: { clientX: number; clientY: number; currentTarget: HTMLButtonElement }, macroCell: IslandCell, blockSize: number): IslandCell {
  if (blockSize === referenceIslandSubdivisions) {
    return macroCellToSubcell(macroCell, 0, 0);
  }

  const local = resolveLocalSubcellFromPointer(event);
  return macroCellToSubcell(macroCell, snapLocalSubcell(local.x, blockSize), snapLocalSubcell(local.y, blockSize));
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

function readRegionTooltipInfoFromMacroState(macroState: MacroCellState): RegionTooltipInfo | null {
  return macroState.region ? { region: macroState.region, cellCount: macroState.regionCellCount } : null;
}

function readRegionTooltipInfoFromPointer(
  event: { clientX: number; clientY: number; currentTarget: HTMLButtonElement },
  macroCell: IslandCell,
  blockSize: number,
  regionByCell: Map<string, IslandRegion>,
): RegionTooltipInfo | null {
  const anchor = resolveSelectionAnchor(event, macroCell, blockSize);
  return readRegionTooltipInfoFromBlock(anchor, blockSize, regionByCell);
}

function readRegionTooltipInfoFromBlock(
  anchor: IslandCell,
  blockSize: number,
  regionByCell: Map<string, IslandRegion>,
): RegionTooltipInfo | null {
  let region: IslandRegion | undefined;
  let cellCount = 0;
  for (let y = anchor.y; y < anchor.y + blockSize; y += 1) {
    for (let x = anchor.x; x < anchor.x + blockSize; x += 1) {
      const cellRegion = regionByCell.get(cellKey({ x, y }));
      region ??= cellRegion;
      if (cellRegion && cellRegion.id === region?.id) {
        cellCount += 1;
      }
    }
  }
  return region ? { region, cellCount } : null;
}

function chooseRegionColorForSelection(cells: IslandCell[], regions: IslandRegion[], grid: IslandDocumentV1['maps'][number]['grid']): string {
  const selectedKeys = new Set(cells.map(cellKey));
  const regionByKey = new Map<string, IslandRegion>();
  const totalColorUse = new Map<string, number>();
  const adjacentColorUse = new Map<string, number>();

  for (const color of islandRegionPalette) {
    totalColorUse.set(color, 0);
    adjacentColorUse.set(color, 0);
  }

  for (const region of regions) {
    totalColorUse.set(region.color, (totalColorUse.get(region.color) ?? 0) + region.cells.length);
    for (const cell of region.cells) {
      regionByKey.set(cellKey(cell), region);
    }
  }

  for (const cell of cells) {
    for (const neighbor of orthogonalNeighbors(cell, grid)) {
      if (selectedKeys.has(cellKey(neighbor))) {
        continue;
      }
      const region = regionByKey.get(cellKey(neighbor));
      if (region) {
        adjacentColorUse.set(region.color, (adjacentColorUse.get(region.color) ?? 0) + 1);
      }
    }
  }

  return islandRegionPalette.reduce((best, color) => {
    const bestAdjacent = adjacentColorUse.get(best) ?? 0;
    const colorAdjacent = adjacentColorUse.get(color) ?? 0;
    if (colorAdjacent !== bestAdjacent) {
      return colorAdjacent < bestAdjacent ? color : best;
    }

    const bestTotal = totalColorUse.get(best) ?? 0;
    const colorTotal = totalColorUse.get(color) ?? 0;
    return colorTotal < bestTotal ? color : best;
  }, islandRegionPalette[0]);
}

function orthogonalNeighbors(cell: IslandCell, grid: IslandDocumentV1['maps'][number]['grid']): IslandCell[] {
  return [
    { x: cell.x - 1, y: cell.y },
    { x: cell.x + 1, y: cell.y },
    { x: cell.x, y: cell.y - 1 },
    { x: cell.x, y: cell.y + 1 },
  ].filter(neighbor => neighbor.x >= 0 && neighbor.y >= 0 && neighbor.x < grid.width && neighbor.y < grid.height);
}

function countRegionCellsInMacroCell(region: IslandRegion, macroCell: IslandCell): number {
  const minX = macroCell.x * referenceIslandSubdivisions;
  const minY = macroCell.y * referenceIslandSubdivisions;
  const maxX = minX + referenceIslandSubdivisions;
  const maxY = minY + referenceIslandSubdivisions;
  return region.cells.filter(cell => cell.x >= minX && cell.x < maxX && cell.y >= minY && cell.y < maxY).length;
}

function readTooltipAnchor(element: HTMLElement | null): RegionTooltip['anchor'] {
  if (!element) {
    return { x: 12, y: 64 };
  }
  const rect = element.getBoundingClientRect();
  const rightSideX = rect.right + 10;
  const leftSideX = rect.left - 190;
  const hasRightSpace = rightSideX <= window.innerWidth - 190;
  return {
    x: Math.round(hasRightSpace ? rightSideX : Math.max(12, leftSideX)),
    y: Math.round(clamp(rect.top + rect.height / 2, 44, window.innerHeight - 44)),
  };
}

function resolveLocalSubcellFromPointer(event: { clientX: number; clientY: number; currentTarget: HTMLButtonElement }): IslandCell {
  const rect = event.currentTarget.getBoundingClientRect();
  const localX = clamp(Math.floor(((event.clientX - rect.left) / rect.width) * referenceIslandSubdivisions), 0, referenceIslandSubdivisions - 1);
  const localY = clamp(Math.floor(((event.clientY - rect.top) / rect.height) * referenceIslandSubdivisions), 0, referenceIslandSubdivisions - 1);
  return { x: localX, y: localY };
}

function snapLocalSubcell(value: number, blockSize: number): number {
  return Math.floor(value / blockSize) * blockSize;
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

function baseMapPointToDisplayPoint(point: number, zoom: number): number {
  const displayCellSize = readDisplayMapCellSize(zoom);
  const displayStride = displayCellSize + mapCellGap;
  const macroIndex = Math.floor(point / mapCellStride);
  const localPoint = point - macroIndex * mapCellStride;
  if (localPoint <= mapCellSize) {
    return macroIndex * displayStride + (localPoint / mapCellSize) * displayCellSize;
  }
  return macroIndex * displayStride + displayCellSize + Math.min(localPoint - mapCellSize, mapCellGap);
}

function displayPointToBaseMapPoint(point: number, zoom: number): number {
  const displayCellSize = readDisplayMapCellSize(zoom);
  const displayStride = displayCellSize + mapCellGap;
  const macroIndex = Math.floor(point / displayStride);
  const localPoint = point - macroIndex * displayStride;
  if (localPoint <= displayCellSize) {
    return macroIndex * mapCellStride + (localPoint / displayCellSize) * mapCellSize;
  }
  return macroIndex * mapCellStride + mapCellSize + Math.min(localPoint - displayCellSize, mapCellGap);
}

function readFitMapView(rect: { width: number; height: number }): MapView {
  const fixedWidth = readMapSurfaceFixedSize(referenceIslandMacroGrid.width);
  const fixedHeight = readMapSurfaceFixedSize(referenceIslandMacroGrid.height);
  const availableWidth = Math.max(mapCellSize, rect.width - mapFitPadding * 2);
  const availableHeight = Math.max(mapCellSize, rect.height - mapFitPadding * 2);
  const displayCellSize = Math.max(
    1,
    Math.floor(Math.min(
      (availableWidth - fixedWidth) / referenceIslandMacroGrid.width,
      (availableHeight - fixedHeight) / referenceIslandMacroGrid.height,
      mapCellSize * maxMapZoom,
    )),
  );
  const zoom = clamp(displayCellSize / mapCellSize, minMapZoom, maxMapZoom);
  const surfaceSize = readMapSurfaceDisplaySize(zoom);
  return {
    zoom,
    panX: snapScreenPixel((rect.width - surfaceSize.width) / 2),
    panY: snapScreenPixel((rect.height - surfaceSize.height) / 2),
  };
}

function readMapSurfaceDisplaySize(zoom: number): { width: number; height: number } {
  const displayCellSize = readDisplayMapCellSize(zoom);
  return {
    width: referenceIslandMacroGrid.width * displayCellSize + readMapSurfaceFixedSize(referenceIslandMacroGrid.width),
    height: referenceIslandMacroGrid.height * displayCellSize + readMapSurfaceFixedSize(referenceIslandMacroGrid.height),
  };
}

function readMapSurfaceFixedSize(cellCount: number): number {
  return Math.max(0, cellCount - 1) * mapCellGap + 2 * mapCellGap + 2 * mapSurfaceBorder;
}

function readSubcellDisplayLeft(cellX: number, zoom: number): number {
  const macroX = Math.floor(cellX / referenceIslandSubdivisions);
  const localX = cellX % referenceIslandSubdivisions;
  const displayCellSize = readDisplayMapCellSize(zoom);
  return macroX * (displayCellSize + mapCellGap) + localX * readDisplayMapSubCellSize(zoom);
}

function readSubcellDisplayTop(cellY: number, zoom: number): number {
  const macroY = Math.floor(cellY / referenceIslandSubdivisions);
  const localY = cellY % referenceIslandSubdivisions;
  const displayCellSize = readDisplayMapCellSize(zoom);
  return macroY * (displayCellSize + mapCellGap) + localY * readDisplayMapSubCellSize(zoom);
}

function readDisplayMapCellSize(zoom: number): number {
  return Math.max(1, snapScreenPixel(mapCellSize * zoom));
}

function readDisplayMapSubCellSize(zoom: number): number {
  return readDisplayMapCellSize(zoom) / referenceIslandSubdivisions;
}

function snapScreenPixel(value: number): number {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.round(value * ratio) / ratio;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function readTerrainColorsFromImageFile(file: File): Promise<IslandTerrainColors> {
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error('invalid-image-file');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width <= 0 || height <= 0) {
      throw new Error('empty-image');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('canvas-unavailable');
    }
    context.drawImage(image, 0, 0, width, height);
    return sampleReferenceIslandTerrainColorsFromImageData(context.getImageData(0, 0, width, height));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image-load-failed'));
    image.src = src;
  });
}

function normalizeNickname(nickname: string, email: string): string {
  const trimmed = nickname.trim();
  if (trimmed) {
    return trimmed;
  }
  const emailPrefix = email.split('@')[0]?.trim();
  return emailPrefix || 'pokokit-user';
}

function readBrowserLocale(): string {
  return navigator.languages[0] ?? navigator.language ?? 'en';
}

function defaultMapTitleForLocale(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? '云岛' : 'Cloud Island';
}
