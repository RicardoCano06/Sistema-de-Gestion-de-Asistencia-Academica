/** Clave global (invitado / sin usuario en sesión). Debe coincidir con el script en index.html. */
export const THEME_GLOBAL_KEY = 'theme';

export function themeKeyForUser(userId?: string | number | null): string {
  if (userId != null && String(userId).trim() !== '') {
    return `${THEME_GLOBAL_KEY}_${String(userId)}`;
  }
  return THEME_GLOBAL_KEY;
}

/** Lee preferencia: primero por usuario, luego clave global. */
export function readThemeFromStorage(userId?: string | number | null): 'dark' | 'light' {
  try {
    const scopedRaw = userId ? localStorage.getItem(themeKeyForUser(userId)) : null;
    const scoped = scopedRaw != null && scopedRaw !== '' ? scopedRaw : null;
    const fallback = localStorage.getItem(THEME_GLOBAL_KEY);
    const value = scoped ?? fallback;
    return value === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function writeThemeToStorage(userId: string | number | undefined | null, mode: 'dark' | 'light'): void {
  try {
    localStorage.setItem(THEME_GLOBAL_KEY, mode);
    localStorage.setItem(themeKeyForUser(userId), mode);
  } catch {
    /* private mode / quota */
  }
}
