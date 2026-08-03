import { useMemo } from 'react';
import type { ScopeOption } from '../components/ScopeSelector';
import { useAutoAssignScopeId } from '../components/ScopeSelector';
import type { MisAlcances } from './useMisAlcances';
import { calcularContextoSelectorListo, deriveAlcanceVisual } from './useAlcanceVisual';

export interface CarreraConFacultad extends ScopeOption {
  facultad_id: number;
}

export interface UseScopeFormParams {
  alcance: MisAlcances;
  /** Catálogo completo de carreras (para obtener facultad_id). */
  carrerasCatalogo: CarreraConFacultad[];
  /** Si true, no se usa selector de facultad (ej. jefe de carrera). */
  ocultarFacultad?: boolean;
  facultadId: string;
  setFacultadId: (id: string) => void;
  carreraId: string;
  setCarreraId: (id: string) => void;
  /** Fallback cuando el usuario no tiene scopes (admin). */
  facultadesFallback?: ScopeOption[];
  /** `/scopes/mis-alcances` resuelto (default true). */
  alcanceListo?: boolean;
  /** Catálogo facultades/carreras cargado en la página (default true). */
  datosListos?: boolean;
}

/**
 * Estado de formulario estándar: facultades/carreras del alcance + cascada facultad → carrera.
 */
export function useScopeForm({
  alcance,
  carrerasCatalogo,
  ocultarFacultad = false,
  facultadId,
  setFacultadId,
  carreraId,
  setCarreraId,
  facultadesFallback = [],
  alcanceListo = true,
  datosListos = true,
}: UseScopeFormParams) {
  const alcanceVisual = useMemo(
    () => deriveAlcanceVisual(alcance),
    [alcance.carreras.length, alcance.facultades.length]
  );
  const ocultarFacultadEfectivo = ocultarFacultad || alcanceVisual === 'carrera';

  const facultadesDisponibles = useMemo(() => {
    if (alcance.facultades.length > 0) return alcance.facultades;
    return facultadesFallback;
  }, [alcance.facultades, facultadesFallback]);

  const carrerasEnAlcance = useMemo((): CarreraConFacultad[] => {
    const scoped = alcance.carreras;
    const byId = new Map(carrerasCatalogo.map((c) => [c.id, c]));
    const fuente =
      scoped.length > 0
        ? scoped.map((c) => {
            const full = byId.get(c.id);
            return {
              id: c.id,
              nombre: c.nombre,
              facultad_id: full?.facultad_id ?? 0,
            };
          })
        : carrerasCatalogo;
    return fuente.filter((c) => c.facultad_id > 0);
  }, [alcance.carreras, carrerasCatalogo]);

  const facultadIdEfectiva = useMemo(() => {
    if (ocultarFacultadEfectivo) return null;
    if (facultadesDisponibles.length === 1) return facultadesDisponibles[0].id;
    const n = Number(facultadId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [ocultarFacultadEfectivo, facultadesDisponibles, facultadId]);

  const carrerasDisponibles = useMemo(() => {
    if (ocultarFacultadEfectivo) return carrerasEnAlcance;
    if (facultadIdEfectiva == null) return [];
    return carrerasEnAlcance.filter((c) => c.facultad_id === facultadIdEfectiva);
  }, [ocultarFacultadEfectivo, carrerasEnAlcance, facultadIdEfectiva]);

  useAutoAssignScopeId(ocultarFacultadEfectivo ? [] : facultadesDisponibles, facultadId, setFacultadId);
  useAutoAssignScopeId(carrerasDisponibles, carreraId, setCarreraId);

  const requiereElegirFacultad =
    !ocultarFacultadEfectivo && facultadesDisponibles.length > 1 && facultadIdEfectiva == null;

  const contextoSelectorListo = calcularContextoSelectorListo({
    alcanceListo,
    datosListos,
    alcanceVisual,
    carrerasOpciones: carrerasDisponibles,
    carreraId,
  });

  return {
    facultadesDisponibles,
    carrerasDisponibles,
    facultadIdEfectiva,
    requiereElegirFacultad,
    alcanceVisual,
    ocultarFacultad: ocultarFacultadEfectivo,
    contextoSelectorListo,
  };
}
