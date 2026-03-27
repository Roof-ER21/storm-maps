import type { EvidenceItem } from '../types/storm';

const DB_NAME = 'storm-maps-evidence';
const DB_VERSION = 1;
const STORE_NAME = 'evidence';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open evidence database.'));
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

export async function listEvidenceItems(): Promise<EvidenceItem[]> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onerror = () => {
      reject(new Error('Failed to read evidence items.'));
    };

    request.onsuccess = () => {
      const results = (request.result as EvidenceItem[]).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
      resolve(results);
    };
  });
}

export async function saveEvidenceItem(item: EvidenceItem): Promise<void> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(item);

    request.onerror = () => {
      reject(new Error('Failed to save evidence item.'));
    };

    tx.oncomplete = () => {
      resolve();
    };

    tx.onerror = () => {
      reject(new Error('Failed to commit evidence item.'));
    };
  });
}

export async function removeEvidenceItem(itemId: string): Promise<void> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(itemId);

    request.onerror = () => {
      reject(new Error('Failed to remove evidence item.'));
    };

    tx.oncomplete = () => {
      resolve();
    };

    tx.onerror = () => {
      reject(new Error('Failed to commit evidence removal.'));
    };
  });
}
