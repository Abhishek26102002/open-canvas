import type { BinaryFile, SceneElement } from "./types";

const SCENE_KEY = "opencanvas:scene";
const PREFS_KEY = "opencanvas:prefs";
const LEGACY_SCENE_KEY = "excile:scene";
const DB_NAME = "opencanvas";
const STORE = "files";

export interface StoredScene {
  name?: string;
  elements: SceneElement[];
  viewport?: { scrollX: number; scrollY: number; zoom: number };
  viewBackgroundColor?: string;
}

export interface StoredPrefs {
  grid?: boolean;
  toolLocked?: boolean;
}

const safeParse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const loadScene = () => {
  try {
    // Fall back to data saved under the app's previous name.
    return safeParse<StoredScene>(localStorage.getItem(SCENE_KEY) ?? localStorage.getItem(LEGACY_SCENE_KEY));
  } catch {
    return null;
  }
};

export const saveScene = (scene: StoredScene) => {
  try {
    localStorage.setItem(SCENE_KEY, JSON.stringify(scene));
  } catch {
    // Storage full or unavailable; nothing else we can do here.
  }
};

export const loadPrefs = () => {
  try {
    return safeParse<StoredPrefs>(localStorage.getItem(PREFS_KEY)) ?? {};
  } catch {
    return {};
  }
};

export const savePrefs = (prefs: StoredPrefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
};

// Images can be large, so they go to IndexedDB instead of localStorage.

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export const loadFiles = async (): Promise<Record<string, BinaryFile>> => {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(Object.fromEntries((req.result as BinaryFile[]).map((f) => [f.id, f])));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return {};
  }
};

export const saveFiles = async (files: BinaryFile[]) => {
  if (!files.length) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    for (const f of files) tx.objectStore(STORE).put(f);
  } catch {}
};
