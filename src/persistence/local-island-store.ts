import { isIslandDocumentV1, localIslandStorageKey, type IslandDocumentV1 } from '../domain/island-document';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LocalStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export function loadLocalIslandDocument(storage: StorageLike = window.localStorage): LocalStoreResult<IslandDocumentV1 | null> {
  try {
    const raw = storage.getItem(localIslandStorageKey);
    if (!raw) {
      return { ok: true, value: null };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isIslandDocumentV1(parsed)) {
      storage.removeItem(localIslandStorageKey);
      return { ok: true, value: null };
    }
    return { ok: true, value: parsed };
  } catch {
    try {
      storage.removeItem(localIslandStorageKey);
    } catch {
      return { ok: false, message: '无法访问本地保存。请检查浏览器隐私模式或存储权限。' };
    }
    return { ok: true, value: null };
  }
}

export function saveLocalIslandDocument(document: IslandDocumentV1, storage: StorageLike = window.localStorage): LocalStoreResult<null> {
  try {
    storage.setItem(localIslandStorageKey, JSON.stringify(document));
    return { ok: true, value: null };
  } catch {
    return { ok: false, message: '无法写入本地保存。请检查浏览器隐私模式或存储权限。' };
  }
}

export function clearLocalIslandDocument(storage: StorageLike = window.localStorage): LocalStoreResult<null> {
  try {
    storage.removeItem(localIslandStorageKey);
    return { ok: true, value: null };
  } catch {
    return { ok: false, message: '无法清除本地草稿。请检查浏览器隐私模式或存储权限。' };
  }
}
