import type { SessionUser } from './rbac';

export function readStoredUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem('currentUser');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionUser;
    if (!parsed || typeof parsed !== 'object' || !parsed.id) return null;
    return parsed;
  } catch {
    try { localStorage.removeItem('currentUser'); } catch { /* ignorar */ }
    return null;
  }
}

export function safeGetStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeRemoveStorageItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // storage puede no estar disponible
  }
}
