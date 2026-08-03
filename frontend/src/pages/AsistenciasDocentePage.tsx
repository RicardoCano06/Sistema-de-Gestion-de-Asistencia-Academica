import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from '../utils/toast';
import {
  ACADEMICO_TAB_ACTIVE,
  ACADEMICO_TAB_BASE,
  ACADEMICO_TAB_INACTIVE,
} from '../components/AcademicoSubnav';
import { AppSidebar } from '../components/AppSidebar';
import { AppSelect } from '../components/ui/app-select';
import CronogramaDocenteTab from '../components/CronogramaDocenteTab';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  ASISTENCIAS_CURSO_ID_STORAGE_KEY,
  abrirDocumento,
  apiFetch,
  clearAsistenciasCursoIdPersistido,
  generarYAbrirPdf,
} from '../utils/api';
import {
  contarFaltasDesdeSesiones,
  descripcionEstadoAsistencia,
  evaluarEstadoAsistencia,
  metricasModuloCurso,
  porcentajeMaximoAlcanzable,
  type EstadoAsistenciaAlumno,
  type MetricasModuloCurso,
} from '../utils/estado-asistencia';
import { puedeAprobarJustificaciones } from '../utils/rbac';
import { agruparJustificacionesPorCarga, claveGrupoJustificacionCarga } from '../utils/justificaciones-grupo';



type Sesion = {
  id: number;
  curso_id: number;
  fecha: string;
  estado: string;
  modalidad: 'presencial' | 'virtual';
  observaciones?: string | null;
  cerrado_por?: string | null;
  cerrado_en?: string | null;
};

type PlanillaRow = {
  sesionId: number;
  cursoId: number;
  fecha: string;
  alumno: string;
  matriculaId: number;
  numeroDocumento?: string | null;
  estadoAcademico?: string | null;
  faltasAcumuladas?: number | null;
  porcentajeAsistencia?: number | null;
  estadoAsistencia?: 'presente' | 'ausente' | 'justificada' | null;
  justificada: boolean;
  observaciones?: string | null;
};

// Mapa matriculaId -> sesionId -> PlanillaRow
type PlanillaMatrix = Map<
  number,
  {
    alumno: string;
    documento: string;
    ordenLista: number | null;
    faltasAcumuladas: number;
    porcentajeAsistencia: number | null;
    estadoAcademico: string | null;
    celdas: Map<number, PlanillaRow>;
  }
>;

type PlanillaMatrixEntry = NonNullable<ReturnType<PlanillaMatrix['get']>>;

type ColumnaPlanilla = {
  fecha: string;
  modalidadDefault: 'presencial' | 'virtual';
  sesion: Sesion | null;
  esListaExcepcional: boolean;
};

type PlanillaAsignada = {
  curso_id: number;
  modulo_id: number;
  materia: string;
  /** Semestre curricular del plan (`materias.semestre`). */
  semestre: number;
  carrera: string;
  facultad: string;
  fecha_inicio: string;
  fecha_fin: string;
  estado_modulo: string;
  aula?: string | null;
  horario_inicio?: string | null;
  horario_fin?: string | null;
  notas?: string | null;
  total_matriculas: number;
  docente: string;
  activa_hoy: boolean;
  periodo_label: string;
};

interface ApiList<T> {
  total: number;
  datos: T[];
}

type MetadatosCursoPlanilla = Omit<PlanillaAsignada, 'activa_hoy' | 'periodo_label'>;

/** Respuesta nueva del backend; `curso` es opcional para tolerar despliegues desfasados. */
interface ApiPlanillaResponse {
  curso?: MetadatosCursoPlanilla | null;
  total?: number;
  datos?: Record<string, any>[];
}

