import type { ResumenCursoPanel } from './panel-resumenes';

export interface FunnelRetencionRow {
  name: string;
  value: number;
  fill: string;
  dropOffAbs: number;
  dropOffPct: number;
}

export interface ScatterAsistenciaRiesgoRow {
  materia: string;
  cursoId: number;
  asistencia: number;
  pctRiesgo: number;
  matriculas: number;
}

export interface CarreraInhabilitadosRow {
  carreraId: number;
  carrera: string;
  pctInhabilitados: number;
  pctAsistencia: number;
  matriculas: number;
}

export interface AsistenciaAlertasMesRow {
  periodoKey: string;
  periodo: string;
  asistencia: number;
  alertas: number;
  matriculas: number;
}

function periodoLabelFromKey(key: string): string {
  const [anioStr, mesStr] = key.split('-');
  return new Date(Number(anioStr), Number(mesStr) - 1, 1).toLocaleDateString('es-AR', {
    month: 'short',
    year: '2-digit',
  });
}

/** Embudo: matrículas → en riesgo → irregulares (snapshot último mes por curso). */
export function buildFunnelRetencionData(resumenesRecientes: ResumenCursoPanel[]): FunnelRetencionRow[] {
  let totalMat = 0;
  let riesgo = 0;
  let irregulares = 0;
  for (const r of resumenesRecientes) {
    totalMat += Number(r.total_matriculas) || 0;
    riesgo += Number(r.alumnos_riesgo) || 0;
    irregulares += Number(r.alumnos_irregulares) || 0;
  }
  if (totalMat <= 0) return [];

  const etapas: Omit<FunnelRetencionRow, 'dropOffAbs' | 'dropOffPct'>[] = [
    { name: 'Matrículas totales', value: totalMat, fill: '#22d3a5' },
    { name: 'En riesgo', value: riesgo, fill: '#f59e0b' },
    { name: 'Irregulares', value: irregulares, fill: '#f43f5e' },
  ];

  return etapas.map((etapa, idx) => {
    if (idx === 0) {
      return { ...etapa, dropOffAbs: 0, dropOffPct: 0 };
    }
    const prev = etapas[idx - 1].value;
    const dropOffAbs = etapa.value;
    const dropOffPct = prev > 0 ? Number(((dropOffAbs / prev) * 100).toFixed(1)) : 0;
    return { ...etapa, dropOffAbs, dropOffPct };
  });
}

/** Un punto por materia (último mes): asistencia vs % en riesgo. */
export function buildScatterAsistenciaRiesgo(
  resumenesRecientes: ResumenCursoPanel[],
  materiaPorCurso: Map<number, string>,
): ScatterAsistenciaRiesgoRow[] {
  const porMateria = new Map<string, ScatterAsistenciaRiesgoRow>();

  for (const r of resumenesRecientes) {
    const total = Number(r.total_matriculas) || 0;
    if (total <= 0) continue;
    const materia = (r.materia ?? materiaPorCurso.get(r.curso_id) ?? `Curso ${r.curso_id}`).trim();
    const key = materia || `curso-${r.curso_id}`;
    const asistencia = Number(r.promedio_asistencia) || 0;
    const pctRiesgo = Number((((Number(r.alumnos_riesgo) || 0) / total) * 100).toFixed(1));

    const prev = porMateria.get(key);
    if (!prev || pctRiesgo >= prev.pctRiesgo) {
      porMateria.set(key, {
        materia: key,
        cursoId: r.curso_id,
        asistencia,
        pctRiesgo,
        matriculas: total,
      });
    }
  }

  return [...porMateria.values()];
}

/** Agregación por carrera: % inhabilitados (último mes por curso). */
export function buildCarreraInhabilitadosData(
  resumenesRecientes: ResumenCursoPanel[],
  cursoCarreraId: Map<number, number>,
  carrerasPorId: Map<number, string>,
): CarreraInhabilitadosRow[] {
  const agg = new Map<
    number,
    { inhabilitados: number; matriculas: number; sumAsistencia: number }
  >();

  for (const r of resumenesRecientes) {
    const carreraId = cursoCarreraId.get(r.curso_id);
    if (carreraId == null) continue;
    const mat = Number(r.total_matriculas) || 0;
    if (mat <= 0) continue;
    const cur = agg.get(carreraId) ?? { inhabilitados: 0, matriculas: 0, sumAsistencia: 0 };
    cur.inhabilitados += Number(r.alumnos_irregulares) || 0;
    cur.matriculas += mat;
    cur.sumAsistencia += (Number(r.promedio_asistencia) || 0) * mat;
    agg.set(carreraId, cur);
  }

  return [...agg.entries()]
    .map(([carreraId, v]) => ({
      carreraId,
      carrera: carrerasPorId.get(carreraId) ?? `Carrera ${carreraId}`,
      pctInhabilitados:
        v.matriculas > 0 ? Number(((v.inhabilitados / v.matriculas) * 100).toFixed(1)) : 0,
      pctAsistencia:
        v.matriculas > 0 ? Number((v.sumAsistencia / v.matriculas).toFixed(1)) : 0,
      matriculas: v.matriculas,
    }))
    .sort((a, b) => b.pctInhabilitados - a.pctInhabilitados || b.matriculas - a.matriculas);
}

export interface AlertaPanelMes {
  generado_en?: string;
  anio?: number;
  mes?: number;
}

function mesKeyFromAlerta(a: AlertaPanelMes): string | null {
  if (a.generado_en) {
    const d = new Date(a.generado_en);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      return `${y}-${String(m).padStart(2, '0')}`;
    }
  }
  const anio = Number(a.anio);
  const mes = Number(a.mes);
  if (anio && mes) return `${anio}-${String(mes).padStart(2, '0')}`;
  return null;
}

/** Cruza asistencia mensual (resúmenes) con volumen de alertas por mes de generación. */
export function buildAsistenciaAlertasMes(
  resumenes: ResumenCursoPanel[],
  alertas: AlertaPanelMes[],
): AsistenciaAlertasMesRow[] {
  const byPeriodo = new Map<string, { sumWeighted: number; matriculas: number; alertas: number }>();

  for (const r of resumenes) {
    const anio = Number(r.anio);
    const mes = Number(r.mes);
    if (!anio || !mes) continue;
    const key = `${anio}-${String(mes).padStart(2, '0')}`;
    const mat = Math.max(0, Number(r.total_matriculas) || 0);
    const prom = Number(r.promedio_asistencia) || 0;
    const cur = byPeriodo.get(key) ?? { sumWeighted: 0, matriculas: 0, alertas: 0 };
    byPeriodo.set(key, {
      sumWeighted: cur.sumWeighted + prom * mat,
      matriculas: cur.matriculas + mat,
      alertas: cur.alertas,
    });
  }

  for (const a of alertas) {
    const key = mesKeyFromAlerta(a);
    if (!key) continue;
    const cur = byPeriodo.get(key) ?? { sumWeighted: 0, matriculas: 0, alertas: 0 };
    byPeriodo.set(key, { ...cur, alertas: cur.alertas + 1 });
  }

  return [...byPeriodo.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([key, v]) => ({
      periodoKey: key,
      periodo: periodoLabelFromKey(key),
      asistencia: v.matriculas > 0 ? Number((v.sumWeighted / v.matriculas).toFixed(1)) : 0,
      alertas: v.alertas,
      matriculas: v.matriculas,
    }));
}
