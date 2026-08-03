/** Alineado con reportes/consolidado y recalcular_metricas_asistencia. */
export const UMBRAL_INHABILITADO_PCT = 75;
export const UMBRAL_RIESGO_PCT = 80;
export const UMBRAL_FRACCION_CLASES_PARA_EVALUAR = 0.75;

export type EstadoAsistenciaAlumno = 'regular' | 'riesgo' | 'inhabilitado';

export type MetricasModuloCurso = {
  totalClases: number;
  clasesRestantes: number;
  sesionesCerradas: number;
  clasesMinimasParaEvaluar: number;
  puedeEvaluarRiesgo: boolean;
};

function normalizeDate(fecha: string): string {
  return String(fecha ?? '').slice(0, 10);
}

export function contarDiasLectivosModulo(fechaInicio: string, fechaFin: string): number {
  const inicio = normalizeDate(fechaInicio);
  const fin = normalizeDate(fechaFin);
  if (!inicio || !fin || fin < inicio) return 0;
  let count = 0;
  const cursor = new Date(`${inicio}T00:00:00`);
  const end = new Date(`${fin}T00:00:00`);
  while (cursor <= end) {
    const dow = cursor.getDay();
    if (dow >= 1 && dow <= 4) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export function metricasModuloCurso(params: {
  fechaInicio: string;
  fechaFin: string;
  sesiones: Array<{ fecha: string; estado?: string }>;
}): MetricasModuloCurso | null {
  const inicio = normalizeDate(params.fechaInicio);
  const fin = normalizeDate(params.fechaFin);
  if (!inicio || !fin) return null;

  const enRango = (fecha: string) => fecha >= inicio && fecha <= fin;
  const fechasEstandar = new Set<string>();
  const c = new Date(`${inicio}T00:00:00`);
  const end = new Date(`${fin}T00:00:00`);
  while (c <= end) {
    const f = c.toISOString().slice(0, 10);
    const dow = c.getDay();
    if (dow >= 1 && dow <= 4) fechasEstandar.add(f);
    c.setDate(c.getDate() + 1);
  }

  let extras = 0;
  for (const s of params.sesiones) {
    const f = normalizeDate(s.fecha);
    if (!enRango(f) || fechasEstandar.has(f)) continue;
    extras++;
  }

  const totalClases = contarDiasLectivosModulo(inicio, fin) + extras;
  const sesionesCerradas = params.sesiones.filter(
    (s) => enRango(normalizeDate(s.fecha)) && String(s.estado ?? '').toLowerCase() === 'cerrada'
  ).length;
  const clasesMinimasParaEvaluar =
    totalClases > 0 ? Math.ceil(totalClases * UMBRAL_FRACCION_CLASES_PARA_EVALUAR) : 0;

  return {
    totalClases,
    clasesRestantes: Math.max(0, totalClases - sesionesCerradas),
    sesionesCerradas,
    clasesMinimasParaEvaluar,
    puedeEvaluarRiesgo: clasesMinimasParaEvaluar > 0 && sesionesCerradas >= clasesMinimasParaEvaluar,
  };
}

type CeldaAsistencia = {
  estadoAsistencia?: 'presente' | 'ausente' | 'justificada' | null;
  justificada?: boolean;
};

/** Faltas en sesiones cerradas sin marca = falta. */
export function contarFaltasDesdeSesiones(
  celdas: Map<number, CeldaAsistencia>,
  sesiones: Array<{ id: number; estado?: string }>
): number {
  let faltas = 0;
  for (const s of sesiones) {
    if (String(s.estado ?? '').toLowerCase() !== 'cerrada') continue;
    const celda = celdas.get(s.id);
    const ok =
      celda?.estadoAsistencia === 'presente'
      || celda?.estadoAsistencia === 'justificada'
      || Boolean(celda?.justificada);
    if (!ok) faltas++;
  }
  return faltas;
}

export function porcentajeMaximoAlcanzable(
  porcentajeAsistencia: number | null,
  metricas: MetricasModuloCurso | null
): number | null {
  if (!metricas?.totalClases) return porcentajeAsistencia;
  const pct = Number(porcentajeAsistencia ?? 0);
  const creditos = (pct / 100) * metricas.totalClases;
  return Math.min(
    100,
    Number((((creditos + metricas.clasesRestantes) / metricas.totalClases) * 100).toFixed(2))
  );
}

/** Color de fila / estado visual: solo por % (las faltas no influyen). */
export function evaluarEstadoAsistencia(input: {
  porcentajeAsistencia: number | null;
  porcentajeMaximoAlcanzable?: number | null;
  puedeEvaluarRiesgo?: boolean;
}): EstadoAsistenciaAlumno {
  if (input.puedeEvaluarRiesgo === false) return 'regular';

  const pct = Number(input.porcentajeAsistencia ?? 100);
  const pctMax =
    input.porcentajeMaximoAlcanzable != null ? Number(input.porcentajeMaximoAlcanzable) : pct;

  if (pct < UMBRAL_INHABILITADO_PCT || pctMax < UMBRAL_INHABILITADO_PCT) {
    return 'inhabilitado';
  }

  if (pct < UMBRAL_RIESGO_PCT) {
    return 'riesgo';
  }

  return 'regular';
}

/** Hay al menos una fila de asistencia en sesiones cerradas del curso. */
export function tieneAsistenciaRegistrada(sesionesRegistradas: unknown): boolean {
  return Number(sesionesRegistradas ?? 0) > 0;
}

/** Etiqueta de % en fichas/listados; sin sesiones cerradas no se muestra un porcentaje. */
export function etiquetaPorcentajeAsistencia(
  porcentaje: unknown,
  sesionesRegistradas: unknown
): string {
  if (!tieneAsistenciaRegistrada(sesionesRegistradas)) {
    return 'Sin registros';
  }
  return `${Number(porcentaje ?? 0).toFixed(1)}%`;
}

export function descripcionEstadoAsistencia(
  estado: EstadoAsistenciaAlumno,
  input: {
    porcentajeAsistencia: number | null;
    porcentajeMaximoAlcanzable?: number | null;
    puedeEvaluarRiesgo?: boolean;
  }
): string {
  if (input.puedeEvaluarRiesgo === false) {
    return 'Aún no se evalúa riesgo/inhabilitado (faltan listas cerradas del módulo).';
  }
  const pct = Number(input.porcentajeAsistencia ?? 0).toFixed(1);
  const pctMax = Number(input.porcentajeMaximoAlcanzable ?? input.porcentajeAsistencia ?? 0).toFixed(1);

  if (estado === 'inhabilitado') {
    if (Number(input.porcentajeMaximoAlcanzable ?? 100) < UMBRAL_INHABILITADO_PCT) {
      return `Inhabilitado: aunque asista a todo lo restante, máximo ${pctMax}% (mínimo ${UMBRAL_INHABILITADO_PCT}%)`;
    }
    return `Inhabilitado: ${pct}% de asistencia (mínimo ${UMBRAL_INHABILITADO_PCT}%)`;
  }
  if (estado === 'riesgo') {
    return `En riesgo: ${pct}% (necesita ${UMBRAL_RIESGO_PCT}% o más para quedar regular)`;
  }
  return 'Regular';
}
