import { useMemo } from 'react';
import type { MisAlcances } from './useMisAlcances';
import { useMisAlcances } from './useMisAlcances';

export type AlcanceVisual = 'institucional' | 'facultad' | 'carrera';

/** Alcance de UI según scopes del usuario (sin parpadeo institucional al cargar). */
export function deriveAlcanceVisual(alcance: MisAlcances): AlcanceVisual {
  if (alcance.carreras.length >= 1 && alcance.facultades.length === 0) return 'carrera';
  if (alcance.facultades.length >= 1) return 'facultad';
  return 'institucional';
}

export function useAlcanceVisual() {
  const { alcance, listo, loading } = useMisAlcances();
  const alcanceVisual = useMemo(
    () => deriveAlcanceVisual(alcance),
    [alcance.carreras.length, alcance.facultades.length]
  );
  return {
    alcance,
    alcanceVisual,
    alcanceListo: listo,
    alcanceLoading: loading,
    ocultarFacultad: alcanceVisual === 'carrera',
  };
}

/** Evita mostrar selectores vacíos antes de resolver alcance y auto-asignación de carrera única. */
export function calcularContextoSelectorListo(params: {
  alcanceListo: boolean;
  datosListos?: boolean;
  alcanceVisual: AlcanceVisual;
  carrerasOpciones: { id: number }[];
  carreraId: string;
}): boolean {
  const { alcanceListo, datosListos = true, alcanceVisual, carrerasOpciones, carreraId } = params;
  if (!alcanceListo || !datosListos) return false;
  if (alcanceVisual !== 'carrera') return true;
  if (carrerasOpciones.length !== 1) return true;
  const n = Number(carreraId);
  return Number.isFinite(n) && n > 0;
}
