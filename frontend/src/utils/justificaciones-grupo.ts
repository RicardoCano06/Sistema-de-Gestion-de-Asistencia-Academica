/** Campos que identifican una misma carga de justificación (un PDF para varias fechas de clase). */
export function claveGrupoJustificacionCarga(j: {
  motivo: string | null;
  documento_url?: string | null;
  estado_revision: string | null;
  matricula_id?: number | null;
  curso_id?: number | null;
  materia?: string | null;
  modulo_anio?: number | null;
  modulo_mes?: number | null;
}): string {
  const doc = (j.documento_url ?? '').trim();
  const motivo = (j.motivo ?? '').trim();
  const estado = (j.estado_revision ?? '').toLowerCase();
  const mod =
    j.modulo_mes != null && j.modulo_anio != null ? `${j.modulo_mes}/${j.modulo_anio}` : '';
  const mat = j.matricula_id != null ? `${j.matricula_id}|` : '';
  return `${mat}${motivo}|${doc}|${estado}|${j.curso_id ?? ''}|${j.materia ?? ''}|${mod}`;
}

export type GrupoJustificacion<T extends { id: number; fecha: string | null }> = {
  representante: T;
  fechas: string[];
  ids: number[];
};

/** Varias filas de BD (una por fecha de clase) → una fila por carga de justificación. */
export function agruparJustificacionesPorCarga<T extends { id: number; fecha: string | null }>(
  items: T[],
  clave: (item: T) => string
): GrupoJustificacion<T>[] {
  const map = new Map<string, GrupoJustificacion<T>>();
  const orden: GrupoJustificacion<T>[] = [];

  for (const j of items) {
    const key = clave(j);
    const existente = map.get(key);
    if (existente) {
      if (j.fecha) existente.fechas.push(j.fecha);
      existente.ids.push(j.id);
    } else {
      const grupo: GrupoJustificacion<T> = {
        representante: j,
        fechas: j.fecha ? [j.fecha] : [],
        ids: [j.id],
      };
      map.set(key, grupo);
      orden.push(grupo);
    }
  }

  for (const g of orden) {
    g.fechas = [...new Set(g.fechas.map((f) => f.split('T')[0]).filter(Boolean))].sort();
  }

  return orden;
}

export function fechaIsoCorta(f: string): string {
  const d = f.split('T')[0];
  if (!d) return f;
  const [y, m, day] = d.split('-');
  if (y && m && day) return `${day}/${m}/${y}`;
  return d;
}

export function etiquetaModuloJustificacion(mes: number | null, anio: number | null): string | null {
  if (mes == null || anio == null) return null;
  return `${String(mes).padStart(2, '0')}/${anio}`;
}

/** Texto principal para una o varias fechas de clase del mismo grupo. */
export function formatearRangoFechasGrupo(fechas: string[]): {
  principal: string;
  cantidad: number;
  fechasCortas: string[];
} {
  const ordenadas = [...fechas].map((f) => f.split('T')[0]).filter(Boolean).sort();
  if (!ordenadas.length) {
    return { principal: '—', cantidad: 0, fechasCortas: [] };
  }
  const cortas = ordenadas.map(fechaIsoCorta);
  if (cortas.length === 1) {
    return { principal: cortas[0], cantidad: 1, fechasCortas: cortas };
  }
  return {
    principal: `${cortas[0]} – ${cortas[cortas.length - 1]}`,
    cantidad: cortas.length,
    fechasCortas: cortas,
  };
}
