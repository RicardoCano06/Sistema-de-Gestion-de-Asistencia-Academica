/** Fila de vw_resumen_asistencia_curso usada en el panel de inicio. */
export interface ResumenCursoPanel {
  curso_id: number;
  anio: number;
  mes: number;
  materia?: string;
  total_matriculas: number;
  alumnos_regulares: number;
  alumnos_riesgo: number;
  alumnos_irregulares: number;
  promedio_asistencia: number;
}

function periodoOrdinal(r: { anio: number; mes: number }): number {
  return Number(r.anio) * 100 + Number(r.mes);
}

/** Conserva una sola fila por curso: el período (anio/mes) más reciente. */
export function resumenesUltimoMesPorCurso<T extends ResumenCursoPanel>(resumenes: T[]): T[] {
  const byCurso = new Map<number, T>();
  for (const r of resumenes) {
    const anio = Number(r.anio);
    const mes = Number(r.mes);
    if (!anio || !mes) continue;
    const prev = byCurso.get(r.curso_id);
    if (!prev || periodoOrdinal(r) > periodoOrdinal(prev)) {
      byCurso.set(r.curso_id, r);
    }
  }
  return [...byCurso.values()];
}
