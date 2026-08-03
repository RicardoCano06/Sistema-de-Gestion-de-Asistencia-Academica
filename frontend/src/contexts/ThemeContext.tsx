import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { readThemeFromStorage, writeThemeToStorage } from '../utils/theme-storage';

interface ThemeContextType {
  isDark: boolean;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextType>({ isDark: true, toggle: () => {} });

export function ThemeProvider({ children, userId }: { children: ReactNode; userId?: string | null }) {
  const lastUserIdRef = useRef<string | undefined | null>(userId);
  const skipPersistRef = useRef(false);
  const [isDark, setIsDark] = useState<boolean>(() => {
    const dark = readThemeFromStorage(userId) === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    return dark;
  });

  // Cuando cambia el usuario (login / logout), hidrata el tema guardado para ese usuario
  // y evita sobrescribir la clave del usuario anterior en este mismo ciclo.
  useLayoutEffect(() => {
    if (lastUserIdRef.current === userId) return;
    lastUserIdRef.current = userId;
    const dark = readThemeFromStorage(userId) === 'dark';
    skipPersistRef.current = true;
    setIsDark(dark);
    document.documentElement.classList.toggle('dark', dark);
  }, [userId]);

  // Sincroniza <html class="dark"> y persiste en localStorage al cambiar tema o usuario (salvo hidratar sesión).
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);

    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    writeThemeToStorage(userId, isDark ? 'dark' : 'light');
  }, [isDark, userId]);

  const toggle = useCallback(() => {
    setIsDark((v) => !v);
  }, []);

  return <ThemeContext.Provider value={{ isDark, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  return useContext(ThemeContext);
}