function leerCursoIdPersistido(): string {
  try {
    return sessionStorage.getItem(ASISTENCIAS_CURSO_ID_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function esMetadatosCursoPlanillaValidos(valor: unknown): valor is MetadatosCursoPlanilla {
  if (!valor || typeof valor !== 'object') return false;
  const curso = valor as Record<string, unknown>;
  return (
    Number.isFinite(Number(curso.curso_id)) &&
    typeof curso.materia === 'string' &&
    typeof curso.fecha_inicio === 'string' &&
    typeof curso.fecha_fin === 'string'
  );
}

/** Acepta respuesta nueva `{ curso, datos }` o legado `{ total, datos }` sin romper la UI. */
function extraerFilasPlanilla(resp: ApiPlanillaResponse | null | undefined): Record<string, any>[] {
  return Array.isArray(resp?.datos) ? resp.datos : [];
}

function extraerMetadatosCursoPlanilla(
  resp: ApiPlanillaResponse | null | undefined
): MetadatosCursoPlanilla | null {
  return esMetadatosCursoPlanillaValidos(resp?.curso) ? resp.curso : null;
}

function elegirCursoIdPreferido(items: PlanillaAsignada[]): string {
  const preferida = items.find((item) => item.activa_hoy) ?? items[0];
  return preferida ? String(preferida.curso_id) : '';
}

function enriquecerMetadatosCurso(curso: MetadatosCursoPlanilla, fechaReferencia?: string): PlanillaAsignada {
  const hoy = fechaReferencia ?? new Date().toISOString().slice(0, 10);
  const inicio = normalizeDate(curso.fecha_inicio);
  const fin = normalizeDate(curso.fecha_fin);
  return {
    ...curso,
    activa_hoy: inicio <= hoy && hoy <= fin,
    periodo_label: new Date(`${inicio}T00:00:00`).toLocaleDateString('es-AR', {
      month: 'long',
      year: 'numeric',
    }),
  };
}

type JustificacionEstado = 'pendiente' | 'aprobada' | 'rechazada';

interface AusenciaRow {
  asistencia_id: number;
  sesion_id: number;
  fecha: string;
  matricula_id: number;
  alumno: string;
  numero_documento: string;
  estado: string;
  justificada: boolean;
  orden_lista?: number | null;
}

interface JustificacionRow {
  id: number;
  asistencia_id: number;
  motivo: string;
  documento_url?: string | null;
  estado_revision: JustificacionEstado;
  comentarios_revision?: string | null;
  estado_asistencia: string;
  fecha: string;
  curso_id: number;
  materia: string;
  alumno: string;
  matricula_id: number;
}

interface Props {
  onLogout?: () => void;
  roles?: string[];
}

/** Normaliza espacios y comas (formato "Apellidos, Nombres"). */
function formatoNombreLegible(raw: string): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

function normalizeDate(value: string) {
  return String(value).slice(0, 10);
}

/** Primeros 7 caracteres YYYY-MM (para input type="month"). */
function yyyyMmDesdeFecha(iso: string) {
  const s = normalizeDate(iso);
  return s.length >= 7 ? s.slice(0, 7) : s;
}

function clampYyyyMm(val: string, minYm: string, maxYm: string) {
  if (val < minYm) return minYm;
  if (val > maxYm) return maxYm;
  return val;
}

function clampFechaIso(val: string, minD: string, maxD: string) {
  if (val < minD) return minD;
  if (val > maxD) return maxD;
  return val;
}

function etiquetaSemestreCurricularPlanilla(semestre: number | null | undefined): string {
  const n = Number(semestre);
  if (!Number.isFinite(n) || n < 1) return '—';
  return `${Math.trunc(n)}° Semestre`;
}

function formatDateLabel(value?: string | null, long = false) {
  if (!value) return 'Sin fecha';
  const iso = normalizeDate(value);
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!partes) return iso;
  const date = new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
  if (Number.isNaN(date.getTime())) return iso;
  if (long) {
    return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  return date.toLocaleDateString('es-AR');
}

/** Estado efectivo en la sesión abierta (pending + matriz; sin marca = presente por defecto). */
function estadoAsistenciaEnSesion(
  matriculaId: number,
  sesionId: number,
  entry: PlanillaMatrixEntry,
  pendingChanges: Map<string, 'presente' | 'ausente'>
): 'presente' | 'ausente' | 'justificada' {
  const pending = pendingChanges.get(`${matriculaId}:${sesionId}`);
  if (pending) return pending;
  const raw = entry.celdas.get(sesionId)?.estadoAsistencia ?? null;
  if (raw === 'ausente') return 'ausente';
  if (raw === 'justificada') return 'justificada';
  return 'presente';
}

const STICKY_COL_NUM = 36;
const STICKY_COL_CI = 64;
const STICKY_COL_FALTAS = 50;
const STICKY_COL_PCT = 54;
/** Ancho fijo de cada columna de día/sesión (P/A/J); evita solapamiento al achicar el viewport. */
const PLANILLA_SESION_COL_PX = 56;
const PLANILLA_NOMBRE_MIN_PX = 200;
const PLANILLA_NOMBRE_MAX_PX = 720;

type EstadoFilaPlanilla = EstadoAsistenciaAlumno;

function faltasEfectivasAlumno(
  entry: { faltasAcumuladas: number; celdas: Map<number, PlanillaRow> },
  sesionesCurso: Sesion[]
): number {
  const desdePlanilla = contarFaltasDesdeSesiones(entry.celdas, sesionesCurso);
  return Math.max(desdePlanilla, Number(entry.faltasAcumuladas) || 0);
}

function evaluarAlumnoPlanilla(
  entry: {
    faltasAcumuladas: number;
    porcentajeAsistencia: number | null;
    estadoAcademico: string | null;
    celdas: Map<number, PlanillaRow>;
  },
  sesionesCurso: Sesion[],
  metricas: MetricasModuloCurso | null
): { estado: EstadoFilaPlanilla; faltas: number; tooltip: string } {
  const faltas = faltasEfectivasAlumno(entry, sesionesCurso);
  const pctMax = porcentajeMaximoAlcanzable(entry.porcentajeAsistencia, metricas);
  const puedeEvaluarRiesgo = metricas?.puedeEvaluarRiesgo ?? false;
  const estado = evaluarEstadoAsistencia({
    porcentajeAsistencia: entry.porcentajeAsistencia,
    porcentajeMaximoAlcanzable: pctMax,
    puedeEvaluarRiesgo,
  });
  return {
    estado,
    faltas,
    tooltip: descripcionEstadoAsistencia(estado, {
      porcentajeAsistencia: entry.porcentajeAsistencia,
      porcentajeMaximoAlcanzable: pctMax,
      puedeEvaluarRiesgo,
    }),
  };
}

function claseFilaPlanilla(estado: EstadoFilaPlanilla, idx: number): string {
  if (estado === 'inhabilitado') return 'planilla-fila-inhabilitado';
  if (estado === 'riesgo') return 'planilla-fila-riesgo';
  return idx % 2 === 0 ? 'planilla-fila-regular-par' : 'planilla-fila-regular-impar';
}

/** Pestaña Justificaciones activa — ámbar del panel de inicio (Secretaría Académica). */
const JUSTIF_TAB_ACTIVE =
  'border-amber-400/80 text-amber-800 dark:text-amber-100 bg-amber-50 dark:bg-amber-500/15';

/** Paneles del módulo justificaciones: blanco en claro, azul oscuro en dark (como referencia UI). */
const JUSTIF_PANEL_CLASS =
  'min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-[#132a52] dark:shadow-none';

/** Cabecera interna de cada panel (Nueva justificación / Historial). */
const JUSTIF_PANEL_HEADER_CLASS =
  'flex min-w-0 flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 max-lg:py-4 dark:border-slate-800 dark:bg-[#132a52] lg:flex-row lg:items-center lg:justify-between';

/** Tabla historial escritorio — thead y filas. */
const JUSTIF_TABLE_HEAD_CLASS =
  'sticky top-0 z-10 bg-slate-50 text-slate-700 dark:bg-[#0d1b2e] dark:text-[#f0f4f8]';

const JUSTIF_TABLE_ROW_CLASS =
  'border-t border-slate-200 align-top hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-[#0d1b2e]/40';

/** Campos del formulario de justificaciones (claro/oscuro, todos los breakpoints). */
const JUSTIF_FIELD_CLASS =
  'rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 dark:border-slate-600 dark:bg-[#0b2147] dark:text-[#e7eef9] dark:placeholder:text-slate-500';

const JUSTIF_ALUMNO_ITEM_SELECTED =
  'border-primary/50 bg-primary/10 ring-1 ring-primary/25 shadow-sm dark:bg-primary/15';

const JUSTIF_ALUMNO_ITEM_IDLE =
  'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/60 dark:bg-[#0d1b2e] dark:hover:border-slate-500 dark:hover:bg-[#132a52]';

const JUSTIF_DIAS_PANEL_CLASS =
  'rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700/60 dark:bg-[#0d1b2e]';

const JUSTIF_DAY_CHIP_CHECKED =
  'border-primary bg-primary/10 text-slate-900 dark:bg-primary/20 dark:text-[#e7eef9]';

const JUSTIF_DAY_CHIP_IDLE =
  'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200';

const JUSTIF_FALTAS_BADGE_CLASS =
  'inline-flex shrink-0 items-center rounded-md border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 shadow-sm dark:border-rose-500/45 dark:bg-rose-950/70 dark:text-rose-300 dark:shadow-none';

function claseBadgeEstadoJustificacion(estado: JustificacionEstado): string {
  if (estado === 'aprobada') {
    return 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300';
  }
  if (estado === 'rechazada') {
    return 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300';
  }
  return 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-amber-300';
}

const PLANILLA_KPI_ITEMS = [
  {
    key: 'matriculas',
    label: 'Matrículas',
    color: 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300',
  },
  {
    key: 'sesiones',
    label: 'Sesiones del mes',
    color: 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300',
  },
  {
    key: 'riesgo',
    label: 'En riesgo',
    color: 'border-amber-300 text-amber-700 dark:border-amber-500/40 dark:text-[#ef8001]',
  },
  {
    key: 'inhabilitados',
    label: 'Inhabilitados',
    color: 'border-rose-300 text-rose-700 dark:border-rose-500/40 dark:text-rose-300',
  },
] as const;

function PlanillaDiaCeldaMovil({
  col,
  matriculaId,
  entry,
  sesionActivaId,
  getEstadoSiguiente,
  onRegistrar,
}: {
  col: ColumnaPlanilla;
  matriculaId: number;
  entry: PlanillaMatrixEntry;
  sesionActivaId: number | null;
  getEstadoSiguiente: (estado: 'presente' | 'ausente' | 'justificada' | null) => 'presente' | 'ausente';
  onRegistrar: (matriculaId: number, sesionId: number, estado: 'presente' | 'ausente') => void;
}) {
  const s = col.sesion;
  const f = new Date(`${col.fecha}T00:00:00`);
  const etiquetaDia = f.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' });
  const esActiva = s ? sesionActivaId === s.id : false;
  const dimmed = sesionActivaId !== null && !esActiva;
  const cerrada = s ? s.estado.toLowerCase() === 'cerrada' : false;
  const celda = s ? entry.celdas.get(s.id) : undefined;
  const estado = celda?.estadoAsistencia ?? null;
  const editable = Boolean(s && sesionActivaId !== null && esActiva && !cerrada && estado !== 'justificada');
  const pointerStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const swipeTriggeredRef = useRef(false);
  const resetSwipe = () => {
    pointerStartRef.current = null;
    swipeTriggeredRef.current = false;
  };

  if (!s) {
    return (
      <div
        className={`flex w-11 shrink-0 flex-col items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-0.5 py-1.5 dark:border-slate-700 dark:bg-[#0e1a30] ${dimmed ? 'opacity-40' : ''}`}
        title="Día lectivo sin sesión"
      >
        <span className="text-[9px] font-medium uppercase text-slate-600">{etiquetaDia}</span>
        <span className="text-slate-600 text-[10px] font-black">—</span>
      </div>
    );
  }

  const siguiente = getEstadoSiguiente(estado);
  const cellLabel = estado === 'presente' ? 'P' : estado === 'ausente' ? 'A' : estado === 'justificada' ? 'J' : '—';
  const badgeCerrada =
    estado === 'presente'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-400 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/40'
      : estado === 'ausente'
        ? 'bg-rose-100 text-rose-800 border-rose-400 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/40'
        : estado === 'justificada'
          ? 'bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/40'
          : 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800/70 dark:text-slate-300 dark:border-slate-600';

  return (
    <div
      className={`flex w-11 shrink-0 flex-col items-center gap-1 rounded-lg border px-0.5 py-1.5 ${
        esActiva
          ? 'border-primary/50 bg-primary/10'
          : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-[#0e1a30]'
      } ${dimmed ? 'opacity-45' : ''}`}
    >
      <span className={`text-[9px] font-semibold uppercase ${esActiva ? 'text-primary' : 'text-slate-500'}`}>
        {etiquetaDia}
      </span>
      {!editable ? (
        estado === null ? (
          <span className="text-slate-600 text-[10px] font-black">—</span>
        ) : (
          <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border text-sm font-bold ${badgeCerrada}`}>
            {cellLabel}
          </span>
        )
      ) : (
        <button
          type="button"
          title={`Marcar ${siguiente === 'presente' ? 'presente' : 'ausente'}`}
          // Permite scroll vertical mientras detectamos swipe horizontal.
          className={`touch-pan-y inline-flex h-9 w-9 items-center justify-center rounded-lg font-black transition-transform active:scale-95 ${
            estado === 'presente'
              ? 'border bg-emerald-100 text-emerald-700 border-emerald-400 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/40'
              : estado === 'ausente'
                ? 'border bg-rose-100 text-rose-700 border-rose-400 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/40'
                : 'border-0 bg-transparent text-lg text-slate-500 dark:text-slate-600'
          }`}
          onPointerDown={(e) => {
            pointerStartRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
            swipeTriggeredRef.current = false;
          }}
          onPointerCancel={resetSwipe}
          onPointerUp={resetSwipe}
          onPointerMove={(e) => {
            const start = pointerStartRef.current;
            if (!start || start.pointerId !== e.pointerId) return;
            if (swipeTriggeredRef.current) return;

            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            const absX = Math.abs(dx);
            const absY = Math.abs(dy);

            // Swipe horizontal deliberado (evita interferir con scroll vertical)
            if (absX < 28 || absX <= absY) return;

            const target = dx > 0 ? ('presente' as const) : ('ausente' as const);
            if (estado === target) {
              swipeTriggeredRef.current = true;
              return;
            }
            swipeTriggeredRef.current = true;
            onRegistrar(matriculaId, s.id, target);
          }}
          onClick={() => onRegistrar(matriculaId, s.id, siguiente)}
        >
          {estado === 'presente' ? 'P' : estado === 'ausente' ? 'A' : '—'}
        </button>
      )}
    </div>
  );
}

/** Fracción del ancho de la tarjeta que hay que deslizar para confirmar P/A (solo al soltar). */
const SWIPE_UMBRAL_FRACCION = 0.55;

function PlanillaAlumnoSwipeCardMovil({
  matriculaId,
  idx,
  entry,
  sesion,
  estado,
  onMarcar,
}: {
  matriculaId: number;
  idx: number;
  entry: PlanillaMatrixEntry;
  sesion: Sesion;
  estado: 'presente' | 'ausente' | 'justificada' | null;
  onMarcar: (matriculaId: number, estado: 'presente' | 'ausente') => void;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const dragXRef = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const maxDragRef = useRef(340);
  const umbralRef = useRef(160);
  const axisRef = useRef<'none' | 'x' | 'y'>('none');

  useLayoutEffect(() => {
    const medir = () => {
      const w = containerRef.current?.offsetWidth ?? 340;
      maxDragRef.current = Math.max(280, Math.round(w * 0.92));
      umbralRef.current = Math.max(130, Math.round(maxDragRef.current * SWIPE_UMBRAL_FRACCION));
    };
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, []);

  const cerrada = sesion.estado?.toLowerCase?.() === 'cerrada';
  const canSwipe = !cerrada && estado !== 'justificada';

  const abs = Math.abs(dragX);
  const umbralActual = umbralRef.current;
  const intensidadTinte = Math.min(1, abs / Math.max(umbralActual, 1));
  const listoParaConfirmar = abs >= umbralActual;
  const tintePresente = dragX > 0;
  const tinteAusente = dragX < 0;

  const resetDrag = useCallback(() => {
    setDragX(0);
    dragXRef.current = 0;
    setDragging(false);
    startRef.current = null;
    axisRef.current = 'none';
  }, []);

  const aplicarMarca = useCallback(
    (target: 'presente' | 'ausente') => {
      if (!canSwipe || estado === target) {
        resetDrag();
        return;
      }
      onMarcar(matriculaId, target);
      resetDrag();
    },
    [canSwipe, estado, matriculaId, onMarcar, resetDrag]
  );

  const onMove = useCallback(
    (clientX: number, clientY: number, preventScroll: () => void) => {
      const start = startRef.current;
      if (!start || !canSwipe) return;

      const dx = clientX - start.x;
      const dy = clientY - start.y;

      if (axisRef.current === 'none') {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx) * 1.05) {
          axisRef.current = 'y';
          setDragging(false);
          startRef.current = null;
          return;
        }
        axisRef.current = 'x';
      }
      if (axisRef.current === 'y') return;

      preventScroll();
      const max = maxDragRef.current;
      const clamped = Math.max(-max, Math.min(max, dx));
      dragXRef.current = clamped;
      setDragX(clamped);
    },
    [canSwipe]
  );

  const onEnd = useCallback(() => {
    if (!canSwipe) return;
    const finalX = dragXRef.current;
    const umbral = umbralRef.current;
    if (Math.abs(finalX) >= umbral) {
      aplicarMarca(finalX > 0 ? 'presente' : 'ausente');
      return;
    }
    resetDrag();
  }, [aplicarMarca, canSwipe, resetDrag]);

  const onMoveRef = useRef(onMove);
  const onEndRef = useRef(onEnd);
  onMoveRef.current = onMove;
  onEndRef.current = onEnd;

  useEffect(() => {
    const el = cardRef.current;
    if (!el || !canSwipe) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startRef.current = { x: t.clientX, y: t.clientY };
      axisRef.current = 'none';
      setDragging(true);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      onMoveRef.current(t.clientX, t.clientY, () => e.preventDefault());
    };

    const onTouchEnd = () => {
      if (axisRef.current === 'y') {
        resetDrag();
        return;
      }
      onEndRef.current();
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [canSwipe, resetDrag]);

  const insigniaEstado =
    estado === 'presente'
      ? {
          letra: 'P',
          etiqueta: 'Presente',
          caja: 'bg-emerald-50 ring-1 ring-emerald-300 dark:bg-emerald-500/15 dark:ring-emerald-400/45',
          letraCls: 'text-emerald-700 dark:text-emerald-200',
          etiquetaCls: 'text-emerald-600 dark:text-emerald-400/90',
        }
      : estado === 'ausente'
        ? {
            letra: 'A',
            etiqueta: 'Ausente',
            caja: 'bg-rose-50 ring-1 ring-rose-300 dark:bg-rose-500/15 dark:ring-rose-400/45',
            letraCls: 'text-rose-700 dark:text-rose-200',
            etiquetaCls: 'text-rose-600 dark:text-rose-400/90',
          }
        : estado === 'justificada'
          ? {
              letra: 'J',
              etiqueta: 'Justif.',
              caja: 'bg-amber-50 ring-1 ring-amber-300 dark:bg-amber-500/15 dark:ring-amber-400/45',
              letraCls: 'text-amber-800 dark:text-amber-200',
              etiquetaCls: 'text-amber-700 dark:text-amber-400/90',
            }
          : {
              letra: '—',
              etiqueta: 'Sin marcar',
              caja: 'bg-slate-100 ring-1 ring-slate-300 dark:bg-slate-800/60 dark:ring-slate-600/50',
              letraCls: 'text-slate-500',
              etiquetaCls: 'text-slate-500',
            };

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[#0f1a30]"
    >
      {tinteAusente ? (
        <div
          className={`absolute inset-0 z-0 transition-colors ${
            listoParaConfirmar
              ? 'bg-gradient-to-r from-rose-600 via-rose-500 to-rose-600/40'
              : 'bg-gradient-to-r from-rose-700/90 via-rose-600/70 to-transparent'
          }`}
          style={{ opacity: 0.45 + intensidadTinte * 0.55 }}
          aria-hidden
        />
      ) : null}
      {tintePresente ? (
        <div
          className={`absolute inset-0 z-0 transition-colors ${
            listoParaConfirmar
              ? 'bg-gradient-to-l from-emerald-600 via-emerald-500 to-emerald-600/40'
              : 'bg-gradient-to-l from-emerald-700/90 via-emerald-600/70 to-transparent'
          }`}
          style={{ opacity: 0.45 + intensidadTinte * 0.55 }}
          aria-hidden
        />
      ) : null}

      <div
        ref={cardRef}
        className={`relative z-10 rounded-2xl bg-white px-4 py-4 transition-[transform,border-color] select-none dark:bg-[#0f1a30] ${
          dragging ? 'duration-0' : 'duration-200'
        } ${
          listoParaConfirmar && tinteAusente
            ? 'ring-2 ring-rose-400/60 ring-inset'
            : listoParaConfirmar && tintePresente
              ? 'ring-2 ring-emerald-400/60 ring-inset'
              : ''
        }`}
        style={{
          transform: `translateX(${dragX}px)`,
          touchAction: 'pan-y',
        }}
        onPointerDown={(e) => {
          if (!canSwipe || e.pointerType === 'touch') return;
          startRef.current = { x: e.clientX, y: e.clientY };
          axisRef.current = 'none';
          setDragging(true);
          cardRef.current?.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!canSwipe || e.pointerType === 'touch') return;
          onMove(e.clientX, e.clientY, () => e.preventDefault());
        }}
        onPointerUp={(e) => {
          if (!canSwipe || e.pointerType === 'touch') return;
          try {
            cardRef.current?.releasePointerCapture?.(e.pointerId);
          } catch {
            /* ya liberado */
          }
          onEnd();
        }}
        onPointerCancel={(e) => {
          if (e.pointerType === 'touch') return;
          resetDrag();
        }}
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold tabular-nums text-slate-600 dark:bg-slate-800/90 dark:text-slate-400">
            {entry.ordenLista ?? idx + 1}
          </span>

          <div className="relative min-w-0 flex-1 pr-[4.75rem]">
            <div
              className={`absolute right-0 top-0 flex flex-col items-center justify-center rounded-xl px-2 py-1.5 ${insigniaEstado.caja}`}
              aria-label={insigniaEstado.etiqueta}
            >
              <span className={`text-xl font-black leading-none ${insigniaEstado.letraCls}`}>{insigniaEstado.letra}</span>
              <span
                className={`mt-0.5 max-w-[4rem] text-center text-[8px] font-semibold uppercase leading-tight tracking-wide ${insigniaEstado.etiquetaCls}`}
              >
                {insigniaEstado.etiqueta}
              </span>
            </div>

            <p className="text-[15px] font-semibold leading-snug text-slate-900 [overflow-wrap:anywhere] dark:text-[#e8eef8]">
              {formatoNombreLegible(entry.alumno)}
            </p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-500">CI {entry.documento || '—'}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] tabular-nums text-slate-600 dark:bg-slate-800/70 dark:text-slate-400">
                {entry.porcentajeAsistencia != null ? `${entry.porcentajeAsistencia}% asist.` : '—% asist.'}
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] tabular-nums text-slate-600 dark:bg-slate-800/70 dark:text-slate-400">
                {entry.faltasAcumuladas ?? 0} faltas
              </span>
              {cerrada ? (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800/50 dark:text-slate-600">
                  Lista cerrada
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {!canSwipe ? (
          <p className="mt-3 border-t border-slate-200 pt-2.5 text-center text-[11px] text-slate-500 dark:border-slate-800/80 dark:text-slate-600">
            {cerrada ? 'No se puede modificar: lista cerrada.' : 'No se puede deslizar: estado justificado.'}
          </p>
        ) : (
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200 pt-2.5 text-[10px] font-medium uppercase tracking-wide dark:border-slate-800/80">
            <span className="text-rose-600 dark:text-rose-400/85">← Ausente</span>
            <span className="material-symbols-outlined text-[15px] text-slate-400 dark:text-slate-600" aria-hidden>
              swipe
            </span>
            <span className="text-emerald-600 dark:text-emerald-400/85">Presente →</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function AsistenciasDocentePage({ onLogout, roles = [] }: Props) {
  const mostrarModuloJustificaciones = true;
  const puedeResolverJustificaciones = puedeAprobarJustificaciones(roles);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    if (!sidebarOpen) {
      document.documentElement.classList.remove('mobile-sidebar-open');
      return;
    }
    document.documentElement.classList.add('mobile-sidebar-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const desktopMq = window.matchMedia('(min-width: 1024px)');
    let prevOverflow = '';
    if (!desktopMq.matches) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      if (!desktopMq.matches) {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, [sidebarOpen]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)');
    const onChange = () => setViewportEsMovil(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);

    // Intentar disparar resize múltiples veces para asegurar que los componentes
    // que dependen de medidas del viewport (como la planilla o zonas de scroll)
    // se recalculen después de que el DOM y el CSS se hayan estabilizado.
    const timers = [0, 100, 500].map(ms => setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, ms));

    return () => {
      mq.removeEventListener('change', onChange);
      timers.forEach(clearTimeout);
    };
  }, []);

  const [subView, setSubView] = useState<'planilla' | 'cronograma' | 'justificaciones'>('planilla');
  const [planillasAsignadas, setPlanillasAsignadas] = useState<PlanillaAsignada[]>([]);
  const [planillasLoading, setPlanillasLoading] = useState(false);
  const [planillasError, setPlanillasError] = useState<string | null>(null);
  const [cursoId, setCursoId] = useState(leerCursoIdPersistido);
  const [metadatosCursoPlanilla, setMetadatosCursoPlanilla] = useState<MetadatosCursoPlanilla | null>(null);

  // Selector de mes (YYYY-MM)
  const [mesAnio, setMesAnio] = useState(() => {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  });

  const [sesiones, setSesiones] = useState<Sesion[]>([]);
  const [planillaMatrix, setPlanillaMatrix] = useState<PlanillaMatrix>(new Map());
  const [loading, setLoading] = useState(false);
  const [generandoPdfLegal, setGenerandoPdfLegal] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Map<string, 'presente' | 'ausente'>>(new Map());
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [nuevaSesionFecha, setNuevaSesionFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [nuevaSesionModalidad, setNuevaSesionModalidad] = useState<'presencial' | 'virtual'>('presencial');
  const [creandoSesion, setCreandoSesion] = useState(false);
  const [cerrandoSesionId, setCerrandoSesionId] = useState<number | null>(null);
  const [cancelandoSesionId, setCancelandoSesionId] = useState<number | null>(null);
  const [cerrarListaModalOpen, setCerrarListaModalOpen] = useState(false);
  const [sesionActivaId, setSesionActivaId] = useState<number | null>(null);
  const [justificaciones, setJustificaciones] = useState<JustificacionRow[]>([]);
  const [justificacionesLoading, setJustificacionesLoading] = useState(false);
  const [resolviendoId, setResolviendoId] = useState<number | null>(null);
  const [justificacionEstado, setJustificacionEstado] = useState<'' | JustificacionEstado>('pendiente');
  const [comentariosRevision, setComentariosRevision] = useState<Record<number, string>>({});
  const [cambiandoModalidad, setCambiandoModalidad] = useState(false);
  const [sesionModalidad, setSesionModalidad] = useState<Record<number, 'presencial' | 'virtual'>>({});
  const [ausencias, setAusencias] = useState<AusenciaRow[]>([]);
  const [ausenciasLoading, setAusenciasLoading] = useState(false);
  const [justifAlumnoBusqueda, setJustifAlumnoBusqueda] = useState('');
  const [justifAlumnoSeleccionado, setJustifAlumnoSeleccionado] = useState<number | null>(null);
  const [justifDiasSeleccionados, setJustifDiasSeleccionados] = useState<string[]>([]);
  const [ausenciasError, setAusenciasError] = useState<string | null>(null);
  const [justifMotivo, setJustifMotivo] = useState('');
  const [justifArchivo, setJustifArchivo] = useState<File | null>(null);
  const [subiendoJustif, setSubiendoJustif] = useState(false);
  const [mostrarFormJustif, setMostrarFormJustif] = useState(false);
  const [viewportEsMovil, setViewportEsMovil] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches,
  );
  const listaAbiertaSyncKeyRef = useRef<string | null>(null);

  const planillaSeleccionada = useMemo(() => {
    const fromList = planillasAsignadas.find((item) => String(item.curso_id) === cursoId) ?? null;
    if (metadatosCursoPlanilla && String(metadatosCursoPlanilla.curso_id) === cursoId) {
      const fromPlanilla = enriquecerMetadatosCurso(metadatosCursoPlanilla);
      return fromList ? { ...fromList, ...fromPlanilla } : fromPlanilla;
    }
    return fromList;
  }, [cursoId, planillasAsignadas, metadatosCursoPlanilla]);

  const metricasModulo = useMemo(() => {
    if (!planillaSeleccionada) return null;
    return metricasModuloCurso({
      fechaInicio: planillaSeleccionada.fecha_inicio,
      fechaFin: planillaSeleccionada.fecha_fin,
      sesiones: sesiones.map((s) => ({ fecha: s.fecha, estado: s.estado })),
    });
  }, [planillaSeleccionada, sesiones]);

  const resumen = useMemo(() => {
    let presentes = 0;
    let ausentes = 0;
    let justificados = 0;
    let enRiesgo = 0;
    let inhabilitados = 0;
    let total = 0;
    const puedeEvaluar = metricasModulo?.puedeEvaluarRiesgo ?? false;
    for (const entry of planillaMatrix.values()) {
      total++;
      const { estado } = evaluarAlumnoPlanilla(entry, sesiones, metricasModulo);
      if (puedeEvaluar) {
        if (estado === 'inhabilitado') inhabilitados++;
        else if (estado === 'riesgo') enRiesgo++;
      }
      const hoy = new Date().toISOString().slice(0, 10);
      const sesionHoy = sesiones.find((s) => normalizeDate(s.fecha) === hoy);
      if (sesionHoy) {
        const celda = entry.celdas.get(sesionHoy.id);
        if (celda?.estadoAsistencia === 'presente') presentes++;
        else if (celda?.estadoAsistencia === 'ausente') ausentes++;
        else if (celda?.estadoAsistencia === 'justificada') justificados++;
      }
    }
    return {
      presentes,
      ausentes,
      justificados,
      enRiesgo,
      inhabilitados,
      total,
      puedeEvaluarRiesgo: puedeEvaluar,
      evaluacionPendiente: metricasModulo != null && !puedeEvaluar,
    };
  }, [planillaMatrix, sesiones, metricasModulo]);

  /** Meses (YYYY-MM) dentro del módulo del curso seleccionado — el docente no puede tomar lista fuera de ese rango. */
  const rangoMesModulo = useMemo(() => {
    if (!planillaSeleccionada?.fecha_inicio || !planillaSeleccionada?.fecha_fin) return null;
    const minYm = yyyyMmDesdeFecha(planillaSeleccionada.fecha_inicio);
    const maxYm = yyyyMmDesdeFecha(planillaSeleccionada.fecha_fin);
    if (minYm > maxYm) return { min: maxYm, max: minYm };
    return { min: minYm, max: maxYm };
  }, [planillaSeleccionada?.fecha_inicio, planillaSeleccionada?.fecha_fin]);

  // Sesiones del mes seleccionado
  const sesionesDelMes = useMemo(() => {
    const [anio, mes] = mesAnio.split('-').map(Number);
    return sesiones
      .filter((s) => {
        const f = new Date(`${normalizeDate(s.fecha)}T00:00:00`);
        return f.getFullYear() === anio && f.getMonth() + 1 === mes;
      })
      .sort((a, b) => normalizeDate(a.fecha).localeCompare(normalizeDate(b.fecha)));
  }, [sesiones, mesAnio]);

  /** Sesión abierta en edición: mientras exista, no se puede volver a «Tomar lista». */
  const sesionListaAbierta = useMemo(() => {
    if (sesionActivaId) {
      return sesionesDelMes.find((s) => s.id === sesionActivaId && s.estado.toLowerCase() !== 'cerrada') ?? null;
    }
    return [...sesionesDelMes].reverse().find((s) => s.estado.toLowerCase() !== 'cerrada') ?? null;
  }, [sesionActivaId, sesionesDelMes]);

  const resumenCierreLista = useMemo(() => {
    if (!sesionListaAbierta) return null;
    const sesionId = sesionListaAbierta.id;
    let presentes = 0;
    let ausentes = 0;
    const alumnosAusentes: { matriculaId: number; nombre: string }[] = [];
    for (const [matriculaId, entry] of planillaMatrix) {
      const estado = estadoAsistenciaEnSesion(matriculaId, sesionId, entry, pendingChanges);
      if (estado === 'ausente') {
        ausentes += 1;
        alumnosAusentes.push({ matriculaId, nombre: entry.alumno });
      } else {
        presentes += 1;
      }
    }
    alumnosAusentes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    return { presentes, ausentes, alumnosAusentes };
  }, [sesionListaAbierta, planillaMatrix, pendingChanges]);

  // Todos los días lectivos (Lun–Jue) del mes seleccionado, acotados al rango del módulo
  const diasLectivosDelMes = useMemo(() => {
    const [anio, mes] = mesAnio.split('-').map(Number);
    const diasEnMes = new Date(anio, mes, 0).getDate();
    const fechaInicio = planillaSeleccionada ? normalizeDate(planillaSeleccionada.fecha_inicio) : null;
    const fechaFin    = planillaSeleccionada ? normalizeDate(planillaSeleccionada.fecha_fin)    : null;
    const dias: { fecha: string; modalidadDefault: 'presencial' | 'virtual' }[] = [];
    for (let d = 1; d <= diasEnMes; d++) {
      const fecha = `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (fechaInicio && fecha < fechaInicio) continue;
      if (fechaFin    && fecha > fechaFin)    continue;
      const diaSemana = new Date(`${fecha}T00:00:00`).getDay();
      if (diaSemana >= 1 && diaSemana <= 4) {
        dias.push({ fecha, modalidadDefault: 'presencial' });
      }
    }
    return dias;
  }, [mesAnio, planillaSeleccionada]);

  // Días fijos Lun–Jue + columnas extra por sesiones en fechas no estándar (mismo mes, orden cronológico)
  const columnasDelMes = useMemo((): ColumnaPlanilla[] => {
    const fechasEstandar = new Set(diasLectivosDelMes.map((d) => d.fecha));
    const fechaInicio = planillaSeleccionada ? normalizeDate(planillaSeleccionada.fecha_inicio) : null;
    const fechaFin = planillaSeleccionada ? normalizeDate(planillaSeleccionada.fecha_fin) : null;
    const enRangoModulo = (fecha: string) => {
      if (fechaInicio && fecha < fechaInicio) return false;
      if (fechaFin && fecha > fechaFin) return false;
      return true;
    };

    const base: ColumnaPlanilla[] = diasLectivosDelMes.map((dia) => {
      const sesion = sesionesDelMes.find((s) => normalizeDate(s.fecha) === dia.fecha) ?? null;
      return { ...dia, sesion, esListaExcepcional: false };
    });

    const extras: ColumnaPlanilla[] = [];
    for (const s of sesionesDelMes) {
      const f = normalizeDate(s.fecha);
      if (fechasEstandar.has(f)) continue;
      if (!enRangoModulo(f)) continue;
      extras.push({
        fecha: f,
        modalidadDefault: s.modalidad ?? 'presencial',
        sesion: s,
        esListaExcepcional: true,
      });
    }

    return [...base, ...extras].sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [diasLectivosDelMes, sesionesDelMes, planillaSeleccionada]);

  // Filas de la tabla (orden de importación / matrícula; fallback alfabético)
  const alumnosOrdenados = useMemo(() => {
    return [...planillaMatrix.entries()].sort(([, a], [, b]) => {
      const oa = a.ordenLista ?? Number.MAX_SAFE_INTEGER;
      const ob = b.ordenLista ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      return a.alumno.localeCompare(b.alumno, 'es');
    });
  }, [planillaMatrix]);

  const sesionActiva = useMemo(() => {
    if (!sesionActivaId) return null;
    return sesiones.find((s) => s.id === sesionActivaId) ?? null;
  }, [sesiones, sesionActivaId]);

  /** Sesión en toma de lista (solo si no está cerrada; persiste tras recargar). */
  const sesionMovilLista = useMemo(() => {
    const candidata = sesionActiva ?? sesionListaAbierta;
    if (!candidata || candidata.estado?.toLowerCase?.() === 'cerrada') return null;
    return candidata;
  }, [sesionActiva, sesionListaAbierta]);

  // Móvil: mismo orden alfabético que la planilla (sin reordenar al marcar P/A)
  const alumnosOrdenadosMovil = alumnosOrdenados;

  const planillaNombreMedirRef = useRef<HTMLSpanElement>(null);
  const [planillaNombreColPx, setPlanillaNombreColPx] = useState(260);

  const longestNombrePlanilla = useMemo(() => {
    let best = 'Apellidos y Nombres';
    for (const [, e] of alumnosOrdenados) {
      const t = formatoNombreLegible(e.alumno);
      if (t.length > best.length) best = t;
    }
    return best;
  }, [alumnosOrdenados]);

  const stickyPlanillaLeft = useMemo(() => {
    const afterNombre = STICKY_COL_NUM + planillaNombreColPx;
    return {
      ci: afterNombre,
      faltas: afterNombre + STICKY_COL_CI,
      pct: afterNombre + STICKY_COL_CI + STICKY_COL_FALTAS,
      nombreW: planillaNombreColPx,
    };
  }, [planillaNombreColPx]);

  const anchoMinPlanillaTabla = useMemo(
    () =>
      STICKY_COL_NUM +
      planillaNombreColPx +
      STICKY_COL_CI +
      STICKY_COL_FALTAS +
      STICKY_COL_PCT +
      columnasDelMes.length * PLANILLA_SESION_COL_PX,
    [planillaNombreColPx, columnasDelMes.length]
  );

  useLayoutEffect(() => {
    if (!cursoId) return;
    const el = planillaNombreMedirRef.current;
    if (!el) return;

    let raf = 0;
    const runMeasure = () => {
      const w = Math.ceil(el.getBoundingClientRect().width) + 40;
      setPlanillaNombreColPx(Math.min(PLANILLA_NOMBRE_MAX_PX, Math.max(PLANILLA_NOMBRE_MIN_PX, w)));
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(runMeasure);
      });
    };

    schedule();
    const ro = new ResizeObserver(() => schedule());
    ro.observe(el);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [longestNombrePlanilla, cursoId, loading]);

  // alumnosConAusencias: un entry por alumno con todas sus ausencias sin justificar
  const alumnosConAusencias = useMemo(() => {
    const map = new Map<number, { matriculaId: number; alumno: string; documento: string; ordenLista?: number | null; dias: AusenciaRow[] }>();
    for (const a of ausencias) {
      if (!map.has(a.matricula_id)) {
        map.set(a.matricula_id, {
          matriculaId: a.matricula_id,
          alumno: a.alumno,
          documento: a.numero_documento,
          ordenLista: a.orden_lista,
          dias: [],
        });
      }
      map.get(a.matricula_id)!.dias.push(a);
    }
    return Array.from(map.values()).sort((a, b) => {
      const oa = a.ordenLista ?? Number.MAX_SAFE_INTEGER;
      const ob = b.ordenLista ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      return a.alumno.localeCompare(b.alumno, 'es');
    });
  }, [ausencias]);

  const alumnosFiltrados = useMemo(() => {
    const q = justifAlumnoBusqueda.trim().toLowerCase();
    if (!q) return alumnosConAusencias;
    return alumnosConAusencias.filter(
      (a) => a.alumno.toLowerCase().includes(q) || a.documento.toLowerCase().includes(q)
    );
  }, [alumnosConAusencias, justifAlumnoBusqueda]);

  const cargarPlanillasAsignadas = useCallback(async () => {
    setPlanillasLoading(true);
    setPlanillasError(null);
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const resp = await apiFetch<ApiList<PlanillaAsignada>>(
        `/asistencias/mis-planillas?fecha=${encodeURIComponent(hoy)}`
      );
      const items = resp?.datos ?? [];
      setPlanillasAsignadas(items);
      setCursoId((prev) => {
        if (prev && items.some((item) => String(item.curso_id) === prev)) return prev;
        return elegirCursoIdPreferido(items);
      });
      if (!items.length) { setSesiones([]); setPlanillaMatrix(new Map()); setPendingChanges(new Map()); }
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'No se pudieron cargar las planillas';
      setPlanillasAsignadas([]); setCursoId(''); setSesiones([]); setPlanillaMatrix(new Map()); setPendingChanges(new Map());
      setPlanillasError(mensaje);
    } finally {
      setPlanillasLoading(false);
    }
  }, []);

  // Carga todas las sesiones + planilla completa del curso (sin filtro de fecha)
  const cargarPlanillaMes = useCallback(async () => {
    const cursoNum = Number(cursoId);
    if (!cursoId || Number.isNaN(cursoNum)) return;
    setLoading(true);
    setSessionError(null);
    try {
      const [sesionesResp, planillaResp, alumnosResp] = await Promise.all([
        apiFetch<ApiList<Sesion>>(`/asistencias/sesiones?cursoId=${cursoNum}`),
        apiFetch<ApiPlanillaResponse>(`/asistencias/planilla?cursoId=${cursoNum}`),
        apiFetch<ApiList<Record<string, any>>>(`/asistencias/alumnos-curso?cursoId=${cursoNum}`),
      ]);
      const metadatosCurso = extraerMetadatosCursoPlanilla(planillaResp);
      setMetadatosCursoPlanilla(metadatosCurso);
      const todasSesiones = sesionesResp?.datos ?? [];
      setSesiones(todasSesiones);
      // Modalidades
      const mod: Record<number, 'presencial' | 'virtual'> = {};
      for (const s of todasSesiones) mod[s.id] = s.modalidad ?? 'presencial';
      setSesionModalidad(mod);
      // Construir matrix sembrando primero con todos los alumnos matriculados
      const matrix: PlanillaMatrix = new Map();
      for (const al of (alumnosResp?.datos ?? [])) {
        matrix.set(Number(al.matricula_id), {
          alumno: al.alumno ?? 'Alumno sin nombre',
          documento: al.numero_documento ?? '',
          ordenLista: al.orden_lista != null ? Number(al.orden_lista) : null,
          faltasAcumuladas: Number(al.faltas_acumuladas) || 0,
          porcentajeAsistencia: al.porcentaje_asistencia != null ? Number(al.porcentaje_asistencia) : null,
          estadoAcademico: al.estado_academico ?? null,
          celdas: new Map(),
        });
      }
      // Superponer datos de sesiones sobre el matrix (nuevo formato agregado)
      for (const alumno of extraerFilasPlanilla(planillaResp)) {
        const mid = Number(alumno.matricula_id);
        const entry = matrix.get(mid);
        if (!entry) continue;
        entry.faltasAcumuladas = Number(alumno.faltas_acumuladas) || 0;
        entry.porcentajeAsistencia = alumno.porcentaje_asistencia != null ? Number(alumno.porcentaje_asistencia) : null;
        if (alumno.estado_academico) entry.estadoAcademico = alumno.estado_academico;
        if (!entry.alumno || entry.alumno === 'Alumno sin nombre') entry.alumno = alumno.alumno;
        if (entry.ordenLista == null && alumno.orden_lista != null) {
          entry.ordenLista = Number(alumno.orden_lista);
        }
        for (const ses of (alumno.sesiones ?? [])) {
          entry.celdas.set(ses.sesion_id, {
            sesionId: ses.sesion_id,
            cursoId: cursoNum,
            fecha: ses.fecha,
            alumno: entry.alumno,
            matriculaId: mid,
            estadoAsistencia: ses.estado_asistencia,
            justificada: Boolean(ses.justificada),
            observaciones: ses.observaciones ?? null,
          });
        }
      }
      setPlanillaMatrix(matrix);
      setPendingChanges(new Map());
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'No se pudo cargar la planilla';
      setSessionError(mensaje);
      toast.error(mensaje);
      setMetadatosCursoPlanilla(null);
      setSesiones([]);
      setPlanillaMatrix(new Map());
      setPendingChanges(new Map());
    } finally {
      setLoading(false);
    }
  }, [cursoId]);

  const handleCursoIdChange = useCallback((value: string) => {
    setSessionError(null);
    setCursoId(value);
  }, []);

  const handleRegistrar = useCallback(
    (matriculaId: number, sesionId: number, estado: 'presente' | 'ausente') => {
      const key = `${matriculaId}:${sesionId}`;
      setPlanillaMatrix((prev) => {
        const entry = prev.get(matriculaId);
        if (!entry) return prev;
        const celda = entry.celdas.get(sesionId) ?? {
          sesionId,
          cursoId: Number(cursoId),
          fecha: '',
          alumno: entry.alumno,
          matriculaId,
          justificada: false,
        };
        const newCeldas = new Map(entry.celdas);
        newCeldas.set(sesionId, { ...celda, estadoAsistencia: estado, justificada: false });
        const next = new Map(prev);
        next.set(matriculaId, { ...entry, celdas: newCeldas });
        return next;
      });
      setPendingChanges((prev) => {
        const next = new Map(prev);
        next.set(key, estado);
        return next;
      });
    },
    [cursoId]
  );

  const guardarCambiosLote = useCallback(async () => {
    if (!pendingChanges.size) return;

    const bySesion = new Map<number, Array<{ matriculaId: number; estado: 'presente' | 'ausente' }>>();
    for (const [key, estado] of pendingChanges) {
      const [matStr, sesStr] = key.split(':');
      const matriculaId = Number(matStr);
      const sesionId = Number(sesStr);
      let arr = bySesion.get(sesionId);
      if (!arr) { arr = []; bySesion.set(sesionId, arr); }
      arr.push({ matriculaId, estado });
    }

    for (const [sesionId, registros] of bySesion) {
      await apiFetch('/asistencias/registro-lote', {
        method: 'POST',
        body: JSON.stringify({
          sesionId,
          registros: registros.map((r) => ({
            matriculaId: r.matriculaId,
            estado: r.estado,
            justificada: false,
          })),
        }),
      });
    }

    setPendingChanges(new Map());
  }, [pendingChanges]);

  const descargarPlanillaLegal = useCallback(async () => {
    const cursoNum = Number(cursoId);
    if (!cursoId || Number.isNaN(cursoNum)) {
      toast.error('Selecciona un curso para generar la planilla legal.');
      return;
    }

    setGenerandoPdfLegal(true);
    try {
      await generarYAbrirPdf('/reportes/actas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cursoId: cursoNum,
          tipoActa: 'pdf_legal',
          periodo: mesAnio,
        }),
      });
      toast.success('Planilla legal generada correctamente.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo generar la planilla legal');
    } finally {
      setGenerandoPdfLegal(false);
    }
  }, [cursoId, mesAnio]);

  const getEstadoSiguiente = useCallback((estadoActual: 'presente' | 'ausente' | 'justificada' | null) => {
    if (estadoActual === 'presente') return 'ausente' as const;
    return 'presente' as const;
  }, []);

  const cargarJustificaciones = useCallback(async () => {
    if (!cursoId) {
      setJustificaciones([]);
      return;
    }

    const estadoQuery = justificacionEstado ? `&estado=${encodeURIComponent(justificacionEstado)}` : '';
    const cursoQuery = cursoId ? `cursoId=${Number(cursoId)}` : '';
    const qs = [cursoQuery, estadoQuery.slice(1)].filter(Boolean).join('&');
    const endpoint = qs ? `/asistencias/justificaciones?${qs}` : '/asistencias/justificaciones';

    setJustificacionesLoading(true);
    try {
      const resp = await apiFetch<ApiList<JustificacionRow>>(endpoint);
      setJustificaciones(resp?.datos ?? []);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'No se pudo listar justificaciones';
      toast.error(mensaje);
      setJustificaciones([]);
    } finally {
      setJustificacionesLoading(false);
    }
  }, [cursoId, justificacionEstado]);

  const resolver = useCallback(
    async (justificacionId: number, accion: 'aprobar' | 'rechazar') => {
      setResolviendoId(justificacionId);
      try {
        await apiFetch(`/asistencias/justificaciones/${justificacionId}/resolucion`, {
          method: 'POST',
          body: JSON.stringify({
            accion,
            comentarios: comentariosRevision[justificacionId]?.trim() || undefined,
          }),
        });
        toast.success(`Justificación ${accion === 'aprobar' ? 'aprobada' : 'rechazada'}`);
        await cargarJustificaciones();
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : 'No se pudo resolver la justificación';
        toast.error(mensaje);
      } finally {
        setResolviendoId(null);
      }
    },
    [cargarJustificaciones, comentariosRevision]
  );

  const cambiarModalidad = useCallback(
    async (sesionId: number, nueva: 'presencial' | 'virtual') => {
      const s = sesiones.find((x) => x.id === sesionId);
      if (!s) {
        toast.error('Sesión no encontrada.');
        return;
      }
      if (s.estado.toLowerCase() === 'cerrada') {
        toast.error('La jornada está cerrada; no se puede cambiar la modalidad.');
        return;
      }
      setCambiandoModalidad(true);
      try {
        const actualizada = await apiFetch<Sesion>(`/asistencias/sesiones/${sesionId}/modalidad`, {
          method: 'PATCH',
          body: JSON.stringify({ modalidad: nueva }),
        });
        setSesiones((prev) => prev.map((x) => x.id === sesionId ? actualizada : x));
        setSesionModalidad((prev) => ({ ...prev, [sesionId]: nueva }));
        toast.success(`Modalidad cambiada a ${nueva === 'virtual' ? 'Virtual' : 'Presencial'}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'No se pudo cambiar la modalidad');
      } finally {
        setCambiandoModalidad(false);
      }
    },
    [sesiones]
  );

  const cerrarSesionById = useCallback(async (sesionId: number) => {
    const s = sesiones.find((x) => x.id === sesionId);
    if (!s || s.estado.toLowerCase() === 'cerrada') { toast.error('La sesión ya está cerrada.'); return; }
    setCerrandoSesionId(sesionId);
    try {
      await guardarCambiosLote();
      const cerrada = await apiFetch<
        Sesion & {
          matriculas?: Array<{
            matricula_id: number;
            porcentaje_asistencia: string | number;
            faltas_acumuladas: number;
            estado_academico: string;
          }>;
        }
      >(`/asistencias/sesiones/${sesionId}/cierre`, { method: 'POST' });
      const { matriculas, ...sesion } = cerrada;
      setSesiones((prev) => prev.map((x) => x.id === sesionId ? sesion : x));
      listaAbiertaSyncKeyRef.current = null;
      setSesionActivaId((prev) => prev === sesionId ? null : prev);
      if (matriculas?.length) {
        setPlanillaMatrix((prev) => {
          const next = new Map(prev);
          for (const m of matriculas) {
            const entry = next.get(Number(m.matricula_id));
            if (!entry) continue;
            entry.porcentajeAsistencia =
              m.porcentaje_asistencia != null ? Number(m.porcentaje_asistencia) : null;
            entry.faltasAcumuladas = Number(m.faltas_acumuladas) || 0;
            if (m.estado_academico) entry.estadoAcademico = m.estado_academico;
          }
          return next;
        });
      }
      toast.success('Lista cerrada. Se actualizó el porcentaje del curso.');
      await cargarPlanillaMes();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cerrar la jornada');
    } finally {
      setCerrandoSesionId(null);
    }
  }, [sesiones, cargarPlanillaMes, guardarCambiosLote]);

  const confirmarCierreLista = useCallback(async () => {
    if (!sesionListaAbierta) return;
    await cerrarSesionById(sesionListaAbierta.id);
  }, [sesionListaAbierta, cerrarSesionById]);

  const anularSesion = useCallback(async (sesionId: number) => {
    setCancelandoSesionId(sesionId);
    try {
      const resultado = await apiFetch<{
        sesionId: number;
        cursoId: number;
        matriculas?: Array<{
          matricula_id: number;
          porcentaje_asistencia: string | number;
          faltas_acumuladas: number;
          estado_academico: string;
        }>;
      }>(`/asistencias/sesiones/${sesionId}/anular`, { method: 'POST' });
      setSesiones((prev) => prev.filter((x) => x.id !== sesionId));
      listaAbiertaSyncKeyRef.current = null;
      setSesionActivaId(null);
      if (resultado.matriculas?.length) {
        setPlanillaMatrix((prev) => {
          const next = new Map(prev);
          for (const m of resultado.matriculas!) {
            const entry = next.get(Number(m.matricula_id));
            if (!entry) continue;
            entry.porcentajeAsistencia =
              m.porcentaje_asistencia != null ? Number(m.porcentaje_asistencia) : null;
            entry.faltasAcumuladas = Number(m.faltas_acumuladas) || 0;
            if (m.estado_academico) entry.estadoAcademico = m.estado_academico;
          }
          return next;
        });
      }
      toast.success('Sesión descartada. Podés crear una nueva en la fecha correcta.');
      await cargarPlanillaMes();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo descartar la sesión');
    } finally {
      setCancelandoSesionId(null);
    }
  }, [cargarPlanillaMes]);

  useEffect(() => {
    if (!sesionListaAbierta) setCerrarListaModalOpen(false);
  }, [sesionListaAbierta]);

  const cargarAusencias = useCallback(async (cId: string) => {
    if (!cId) { setAusencias([]); setAusenciasError(null); return; }
    setAusenciasLoading(true);
    setAusenciasError(null);
    try {
      const resp = await apiFetch<ApiList<AusenciaRow>>(`/asistencias/ausentes?cursoId=${Number(cId)}`);
      setAusencias(resp?.datos ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron cargar las ausencias';
      setAusenciasError(msg);
      setAusencias([]);
      toast.error(msg);
    } finally {
      setAusenciasLoading(false);
    }
  }, []);

  const enviarJustificacion = useCallback(async () => {
    if (!justifDiasSeleccionados.length || !justifMotivo.trim() || !justifArchivo) {
      toast.error('Selecciona al menos un día, completa el motivo y adjunta un PDF.');
      return;
    }
    setSubiendoJustif(true);
    try {
      // 1. Subir el archivo una sola vez (apiFetch renueva token y reintenta si expiró)
      const formData = new FormData();
      formData.append('archivo', justifArchivo);
      const { url } = await apiFetch<{ url: string }>('/asistencias/justificaciones/upload', {
        method: 'POST',
        body: formData,
      });

      // 2. Registrar una justificación por cada día seleccionado
      for (const diaKey of justifDiasSeleccionados) {
        const [sesionId, matriculaId] = diaKey.split(':').map(Number);
        // buscar asistencia_id si existe (puede ser null para filas sin registro)
        const ausenciaRow = ausencias.find((a) => a.sesion_id === sesionId && a.matricula_id === matriculaId);
        const body = ausenciaRow?.asistencia_id
          ? { asistenciaId: ausenciaRow.asistencia_id, motivo: justifMotivo.trim(), documentoUrl: url }
          : { sesionId, matriculaId, motivo: justifMotivo.trim(), documentoUrl: url };
        await apiFetch('/asistencias/justificaciones', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }

      toast.success(`${justifDiasSeleccionados.length} justificación/es registradas correctamente.`);
      setMostrarFormJustif(false);
      setJustifAlumnoBusqueda('');
      setJustifAlumnoSeleccionado(null);
      setJustifDiasSeleccionados([]);
      setJustifMotivo('');
      setJustifArchivo(null);
      await cargarAusencias(cursoId);
      await cargarJustificaciones();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar la justificación');
    } finally {
      setSubiendoJustif(false);
    }
  }, [justifDiasSeleccionados, justifMotivo, justifArchivo, cursoId, cargarAusencias, cargarJustificaciones]);

  useEffect(() => {
    void cargarPlanillasAsignadas();
  }, [cargarPlanillasAsignadas]);

  useEffect(() => {
    try {
      if (cursoId) sessionStorage.setItem(ASISTENCIAS_CURSO_ID_STORAGE_KEY, cursoId);
      else sessionStorage.removeItem(ASISTENCIAS_CURSO_ID_STORAGE_KEY);
    } catch {
      /* sessionStorage no disponible */
    }
  }, [cursoId]);

  useEffect(() => {
    if (!mostrarModuloJustificaciones && subView === 'justificaciones') {
      setSubView('planilla');
    }
  }, [mostrarModuloJustificaciones, subView]);

  useEffect(() => {
    if (subView !== 'planilla' || !cursoId) return;
    void cargarPlanillaMes();
  }, [cursoId, subView, cargarPlanillaMes]);

  /** Recuperación ante cursoId persistido huérfano (curso eliminado, desasignado o IDs migrados). */
  useEffect(() => {
    if (planillasLoading || !cursoId || !planillasAsignadas.length) return;
    if (planillasAsignadas.some((item) => String(item.curso_id) === cursoId)) return;
    clearAsistenciasCursoIdPersistido();
    setSessionError(null);
    setMetadatosCursoPlanilla(null);
    setSesiones([]);
    setPlanillaMatrix(new Map());
    setPendingChanges(new Map());
    setCursoId(elegirCursoIdPreferido(planillasAsignadas));
  }, [cursoId, planillasAsignadas, planillasLoading]);

  useEffect(() => {
    listaAbiertaSyncKeyRef.current = null;
  }, [cursoId]);

  /** Tras cargar datos: si hay lista abierta, modo «Tomar lista» (sin re-ejecutar en bucle). */
  useEffect(() => {
    if (!cursoId || loading || subView !== 'planilla') return;

    const abierta =
      [...sesiones].reverse().find((s) => s.estado?.toLowerCase?.() !== 'cerrada') ?? null;

    const syncKey = abierta ? `${cursoId}:${abierta.id}` : `${cursoId}:none`;
    if (listaAbiertaSyncKeyRef.current === syncKey) return;
    listaAbiertaSyncKeyRef.current = syncKey;

    if (!abierta) {
      setSesionActivaId(null);
      return;
    }

    const mesSesion = normalizeDate(abierta.fecha).slice(0, 7);
    setMesAnio((prev) => (prev === mesSesion ? prev : mesSesion));
    setSesionActivaId(abierta.id);
  }, [cursoId, loading, subView, sesiones]);

  useEffect(() => {
    if (subView !== 'justificaciones') {
      return;
    }
    void cargarJustificaciones();
    if (cursoId) void cargarAusencias(cursoId);
  }, [subView, cargarJustificaciones, cargarAusencias, cursoId]);

  // Pre-llenar la fecha y el mes con la fecha planificada del módulo (acotado al rango del módulo)
  useEffect(() => {
    if (!planillaSeleccionada) return;
    const hoy = new Date().toISOString().slice(0, 10);
    const inicio = normalizeDate(planillaSeleccionada.fecha_inicio);
    const fin = normalizeDate(planillaSeleccionada.fecha_fin);
    let fechaDefault = inicio > hoy ? inicio : hoy;
    fechaDefault = clampFechaIso(fechaDefault, inicio, fin);
    setNuevaSesionFecha(fechaDefault);
    const minYm = yyyyMmDesdeFecha(inicio);
    const maxYm = yyyyMmDesdeFecha(fin);
    const rMin = minYm <= maxYm ? minYm : maxYm;
    const rMax = minYm <= maxYm ? maxYm : minYm;
    const hayListaAbierta = sesiones.some((s) => s.estado?.toLowerCase?.() !== 'cerrada');
    if (!hayListaAbierta) {
      const ym = fechaDefault.slice(0, 7);
      setMesAnio(clampYyyyMm(ym, rMin, rMax));
    }
  }, [planillaSeleccionada?.curso_id, planillaSeleccionada?.fecha_inicio, planillaSeleccionada?.fecha_fin, sesiones]);

  /** Si el mes quedó fuera del módulo (p. ej. datos del curso se actualizaron), lo acota. */
  useEffect(() => {
    if (!rangoMesModulo) return;
    setMesAnio((prev) => {
      const next = clampYyyyMm(prev, rangoMesModulo.min, rangoMesModulo.max);
      return next === prev ? prev : next;
    });
  }, [rangoMesModulo?.min, rangoMesModulo?.max]);


  return (
    <div className="system-bg app-shell-viewport overflow-hidden text-slate-800 dark:text-[#e7eef9]">
      <div className="app-layout-row">
        {sidebarOpen ? (
          <div
            className="app-sidebar-scrim"
            onClick={() => setSidebarOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSidebarOpen(false);
            }}
            role="button"
            tabIndex={-1}
            aria-label="Cerrar menú"
          />
        ) : null}

        <AppSidebar sidebarOpen={sidebarOpen} onLogout={onLogout} onClose={() => setSidebarOpen(false)} />

        <main className="app-layout-main">
          {cursoId ? (
            <span
              ref={planillaNombreMedirRef}
              className="pointer-events-none fixed top-0 left-0 z-0 translate-x-[120vw] text-sm font-medium px-3 whitespace-nowrap opacity-0"
              aria-hidden
            >
              {longestNombrePlanilla}
            </span>
          ) : null}
          <header className="flex min-h-16 flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-md dark:border-slate-800 dark:bg-[#132a52]/90 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                type="button"
                className="app-menu-toggle text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                onClick={() => setSidebarOpen((open) => !open)}
                aria-label={sidebarOpen ? 'Cerrar menú' : 'Abrir menú'}
                aria-expanded={sidebarOpen}
              >
                <span className="material-symbols-outlined">menu</span>
              </button>
              <span className="material-symbols-outlined shrink-0 text-blue-600 dark:text-[#6b8bc3]">fact_check</span>
              <div className="min-w-0">
                <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Control de asistencia</p>
                <h1 className="text-xl font-semibold leading-snug max-lg:text-base max-lg:whitespace-nowrap">
                  {subView === 'planilla' || !mostrarModuloJustificaciones ? (
                    'Planilla de Asistencia'
                  ) : (
                    'Justificaciones'
                  )}
                </h1>
              </div>
            </div>
          </header>

          <section className="justif-movil-scroll-section app-scroll-content flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6 max-lg:bg-background-light dark:max-lg:bg-[#0d1830] xl:overflow-hidden">
            <nav
              className={`grid w-full min-w-0 flex-shrink-0 gap-2 pb-0.5 max-md:gap-1.5 md:flex md:max-w-full md:flex-nowrap md:items-center md:overflow-x-auto md:overflow-visible ${
                mostrarModuloJustificaciones ? 'grid-cols-3' : 'grid-cols-2'
              }`}
              aria-label="Secciones de asistencias"
            >
              <button
                type="button"
                onClick={() => setSubView('planilla')}
                className={`${ACADEMICO_TAB_BASE} ${
                  subView === 'planilla' ? ACADEMICO_TAB_ACTIVE : ACADEMICO_TAB_INACTIVE
                }`}
              >
                <span className="material-symbols-outlined shrink-0 text-base max-md:hidden">fact_check</span>
                Planilla de Asistencia
              </button>
              <button
            type="button"
            onClick={() => setSubView('cronograma')}
            className={`${ACADEMICO_TAB_BASE} ${
              subView === 'cronograma' ? ACADEMICO_TAB_ACTIVE : ACADEMICO_TAB_INACTIVE
            }`}
          >
            <span className="material-symbols-outlined shrink-0 text-base max-md:hidden">calendar_month</span>
            Cronograma de Cátedra
          </button>
          {mostrarModuloJustificaciones ? (
                <button
                  type="button"
                  onClick={() => setSubView('justificaciones')}
                  className={`${ACADEMICO_TAB_BASE} ${
                    subView === 'justificaciones' ? JUSTIF_TAB_ACTIVE : ACADEMICO_TAB_INACTIVE
                  }`}
                >
                  <span className="material-symbols-outlined shrink-0 text-base max-md:hidden">pending_actions</span>
                  Justificaciones
                </button>
              ) : null}
            </nav>

            {subView === 'planilla' ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden max-lg:flex-none max-lg:overflow-visible">

            {/* Barra + KPI: scroll propio en móvil para no competir con la planilla */}
            <div className="relative flex min-w-0 shrink-0 flex-col gap-4">
            <div className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#132a52]">
              <div className="layout-toolbar flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 w-full flex-1 lg:min-w-[12rem]">
                  <p className="text-xs uppercase text-slate-400">Planilla de asistencia</p>
                  <h2 className="text-lg font-semibold leading-snug break-words">{planillaSeleccionada?.materia ?? 'Selecciona un curso'}</h2>
                  {planillaSeleccionada ? (
                    <p className="text-xs text-slate-400 leading-relaxed break-words">
                      {planillaSeleccionada.carrera} · {planillaSeleccionada.total_matriculas} alumnos
                      {' · '}
                      {etiquetaSemestreCurricularPlanilla(planillaSeleccionada.semestre)}
                    </p>
                  ) : null}
                </div>
                <div className="layout-toolbar relative z-10 flex w-full min-w-0 shrink-0 flex-col gap-2 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end">
                  {/* Selector de curso */}
                  <AppSelect
                    className="w-full min-w-0 lg:min-w-[12rem] lg:w-auto"
                    aria-label="Seleccionar curso"
                    value={cursoId}
                    onChange={handleCursoIdChange}
                    disabled={planillasLoading && !planillasAsignadas.length}
                    loading={planillasLoading}
                    placeholder="Seleccionar curso"
                    options={planillasAsignadas.map((item) => ({
                      value: String(item.curso_id),
                      label: item.materia,
                    }))}
                    triggerClassName="w-full py-2 pl-3 pr-3 rounded-lg border border-slate-300 bg-white text-sm text-black dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                  />
                  {/* Selector de mes */}
                  <input
                    type="month"
                    aria-label="Mes y año"
                    title="Solo meses dentro del dictado del módulo"
                    className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50 dark:border-slate-700 dark:bg-[#132a52] dark:text-[#e7eef9] lg:w-auto"
                    value={mesAnio}
                    min={rangoMesModulo?.min}
                    max={rangoMesModulo?.max}
                    disabled={!cursoId || !rangoMesModulo}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      setMesAnio(rangoMesModulo ? clampYyyyMm(v, rangoMesModulo.min, rangoMesModulo.max) : v);
                    }}
                  />
                  <div className="btn-mobile-stack flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:items-center">
                    <button
                      type="button"
                      className="btn-modern btn-modern-ghost btn-modern-sm btn-mobile-cta flex w-full items-center justify-center lg:w-auto"
                      onClick={() => void cargarPlanillaMes()}
                      disabled={loading || !cursoId}
                    >
                      <span className="material-symbols-outlined text-[16px]">refresh</span>
                      {loading ? 'Cargando...' : 'Actualizar'}
                    </button>
                    <button
                      type="button"
                      className="btn-modern btn-modern-ghost btn-modern-sm btn-mobile-cta flex w-full items-center justify-center lg:w-auto"
                      onClick={() => void descargarPlanillaLegal()}
                      disabled={generandoPdfLegal || !cursoId}
                      title="Generar y abrir planilla legal PDF del mes seleccionado"
                    >
                      <span className="material-symbols-outlined text-[16px]">print</span>
                      {generandoPdfLegal ? 'Generando PDF...' : 'Imprimir planilla legal'}
                    </button>
                  </div>
                </div>
              </div>

              {!planillasLoading && !planillasError && planillasAsignadas.length === 0 ? (
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-6 text-center">
                  <span className="material-symbols-outlined text-[40px] text-amber-300/90">event_busy</span>
                  <p className="mt-2 text-sm font-medium text-slate-900 dark:text-[#e7eef9]">No hay planillas</p>
                  <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
                    Si deberías ver cursos, confirmá con secretaría o coordinación académica que tengas planillas registradas.
                  </p>
                </div>
              ) : null}

              {/* Nueva sesión */}
              <div className="layout-toolbar flex min-w-0 flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-800/60 lg:flex-row lg:flex-wrap lg:items-center">
                <span className="w-full shrink-0 text-xs font-medium text-slate-600 dark:text-slate-500 lg:w-auto">Nueva sesión:</span>
                <input
                  type="date"
                  aria-label="Fecha de nueva sesión"
                  title="Solo fechas dentro del dictado del módulo (Domingos deshabilitados)"
                  className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 dark:border-slate-700 dark:bg-[#132a52] dark:text-[#e7eef9] lg:w-auto [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  value={nuevaSesionFecha}
                  min={planillaSeleccionada ? normalizeDate(planillaSeleccionada.fecha_inicio) : undefined}
                  max={planillaSeleccionada ? normalizeDate(planillaSeleccionada.fecha_fin) : undefined}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) {
                      setNuevaSesionFecha('');
                      return;
                    }

                    // Bloqueo estricto de domingos (Day 0)
                    const [y, m, d] = v.split('-').map(Number);
                    const fechaEval = new Date(Date.UTC(y, m - 1, d));
                    if (fechaEval.getUTCDay() === 0) {
                      toast.error('Día no permitido', {
                        description: 'Las sesiones de clase no se pueden dictar los domingos.',
                      });
                      return;
                    }

                    if (!planillaSeleccionada) {
                      setNuevaSesionFecha(v);
                      return;
                    }
                    const lo = normalizeDate(planillaSeleccionada.fecha_inicio);
                    const hi = normalizeDate(planillaSeleccionada.fecha_fin);
                    setNuevaSesionFecha(clampFechaIso(v, lo, hi));
                  }}
                />
                {/* Selector Presencial / Virtual */}
                <div className="inline-flex w-full max-w-full min-w-0 justify-center overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600 lg:w-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setNuevaSesionModalidad('presencial');
                      if (sesionActivaId) {
                        const act = sesiones.find((x) => x.id === sesionActivaId);
                        if (act && act.estado.toLowerCase() !== 'cerrada') {
                          void cambiarModalidad(sesionActivaId, 'presencial');
                        }
                      }
                    }}
                    className={`inline-flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-none max-lg:min-h-11 max-lg:text-sm lg:flex-none ${
                      nuevaSesionModalidad === 'presencial'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">location_on</span>
                    Presencial
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNuevaSesionModalidad('virtual');
                      if (sesionActivaId) {
                        const act = sesiones.find((x) => x.id === sesionActivaId);
                        if (act && act.estado.toLowerCase() !== 'cerrada') {
                          void cambiarModalidad(sesionActivaId, 'virtual');
                        }
                      }
                    }}
                    className={`inline-flex flex-1 items-center justify-center gap-1.5 border-l border-slate-300 px-3 py-1.5 text-xs font-bold transition-none max-lg:min-h-11 max-lg:text-sm dark:border-slate-600 lg:flex-none ${
                      nuevaSesionModalidad === 'virtual'
                        ? 'bg-violet-500 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">videocam</span>
                    Virtual
                  </button>
                </div>
                <button
                  type="button"
                  className="btn-modern btn-modern-primary btn-modern-sm btn-mobile-cta flex w-full items-center justify-center lg:w-auto"
                  disabled={creandoSesion || !cursoId || !nuevaSesionFecha || !!sesionListaAbierta}
                  title={
                    sesionListaAbierta
                      ? 'Hay una lista abierta. Usá «Revisar y Cerrar Lista» antes de tomar otra sesión.'
                      : undefined
                  }
                  onClick={async () => {
                    if (!cursoId || !nuevaSesionFecha) return;
                    const existente = sesionesDelMes.find(
                      (s) => normalizeDate(s.fecha) === normalizeDate(nuevaSesionFecha)
                    );
                    if (existente) {
                      if (existente.estado.toLowerCase() === 'cerrada') {
                        toast.error('La lista de ese día ya está cerrada', {
                          description: `Ya registraste y cerraste la lista del ${formatDateLabel(existente.fecha, true)}. Elegí otra fecha para tomar asistencia.`,
                        });
                        return;
                      }
                      listaAbiertaSyncKeyRef.current = null;
                      setSesionActivaId(existente.id);
                      toast.success('Sesión reanudada. Podés seguir marcando asistencia.');
                      void cargarPlanillaMes();
                      return;
                    }
                    setCreandoSesion(true);
                    try {
                      const nuevaSesion = await apiFetch<Sesion>('/asistencias/sesiones', {
                        method: 'POST',
                        body: JSON.stringify({ cursoId: Number(cursoId), fecha: nuevaSesionFecha, modalidad: nuevaSesionModalidad }),
                      });
                      toast.success('Sesión creada. Todos presentes por defecto; marcá solo ausentes.');
                      setSesiones((prev) => [...prev, nuevaSesion]);
                      listaAbiertaSyncKeyRef.current = null;
                      setSesionActivaId(nuevaSesion.id);
                      void cargarPlanillaMes();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'No se pudo crear la sesión');
                    } finally {
                      setCreandoSesion(false);
                    }
                  }}
                >
                  {creandoSesion ? 'Creando...' : 'Tomar lista'}
                </button>

                {sesionListaAbierta ? (
                  <>
                    <button
                      type="button"
                      className="btn-modern btn-modern-sm btn-mobile-cta flex w-full items-center justify-center gap-1.5 border-0 bg-rose-600 font-semibold text-white shadow-md hover:bg-rose-500 lg:w-auto"
                      disabled={cerrandoSesionId === sesionListaAbierta.id || cancelandoSesionId === sesionListaAbierta.id}
                      onClick={() => setCerrarListaModalOpen(true)}
                    >
                      <span className="material-symbols-outlined text-[16px]">fact_check</span>
                      {cerrandoSesionId === sesionListaAbierta.id ? 'Cerrando...' : 'Revisar y Cerrar Lista'}
                    </button>
                    <button
                      type="button"
                      className="btn-modern btn-modern-ghost btn-modern-sm btn-mobile-cta flex w-full items-center justify-center gap-1.5 border border-red-400/50 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-950/30 lg:w-auto"
                      disabled={cerrandoSesionId === sesionListaAbierta.id || cancelandoSesionId != null}
                      title="Elimina la sesión y todos sus registros de asistencia para poder crear una nueva con la fecha correcta"
                      onClick={() => {
                        if (sesionListaAbierta) {
                          void anularSesion(sesionListaAbierta.id);
                        }
                      }}
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                      {cancelandoSesionId === sesionListaAbierta.id ? 'Descartando...' : 'Descartar Sesión'}
                    </button>
                  </>
                ) : null}
              </div>

              <Dialog
                open={cerrarListaModalOpen && !!sesionListaAbierta}
                onOpenChange={(open) => {
                  if (!open && cerrandoSesionId == null) setCerrarListaModalOpen(false);
                }}
              >
                <DialogContent className="flex max-h-[min(92dvh,calc(100vh-1.5rem))] max-w-md flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl dark:border-slate-600/40 dark:bg-gradient-to-b dark:from-[#162d55] dark:to-[#0f2244] dark:text-[#e7eef9] max-md:overflow-hidden">
                  <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-5 pb-4 pt-5 sm:px-6 dark:border-white/10 dark:bg-[#0c1a32]/90">
                    <DialogHeader className="space-y-2 text-left">
                      <DialogTitle className="text-lg font-semibold text-slate-900 dark:text-white">
                        Revisar y cerrar lista
                      </DialogTitle>
                      <DialogDescription className="text-sm text-slate-600 dark:text-slate-300">
                        Confirmá el resumen de asistencia antes de cerrar la jornada. Podés volver para seguir editando.
                      </DialogDescription>
                    </DialogHeader>
                  </div>

                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain px-5 py-5 sm:px-6 [-webkit-overflow-scrolling:touch]">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-white/10 dark:bg-[#0a162c]/80">
                      <dl className="grid gap-2.5">
                        <div>
                          <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Curso</dt>
                          <dd className="mt-0.5 font-medium leading-snug text-slate-900 dark:text-slate-100">
                            {planillaSeleccionada?.materia ?? '—'}
                          </dd>
                          {planillaSeleccionada ? (
                            <dd className="text-xs text-slate-500 dark:text-slate-400">{planillaSeleccionada.carrera}</dd>
                          ) : null}
                        </div>
                        <div>
                          <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Fecha de la lista</dt>
                          <dd className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">
                            {sesionListaAbierta ? formatDateLabel(sesionListaAbierta.fecha, true) : '—'}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="flex flex-wrap gap-3 text-sm">
                      <p className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                        <span className="material-symbols-outlined text-[18px]">check_circle</span>
                        Presentes: {resumenCierreLista?.presentes ?? 0}
                      </p>
                      <p className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-medium text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                        <span className="material-symbols-outlined text-[18px]">cancel</span>
                        Ausentes: {resumenCierreLista?.ausentes ?? 0}
                      </p>
                    </div>

                    {(resumenCierreLista?.ausentes ?? 0) > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Alumnos ausentes</p>
                        <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-600/50 dark:bg-[#071222]">
                          <ul className="flex flex-wrap gap-2">
                            {resumenCierreLista?.alumnosAusentes.map((al) => (
                              <li key={al.matriculaId}>
                                <span className="inline-flex max-w-full items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-900 dark:border-rose-500/35 dark:bg-rose-500/15 dark:text-rose-100">
                                  {al.nombre}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ) : (
                      <p className="rounded-xl border border-emerald-200/80 bg-emerald-50/80 px-3 py-2.5 text-sm font-medium text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200">
                        Asistencia completa — Sin alumnos ausentes
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:px-6 dark:border-white/10 dark:bg-[#0f2244]">
                    <div className="btn-mobile-stack flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                      <button
                        type="button"
                        className="btn-modern btn-modern-ghost btn-mobile-cta lg:h-10 lg:min-h-0 lg:w-auto"
                        onClick={() => setCerrarListaModalOpen(false)}
                        disabled={cerrandoSesionId != null}
                      >
                        Volver
                      </button>
                      <button
                        type="button"
                        className="btn-modern btn-modern-sm btn-mobile-cta flex min-h-11 items-center justify-center gap-1.5 border-0 bg-rose-600 font-semibold text-white shadow-md hover:bg-rose-500 lg:h-10 lg:min-h-0 lg:w-auto"
                        onClick={() => void confirmarCierreLista()}
                        disabled={!sesionListaAbierta || cerrandoSesionId != null}
                      >
                        <span className="material-symbols-outlined text-[18px]">check_circle</span>
                        {cerrandoSesionId != null ? 'Cerrando...' : 'Confirmar y cerrar lista'}
                      </button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              {planillasError ? (
                <div className="flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  {planillasError}
                </div>
              ) : null}
            </div>

            {/* KPI + leyenda — móvil compacto */}
            <div className="space-y-2 md:hidden">
              <div className="grid grid-cols-2 gap-2">
                {PLANILLA_KPI_ITEMS.map((k) => {
                  const value =
                    k.key === 'matriculas'
                      ? planillaMatrix.size
                      : k.key === 'sesiones'
                        ? sesionesDelMes.length
                        : k.key === 'riesgo'
                          ? resumen.evaluacionPendiente
                            ? '—'
                            : resumen.enRiesgo
                          : resumen.evaluacionPendiente
                            ? '—'
                            : resumen.inhabilitados;
                  const title =
                    k.key === 'riesgo' || k.key === 'inhabilitados'
                      ? resumen.evaluacionPendiente
                        ? `Se evalúa al cerrar el 75% de las clases del módulo (${metricasModulo?.sesionesCerradas ?? 0}/${metricasModulo?.clasesMinimasParaEvaluar ?? '?'})`
                        : undefined
                      : undefined;
                  return (
                    <div
                      key={k.key}
                      title={title}
                      className={`rounded-lg border bg-white px-2.5 py-2 text-center dark:bg-[#132a52] ${k.color}`}
                    >
                      <p className="text-lg font-bold tabular-nums leading-none">{value}</p>
                      <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide opacity-80">{k.label}</p>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-[#0f1f3d] dark:text-slate-300">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-emerald-400 bg-emerald-100 text-sm font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">
                    P
                  </span>
                  Pres.
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-rose-400 bg-rose-100 text-sm font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-200">
                    A
                  </span>
                  Aus.
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-400 bg-amber-100 text-sm font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                    J
                  </span>
                  Just.
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-slate-100 text-base font-bold leading-none text-slate-500 dark:border-slate-600 dark:bg-slate-800/40">
                    —
                  </span>
                  Vacío
                </span>
              </div>
            </div>

            {/* KPI + leyenda — escritorio */}
            <div className="hidden flex-wrap gap-2 md:flex">
              {[
                { label: 'Matrículas', value: planillaMatrix.size, color: PLANILLA_KPI_ITEMS[0].color },
                { label: 'Sesiones del mes', value: sesionesDelMes.length, color: PLANILLA_KPI_ITEMS[1].color },
                {
                  label: 'En riesgo',
                  value: resumen.evaluacionPendiente ? '—' : resumen.enRiesgo,
                  color: 'border-amber-500/40 text-[#ef8001]',
                  title: resumen.evaluacionPendiente
                    ? `Se evalúa al cerrar el 75% de las clases del módulo (${metricasModulo?.sesionesCerradas ?? 0}/${metricasModulo?.clasesMinimasParaEvaluar ?? '?'})`
                    : undefined,
                },
                {
                  label: 'Inhabilitados',
                  value: resumen.evaluacionPendiente ? '—' : resumen.inhabilitados,
                  color: 'border-rose-500/40 text-rose-300',
                  title: resumen.evaluacionPendiente
                    ? `Se evalúa al cerrar el 75% de las clases del módulo (${metricasModulo?.sesionesCerradas ?? 0}/${metricasModulo?.clasesMinimasParaEvaluar ?? '?'})`
                    : undefined,
                },
              ].map((k) => (
                <div
                  key={k.label}
                  title={'title' in k ? k.title : undefined}
                  className={`rounded-lg border bg-white px-3 py-1.5 text-sm dark:bg-[#132a52] ${k.color}`}
                >
                  <span className="font-bold">{k.value}</span> <span className="text-xs opacity-70">{k.label}</span>
                </div>
              ))}
              <div className="rounded-lg border border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-[#0f1f3d] dark:text-slate-300 px-3 py-1.5 text-xs flex flex-wrap items-center gap-x-3 gap-y-1.5 w-full min-w-0">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded border text-xs font-bold bg-emerald-100 text-emerald-700 border-emerald-400 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/40">P</span>
                  Presente
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded border text-xs font-bold bg-rose-100 text-rose-700 border-rose-400 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/40">A</span>
                  Ausente
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded border text-xs font-bold bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/40">J</span>
                  Justificada
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-slate-400 dark:text-slate-600">—</span>
                  Sin marcar
                </span>
              </div>
            </div>
            </div>

            {/* Tabla tipo planilla */}
            <div className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 max-lg:flex-none max-lg:bg-white dark:border-slate-700 dark:bg-[#07101f] dark:max-lg:bg-[#0a1828]">
              {loading ? (
                <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
                  <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                  Cargando planilla...
                </div>
              ) : sessionError ? (
                <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
                  <span className="material-symbols-outlined text-[40px] text-rose-400">error</span>
                  <p className="max-w-md text-sm font-medium text-rose-800 dark:text-rose-200">{sessionError}</p>
                  <p className="max-w-md text-xs text-slate-500 dark:text-slate-400">
                    El selector de curso sigue disponible arriba. Elegí otra materia o usá «Actualizar» para reintentar.
                  </p>
                  <button
                    type="button"
                    className="btn-modern btn-modern-ghost btn-modern-sm"
                    onClick={() => void cargarPlanillaMes()}
                    disabled={!cursoId || loading}
                  >
                    <span className="material-symbols-outlined text-[16px]">refresh</span>
                    Reintentar carga
                  </button>
                </div>
              ) : !cursoId ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
                  <span className="material-symbols-outlined text-[40px]">assignment</span>
                  <p>Selecciona un curso para ver la planilla</p>
                </div>
              ) : !sesionesDelMes.length && !planillaMatrix.size ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
                  <span className="material-symbols-outlined text-[40px]">calendar_month</span>
                  <p>No hay sesiones registradas para {mesAnio}</p>
                  <p className="text-xs">Agrega una sesión desde el formulario de arriba</p>
                </div>
              ) : (
                <>
                  {/* Planilla móvil — deslizar al tomar lista; grilla por días si no hay sesión activa */}
                  <div className="app-mobile-bottom-bar space-y-3 px-3 pt-3 pb-3 md:hidden">
                    {sesionMovilLista ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-[#0f1a30] dark:text-slate-500">
                          <p className="font-semibold text-slate-800 dark:text-slate-300">
                            Tomar lista · {formatDateLabel(sesionMovilLista.fecha, true)}
                          </p>
                          <p className="mt-0.5">
                            Deslizá <span className="font-semibold text-rose-600 dark:text-rose-300">izquierda</span> para
                            Ausente y <span className="font-semibold text-emerald-600 dark:text-emerald-300">derecha</span>{' '}
                            para Presente.
                          </p>
                        </div>
                        <ul className="space-y-3">
                          {alumnosOrdenadosMovil.map(([matriculaId, entry], idx) => {
                            const celda = entry.celdas.get(sesionMovilLista.id);
                            const estado = celda?.estadoAsistencia ?? null;
                            return (
                              <li key={matriculaId}>
                                <PlanillaAlumnoSwipeCardMovil
                                  matriculaId={matriculaId}
                                  idx={idx}
                                  entry={entry}
                                  sesion={sesionMovilLista}
                                  estado={estado}
                                  onMarcar={(mid, est) => handleRegistrar(mid, sesionMovilLista.id, est)}
                                />
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : (
                      <>
                        {!columnasDelMes.length ? (
                          <p className="text-center text-xs text-slate-500">
                            Sin días lectivos en {mesAnio} para el rango del módulo.
                          </p>
                        ) : null}
                        <ul className="space-y-3">
                          {alumnosOrdenadosMovil.map(([matriculaId, entry], idx) => {
                            const evaluado = evaluarAlumnoPlanilla(entry, sesiones, metricasModulo);
                            const borde =
                              evaluado.estado === 'inhabilitado'
                                ? 'border-rose-300 dark:border-rose-500/40'
                                : evaluado.estado === 'riesgo'
                                  ? 'border-amber-300 dark:border-amber-500/40'
                                  : 'border-slate-200 dark:border-slate-700';
                            return (
                              <li
                                key={matriculaId}
                                className={`rounded-xl border bg-white p-3 dark:bg-[#0f1a30] ${borde}`}
                                title={evaluado.tooltip}
                              >
                                <div className="flex items-start gap-2">
                                  <span className="mt-0.5 w-6 shrink-0 text-center text-xs font-semibold text-slate-500">
                                    {entry.ordenLista ?? idx + 1}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold leading-snug text-slate-900 dark:text-[#e7eef9]">
                                      {formatoNombreLegible(entry.alumno)}
                                    </p>
                                    <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-500">
                                      CI {entry.documento || '—'}
                                    </p>
                                    <p className="mt-1 text-xs font-medium tabular-nums text-slate-500 dark:text-slate-400">
                                      {evaluado.faltas} faltas ·{' '}
                                      {entry.porcentajeAsistencia != null ? `${entry.porcentajeAsistencia}%` : '—'} asistencia
                                    </p>
                                  </div>
                                </div>
                                {columnasDelMes.length > 0 ? (
                                  <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto overscroll-x-contain pb-1 pt-0.5">
                                    {columnasDelMes.map((col) => (
                                      <PlanillaDiaCeldaMovil
                                        key={col.fecha}
                                        col={col}
                                        matriculaId={matriculaId}
                                        entry={entry}
                                        sesionActivaId={sesionActivaId}
                                        getEstadoSiguiente={getEstadoSiguiente}
                                        onRegistrar={handleRegistrar}
                                      />
                                    ))}
                                  </div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                    {!alumnosOrdenados.length && !loading ? (
                      <p className="py-8 text-center text-sm text-slate-500">No hay alumnos matriculados en este curso.</p>
                    ) : null}
                  </div>

                  {/* Planilla escritorio — grilla fija (#, datos, fechas del cronograma) */}
                  <div className="scroll-region-tablet hidden min-h-0 flex-1 flex-col overflow-hidden md:flex">
                <div className="isolate w-full min-w-0 flex-1 rounded-t-xl lg:scroll-region lg:min-h-0">
                  <table
                    className="text-sm border-separate border-spacing-0 w-full min-w-max table-fixed"
                    style={{ minWidth: anchoMinPlanillaTabla }}
                  >
                    <colgroup>
                      <col style={{ width: STICKY_COL_NUM }} />
                      <col style={{ width: stickyPlanillaLeft.nombreW }} />
                      <col style={{ width: STICKY_COL_CI }} />
                      <col style={{ width: STICKY_COL_FALTAS }} />
                      <col style={{ width: STICKY_COL_PCT }} />
                      {columnasDelMes.map((col) => (
                        <col key={col.fecha} style={{ width: PLANILLA_SESION_COL_PX }} />
                      ))}
                    </colgroup>
                    <thead className="sticky top-0 z-[70] bg-[#0d1b2e]">
                      <tr>
                        <th className="sticky top-0 left-0 z-[61] bg-[#0d1b2e] px-1 py-2 text-center border-l border-t border-b border-r border-slate-800/40 rounded-tl-xl font-semibold text-slate-500 text-xs w-[36px] min-w-[36px] max-w-[36px] whitespace-nowrap align-middle">
                          #
                        </th>
                        <th
                          className="sticky top-0 left-[36px] z-[60] bg-[#0d1b2e] px-3 py-2 text-left border-t border-b border-r border-slate-800/40 font-semibold text-slate-300 whitespace-nowrap align-middle overflow-hidden"
                          style={{
                            width: stickyPlanillaLeft.nombreW,
                            minWidth: stickyPlanillaLeft.nombreW,
                            maxWidth: stickyPlanillaLeft.nombreW,
                          }}
                        >
                          Apellidos y Nombres
                        </th>
                        <th
                          className="sticky top-0 z-[59] bg-[#0d1b2e] px-0 py-2 border-t border-b border-r border-slate-800/40 w-[64px] min-w-[64px] max-w-[64px] whitespace-nowrap align-middle"
                          style={{ left: stickyPlanillaLeft.ci }}
                        >
                          <span className="flex w-full items-center justify-center font-semibold text-slate-300 text-sm">
                            CI
                          </span>
                        </th>
                        <th
                          className="sticky top-0 z-[58] bg-[#0d1b2e] px-0 py-2 border-t border-b border-r border-slate-800/40 w-[50px] min-w-[50px] max-w-[50px] whitespace-nowrap align-middle"
                          style={{ left: stickyPlanillaLeft.faltas }}
                        >
                          <span className="flex w-full items-center justify-center font-semibold text-slate-400 text-sm">
                            Faltas
                          </span>
                        </th>
                        <th
                          className={`sticky top-0 z-[57] bg-[#0d1b2e] px-0 py-2 border-t border-b border-r border-slate-800/40 font-semibold text-slate-400 text-sm whitespace-nowrap align-middle overflow-hidden ${columnasDelMes.length === 0 ? 'rounded-tr-xl' : ''}`}
                          style={{ left: stickyPlanillaLeft.pct, width: STICKY_COL_PCT, minWidth: STICKY_COL_PCT, maxWidth: STICKY_COL_PCT }}
                        >
                          <span className="flex w-full items-center justify-center">%</span>
                        </th>
                        {columnasDelMes.map((col, colIdx) => {
                          const f = new Date(`${col.fecha}T00:00:00`);
                          const s = col.sesion;
                          const esCerrada = s ? s.estado.toLowerCase() === 'cerrada' : false;
                          const esActiva = s ? sesionActivaId === s.id : false;
                          const dimmed = sesionActivaId !== null && !esActiva;
                          const modalidadActual = s ? (sesionModalidad[s.id] ?? s.modalidad) : col.modalidadDefault;
                          const isUltimaFecha = colIdx === columnasDelMes.length - 1;
                          const tituloColumna =
                            col.esListaExcepcional && s
                              ? `Clase reprogramada (${formatDateLabel(col.fecha)}). Fuera del calendario habitual Lun–Jue.`
                              : undefined;
                          return (
                            <th
                              key={col.fecha}
                              title={tituloColumna}
                              className={`sticky top-0 z-40 px-1 py-2 align-middle text-center border-t border-b border-r border-slate-800/40 min-w-[56px] transition-none ${
                                esActiva ? 'bg-[#0d2540]' : 'bg-[#0d1b2e]'
                              } ${isUltimaFecha ? 'rounded-tr-xl' : ''}`}
                            >
                              <div className={`flex flex-col items-center gap-0.5 ${dimmed ? 'opacity-45' : ''}`}>
                                {s ? (
                                  esActiva && !esCerrada ? (
                                    <button
                                      type="button"
                                      title={`Modalidad: ${modalidadActual === 'presencial' ? 'Presencial — clic para cambiar a Virtual' : 'Virtual — clic para cambiar a Presencial'}`}
                                      disabled={cambiandoModalidad}
                                      onClick={() => void cambiarModalidad(s.id, modalidadActual === 'presencial' ? 'virtual' : 'presencial')}
                                      className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-sm font-bold leading-none shadow-sm transition-opacity hover:opacity-80 disabled:opacity-50 ${
                                        modalidadActual === 'presencial'
                                          ? 'text-white bg-emerald-600'
                                          : 'text-white bg-violet-600'
                                      }`}
                                    >
                                      <span className="material-symbols-outlined text-sm leading-none">
                                        {modalidadActual === 'presencial' ? 'location_on' : 'videocam'}
                                      </span>
                                      {modalidadActual === 'presencial' ? 'P' : 'V'}
                                    </button>
                                  ) : (
                                    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-sm font-bold leading-none shadow-sm ${
                                      modalidadActual === 'presencial'
                                        ? 'text-white bg-emerald-600'
                                        : 'text-white bg-violet-600'
                                    }`}>
                                      <span className="material-symbols-outlined text-sm leading-none">
                                        {modalidadActual === 'presencial' ? 'location_on' : 'videocam'}
                                      </span>
                                      {modalidadActual === 'presencial' ? 'P' : 'V'}
                                    </span>
                                  )
                                ) : null}
                                <span className={`text-sm font-bold ${s ? 'text-slate-300' : 'text-slate-600'}`}>
                                  {f.getDate()}
                                </span>
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {alumnosOrdenados.map(([matriculaId, entry], idx) => {
                        const evaluado = evaluarAlumnoPlanilla(entry, sesiones, metricasModulo);
                        const filaClass = claseFilaPlanilla(evaluado.estado, idx);
                        const celdaBase = 'border-b border-r border-slate-800/40';
                        const celdaFila =
                          evaluado.estado === 'riesgo' || evaluado.estado === 'inhabilitado'
                            ? 'planilla-celda-fila'
                            : '';
                        return (
                          <tr
                            key={matriculaId}
                            className={`planilla-fila ${filaClass}`}
                            title={evaluado.tooltip}
                          >
                            {/* # */}
                            <td
                              className={`sticky left-0 z-[57] px-1 py-2.5 text-center text-xs w-[36px] min-w-[36px] max-w-[36px] border-l ${celdaBase} ${celdaFila} planilla-celda-indice planilla-celda-texto`}
                            >
                              <span className="opacity-70">{entry.ordenLista ?? idx + 1}</span>
                            </td>
                            {/* Nombre */}
                            <td
                              className={`sticky left-[36px] z-[56] px-3 py-2.5 ${celdaBase} ${celdaFila} align-middle overflow-hidden`}
                              style={{
                                width: stickyPlanillaLeft.nombreW,
                                minWidth: stickyPlanillaLeft.nombreW,
                                maxWidth: stickyPlanillaLeft.nombreW,
                              }}
                            >
                              <span className="planilla-celda-texto font-medium text-sm whitespace-nowrap block">
                                {formatoNombreLegible(entry.alumno)}
                              </span>
                            </td>
                            {/* CI */}
                            <td
                              className={`sticky z-[55] px-0 py-2.5 w-[64px] min-w-[64px] max-w-[64px] ${celdaBase} ${celdaFila} align-middle`}
                              style={{ left: stickyPlanillaLeft.ci }}
                            >
                              <span className="flex w-full items-center justify-center text-sm planilla-celda-texto opacity-80">
                                {entry.documento || '—'}
                              </span>
                            </td>
                            {/* Faltas */}
                            <td
                              className={`sticky z-[54] px-2 py-2.5 text-center w-[50px] min-w-[50px] max-w-[50px] ${celdaBase} ${celdaFila}`}
                              style={{ left: stickyPlanillaLeft.faltas }}
                            >
                              <span className="text-sm font-bold planilla-celda-metrica">
                                {evaluado.faltas}
                              </span>
                            </td>
                            {/* % Asistencia */}
                            <td
                              className={`sticky z-[53] px-0 py-2.5 ${celdaBase} ${celdaFila} overflow-hidden align-middle`}
                              style={{
                                left: stickyPlanillaLeft.pct,
                                width: STICKY_COL_PCT,
                                minWidth: STICKY_COL_PCT,
                                maxWidth: STICKY_COL_PCT,
                              }}
                            >
                              <span className={`flex w-full items-center justify-center text-sm tabular-nums font-semibold ${evaluado.estado === 'regular' ? 'text-slate-300' : 'planilla-celda-metrica'}`}>
                                {entry.porcentajeAsistencia != null ? `${entry.porcentajeAsistencia}%` : '—'}
                              </span>
                            </td>
                            {/* Celdas de cada columna (día lectivo) */}
                            {columnasDelMes.map((col) => {
                              const s = col.sesion;
                              if (!s) {
                                return (
                                  <td
                                    key={col.fecha}
                                    title="Día lectivo sin sesión — no se toma lista ni computa ausencias."
                                    className={`px-1 py-1.5 ${celdaBase} ${celdaFila} text-center min-w-[56px]`}
                                  >
                                    <span className="planilla-celda-texto opacity-50 text-[10px] font-black select-none">—</span>
                                  </td>
                                );
                              }

                              const celda = entry.celdas.get(s.id);
                              const estado = celda?.estadoAsistencia ?? null;
                              const cerrada = s.estado.toLowerCase() === 'cerrada';
                              const siguiente = getEstadoSiguiente(estado);
                              const esActiva = sesionActivaId === s.id;
                              const dimmed = sesionActivaId !== null && !esActiva;
                              const editable =
                                sesionActivaId !== null && esActiva && !cerrada && estado !== 'justificada';

                              const cellLabel = estado === 'presente' ? 'P'
                                : estado === 'ausente' ? 'A'
                                : estado === 'justificada' ? 'J'
                                : '-';

                              const badgeCerradaClases =
                                estado === 'presente'
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-400 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/40'
                                  : estado === 'ausente'
                                    ? 'bg-rose-100 text-rose-800 border-rose-400 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/40'
                                    : estado === 'justificada'
                                      ? 'bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/40'
                                      : 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800/70 dark:text-slate-300 dark:border-slate-600';

                              return (
                                <td
                                  key={col.fecha}
                                  className={`px-1 py-1.5 ${celdaBase} ${celdaFila} text-center min-w-[56px] transition-opacity ${dimmed ? 'opacity-40' : ''} ${esActiva ? 'bg-primary/5' : ''}`}
                                >
                                  {!editable ? (
                                    estado === null ? (
                                      <span className="text-slate-600 text-[10px] font-black">—</span>
                                    ) : (
                                      <span
                                        className={`inline-flex items-center justify-center w-8 h-8 rounded-lg font-bold border text-sm ${badgeCerradaClases}`}
                                      >
                                        {cellLabel}
                                      </span>
                                    )
                                  ) : (
                                    <div className="flex justify-center">
                                      <button
                                        type="button"
                                        title={`Estado actual: ${estado === 'presente' ? 'Presente' : estado === 'ausente' ? 'Ausente' : 'Sin marcar'}. Clic para marcar ${siguiente === 'presente' ? 'Presente' : 'Ausente'}.`}
                                        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg font-black transition-transform duration-100 hover:scale-[1.02] active:scale-[0.98] max-lg:h-10 max-lg:w-10 ${
                                          estado === 'presente'
                                            ? 'text-sm border bg-emerald-100 text-emerald-700 border-emerald-400 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/40'
                                            : estado === 'ausente'
                                              ? 'text-sm border bg-rose-100 text-rose-700 border-rose-400 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/40'
                                              : 'text-[10px] border-0 bg-transparent text-[#0a0a0a] hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400'
                                        }`}
                                        onClick={() => handleRegistrar(matriculaId, s.id, siguiente)}
                                      >
                                        {estado === 'presente' ? 'P' : estado === 'ausente' ? 'A' : '—'}
                                      </button>
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                      {!alumnosOrdenados.length && !loading ? (
                        <tr>
                          <td colSpan={columnasDelMes.length + 5} className="py-10 text-center text-slate-500 text-sm">
                            No hay alumnos matriculados en este curso.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                  </div>
                </>
              )}
            </div>

            </div>
            ) : null}

            {subView === 'cronograma' && cursoId ? (
              <div className="min-w-0 overflow-y-auto flex-1">
                <CronogramaDocenteTab cursoId={Number(cursoId)} />
              </div>
            ) : null}

            {mostrarModuloJustificaciones && subView === 'justificaciones' ? (
            <div className="justif-layout-column min-w-0 space-y-4 max-xl:flex-none xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:gap-5">

              {/* Formulario nueva justificación — altura solo al contenido en móvil (evita bloque blanco vacío) */}
              <div
                data-justif-form-panel
                className={`justif-movil-form-panel ${JUSTIF_PANEL_CLASS} flex flex-col overflow-hidden xl:overflow-visible max-xl:shrink-0 xl:shrink-0`}
              >
                <div className={JUSTIF_PANEL_HEADER_CLASS}>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Nueva justificación</p>
                    <h3 className="text-lg font-semibold leading-snug break-words text-slate-900 dark:text-[#f0f4f8]">
                      Registrar justificativo de inasistencia
                    </h3>
                  </div>
                  <div className="btn-mobile-stack flex w-full min-w-0 flex-col gap-2 lg:w-auto lg:flex-row lg:items-center">
                    <AppSelect
                      className="w-full min-w-0 lg:w-auto"
                      aria-label="Seleccionar curso para justificación"
                      value={cursoId}
                      onChange={(v) => {
                        handleCursoIdChange(v);
                        void cargarAusencias(v);
                      }}
                      disabled={planillasLoading && !planillasAsignadas.length}
                      placeholder="Selecciona una planilla"
                      options={planillasAsignadas.map((item) => ({
                        value: String(item.curso_id),
                        label: item.materia,
                      }))}
                      triggerClassName="w-full rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-[#0b2147] dark:text-[#e7eef9]"
                    />
                    <button
                      type="button"
                      className="btn-modern btn-modern-primary btn-modern-sm btn-mobile-cta lg:w-auto"
                      onClick={() => {
                        if (mostrarFormJustif) {
                          setJustifAlumnoBusqueda('');
                          setJustifAlumnoSeleccionado(null);
                          setJustifDiasSeleccionados([]);
                          setJustifMotivo('');
                          setJustifArchivo(null);
                        } else {
                          // cargar ausencias si aún no están cargadas para este curso
                          void cargarAusencias(cursoId);
                        }
                        setMostrarFormJustif((v) => !v);
                      }}
                      disabled={!cursoId}
                    >
                      <span className="material-symbols-outlined text-[16px]">{mostrarFormJustif ? 'expand_less' : 'add'}</span>
                      {mostrarFormJustif ? 'Cancelar' : 'Nueva justificación'}
                    </button>
                  </div>
                </div>

                {mostrarFormJustif ? (
                  <div className="justif-movil-form-scroll space-y-5 bg-white p-4 max-lg:px-4 max-lg:pt-4 dark:bg-[#132a52]">

                    {/* Paso 1: Buscar alumno */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-white text-[10px] font-bold">1</span>
                        Buscar alumno
                      </p>
                      <div className="space-y-2">
                          <div className="relative">
                            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[18px]">search</span>
                            <input
                              type="text"
                              className={`w-full py-2 pl-9 pr-4 text-sm max-lg:min-h-11 ${JUSTIF_FIELD_CLASS}`}
                              placeholder="Buscar por nombre o CI..."
                              value={justifAlumnoBusqueda}
                              onChange={(e) => {
                                setJustifAlumnoBusqueda(e.target.value);
                                setJustifAlumnoSeleccionado(null);
                                setJustifDiasSeleccionados([]);
                              }}
                            />
                          </div>
                          <div className="max-h-52 overflow-y-auto space-y-1.5 py-0.5">
                            {ausenciasLoading ? (
                              <p className="px-4 py-3 text-sm text-slate-500 flex items-center gap-2">
                                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                                Cargando ausencias...
                              </p>
                            ) : ausenciasError ? (
                              <div className="px-4 py-3 flex items-start gap-2 text-sm text-rose-700 dark:text-rose-300">
                                <span className="material-symbols-outlined text-[16px] mt-0.5">error</span>
                                <div>
                                  <p className="font-medium">Error al cargar ausencias</p>
                                  <p className="text-xs text-rose-600 dark:text-rose-400">{ausenciasError}</p>
                                  <button
                                    type="button"
                                    className="mt-1 text-xs text-primary hover:underline"
                                    onClick={() => void cargarAusencias(cursoId)}
                                  >
                                    Reintentar
                                  </button>
                                </div>
                              </div>
                            ) : !alumnosFiltrados.length ? (
                              <p className="px-4 py-3 text-sm text-slate-500">
                                {justifAlumnoBusqueda.trim()
                                  ? `Sin resultados para «${justifAlumnoBusqueda}».`
                                  : 'No hay alumnos matriculados en este curso.'}
                              </p>
                            ) : alumnosFiltrados.map((al) => (
                              <button
                                key={al.matriculaId}
                                type="button"
                                onClick={() => {
                                  setJustifAlumnoSeleccionado(al.matriculaId);
                                  setJustifDiasSeleccionados([]);
                                }}
                                className={`group flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-all max-lg:min-h-12 max-lg:rounded-xl max-lg:px-3 max-lg:py-3 ${
                                  justifAlumnoSeleccionado === al.matriculaId
                                    ? JUSTIF_ALUMNO_ITEM_SELECTED
                                    : JUSTIF_ALUMNO_ITEM_IDLE
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-[13px] font-semibold leading-snug tracking-tight whitespace-normal break-words text-slate-900 dark:text-[#e7eef9]">
                                    {formatoNombreLegible(al.alumno)}
                                  </p>
                                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                                    <span className="material-symbols-outlined text-[13px] leading-none text-slate-500 shrink-0 dark:text-slate-400">id_card</span>
                                    <span>
                                      CI <span className="tabular-nums text-slate-400 dark:text-slate-500">{al.documento}</span>
                                    </span>
                                  </p>
                                </div>
                                <span className={JUSTIF_FALTAS_BADGE_CLASS}>
                                  {al.dias.length} {al.dias.length === 1 ? 'falta' : 'faltas'}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                    </div>

                    {/* Paso 2: Seleccionar días */}
                    {justifAlumnoSeleccionado !== null ? (() => {
                      const alumno = alumnosConAusencias.find((a) => a.matriculaId === justifAlumnoSeleccionado);
                      if (!alumno) return null;
                      return (
                        <div id="justif-paso-dias" className="space-y-2 scroll-mt-4">
                          <p className="text-xs font-semibold uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
                            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-white text-[10px] font-bold">2</span>
                            Días a justificar —
                            <span className="text-slate-600 normal-case font-medium dark:text-slate-300">{formatoNombreLegible(alumno.alumno)}</span>
                          </p>
                          <div className={`${JUSTIF_DIAS_PANEL_CLASS} w-full max-xl:w-fit max-xl:min-w-[min(100%,18rem)]`}>
                            {!alumno.dias.length ? (
                              <p className="text-sm text-slate-500">
                                Este alumno no tiene inasistencias sin justificar registradas.
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {[...alumno.dias].sort((a, b) => a.fecha.localeCompare(b.fecha)).map((d) => {
                                  const diaKey = `${d.sesion_id}:${d.matricula_id}`;
                                  const checked = justifDiasSeleccionados.includes(diaKey);
                                  return (
                                    <button
                                      key={diaKey}
                                      type="button"
                                      onClick={() => setJustifDiasSeleccionados((prev) =>
                                        checked ? prev.filter((k) => k !== diaKey) : [...prev, diaKey]
                                      )}
                                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium max-lg:min-h-11 max-lg:px-4 ${
                                        checked ? JUSTIF_DAY_CHIP_CHECKED : JUSTIF_DAY_CHIP_IDLE
                                      }`}
                                    >
                                      <span className={`material-symbols-outlined text-[15px] ${checked ? 'text-primary' : 'text-slate-500 dark:text-slate-400'}`}>
                                        {checked ? 'check_box' : 'check_box_outline_blank'}
                                      </span>
                                      {new Date(`${d.fecha}T00:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' })}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            {justifDiasSeleccionados.length > 0 ? (
                              <p className="mt-2 text-xs text-slate-500">
                                {justifDiasSeleccionados.length} {justifDiasSeleccionados.length === 1 ? 'día seleccionado' : 'días seleccionados'}
                              </p>
                            ) : alumno.dias.length > 0 ? (
                              <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">Haz clic en los días que quieres justificar.</p>
                            ) : null}
                          </div>
                        </div>
                      );
                    })() : null}

                    {/* Paso 3: Motivo + PDF — solo tras elegir alumno */}
                    {justifAlumnoSeleccionado !== null ? (
                    <>
                    <div id="justif-paso-datos" className="space-y-2 scroll-mt-4">
                      <p className="text-xs font-semibold uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-white text-[10px] font-bold">3</span>
                        Completar datos
                      </p>
                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        <label className="flex flex-col gap-1.5 text-sm">
                          <span className="text-xs uppercase text-slate-500 dark:text-slate-400">Motivo</span>
                          <textarea
                            className={`min-h-[5.5rem] w-full resize-none px-3 py-2.5 text-sm md:min-h-[80px] ${JUSTIF_FIELD_CLASS}`}
                            placeholder="Describe el motivo de la inasistencia..."
                            value={justifMotivo}
                            onChange={(e) => setJustifMotivo(e.target.value)}
                            maxLength={500}
                          />
                        </label>
                        <div className="flex min-w-0 flex-col gap-1.5 text-sm">
                          <span className="text-xs uppercase text-slate-500 dark:text-slate-400">
                            Documento justificativo (PDF)
                          </span>
                          <div
                            className={`app-file-upload-zone lg:min-h-[80px] ${
                              justifArchivo ? 'app-file-upload-zone--filled' : ''
                            }`}
                          >
                            <input
                              id="justif-file-input"
                              type="file"
                              accept="application/pdf"
                              aria-label="Seleccionar PDF justificativo"
                              disabled={Boolean(justifArchivo)}
                              className="absolute inset-0 z-[1] h-full w-full cursor-pointer opacity-0 disabled:pointer-events-none"
                              onChange={(e) => {
                                const f = e.target.files?.[0] ?? null;
                                setJustifArchivo(f);
                                e.target.value = '';
                              }}
                            />
                            <div className="app-file-upload-zone__label pointer-events-none">
                              <span
                                className={`material-symbols-outlined shrink-0 text-[26px] ${
                                  justifArchivo ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'
                                }`}
                              >
                                {justifArchivo ? 'task' : 'upload_file'}
                              </span>
                              <div className="min-w-0 flex-1">
                                {justifArchivo ? (
                                  <>
                                    <p className="app-file-upload-zone__name">{justifArchivo.name}</p>
                                    <p className="app-file-upload-zone__meta">
                                      {(justifArchivo.size / 1024).toFixed(1)} KB
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <p className="app-file-upload-zone__hint-title">Tocá para adjuntar PDF</p>
                                    <p className="app-file-upload-zone__meta">Máximo 10 MB</p>
                                  </>
                                )}
                              </div>
                            </div>
                            {justifArchivo ? (
                              <button
                                type="button"
                                className="app-file-upload-zone__remove relative z-[2]"
                                aria-label="Quitar archivo"
                                onClick={() => setJustifArchivo(null)}
                              >
                                <span className="material-symbols-outlined text-[22px]">close</span>
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end max-lg:w-full max-lg:pt-2 app-mobile-cta-footer">
                      <button
                        id="justif-submit-btn"
                        type="button"
                        className="btn-modern btn-modern-primary btn-mobile-cta lg:w-auto"
                        onClick={() => void enviarJustificacion()}
                        disabled={subiendoJustif || !justifDiasSeleccionados.length || !justifMotivo.trim() || !justifArchivo}
                      >
                        {subiendoJustif
                          ? 'Enviando...'
                          : `Registrar justificación${justifDiasSeleccionados.length > 1 ? ` (${justifDiasSeleccionados.length} días)` : ''}`}
                      </button>
                    </div>
                    </>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Bandeja de revisión — en móvil no se monta con el formulario abierto (evita hueco blanco) */}
              {(!viewportEsMovil || !mostrarFormJustif) ? (
              <div className={`justif-historial-panel ${JUSTIF_PANEL_CLASS} xl:mt-0 xl:shrink-0`}>
                <div className={`${JUSTIF_PANEL_HEADER_CLASS} max-md:flex-col max-md:items-stretch`}>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Historial</p>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-[#f0f4f8]">
                      Bandeja de revisión y resolución
                    </h3>
                  </div>
                  <div className="btn-mobile-stack flex w-full min-w-0 flex-col gap-2 lg:w-auto lg:flex-row lg:items-center">
                    <AppSelect
                      className="w-full min-w-0 lg:w-auto"
                      aria-label="Filtrar justificaciones por estado"
                      value={justificacionEstado}
                      onChange={(v) => setJustificacionEstado(v as '' | JustificacionEstado)}
                      allowEmpty
                      emptyLabel="Todos los estados"
                      options={[
                        { value: 'pendiente', label: 'Pendiente' },
                        { value: 'aprobada', label: 'Aprobada' },
                        { value: 'rechazada', label: 'Rechazada' },
                      ]}
                      triggerClassName="w-full rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-[#0b2147] dark:text-[#e7eef9]"
                    />
                    <button
                      type="button"
                      className="btn-modern btn-modern-ghost btn-modern-sm btn-mobile-cta border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-[#0b2147] dark:text-[#e7eef9] dark:hover:bg-[#091c3d] lg:w-auto"
                      onClick={() => void cargarJustificaciones()}
                      disabled={justificacionesLoading}
                    >
                      {justificacionesLoading ? 'Actualizando...' : 'Actualizar'}
                    </button>
                  </div>
                </div>
                {/* Historial — tarjetas en móvil */}
                <ul className="divide-y divide-slate-200 dark:divide-slate-800 md:hidden">
                  {justificacionesLoading ? (
                    <li className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-500">
                      <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                      Cargando justificaciones...
                    </li>
                  ) : null}
                  {!justificacionesLoading && !justificaciones.length ? (
                    <li className="px-4 py-10 text-center text-sm text-slate-500">
                      <span className="material-symbols-outlined mb-2 block text-[36px] text-slate-400">inbox</span>
                      {cursoId
                        ? 'No hay justificaciones para el filtro actual.'
                        : 'Selecciona una planilla para revisar justificaciones.'}
                    </li>
                  ) : null}
                  {!justificacionesLoading &&
                    agruparJustificacionesPorCarga(justificaciones, claveGrupoJustificacionCarga).map((g) => {
                      const j = g.representante;
                      const pendiente = j.estado_revision === 'pendiente';
                      const resolviendo = g.ids.some((id) => resolviendoId === id);
                      return (
                        <li key={g.ids.join('-')} className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-[15px] font-semibold leading-snug text-slate-900 dark:text-[#e7eef9]">
                                {formatoNombreLegible(j.alumno)}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-500">
                                Matrícula #{j.matricula_id}
                              </p>
                            </div>
                            <span
                              className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize ${claseBadgeEstadoJustificacion(j.estado_revision)}`}
                            >
                              {j.estado_revision}
                            </span>
                          </div>
                          <div className="space-y-2 text-sm">
                            <p className="text-slate-600 dark:text-[#9fb3d4]">
                              <span className="font-medium text-slate-700 dark:text-slate-400">Curso: </span>
                              {j.materia}
                              <span className="text-xs text-slate-500"> (#{j.curso_id})</span>
                            </p>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Motivo</p>
                              <p className="mt-0.5 break-words text-slate-800 dark:text-[#9fb3d4]">{j.motivo}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fechas</p>
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {[...g.fechas].sort().map((f) => (
                                  <span
                                    key={f}
                                    className="inline-block rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:border-slate-700/60 dark:bg-slate-700/60 dark:text-slate-300"
                                  >
                                    {new Date(`${normalizeDate(f)}T00:00:00`).toLocaleDateString('es-AR', {
                                      day: '2-digit',
                                      month: 'short',
                                    })}
                                  </span>
                                ))}
                              </div>
                            </div>
                            {j.documento_url ? (
                              <a
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  void abrirDocumento(j.documento_url).catch((err) =>
                                    toast.error(err instanceof Error ? err.message : 'No se pudo abrir el PDF')
                                  );
                                }}
                                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-blue-700 dark:border-slate-700 dark:bg-[#0d1b2e] dark:text-blue-400"
                              >
                                <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                                Ver documento PDF
                              </a>
                            ) : null}
                            {!pendiente && j.comentarios_revision ? (
                              <p className="text-xs text-slate-600 dark:text-slate-500">
                                <span className="font-medium">Comentario: </span>
                                {j.comentarios_revision}
                              </p>
                            ) : null}
                          </div>
                          {puedeResolverJustificaciones && pendiente ? (
                            <div className="space-y-2.5 border-t border-slate-200 pt-3 dark:border-slate-800">
                              <input
                                className={`w-full px-3 py-2.5 text-sm max-lg:min-h-11 lg:text-xs ${JUSTIF_FIELD_CLASS}`}
                                placeholder="Comentario (opcional)"
                                value={comentariosRevision[j.id] ?? ''}
                                onChange={(e) =>
                                  setComentariosRevision((prev) => ({ ...prev, [j.id]: e.target.value }))
                                }
                              />
                              <div className="btn-mobile-row flex gap-2">
                                <button
                                  type="button"
                                  className="btn-modern btn-modern-success btn-modern-xs btn-mobile-cta"
                                  onClick={() => void Promise.all(g.ids.map((id) => resolver(id, 'aprobar')))}
                                  disabled={resolviendo}
                                >
                                  Aprobar
                                </button>
                                <button
                                  type="button"
                                  className="btn-modern btn-modern-danger btn-modern-xs btn-mobile-cta"
                                  onClick={() => void Promise.all(g.ids.map((id) => resolver(id, 'rechazar')))}
                                  disabled={resolviendo}
                                >
                                  Rechazar
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                </ul>

                {/* Historial — tabla en escritorio (sin cambios) */}
                <div className="scroll-region-at-lg scroll-region-tablet hidden md:block md:max-h-[420px] max-xl:overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className={JUSTIF_TABLE_HEAD_CLASS}>
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold">Alumno</th>
                        <th className="px-4 py-3 text-left font-semibold">Curso</th>
                        <th className="px-4 py-3 text-left font-semibold">Motivo</th>
                        <th className="px-4 py-3 text-left font-semibold">Fechas</th>
                        <th className="px-4 py-3 text-left font-semibold">Estado</th>
                        {puedeResolverJustificaciones ? (
                          <th className="px-4 py-3 text-right font-semibold">Acciones</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {justificacionesLoading ? (
                        <tr>
                          <td colSpan={puedeResolverJustificaciones ? 6 : 5} className="px-4 py-6 text-center text-slate-400">
                            Cargando justificaciones...
                          </td>
                        </tr>
                      ) : null}
                      {!justificacionesLoading && !justificaciones.length ? (
                        <tr>
                          <td colSpan={puedeResolverJustificaciones ? 6 : 5} className="px-4 py-6 text-center text-slate-500">
                            {cursoId ? 'No hay justificaciones para el filtro actual.' : 'Selecciona una planilla para revisar justificaciones.'}
                          </td>
                        </tr>
                      ) : null}
                      {!justificacionesLoading &&
                        agruparJustificacionesPorCarga(justificaciones, claveGrupoJustificacionCarga).map((g) => {
                          const j = g.representante;
                          const pendiente = j.estado_revision === 'pendiente';
                          const resolviendo = g.ids.some((id) => resolviendoId === id);
                          return (
                            <tr key={g.ids.join('-')} className={JUSTIF_TABLE_ROW_CLASS}>
                              <td className="px-4 py-3 text-slate-900 dark:text-[#e7eef9]">
                                <div className="font-medium">{formatoNombreLegible(j.alumno)}</div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">Matrícula #{j.matricula_id}</div>
                              </td>
                              <td className="px-4 py-3 text-slate-700 dark:text-[#9fb3d4]">
                                <div>#{j.curso_id}</div>
                                <div className="text-xs text-slate-500">{j.materia}</div>
                              </td>
                              <td className="max-w-[240px] px-4 py-3 text-slate-700 dark:text-[#9fb3d4]">
                                <p className="line-clamp-2">{j.motivo}</p>
                                {j.documento_url ? (
                                  <a
                                    href="#"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      void abrirDocumento(j.documento_url).catch((err) =>
                                        toast.error(err instanceof Error ? err.message : 'No se pudo abrir el PDF')
                                      );
                                    }}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                  >
                                    <span className="material-symbols-outlined text-[14px]">picture_as_pdf</span>
                                    Ver PDF
                                  </a>
                                ) : null}
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-600 dark:text-[#9fb3d4]">
                                {[...g.fechas].sort().map((f) => (
                                  <span
                                    key={f}
                                    className="mb-1 mr-1 inline-block rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-slate-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300"
                                  >
                                    {new Date(`${normalizeDate(f)}T00:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
                                  </span>
                                ))}
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize ${claseBadgeEstadoJustificacion(j.estado_revision)}`}
                                >
                                  {j.estado_revision}
                                </span>
                                {!pendiente && j.comentarios_revision ? (
                                  <p className="mt-1 text-xs text-slate-500">{j.comentarios_revision}</p>
                                ) : null}
                              </td>
                              {puedeResolverJustificaciones ? (
                                <td className="px-4 py-3 text-right">
                                  {pendiente ? (
                                    <div className="space-y-2">
                                      <input
                                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-primary focus:outline-none dark:border-[#4f8cdb] dark:bg-[#0b2147] dark:text-[#e7eef9]"
                                        placeholder="Comentario (opcional)"
                                        value={comentariosRevision[j.id] ?? ''}
                                        onChange={(e) =>
                                          setComentariosRevision((prev) => ({ ...prev, [j.id]: e.target.value }))
                                        }
                                      />
                                      <div className="inline-flex gap-2">
                                        <button
                                          type="button"
                                          className="btn-modern btn-modern-success btn-modern-xs"
                                          onClick={() => void Promise.all(g.ids.map((id) => resolver(id, 'aprobar')))}
                                          disabled={resolviendo}
                                        >
                                          Aprobar
                                        </button>
                                        <button
                                          type="button"
                                          className="btn-modern btn-modern-danger btn-modern-xs"
                                          onClick={() => void Promise.all(g.ids.map((id) => resolver(id, 'rechazar')))}
                                          disabled={resolviendo}
                                        >
                                          Rechazar
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-slate-500">{j.comentarios_revision ?? 'Sin comentarios'}</span>
                                  )}
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
              ) : null}
            </div>
            ) : null}
          </section>
        </main>
      </div>
    </div>
  );
}

