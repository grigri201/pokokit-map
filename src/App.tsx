import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { restoreDomainSession, type DomainSessionUser } from './auth/domain-session';
import {
  createDefaultIslandDocument,
  createIslandRegion,
  getActiveMap,
  islandRegionPalette,
  nextIslandRegionId,
  type IslandCell,
  type IslandDocumentV1,
  type IslandRegion,
} from './domain/island-document';
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

interface AppProps {
  config?: AppConfig;
  fetcher?: typeof fetch;
  storage?: StorageLike;
}

export function App({ config = readAppConfig(), fetcher = fetch, storage = window.localStorage }: AppProps) {
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

  const apiClient = useMemo(() => new IslandApiClient({ apiBaseUrl: config.apiBaseUrl, fetcher }), [config.apiBaseUrl, fetcher]);

  const loadCloudIsland = useCallback(async () => {
    setSaveState('pending');
    try {
      const islands = await apiClient.listIslands();
      const first = islands[0] ?? null;
      if (first) {
        setCloudRecord(first);
        setDocument(first.document);
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
      const localDocument = local.ok ? local.value : null;
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
          return;
        }
        setMode('cloud');
        await loadCloudIsland();
        return;
      }

      setMode('local');
      setAuth(session.status === 'error' ? { status: 'error', message: session.message } : { status: 'anonymous' });
      setDocument(localDocument ?? createDefaultIslandDocument());
      setSaveState('idle');
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [config.apiBaseUrl, fetcher, loadCloudIsland, storage]);

  const saveNow = useCallback(async () => {
    setSaveState('pending');
    if (mode === 'cloud' && auth.status === 'authenticated') {
      try {
        const saved = cloudRecord
          ? await apiClient.updateIsland(cloudRecord.id, { name: 'My island plan', document })
          : await apiClient.createIsland({ name: 'My island plan', document });
        setCloudRecord(saved);
        setDocument(saved.document);
        setSaveState('saved');
        setErrorMessage(null);
      } catch (error) {
        setSaveState('error');
        setErrorMessage(readSafeError(error, '保存到 Pokokit Cloud 失败，可重试。'));
      }
      return;
    }

    const saved = saveLocalIslandDocument(document, storage);
    setSaveState(saved.ok ? 'saved' : 'error');
    setErrorMessage(saved.ok ? null : saved.message);
  }, [apiClient, auth.status, cloudRecord, document, mode, storage]);

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
  const gridCells = useMemo(() => {
    const cells: IslandCell[] = [];
    for (let y = 0; y < activeMap.grid.height; y += 1) {
      for (let x = 0; x < activeMap.grid.width; x += 1) {
        cells.push({ x, y });
      }
    }
    return cells;
  }, [activeMap.grid.height, activeMap.grid.width]);
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
  const canCreateRegion = selection.cells.length > 0 && regionDraft.label.trim().length > 0 && regionDraft.note.trim().length > 0;
  const mapStyle = { '--grid-width': activeMap.grid.width } as CSSProperties;

  const handleCellPointerDown = useCallback((cell: IslandCell) => {
    setActiveTooltip(null);
    setRegionError(null);
    setSelection(beginSelectionDrag(cell, activeMap.grid));
  }, [activeMap.grid]);

  const handleCellPointerEnter = useCallback((cell: IslandCell) => {
    setSelection(current => (
      current.dragging
        ? updateSelectionDrag(current, cell, activeMap.grid)
        : current
    ));
  }, [activeMap.grid]);

  const handleCellPointerUp = useCallback((cell: IslandCell) => {
    setSelection(current => endSelectionDrag(current, cell, activeMap.grid));
  }, [activeMap.grid]);

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

  return (
    <main className="workspace">
      <aside className="side-panel" aria-label="保存和登录状态">
        <div>
          <p className="eyebrow">Island Designer</p>
          <h1>岛屿规划工作台</h1>
        </div>

        {isCloud ? (
          <section className="status-card cloud" aria-label="云端保存状态">
            <strong>已登录：保存到 Pokokit Cloud</strong>
            <span>{auth.user.email ?? auth.user.id}</span>
            <span className={`save-pill ${saveState}`}>{statusLabel}</span>
          </section>
        ) : isAuthenticatedLocal ? (
          <section className="status-card local" aria-label="本地保存状态">
            <strong>已登录：当前继续本地保存，草稿不会自动同步到云端</strong>
            <span>{auth.user.email ?? auth.user.id}</span>
            <span className={`save-pill ${saveState}`}>{statusLabel}</span>
          </section>
        ) : (
          <section className="status-card local" aria-label="本地保存状态">
            <strong>未登录：仅保存在此浏览器 localStorage，不会同步到云端</strong>
            <a href={config.signInUrl}>登录同步</a>
            <span className={`save-pill ${saveState}`}>{statusLabel}</span>
          </section>
        )}

        {auth.status === 'error' ? <p className="safe-error">{auth.message}</p> : null}
        {errorMessage ? <p className="safe-error">{errorMessage}</p> : null}

        {migrationDraft ? (
          <section className="migration-panel" aria-label="本地草稿处理">
            <strong>发现本地匿名草稿</strong>
            <p>选择后才会处理这份草稿，不会自动上传。</p>
            <button type="button" onClick={() => void saveLocalDraftToCloud()}>保存到云端</button>
            <button type="button" onClick={continueLocalDraft}>继续本地</button>
            <button type="button" onClick={() => void discardLocalDraft()}>丢弃本地草稿</button>
          </section>
        ) : null}

        <button className="primary-action" type="button" onClick={() => void saveNow()} disabled={saveState === 'pending'}>
          {saveState === 'pending' ? '保存中' : '保存当前规划'}
        </button>
        {saveState === 'error' ? (
          <button className="secondary-action" type="button" onClick={() => void saveNow()}>重试保存</button>
        ) : null}

        <section className="region-panel" aria-label="创建区域说明">
          <div>
            <p className="eyebrow">Region</p>
            <strong>{selection.cells.length > 0 ? `${selection.cells.length} 个格子已选择` : '未选择格子'}</strong>
          </div>
          <form onSubmit={createRegion}>
            <label>
              区域标题
              <input
                value={regionDraft.label}
                onChange={event => setRegionDraft(current => ({ ...current, label: event.target.value }))}
                placeholder="例如：入口花园"
              />
            </label>
            <label>
              说明文字
              <textarea
                value={regionDraft.note}
                onChange={event => setRegionDraft(current => ({ ...current, note: event.target.value }))}
                placeholder="记录规划意图"
                rows={3}
              />
            </label>
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
            {regionError ? <p className="safe-error compact">{regionError}</p> : null}
            <button className="secondary-action" type="submit" disabled={!canCreateRegion}>创建说明</button>
          </form>
        </section>
      </aside>

      <section className="map-workbench" aria-label="第一张岛屿地图">
        <div className="map-toolbar">
          <div>
            <p className="eyebrow">Map 01</p>
            <h2>{activeMap.name}</h2>
          </div>
          <dl>
            <div>
              <dt>Grid</dt>
              <dd>{activeMap.grid.width} x {activeMap.grid.height}</dd>
            </div>
            <div>
              <dt>Regions</dt>
              <dd>{activeMap.regions.length}</dd>
            </div>
            <div>
              <dt>Selected</dt>
              <dd>{selection.cells.length}</dd>
            </div>
          </dl>
        </div>
        <div className="map-scroll">
          <div className="map-surface" role="grid" aria-label="第一张巨大岛屿地图" style={mapStyle}>
            {gridCells.map(cell => {
              const key = cellKey(cell);
              const region = regionByCell.get(key);
              const selected = selectedCellKeys.has(key);
              const className = [
                'map-cell',
                selected ? 'selected' : '',
                region ? 'saved' : '',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={key}
                  type="button"
                  role="gridcell"
                  className={className}
                  style={region ? { '--region-color': region.color } as CSSProperties : undefined}
                  data-testid={`map-cell-${cell.x}-${cell.y}`}
                  data-region-id={region?.id}
                  aria-label={region ? `格子 ${cell.x + 1},${cell.y + 1}：${region.label}` : `格子 ${cell.x + 1},${cell.y + 1}`}
                  aria-selected={selected}
                  onPointerDown={() => handleCellPointerDown(cell)}
                  onPointerEnter={() => handleCellPointerEnter(cell)}
                  onPointerUp={() => handleCellPointerUp(cell)}
                  onMouseEnter={() => showRegionTooltip(region)}
                  onFocus={() => showRegionTooltip(region)}
                  onClick={() => showRegionTooltip(region)}
                />
              );
            })}
          </div>
        </div>
        {activeTooltip ? (
          <aside className="map-tooltip" role="tooltip">
            <strong>{activeTooltip.region.label}</strong>
            <span>{activeTooltip.region.note}</span>
            <small>{activeTooltip.cellCount} 个格子</small>
          </aside>
        ) : null}
      </section>
    </main>
  );
}

function readSafeError(error: unknown, fallback: string): string {
  if (error instanceof IslandApiError) {
    return error.message;
  }
  return fallback;
}
