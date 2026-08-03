import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import type { ScopeOption } from '../components/ScopeSelector';

export interface MisAlcances {
  facultades: ScopeOption[];
  carreras: ScopeOption[];
}

const VACIO: MisAlcances = { facultades: [], carreras: [] };

export function useMisAlcances() {
  const [alcance, setAlcance] = useState<MisAlcances | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const data = await apiFetch<MisAlcances>('/scopes/mis-alcances');
        if (!cancelled) setAlcance(data ?? VACIO);
      } catch {
        if (!cancelled) setAlcance(VACIO);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { alcance: alcance ?? VACIO, loading, listo: !loading && alcance != null };
}
