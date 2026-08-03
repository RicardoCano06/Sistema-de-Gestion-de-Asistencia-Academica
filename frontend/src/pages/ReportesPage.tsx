import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '../utils/toast';
import { AppSidebar } from '../components/AppSidebar';
import { ReportesPanelListaScroll } from '../components/reportes/ReportesPanelListaScroll';
import { ReportesCursoPicker } from '../components/reportes/ReportesCursoPicker';
import { ScopeSelector, ScopeSelectorSkeleton, useAutoAssignScopeId } from '../components/ScopeSelector';
import { calcularContextoSelectorListo, deriveAlcanceVisual } from '../hooks/useAlcanceVisual';
import { AppSelect, appSelectDarkSurfaceClass } from '../components/ui/app-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { useMisAlcances } from '../hooks/useMisAlcances';
import { abrirDocumento, apiFetch, generarYAbrirPdf, toastApiError } from '../utils/api';
import { formatDateTime24 } from '../utils/datetime';
import { puedeEjecutarCierreMensual } from '../utils/rbac';
import { readStoredUser } from '../utils/session-user';

interface Props {
  onLogout?: () => void;
}

interface ApiList<T> {
  total: number;
  datos: T[];
}

interface Acta {
  id: number;
  tipo_acta: string;
  curso_id: number;
  materia: string;
  generado_en: string;
  url_documento: string;
}

interface Habilitado {
  matricula_id: number;
  alumno: string;
  porcentaje_final: number;
  habilitado: boolean;
}

interface ConsolidadoRiesgoItem {
  periodo: string;
  curso_id: number;
  facultad: string;
  carrera: string;
  semestre: number;
  materia: string;
  alumno: string;
  numero_documento: string;
  porcentaje_asistencia: number;
  faltas_acumuladas: number;
  estado_consolidado: 'INHABILITADO';
}

interface AusentismoAgregadoItem {
  facultad: string;
  carrera: string;
  totalCursos: number;
  totalSesiones: number;
  totalFaltas: number;
  promedioAusentismo: number;
  promedioAsistencia: number;
  nivel: string;
}

const MESES_REPORTE_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

interface ValidacionCierre {
  id: string;
  titulo: string;
  estado: 'ok' | 'warning' | 'blocked' | 'pendiente';
  detalle: string;
}

interface ChecklistCierre {
  cursoId: number;
  moduloId: number;
  periodo: string;
  materia: string;
  estadoModulo: string;
  habilitadosCount: number;
  actaHabilitadosGenerada: boolean;
  pdfLegalGenerado: boolean;
  estadisticaGenerada: boolean;
  validaciones: ValidacionCierre[];
  puedeCerrar: boolean;
}

interface Carrera {
  id: number;
  nombre: string;
  facultad_id?: number;
  facultad?: string;
}

type ReporteTab = 'cierre' | 'consolidado' | 'ausentismo';

interface CursoOpcion {
  id: number;
  materia?: string;
  codigo_materia?: string;
  docente?: string;
  anio?: number;
  mes?: number;
  carrera_id?: number;
  carrera?: string;
  estado_modulo?: string;
}

const selectReportesTriggerClass = appSelectDarkSurfaceClass;

export function ReportesPage({ onLogout }: Props) {
  const puedeCerrarModulo = puedeEjecutarCierreMensual(readStoredUser()?.roles);
  const { alcance, listo: alcanceListo } = useMisAlcances();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reporteTab, setReporteTab] = useState<ReporteTab>('cierre');
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [cierrePasswordConfirm, setCierrePasswordConfirm] = useState('');
  const [cierreShowPassword, setCierreShowPassword] = useState(false);
  const [consolidado, setConsolidado] = useState<ConsolidadoRiesgoItem[]>([]);
  const [consolidadoLoading, setConsolidadoLoading] = useState(false);
  const [consolidadoPdfLoading, setConsolidadoPdfLoading] = useState(false);
  const [ausentismoPdfLoading, setAusentismoPdfLoading] = useState(false);
  const [ausentismoDatos, setAusentismoDatos] = useState<AusentismoAgregadoItem[]>([]);
  const [ausentismoDatosLoading, setAusentismoDatosLoading] = useState(false);
  /** Periodo mensual exclusivo del PDF Fac/Carr (no usa curso ni semestre del plan). */
  const [ausentismoMes, setAusentismoMes] = useState(() =>
    String(new Date().getMonth() + 1).padStart(2, '0')
  );
  const [ausentismoAnio, setAusentismoAnio] = useState(() => String(new Date().getFullYear()));
  const [ausentismoAcotarAlcance, setAusentismoAcotarAlcance] = useState(false);
  const [consolidadoSearch, setConsolidadoSearch] = useState('');
  const [consolidadoSort, setConsolidadoSort] = useState<'faltas_desc' | 'asistencia_asc' | 'alumno_asc'>('faltas_desc');

  useEffect(() => {
    if (reporteTab !== 'cierre') {
      setConfirmCloseOpen(false);
      setCierrePasswordConfirm('');
    }
  }, [reporteTab]);

  // Selector en cascada
  const [carreras, setCarreras] = useState<Carrera[]>([]);
  const [cursoOpciones, setCursoOpciones] = useState<CursoOpcion[]>([]);
  /** Cursos por carrera sin filtrar semestre: sirve para listar años antes del paso Semestre */
  const [cursosCatalogoPorCarrera, setCursosCatalogoPorCarrera] = useState<CursoOpcion[]>([]);
  const [facultadSeleccionadaId, setFacultadSeleccionadaId] = useState('');
  const [carreraSeleccionadaId, setCarreraSeleccionadaId] = useState('');
  const [cursoSeleccionadoId, setCursoSeleccionadoId] = useState('');
  const [catalogoCursosLoading, setCatalogoCursosLoading] = useState(false);
  const [cursosLoading, setCursosLoading] = useState(false);
  const alcanceVisualReportes = useMemo(
    () => deriveAlcanceVisual(alcance),
    [alcance.carreras.length, alcance.facultades.length]
  );

  const carrerasEnAlcance = useMemo(() => {
    if (alcance.carreras.length === 0) return carreras;
    const ids = new Set(alcance.carreras.map((c) => c.id));
    return carreras.filter((c) => ids.has(c.id));
  }, [carreras, alcance.carreras]);

  const facultadesDisponibles = useMemo(() => {
    if (alcance.facultades.length > 0) {
      return alcance.facultades.map((f) => ({ id: f.id, nombre: f.nombre }));
    }
    const mapa = new Map<number, string>();
    for (const c of carrerasEnAlcance) {
      if (c.facultad_id != null) mapa.set(c.facultad_id, c.facultad ?? 'Sin facultad');
    }
    return Array.from(mapa.entries())
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [alcance.facultades, carrerasEnAlcance]);

  const carrerasFiltradas = useMemo(() => {
    const base = carrerasEnAlcance;
    if (alcanceVisualReportes === 'carrera') return base;
    if (!facultadSeleccionadaId) return base;
    return base.filter((c) => String(c.facultad_id ?? '') === facultadSeleccionadaId);
  }, [carrerasEnAlcance, facultadSeleccionadaId, alcanceVisualReportes]);

  useAutoAssignScopeId(
    alcanceVisualReportes === 'carrera' ? [] : facultadesDisponibles,
    facultadSeleccionadaId,
    setFacultadSeleccionadaId
  );
  const carrerasOpciones = useMemo(
    () => carrerasFiltradas.map((c) => ({ id: c.id, nombre: c.nombre })),
    [carrerasFiltradas]
  );

  const contextoSelectorListo = calcularContextoSelectorListo({
    alcanceListo,
    datosListos: carreras.length > 0,
    alcanceVisual: alcanceVisualReportes,
    carrerasOpciones,
    carreraId: carreraSeleccionadaId,
  });

  const aniosAusentismoOpciones = useMemo(() => {
    const actual = new Date().getFullYear();
    return Array.from({ length: 8 }, (_, i) => actual - i);
  }, []);

  const mesesAusentismoOpciones = useMemo(
    () => [
      { value: 'todos', label: 'Todos' },
      ...MESES_REPORTE_LABELS.map((label, i) => ({
        value: String(i + 1).padStart(2, '0'),
        label,
      })),
    ],
    []
  );

  const ausentismoResumen = useMemo(() => {
    if (!ausentismoDatos.length) return null;
    const totalCarreras = ausentismoDatos.length;
    const totalCursos = ausentismoDatos.reduce((s, r) => s + r.totalCursos, 0);
    const totalFaltas = ausentismoDatos.reduce((s, r) => s + r.totalFaltas, 0);
    const promAus =
      ausentismoDatos.reduce((s, r) => s + r.promedioAusentismo, 0) / totalCarreras;
    return {
      totalCarreras,
      totalCursos,
      totalFaltas,
      promedioAusentismo: Number(promAus.toFixed(1)),
      promedioAsistencia: Number((100 - promAus).toFixed(1)),
    };
  }, [ausentismoDatos]);

  const ausentismoPeriodoApi = useMemo(() => {
    if (!ausentismoAnio || !ausentismoMes) return '';
    if (ausentismoMes === 'todos') return ausentismoAnio;
    return `${ausentismoAnio}-${ausentismoMes}`;
  }, [ausentismoAnio, ausentismoMes]);

  const ausentismoPeriodoListo = Boolean(ausentismoPeriodoApi);
  const ausentismoAlcanceListo =
    !ausentismoAcotarAlcance || Boolean(carreraSeleccionadaId || facultadSeleccionadaId);

  const ausentismoVistaPrevia = useMemo(() => {
    const periodoTxt = ausentismoPeriodoApi
      ? ausentismoMes === 'todos'
        ? `Año ${ausentismoAnio} (todos los meses)`
        : `${ausentismoMes}/${ausentismoAnio}`
      : 'Seleccioná mes y año';
    if (!ausentismoAcotarAlcance) {
      return `Periodo ${periodoTxt} · Todo tu alcance institucional`;
    }
    const carreraNom = carrerasEnAlcance.find((c) => String(c.id) === carreraSeleccionadaId)?.nombre;
    const facultadNom = facultadesDisponibles.find((f) => String(f.id) === facultadSeleccionadaId)?.nombre;
    if (carreraNom) return `Periodo ${periodoTxt} · Carrera: ${carreraNom}`;
    if (facultadNom) return `Periodo ${periodoTxt} · Facultad: ${facultadNom}`;
    return `Periodo ${periodoTxt} · Elegí facultad o carrera para acotar`;
  }, [
    ausentismoPeriodoApi,
    ausentismoMes,
    ausentismoAnio,
    ausentismoAcotarAlcance,
    carreraSeleccionadaId,
    facultadSeleccionadaId,
    carrerasEnAlcance,
    facultadesDisponibles,
  ]);

  useAutoAssignScopeId(carrerasOpciones, carreraSeleccionadaId, setCarreraSeleccionadaId);

  const cursoId = cursoSeleccionadoId;

  const [periodo, setPeriodo] = useState(() => {
    const d = new Date();
    const rawMonth = d.getMonth() + 1;
    const boundedMonth = Math.min(Math.max(rawMonth, 1), 10);
    const month = String(boundedMonth).padStart(2, '0');
    return `${d.getFullYear()}-${month}`;
  });
  const [semestreSeleccionado, setSemestreSeleccionado] = useState('');
  /** Año del módulo académico: filtra la lista de cursos antes del paso final */
  const [anioFiltroCursos, setAnioFiltroCursos] = useState('');

  const [actas, setActas] = useState<Acta[]>([]);
  const [habilitados, setHabilitados] = useState<Habilitado[]>([]);
  const [checklist, setChecklist] = useState<ChecklistCierre | null>(null);

  const aniosDisponibles = useMemo(() => {
    const s = new Set<number>();
    for (const c of cursosCatalogoPorCarrera) {
      const a = Number(c.anio);
      if (Number.isFinite(a)) s.add(a);
    }
    return [...s].sort((a, b) => b - a);
  }, [cursosCatalogoPorCarrera]);

  const cursoOpcionesFiltradas = useMemo(() => {
    if (!anioFiltroCursos) return [];
    const y = Number(anioFiltroCursos);
    return cursoOpciones.filter((c) => Number(c.anio) === y);
  }, [cursoOpciones, anioFiltroCursos]);

  // Cargar carreras al montar
  useEffect(() => {
    apiFetch<ApiList<Carrera>>('/academico/carreras')
      .then((resp) => setCarreras(resp?.datos ?? []))
      .catch(() => setCarreras([]));
  }, []);

  // Catálogo por carrera (sin semestre) → años disponibles antes de elegir semestre
  useEffect(() => {
    if (!carreraSeleccionadaId) {
      setCursosCatalogoPorCarrera([]);
      setAnioFiltroCursos('');
      return;
    }
    setCursosCatalogoPorCarrera([]);
    setAnioFiltroCursos('');
    const params = new URLSearchParams({ carreraId: carreraSeleccionadaId });
    setCatalogoCursosLoading(true);
    apiFetch<ApiList<CursoOpcion>>(`/academico/cursos?${params.toString()}`)
      .then((resp) => setCursosCatalogoPorCarrera(resp?.datos ?? []))
      .catch(() => setCursosCatalogoPorCarrera([]))
      .finally(() => setCatalogoCursosLoading(false));
  }, [carreraSeleccionadaId]);

  // Cursos filtrados por carrera + semestre (+ año en API si ya está elegido)
  useEffect(() => {
    if (!carreraSeleccionadaId || !semestreSeleccionado) {
      setCursoOpciones([]);
      setCursoSeleccionadoId('');
      return;
    }
    setCursoOpciones([]);
    setCursoSeleccionadoId('');
    const params = new URLSearchParams({
      carreraId: carreraSeleccionadaId,
      semestre: semestreSeleccionado,
    });
    if (anioFiltroCursos) params.set('anio', anioFiltroCursos);
    setCursosLoading(true);
    apiFetch<ApiList<CursoOpcion>>(`/academico/cursos?${params.toString()}`)
      .then((resp) => {
        const datos = resp?.datos ?? [];
        setCursoOpciones(datos);
        setCursoSeleccionadoId('');
      })
      .catch(() => setCursoOpciones([]))
      .finally(() => setCursosLoading(false));
  }, [carreraSeleccionadaId, semestreSeleccionado, anioFiltroCursos]);

  useEffect(() => {
    if (!aniosDisponibles.length) {
      if (anioFiltroCursos) setAnioFiltroCursos('');
      return;
    }
    if (aniosDisponibles.length === 1) {
      setAnioFiltroCursos(String(aniosDisponibles[0]));
      return;
    }
    if (anioFiltroCursos && !aniosDisponibles.includes(Number(anioFiltroCursos))) {
      setAnioFiltroCursos('');
    }
  }, [aniosDisponibles, anioFiltroCursos]);

  useEffect(() => {
    setCursoSeleccionadoId('');
  }, [anioFiltroCursos]);

  useEffect(() => {
    if (anioFiltroCursos) setAusentismoAnio(anioFiltroCursos);
  }, [anioFiltroCursos]);

  // Cuando se selecciona un curso, autocompletar el periodo con su anio/mes
  useEffect(() => {
    if (!cursoSeleccionadoId) return;
    const curso =
      cursoOpcionesFiltradas.find((c) => String(c.id) === cursoSeleccionadoId) ??
      cursoOpciones.find((c) => String(c.id) === cursoSeleccionadoId);
    if (curso?.anio && curso?.mes) {
      const mes = String(curso.mes).padStart(2, '0');
      const next = `${curso.anio}-${mes}`;
      setPeriodo((prev) => (prev === next ? prev : next));
    }
  }, [cursoSeleccionadoId, cursoOpcionesFiltradas, cursoOpciones]);


  const cursoNum = Number(cursoId);
  const cursoValido = Boolean(cursoId) && !Number.isNaN(cursoNum) && cursoNum > 0;

  const cargarActas = useCallback(async () => {
    setLoading(true);
    try {
      const query = cursoValido ? `/reportes/actas?cursoId=${cursoNum}` : '/reportes/actas';
      const actasResp = await apiFetch<ApiList<Acta>>(query);
      setActas(actasResp?.datos ?? []);
    } catch (error) {
      toastApiError(error, 'No se pudo cargar actas');
    } finally {
      setLoading(false);
    }
  }, [cursoNum, cursoValido]);

  useEffect(() => {
    void cargarActas();
  }, [cargarActas]);

  const cargarHabilitados = useCallback(async () => {
    if (!cursoValido) {
      toast.error('Ingresa un curso valido para consultar habilitados.');
      return;
    }
    try {
      const data = await apiFetch<ApiList<Habilitado>>(`/asistencias/habilitados/${cursoNum}`);
      setHabilitados(data?.datos ?? []);
    } catch (error) {
      toastApiError(error, 'No se pudo consultar habilitados');
      setHabilitados([]);
    }
  }, [cursoNum, cursoValido]);

  const cargarChecklist = useCallback(async () => {
    if (!cursoValido) {
      setChecklist(null);
      return;
    }

    setChecklistLoading(true);
    try {
      const data = await apiFetch<ChecklistCierre>(`/reportes/cierre-mensual?cursoId=${cursoNum}&periodo=${encodeURIComponent(periodo)}`);
      setChecklist(data);
    } catch (error) {
      setChecklist(null);
      toastApiError(error, 'No se pudo validar el cierre mensual');
    } finally {
      setChecklistLoading(false);
    }
  }, [cursoNum, cursoValido, periodo]);

  const recalcular = useCallback(async () => {
    if (!cursoValido) {
      toast.error('Ingresa un curso valido para recalcular.');
      return;
    }
    try {
      await apiFetch('/reportes/estadisticas/recalcular', {
        method: 'POST',
        body: JSON.stringify({ cursoId: cursoNum, periodo }),
      });
      toast.success('Estadistica recalculada');
      await Promise.all([cargarChecklist(), cargarHabilitados()]);
    } catch (error) {
      toastApiError(error, 'No se pudo recalcular');
    }
  }, [cursoNum, cursoValido, periodo, cargarChecklist, cargarHabilitados]);

  const generarActa = useCallback(async (tipoActa: string) => {
    if (!cursoValido) {
      toast.error('Ingresa un curso valido para generar acta.');
      return;
    }
    try {
      const abrirPdf = tipoActa === 'pdf_legal' || tipoActa === 'habilitados_no_habilitados';
      await generarYAbrirPdf(
        '/reportes/actas',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cursoId: cursoNum, tipoActa, periodo }),
        },
        abrirPdf
      );
      toast.success(`Acta ${tipoActa} generada correctamente`);
      await Promise.all([cargarActas(), cargarChecklist()]);
    } catch (error) {
      toastApiError(error, 'No se pudo generar el acta');
    }
  }, [cursoNum, cursoValido, periodo, cargarActas, cargarChecklist]);

  const cerrarModulo = useCallback(async () => {
    if (!cursoValido) {
      toast.error('Ingresa un curso valido para cerrar el módulo.');
      return;
    }

    setClosing(true);
    try {
      await apiFetch('/reportes/cierre-mensual', {
        method: 'POST',
        body: JSON.stringify({ cursoId: cursoNum, periodo, password: cierrePasswordConfirm }),
      });
      toast.success('Módulo mensual cerrado correctamente');
      setConfirmCloseOpen(false);
      setCierrePasswordConfirm('');
      await Promise.all([cargarChecklist(), cargarActas(), cargarHabilitados()]);
    } catch (error) {
      toastApiError(error, 'No se pudo cerrar el módulo');
    } finally {
      setClosing(false);
    }
  }, [cursoNum, cursoValido, periodo, cierrePasswordConfirm, cargarChecklist, cargarActas, cargarHabilitados]);

  const consolidadoFiltrosListos = Boolean(semestreSeleccionado && anioFiltroCursos);

  const cargarConsolidado = useCallback(async () => {
    if (!consolidadoFiltrosListos) {
      setConsolidado([]);
      return;
    }
    setConsolidadoLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('periodo', periodo);
      params.set('anio', anioFiltroCursos);
      params.set('semestre', semestreSeleccionado);
      if (alcanceVisualReportes !== 'carrera' && facultadSeleccionadaId) params.set('facultadId', facultadSeleccionadaId);
      if (carreraSeleccionadaId) params.set('carreraId', carreraSeleccionadaId);
      if (cursoValido) params.set('cursoId', String(cursoNum));
      if (consolidadoSearch.trim()) params.set('search', consolidadoSearch.trim());
      params.set('orderBy', consolidadoSort);
      const data = await apiFetch<ApiList<ConsolidadoRiesgoItem>>(`/reportes/consolidado-riesgo?${params.toString()}`);
      setConsolidado(data?.datos ?? []);
    } catch (error) {
      toastApiError(error, 'No se pudo cargar el consolidado');
      setConsolidado([]);
    } finally {
      setConsolidadoLoading(false);
    }
  }, [
    periodo,
    anioFiltroCursos,
    semestreSeleccionado,
    consolidadoFiltrosListos,
    facultadSeleccionadaId,
    carreraSeleccionadaId,
    cursoValido,
    cursoNum,
    consolidadoSearch,
    consolidadoSort,
    alcanceVisualReportes,
  ]);

  const generarConsolidadoPdf = useCallback(async () => {
    if (!consolidadoFiltrosListos) {
      toast.error('Seleccioná año y semestre en los filtros de inhabilitados.');
      return;
    }
    setConsolidadoPdfLoading(true);
    try {
      await generarYAbrirPdf('/reportes/consolidado-riesgo/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodo,
          anio: Number(anioFiltroCursos),
          semestre: Number(semestreSeleccionado),
          facultadId:
            alcanceVisualReportes !== 'carrera' && facultadSeleccionadaId
              ? Number(facultadSeleccionadaId)
              : undefined,
          carreraId: carreraSeleccionadaId ? Number(carreraSeleccionadaId) : undefined,
          cursoId: cursoValido ? cursoNum : undefined,
          search: consolidadoSearch.trim() || undefined,
          orderBy: consolidadoSort,
        }),
      });
      toast.success('PDF consolidado generado correctamente.');
    } catch (error) {
      toastApiError(error, 'No se pudo generar el PDF consolidado');
    } finally {
      setConsolidadoPdfLoading(false);
    }
  }, [
    periodo,
    anioFiltroCursos,
    semestreSeleccionado,
    consolidadoFiltrosListos,
    facultadSeleccionadaId,
    carreraSeleccionadaId,
    cursoValido,
    cursoNum,
    consolidadoSearch,
    consolidadoSort,
    alcanceVisualReportes,
  ]);

  const cargarAusentismoAgregado = useCallback(async () => {
    if (!ausentismoPeriodoListo || !ausentismoAlcanceListo) {
      setAusentismoDatos([]);
      return;
    }
    setAusentismoDatosLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('periodo', ausentismoPeriodoApi);
      if (ausentismoAcotarAlcance && facultadSeleccionadaId && !carreraSeleccionadaId && alcanceVisualReportes !== 'carrera') {
        params.set('facultadId', facultadSeleccionadaId);
      }
      if (ausentismoAcotarAlcance && carreraSeleccionadaId) {
        params.set('carreraId', carreraSeleccionadaId);
      }
      const data = await apiFetch<{
        total: number;
        periodo: string;
        datos: AusentismoAgregadoItem[];
      }>(`/reportes/estadisticas/ausentismo/agregado?${params.toString()}`);
      setAusentismoDatos(data?.datos ?? []);
    } catch (error) {
      setAusentismoDatos([]);
      toastApiError(error, 'No se pudo cargar el ranking de ausentismo');
    } finally {
      setAusentismoDatosLoading(false);
    }
  }, [
    ausentismoPeriodoApi,
    ausentismoPeriodoListo,
    ausentismoAlcanceListo,
    ausentismoAcotarAlcance,
    facultadSeleccionadaId,
    carreraSeleccionadaId,
    alcanceVisualReportes,
  ]);

  const generarAusentismoPdf = useCallback(async () => {
    if (!ausentismoPeriodoListo) {
      toast.error('Seleccioná el periodo (mes o Todos + año) para el PDF de ausentismo.');
      return;
    }
    if (!ausentismoAlcanceListo) {
      toast.error('Activaste acotar alcance: elegí facultad o carrera.');
      return;
    }
    setAusentismoPdfLoading(true);
    try {
      await generarYAbrirPdf('/reportes/estadisticas/ausentismo/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodo: ausentismoPeriodoApi,
          facultadId:
            ausentismoAcotarAlcance &&
            facultadSeleccionadaId &&
            !carreraSeleccionadaId &&
            alcanceVisualReportes !== 'carrera'
              ? Number(facultadSeleccionadaId)
              : undefined,
          carreraId:
            ausentismoAcotarAlcance && carreraSeleccionadaId
              ? Number(carreraSeleccionadaId)
              : undefined,
        }),
      });
      toast.success('PDF de ausentismo generado correctamente.');
      void cargarAusentismoAgregado();
    } catch (error) {
      toastApiError(error, 'No se pudo generar el PDF de ausentismo');
    } finally {
      setAusentismoPdfLoading(false);
    }
  }, [
    cargarAusentismoAgregado,
    ausentismoPeriodoApi,
    ausentismoPeriodoListo,
    ausentismoAlcanceListo,
    ausentismoAcotarAlcance,
    facultadSeleccionadaId,
    carreraSeleccionadaId,
    alcanceVisualReportes,
  ]);

  useEffect(() => {
    if (reporteTab !== 'cierre') return;
    if (!cursoValido) {
      setChecklist(null);
      setHabilitados([]);
      return;
    }

    void Promise.all([cargarChecklist(), cargarHabilitados(), cargarActas()]);
  }, [reporteTab, cursoValido, cursoNum, periodo, cargarChecklist, cargarHabilitados, cargarActas]);

  useEffect(() => {
    if (reporteTab === 'consolidado') {
      void cargarConsolidado();
    }
  }, [reporteTab, cargarConsolidado]);

  useEffect(() => {
    if (reporteTab === 'ausentismo') {
      void cargarAusentismoAgregado();
    }
  }, [reporteTab, cargarAusentismoAgregado]);

  const habilitadosCount = useMemo(() => habilitados.filter((h) => h.habilitado).length, [habilitados]);
  const validacionesOk = useMemo(() => checklist?.validaciones.filter((item) => item.estado === 'ok').length ?? 0, [checklist]);
  const validacionesBloqueadas = useMemo(
    () =>
      checklist?.validaciones.filter((item) => item.estado === 'blocked' || item.estado === 'pendiente')
        .length ?? 0,
    [checklist],
  );

  function getEstadoClasses(estado: ValidacionCierre['estado']) {
    if (estado === 'ok') {
      return 'border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200';
    }
    if (estado === 'warning') {
      return 'border-amber-500/40 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100';
    }
    if (estado === 'pendiente') {
      return 'border-amber-500/40 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100';
    }
    return 'border-rose-500/40 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100';
  }

  function nivelAusentismoClass(nivel: string): string {
    const u = nivel.toUpperCase();
    if (u === 'CRITICO') {
      return 'border-rose-500/40 bg-rose-50 text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200';
    }
    if (u === 'ALTO') {
      return 'border-amber-500/40 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200';
    }
    if (u === 'MEDIO') {
      return 'border-yellow-500/40 bg-yellow-50 text-yellow-900 dark:border-yellow-500/40 dark:bg-yellow-500/10 dark:text-yellow-200';
    }
    return 'border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200';
  }

  function tipoActaLabel(tipo: string): string {
    const map: Record<string, string> = {
      habilitados_no_habilitados: 'Acta de Habilitados / No Habilitados',
      pdf_legal: 'Planilla Legal',
      consolidado_riesgo: 'Consolidado de Inhabilitados',
      estadisticas_ausentismo: 'Estadísticas de Ausentismo',
      informe_alumno: 'Informe Individual',
      listado_usuarios: 'Listado de Usuarios',
      reporte_auditoria: 'Reporte de Auditoría',
    };
    return map[tipo] ?? tipo.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  }

  function tipoActaIcon(tipo: string): string {
    const map: Record<string, string> = {
      habilitados_no_habilitados: 'how_to_reg',
      pdf_legal: 'picture_as_pdf',
      consolidado_riesgo: 'warning',
      estadisticas_ausentismo: 'bar_chart',
      informe_alumno: 'person',
      listado_usuarios: 'group',
      reporte_auditoria: 'policy',
    };
    return map[tipo] ?? 'description';
  }

  const consolidadoView = useMemo(() => consolidado, [consolidado]);

  const tabBtnInactive =
    'bg-white border-slate-300 text-slate-700 hover:bg-slate-100 dark:bg-[#0c1a3b] dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/40';

  const tabBtnClass = (tab: ReporteTab) => {
    const active = reporteTab === tab;
    if (tab === 'cierre') {
      return active
        ? 'bg-blue-100 border-blue-400 text-blue-700 dark:bg-blue-500/20 dark:border-blue-500/40 dark:text-blue-200'
        : tabBtnInactive;
    }
    if (tab === 'consolidado') {
      return active
        ? 'bg-purple-100 border-purple-400 text-purple-700 dark:bg-purple-500/20 dark:border-purple-500/40 dark:text-purple-200'
        : tabBtnInactive;
    }
    return active
      ? 'bg-sky-100 border-sky-400 text-sky-700 dark:bg-sky-500/20 dark:border-sky-500/40 dark:text-sky-200'
      : tabBtnInactive;
  };

  const filtrosFacultadCarreraGrid = !contextoSelectorListo ? (
    <ScopeSelectorSkeleton
      soloCarrera={alcanceListo && alcanceVisualReportes === 'carrera'}
      gridClassName={
        alcanceVisualReportes === 'carrera' ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'
      }
    />
  ) : (
    <div
      className={`grid gap-3 min-w-0 ${
        alcanceVisualReportes === 'carrera' ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'
      }`}
    >
      {alcanceVisualReportes === 'carrera' ? null : (
        <ScopeSelector
          className="min-w-0"
          label="Facultad"
          options={facultadesDisponibles}
          value={facultadSeleccionadaId}
          placeholder="Seleccioná facultad"
          controlClassName={selectReportesTriggerClass}
          onChange={(id) => {
            setFacultadSeleccionadaId(id);
            setCarreraSeleccionadaId('');
            setCursoSeleccionadoId('');
          }}
        />
      )}
      <ScopeSelector
        className="min-w-0"
        label="Carrera"
        options={carrerasOpciones}
        value={carreraSeleccionadaId}
        placeholder="Seleccioná carrera"
        disabled={alcanceVisualReportes === 'carrera' ? false : !facultadSeleccionadaId}
        controlClassName={selectReportesTriggerClass}
        onChange={(id) => {
          setCarreraSeleccionadaId(id);
          if (id) {
            const c = carrerasFiltradas.find((x) => String(x.id) === id);
            if (c?.facultad_id != null) setFacultadSeleccionadaId(String(c.facultad_id));
          }
          setCursoSeleccionadoId('');
        }}
      />
    </div>
  );

  const filtroAnioModulo = (
    <div className="w-full min-w-0 flex flex-col gap-1 lg:w-[7.5rem] lg:shrink-0">
      <label className="text-xs text-slate-400">Año del módulo</label>
      <AppSelect
        title="Seleccionar año del módulo"
        aria-label="Año del módulo"
        value={anioFiltroCursos}
        onChange={setAnioFiltroCursos}
        placeholder={catalogoCursosLoading ? '...' : aniosDisponibles.length === 0 ? '—' : 'Año'}
        loading={catalogoCursosLoading}
        disabled={!carreraSeleccionadaId || catalogoCursosLoading || aniosDisponibles.length === 0}
        options={aniosDisponibles.map((a) => ({ value: String(a), label: String(a) }))}
        triggerClassName={selectReportesTriggerClass}
      />
    </div>
  );

  const filtroSemestrePlan = (
    <div className="w-full min-w-0 flex flex-col gap-1 lg:w-[11rem] lg:shrink-0">
      <label className="text-xs text-slate-400">Semestre del plan</label>
      <AppSelect
        title="Seleccionar semestre"
        aria-label="Semestre"
        columnsMobile={3}
        listClassName="max-lg:!min-w-0 max-lg:w-full"
        value={semestreSeleccionado}
        onChange={setSemestreSeleccionado}
        placeholder="Semestre"
        disabled={!carreraSeleccionadaId || !anioFiltroCursos}
        options={Array.from({ length: 10 }, (_, i) => i + 1).map((n) => ({
          value: String(n),
          label: `${n}° Semestre`,
        }))}
        triggerClassName={selectReportesTriggerClass}
      />
    </div>
  );

  return (
    <div className="system-bg app-shell-viewport text-[#e7eef9] min-h-screen h-screen overflow-hidden">
      <div className="app-layout-row">
        {sidebarOpen ? <div className="app-sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" /> : null}

        <AppSidebar sidebarOpen={sidebarOpen} onLogout={onLogout} onClose={() => setSidebarOpen(false)} />

        <main className="app-layout-main">
          <header className="flex-shrink-0 min-h-16 bg-[#132a52]/90 backdrop-blur-md border-b border-slate-800 flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3 z-10">
            <button className="app-menu-toggle text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu">
              <span className="material-symbols-outlined">menu</span>
            </button>
            <span className="material-symbols-outlined shrink-0 text-blue-600 dark:text-[#6b8bc3]">description</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Análisis y reportes</p>
              <h1 className="text-xl font-semibold leading-tight truncate max-lg:text-base">Actas, cierre e inhabilitados</h1>
            </div>
          </header>

          <section className="scroll-region app-scroll-content flex-1 min-h-0 min-w-0 p-4 sm:p-6 space-y-5">

            <div className="btn-mobile-tabs btn-mobile-tabs--inline-md flex flex-wrap items-center gap-2 rounded-2xl border border-[#2d466d]/70 bg-[#132a52] p-2 md:inline-flex">
              <button
                type="button"
                className={`rounded-lg border px-3 py-1.5 text-sm lg:py-1.5 ${tabBtnClass('cierre')}`}
                onClick={() => setReporteTab('cierre')}
              >
                Cierre mensual
              </button>
              <button
                type="button"
                className={`rounded-lg border px-3 py-1.5 text-sm lg:py-1.5 ${tabBtnClass('consolidado')}`}
                onClick={() => setReporteTab('consolidado')}
              >
                Inhabilitados
              </button>
              <button
                type="button"
                className={`rounded-lg border px-3 py-1.5 text-sm lg:py-1.5 ${tabBtnClass('ausentismo')}`}
                onClick={() => setReporteTab('ausentismo')}
              >
                Estadísticas Facultad/Carrera
              </button>
            </div>

            {reporteTab === 'cierre' ? (
              <div className="rounded-2xl border border-[#2d466d]/70 bg-[#132a52] p-5 space-y-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-600 dark:text-[#eff3ff]">
                  Filtros — cierre mensual
                </p>
                {filtrosFacultadCarreraGrid}
                <div className="flex flex-col gap-3 min-w-0 lg:flex-row lg:flex-wrap lg:items-end">
                  {filtroAnioModulo}
                  {filtroSemestrePlan}
                  <div className="min-w-0 flex w-full flex-col gap-1 lg:flex-1 lg:min-w-[12rem]">
                    <label className="text-xs text-slate-400">Curso</label>
                    <ReportesCursoPicker
                      options={cursoOpcionesFiltradas}
                      value={cursoSeleccionadoId}
                      onChange={setCursoSeleccionadoId}
                      loading={cursosLoading}
                      disabled={
                        !carreraSeleccionadaId ||
                        !semestreSeleccionado ||
                        !anioFiltroCursos ||
                        cursosLoading
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-modern btn-modern-primary btn-modern-sm btn-mobile-cta flex items-center justify-center gap-1.5 lg:w-auto lg:shrink-0 lg:self-end lg:min-w-[9.5rem]"
                    onClick={() => void cargarChecklist()}
                    disabled={!cursoValido || checklistLoading}
                  >
                    <span className="material-symbols-outlined text-[18px]">search</span>
                    {checklistLoading ? 'Buscando...' : 'Consultar'}
                  </button>
                </div>
                {checklist ? (
                  <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-800">
                    <span className="material-symbols-outlined text-[#6b8bc3] text-[18px]">school</span>
                    <span className="font-medium text-[#e7eef9]">{checklist.materia}</span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs border ${
                        String(checklist.estadoModulo).toLowerCase() === 'cerrado'
                          ? 'border-rose-500/40 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'
                          : 'border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
                      }`}
                    >
                      {checklist.estadoModulo}
                    </span>
                    <span className="text-xs text-slate-400 ml-auto">Periodo: {checklist.periodo}</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {reporteTab === 'consolidado' ? (
              <div className="rounded-2xl border border-[#2d466d]/70 bg-[#132a52] p-5 space-y-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-600 dark:text-[#eff3ff]">
                  Filtros — inhabilitados
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 -mt-2">
                  Facultad, carrera, año del módulo y semestre del plan. No requiere elegir un curso.
                </p>
                {filtrosFacultadCarreraGrid}
                <div className="flex flex-col gap-3 min-w-0 lg:flex-row lg:flex-wrap lg:items-end">
                  {filtroAnioModulo}
                  {filtroSemestrePlan}
                </div>
              </div>
            ) : null}

            {reporteTab === 'cierre' ? (
            <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-[#132a52] p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 flex-shrink-0">
                  <span className="material-symbols-outlined text-[20px]">article</span>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Actas</p>
                  <p className="text-2xl font-bold text-[#f0f4f8]">{actas.length}</p>
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#132a52] p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 flex-shrink-0">
                  <span className="material-symbols-outlined text-[20px]">how_to_reg</span>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Habilitados</p>
                  <p className="text-2xl font-bold text-emerald-300">{habilitadosCount}</p>
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#132a52] p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 flex-shrink-0">
                  <span className="material-symbols-outlined text-[20px]">checklist</span>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Checklist</p>
                  <p className="text-2xl font-bold">{checklist ? `${validacionesOk}/${checklist.validaciones.length}` : '—'}</p>
                </div>
              </div>
            </div>

            <div className="reportes-cierre-cuadros-grid grid grid-cols-1 gap-4 xl:grid-cols-3 xl:grid-rows-2 xl:gap-5 xl:items-stretch">

                {/* Pasos del flujo — fila 1 izquierda */}
                <div className="reportes-cierre-panel reportes-cierre-panel--flujo rounded-2xl border border-[#2d466d]/70 bg-[#132a52] p-5 xl:col-span-2 xl:row-start-1 xl:h-full">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-600 dark:text-[#eff3ff] mb-4">Flujo de cierre guiado</p>
                  <div className="space-y-3">

                    <div className="flex flex-col gap-3 p-3 rounded-xl bg-[#0c1a3b] border border-slate-800 lg:flex-row lg:items-center lg:gap-4">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-500/40 bg-blue-500/20 text-sm font-bold text-blue-300">1</div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">Recalcular ausentismo</p>
                          <p className="text-xs text-slate-400">Actualiza las estadísticas de asistencia del periodo.</p>
                        </div>
                      </div>
                      <button type="button" className="btn-modern btn-modern-primary btn-modern-sm btn-mobile-cta flex w-full shrink-0 items-center justify-center gap-1.5 lg:w-auto lg:min-w-[9rem]" onClick={() => void recalcular()} disabled={!cursoValido || loading}>
                        <span className="material-symbols-outlined text-[15px]">refresh</span>
                        Recalcular
                      </button>
                    </div>

                    <div className="flex flex-col gap-3 p-3 rounded-xl bg-[#0c1a3b] border border-slate-800 lg:flex-row lg:items-center lg:gap-4">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/20 text-sm font-bold text-emerald-300">2</div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">Generar acta habilitados/no habilitados</p>
                          <p className="text-xs text-slate-400">Registra quiénes quedan habilitados para el examen final.</p>
                        </div>
                      </div>
                      <button type="button" className="btn-modern btn-modern-success btn-modern-sm btn-mobile-cta flex w-full shrink-0 items-center justify-center gap-1.5 lg:w-auto lg:min-w-[9rem]" onClick={() => void generarActa('habilitados_no_habilitados')} disabled={!cursoValido || loading}>
                        <span className="material-symbols-outlined text-[15px]">how_to_reg</span>
                        Generar
                      </button>
                    </div>

                    <div className="flex flex-col gap-3 p-3 rounded-xl bg-[#0c1a3b] border border-slate-800 lg:flex-row lg:items-center lg:gap-4">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/20 text-sm font-bold text-blue-600">3</div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">Generar PDF legal</p>
                          <p className="text-xs text-slate-400">Documento oficial con el registro de asistencias del periodo.</p>
                        </div>
                      </div>
                      <button type="button" className="btn-modern btn-modern-info btn-modern-sm btn-mobile-cta flex w-full shrink-0 items-center justify-center gap-1.5 lg:w-auto lg:min-w-[9rem]" onClick={() => void generarActa('pdf_legal')} disabled={!cursoValido || loading}>
                        <span className="material-symbols-outlined text-[15px]">picture_as_pdf</span>
                        Generar PDF
                      </button>
                    </div>

                    {puedeCerrarModulo ? (
                      <div
                        className={`flex flex-col gap-3 rounded-xl border p-3 lg:flex-row lg:items-center lg:gap-4 ${
                          checklist?.puedeCerrar
                            ? 'bg-rose-50 border-rose-300/70 dark:bg-[rgba(59,18,29,0.5)] dark:border-rose-500/60 dark:shadow-[inset_0_0_0_1px_rgba(244,63,94,0.35)]'
                            : 'bg-[#0c1a3b] border-slate-800'
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                              checklist?.puedeCerrar
                                ? 'border border-rose-400 bg-rose-100 text-rose-800 dark:border-rose-400/80 dark:bg-[rgba(171,18,51,0.45)] dark:text-rose-100'
                                : 'border border-slate-700 bg-slate-700/30 text-slate-500'
                            }`}
                          >
                            4
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm font-semibold ${
                                checklist?.puedeCerrar ? 'text-rose-900 dark:text-rose-50' : 'text-[#f0f4f8]'
                              }`}
                            >
                              Cerrar módulo mensual
                            </p>
                            <p
                              className={`text-xs ${
                                checklist?.puedeCerrar
                                  ? 'text-rose-800/90 dark:text-rose-200'
                                  : 'text-slate-400'
                              }`}
                            >
                              {checklist?.puedeCerrar
                                ? 'Todos los requisitos están cumplidos. Puedes cerrar el módulo.'
                                : 'Completa los pasos anteriores para habilitar el cierre.'}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn-modern btn-modern-danger btn-modern-sm btn-mobile-cta flex w-full shrink-0 items-center justify-center gap-1.5 lg:w-auto lg:min-w-[9rem]"
                          onClick={() => setConfirmCloseOpen(true)}
                          disabled={!checklist?.puedeCerrar || closing}
                        >
                          <span className="material-symbols-outlined text-[15px]">lock</span>
                          Cerrar
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 px-1">
                        El cierre del módulo lo realizan Administración, Secretaría Académica o Jefe de Carrera.
                      </p>
                    )}
                  </div>
                </div>

                {/* Checklist de validaciones — fila 2 izquierda */}
                <div className="reportes-cierre-panel reportes-cierre-panel--checklist rounded-2xl border border-[#2d466d]/70 bg-[#132a52] p-5 xl:col-span-2 xl:row-start-2 xl:flex xl:h-full xl:flex-col xl:min-h-0">
                  <div className="mb-4 flex shrink-0 items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-600 dark:text-[#eff3ff]">Checklist de cierre</p>
                      <p className="text-xs text-slate-500 mt-0.5">Requisitos que deben cumplirse para habilitar el cierre.</p>
                    </div>
                    {checklist ? (
                      <span className="text-xs text-slate-400">
                        Bloqueos: <span className="text-rose-300 font-semibold">{validacionesBloqueadas}</span>
                      </span>
                    ) : null}
                  </div>

                  {checklist ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 xl:flex-1 xl:min-h-0">
                      {checklist.validaciones.map((item) => (
                        <div key={item.id} className={`rounded-xl border p-3 ${getEstadoClasses(item.estado)}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="material-symbols-outlined text-[16px]">
                              {item.estado === 'ok' ? 'check_circle' : item.estado === 'warning' ? 'warning' : 'cancel'}
                            </span>
                            <p className="text-sm font-semibold flex-1">{item.titulo}</p>
                            <span className="text-[10px] uppercase tracking-widest opacity-60">{item.estado}</span>
                          </div>
                          <p className="text-xs opacity-80 ml-6">{item.detalle}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-500 xl:flex-1">
                      <span className="material-symbols-outlined text-4xl mb-2 opacity-40">checklist</span>
                      <p className="text-sm">Consultá un curso para ver el checklist.</p>
                    </div>
                  )}
                </div>

                {/* Actas generadas — fila 1 derecha */}
                <div className="reportes-cierre-panel reportes-cierre-panel--actas rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#2d466d]/70 dark:bg-[#132a52] dark:shadow-none max-lg:p-3 xl:col-span-1 xl:col-start-3 xl:row-start-1 xl:flex xl:h-full xl:flex-col xl:min-h-0">
                  <div className="mb-3 flex shrink-0 items-center justify-between gap-2 max-lg:mb-2">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-600 dark:text-[#eff3ff]">Actas generadas</p>
                    <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600 dark:border-slate-800 dark:bg-[#0c1a3b] dark:text-slate-400">
                      {actas.length}
                    </span>
                  </div>
                  <div className="reportes-cierre-panel-scroll-body min-h-0 xl:flex xl:flex-1 xl:flex-col">
                  <ReportesPanelListaScroll vacio={!actas.length} barraCustomHastaXl>
                    {actas.length ? (
                      <ul className="reportes-panel-lista-items max-lg:flex max-lg:flex-col max-lg:gap-2 lg:space-y-2">
                        {actas.map((a) => (
                          <li
                            key={a.id}
                            className="max-lg:rounded-xl max-lg:border max-lg:border-slate-200 max-lg:bg-slate-50 max-lg:p-3 dark:max-lg:border-slate-800 dark:max-lg:bg-[#0c1a3b] lg:rounded-xl lg:border lg:border-slate-200 lg:bg-slate-50 lg:p-3 dark:lg:border-slate-800 dark:lg:bg-[#0c1a3b]"
                          >
                            <div className="flex items-center gap-3 lg:items-start lg:justify-between">
                              <div className="flex min-w-0 flex-1 items-center gap-2.5 max-lg:gap-2 lg:items-start lg:gap-3">
                                <div
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-200/80 bg-cyan-50 text-cyan-700 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300 max-lg:h-8 max-lg:w-8"
                                  aria-hidden
                                >
                                  <span className="material-symbols-outlined text-[18px] max-lg:text-[17px]">
                                    {tipoActaIcon(a.tipo_acta)}
                                  </span>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="line-clamp-2 text-sm font-medium leading-snug text-slate-900 dark:text-[#f0f4f8] lg:truncate lg:line-clamp-none">
                                    {tipoActaLabel(a.tipo_acta)}
                                  </p>
                                  <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-400">{a.materia}</p>
                                  <p className="mt-0.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-500">
                                    {formatDateTime24(a.generado_en, { locale: 'es-AR' })}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  void abrirDocumento(a.url_documento).catch((err) =>
                                    toastApiError(err, 'No se pudo abrir el documento')
                                  )
                                }
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-cyan-700 transition-colors hover:bg-slate-100 active:bg-slate-200 dark:border-slate-700 dark:bg-[#0c1a3b] dark:text-cyan-400 dark:hover:bg-slate-800/80 max-lg:h-9 max-lg:w-9 lg:hidden"
                                title="Abrir documento"
                                aria-label={`Abrir ${tipoActaLabel(a.tipo_acta)}`}
                              >
                                <span className="material-symbols-outlined text-[20px]">open_in_new</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void abrirDocumento(a.url_documento).catch((err) =>
                                    toastApiError(err, 'No se pudo abrir el documento')
                                  )
                                }
                                className="hidden shrink-0 rounded-lg border border-slate-200 bg-white p-1.5 text-cyan-700 hover:bg-slate-100 dark:border-transparent dark:bg-cyan-500/10 dark:text-cyan-400 dark:hover:bg-cyan-500/20 lg:inline-flex"
                                title="Abrir documento"
                              >
                                <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                        <span className="material-symbols-outlined mb-1 text-3xl opacity-40">article</span>
                        <p className="text-sm">Sin actas generadas.</p>
                      </div>
                    )}
                  </ReportesPanelListaScroll>
                  </div>
                </div>

                {/* Habilitados a examen — fila 2 derecha */}
                <div className="reportes-cierre-panel reportes-cierre-panel--habilitados rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-[#2d466d]/70 dark:bg-[#132a52] dark:shadow-none max-lg:p-3 xl:col-span-1 xl:col-start-3 xl:row-start-2 xl:flex xl:h-full xl:flex-col xl:min-h-0">
                  <div className="mb-3 flex shrink-0 items-center justify-between gap-2 max-lg:mb-2">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-600 dark:text-[#eff3ff]">Habilitados a examen</p>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                      {habilitadosCount}
                    </span>
                  </div>
                  <div className="reportes-cierre-panel-scroll-body min-h-0 xl:flex xl:flex-1 xl:flex-col">
                  <ReportesPanelListaScroll vacio={!habilitados.filter((h) => h.habilitado).length}>
                    {habilitados.filter((h) => h.habilitado).length ? (
                      <ul className="reportes-panel-lista-items max-lg:flex max-lg:flex-col max-lg:gap-2 lg:space-y-2">
                        {habilitados
                          .filter((h) => h.habilitado)
                          .map((h) => (
                            <li
                              key={h.matricula_id}
                              className="max-lg:rounded-xl max-lg:border max-lg:border-slate-200 max-lg:bg-slate-50 max-lg:px-3 max-lg:py-2.5 dark:max-lg:border-slate-800 dark:max-lg:bg-[#0c1a3b] lg:rounded-xl lg:border lg:border-slate-200 lg:bg-slate-50 lg:px-3 lg:py-2.5 dark:lg:border-slate-800 dark:lg:bg-[#0c1a3b]"
                            >
                              <div className="flex items-center justify-between gap-2 lg:py-0">
                                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                                  <div
                                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                    aria-hidden
                                  >
                                    <span className="material-symbols-outlined text-[17px]">person</span>
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-slate-900 dark:text-[#f0f4f8]">{h.alumno}</p>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-500">Matrícula #{h.matricula_id}</p>
                                  </div>
                                </div>
                                <span
                                  className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${
                                    h.porcentaje_final >= 75
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                                      : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
                                  }`}
                                >
                                  {h.porcentaje_final}%
                                </span>
                              </div>
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                        <span className="material-symbols-outlined mb-1 text-3xl opacity-40">how_to_reg</span>
                        <p className="text-sm">{cursoValido ? 'Sin habilitados.' : 'Consultá un curso.'}</p>
                      </div>
                    )}
                  </ReportesPanelListaScroll>
                  </div>
                </div>
            </div>
            </>
            ) : null}

            {reporteTab === 'consolidado' ? (
              <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-[#2d466d]/70 dark:bg-[#132a52] max-lg:space-y-3 max-lg:p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-600 dark:text-[#eff3ff]">Inhabilitados</p>
                    <p className="text-xs text-slate-600 mt-1 dark:text-slate-400">
                      Alumnos que no pueden rendir el examen final: asistencia menor al 75% en el periodo.
                    </p>
                  </div>
                  <div className="btn-mobile-stack flex w-full flex-wrap items-center gap-2 lg:w-auto lg:flex-row">
                    <button
                      type="button"
                      className="btn-modern btn-modern-ghost btn-modern-sm btn-mobile-cta flex items-center justify-center gap-1.5 lg:w-auto"
                      onClick={() => void cargarConsolidado()}
                      disabled={consolidadoLoading || !consolidadoFiltrosListos}
                    >
                      <span className="material-symbols-outlined text-[15px]">refresh</span>
                      {consolidadoLoading ? 'Cargando...' : 'Actualizar'}
                    </button>
                    <button
                      type="button"
                      className="btn-modern btn-modern-info btn-modern-sm btn-mobile-cta flex items-center justify-center gap-1.5 lg:w-auto"
                      onClick={() => void generarConsolidadoPdf()}
                      disabled={consolidadoPdfLoading || !consolidadoFiltrosListos}
                    >
                      <span className="material-symbols-outlined text-[15px]">picture_as_pdf</span>
                      {consolidadoPdfLoading ? 'Generando PDF...' : 'Exportar PDF'}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-full border border-rose-500/40 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                    Inhabilitados: {consolidadoView.length}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm text-slate-800 placeholder-slate-500 focus:outline-none dark:bg-[#0c1a3b] dark:border-slate-800 dark:text-[#e7eef9] dark:placeholder-slate-600"
                    placeholder="Buscar alumno, CI, materia..."
                    value={consolidadoSearch}
                    onChange={(e) => setConsolidadoSearch(e.target.value)}
                  />
                  <AppSelect
                    title="Ordenar consolidado"
                    value={consolidadoSort}
                    onChange={(v) => setConsolidadoSort(v as 'faltas_desc' | 'asistencia_asc' | 'alumno_asc')}
                    options={[
                      { value: 'faltas_desc', label: 'Orden: más faltas' },
                      { value: 'asistencia_asc', label: 'Orden: menor asistencia' },
                      { value: 'alumno_asc', label: 'Orden: lista (planilla)' },
                    ]}
                    triggerClassName={selectReportesTriggerClass}
                  />
                </div>

                <div className="rounded-xl border border-slate-300 dark:border-slate-800 lg:scroll-region-at-lg lg:max-h-[min(70dvh,520px)]">
                  {consolidadoLoading ? (
                    <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">Cargando inhabilitados…</p>
                  ) : (
                    <>
                      <ul className="divide-y divide-slate-200 dark:divide-slate-800/60 md:hidden">
                        {consolidadoView.length === 0 ? (
                          <li className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                            {!consolidadoFiltrosListos
                              ? 'Seleccioná año y semestre en los filtros de arriba.'
                              : 'No hay alumnos inhabilitados para el filtro actual.'}
                          </li>
                        ) : (
                          consolidadoView.map((item, idx) => (
                            <li
                              key={`${item.curso_id}-${item.numero_documento}-${idx}`}
                              className="space-y-2 bg-white px-4 py-3 dark:bg-transparent"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug text-slate-900 dark:text-[#e7eef9]">
                                  {item.alumno}
                                </p>
                                <span className="shrink-0 rounded-full border border-rose-500/40 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                                  Inhabilitado
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 dark:text-slate-400">
                                <span className="font-medium text-slate-500 dark:text-slate-500">CI </span>
                                <span className="tabular-nums text-slate-800 dark:text-slate-200">
                                  {item.numero_documento || '—'}
                                </span>
                              </p>
                              <p className="break-words text-xs leading-snug text-slate-700 dark:text-slate-300">
                                <span className="font-medium text-slate-500 dark:text-slate-500">Materia </span>
                                {item.materia}
                              </p>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
                                <span>
                                  <span className="text-slate-500 dark:text-slate-500">% Asist. </span>
                                  <span className="font-semibold text-rose-700 dark:text-rose-300">
                                    {Number(item.porcentaje_asistencia ?? 0).toFixed(1)}%
                                  </span>
                                </span>
                                <span>
                                  <span className="text-slate-500 dark:text-slate-500">Faltas </span>
                                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                                    {item.faltas_acumuladas}
                                  </span>
                                </span>
                                {item.semestre > 0 ? (
                                  <span>
                                    <span className="text-slate-500 dark:text-slate-500">Sem. </span>
                                    {item.semestre}°
                                  </span>
                                ) : null}
                              </div>
                              <p className="break-words text-[11px] leading-snug text-slate-500 dark:text-slate-500">
                                {item.periodo}
                                {item.facultad ? ` · ${item.facultad}` : ''}
                                {item.carrera ? ` · ${item.carrera}` : ''}
                              </p>
                            </li>
                          ))
                        )}
                      </ul>

                      <table className="hidden w-full text-sm text-slate-800 dark:text-[#e7eef9] lg:table">
                        <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-700 dark:bg-[#0b1827] dark:text-slate-400">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Periodo</th>
                            <th className="px-3 py-2 text-left font-medium">Facultad</th>
                            <th className="px-3 py-2 text-left font-medium">Carrera</th>
                            <th className="px-3 py-2 text-left font-medium">Semestre</th>
                            <th className="px-3 py-2 text-left font-medium">Materia</th>
                            <th className="px-3 py-2 text-left font-medium">Alumno</th>
                            <th className="px-3 py-2 text-left font-medium">CI</th>
                            <th className="px-3 py-2 text-left font-medium">% Asist.</th>
                            <th className="px-3 py-2 text-left font-medium">Faltas</th>
                          </tr>
                        </thead>
                        <tbody>
                          {consolidadoView.map((item, idx) => (
                            <tr
                              key={`${item.curso_id}-${item.numero_documento}-${idx}`}
                              className="border-t border-slate-200 dark:border-slate-800/60"
                            >
                              <td className="px-3 py-2">{item.periodo}</td>
                              <td className="px-3 py-2">{item.facultad}</td>
                              <td className="px-3 py-2">{item.carrera}</td>
                              <td className="px-3 py-2">{item.semestre > 0 ? `${item.semestre}°` : '—'}</td>
                              <td className="px-3 py-2">{item.materia}</td>
                              <td className="px-3 py-2">{item.alumno}</td>
                              <td className="px-3 py-2 tabular-nums">{item.numero_documento || '—'}</td>
                              <td className="px-3 py-2">{Number(item.porcentaje_asistencia ?? 0).toFixed(1)}%</td>
                              <td className="px-3 py-2">{item.faltas_acumuladas}</td>
                            </tr>
                          ))}
                          {consolidadoView.length === 0 ? (
                            <tr>
                              <td colSpan={9} className="px-3 py-8 text-center text-slate-500 dark:text-slate-500">
                                {!consolidadoFiltrosListos
                                  ? 'Seleccioná año y semestre en los filtros de arriba.'
                                  : 'No hay alumnos inhabilitados para el filtro actual.'}
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              </div>
            ) : null}

            {reporteTab === 'ausentismo' ? (
              <div className="space-y-4 rounded-2xl border border-[#2d466d]/70 bg-[#132a52] p-5 max-lg:space-y-3 max-lg:p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-600 dark:text-[#eff3ff]">
                      Estadísticas por facultad / carrera
                    </p>
                    <p className="text-xs text-slate-500 mt-1 dark:text-slate-400 max-w-2xl">
                      Promedio de ausentismo por carrera en un mes o en todo el año (opción Todos). Los datos provienen de estadísticas
                      calculadas por curso (recálculo en cierre mensual). No usa semestre del plan ni curso puntual.
                    </p>
                  </div>
                  <div className="btn-mobile-stack flex w-full flex-wrap items-center gap-2 lg:w-auto lg:flex-row">
                    <button
                      type="button"
                      className="btn-modern btn-modern-ghost btn-modern-sm btn-mobile-cta flex items-center justify-center gap-1.5 lg:w-auto"
                      onClick={() => void cargarAusentismoAgregado()}
                      disabled={ausentismoDatosLoading || !ausentismoPeriodoListo || !ausentismoAlcanceListo}
                    >
                      <span className="material-symbols-outlined text-[15px]">refresh</span>
                      {ausentismoDatosLoading ? 'Cargando...' : 'Actualizar'}
                    </button>
                    <button
                      type="button"
                      className="btn-modern btn-modern-primary btn-modern-sm btn-mobile-cta flex items-center justify-center gap-1.5 lg:w-auto"
                      onClick={() => void generarAusentismoPdf()}
                      disabled={ausentismoPdfLoading || !ausentismoPeriodoListo || !ausentismoAlcanceListo}
                    >
                      <span className="material-symbols-outlined text-[15px]">picture_as_pdf</span>
                      {ausentismoPdfLoading ? 'Generando PDF...' : 'Exportar PDF'}
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-medium text-slate-400">Periodo y alcance</p>
                  <div className="flex flex-col gap-3 min-w-0 sm:flex-row sm:flex-wrap sm:items-end">
                    <div className="w-full min-w-0 flex flex-col gap-1 sm:w-[9rem] sm:shrink-0">
                      <label className="text-xs text-slate-400">Mes</label>
                      <AppSelect
                        aria-label="Mes del reporte"
                        value={ausentismoMes}
                        onChange={setAusentismoMes}
                        options={mesesAusentismoOpciones}
                        triggerClassName={selectReportesTriggerClass}
                      />
                    </div>
                    <div className="w-full min-w-0 flex flex-col gap-1 sm:w-[7rem] sm:shrink-0">
                      <label className="text-xs text-slate-400">Año</label>
                      <AppSelect
                        aria-label="Año del reporte"
                        value={ausentismoAnio}
                        onChange={setAusentismoAnio}
                        options={aniosAusentismoOpciones.map((a) => ({
                          value: String(a),
                          label: String(a),
                        }))}
                        triggerClassName={selectReportesTriggerClass}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-300 pb-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded border-slate-500"
                        checked={ausentismoAcotarAlcance}
                        onChange={(e) => setAusentismoAcotarAlcance(e.target.checked)}
                      />
                      Acotar por facultad o carrera
                    </label>
                  </div>
                  {ausentismoAcotarAlcance ? filtrosFacultadCarreraGrid : null}
                  <p className="text-xs text-slate-500">{ausentismoVistaPrevia}</p>
                </div>

                {ausentismoResumen ? (
                  <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3">
                    <div className="rounded-xl border border-slate-800 bg-[#0c1a3b] p-2.5 lg:p-3">
                      <p className="text-[10px] uppercase leading-tight text-slate-500">Carreras</p>
                      <p className="text-lg font-bold text-[#f0f4f8] lg:text-xl">{ausentismoResumen.totalCarreras}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-[#0c1a3b] p-2.5 lg:p-3">
                      <p className="text-[10px] uppercase leading-tight text-slate-500">Cursos</p>
                      <p className="text-lg font-bold text-[#f0f4f8] lg:text-xl">{ausentismoResumen.totalCursos}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-[#0c1a3b] p-2.5 lg:p-3">
                      <p className="text-[10px] uppercase leading-tight text-slate-500">% Ausentismo prom.</p>
                      <p className="text-lg font-bold text-amber-300 lg:text-xl">
                        {ausentismoResumen.promedioAusentismo}%
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-[#0c1a3b] p-2.5 lg:p-3">
                      <p className="text-[10px] uppercase leading-tight text-slate-500">Faltas totales</p>
                      <p className="text-lg font-bold text-[#f0f4f8] lg:text-xl">{ausentismoResumen.totalFaltas}</p>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-xl border border-slate-800 lg:scroll-region-at-lg lg:max-h-[min(70dvh,480px)]">
                  {ausentismoDatosLoading ? (
                    <p className="px-4 py-10 text-center text-sm text-slate-500">Cargando estadísticas…</p>
                  ) : (
                    <>
                      <ul className="divide-y divide-slate-800/60 md:hidden">
                        {ausentismoDatos.length === 0 ? (
                          <li className="px-4 py-10 text-center text-sm text-slate-500">
                            {!ausentismoPeriodoListo || !ausentismoAlcanceListo
                              ? 'Completá periodo y alcance para ver el ranking.'
                              : 'Sin estadísticas para este periodo.'}
                          </li>
                        ) : (
                          ausentismoDatos.map((row, idx) => (
                            <li
                              key={`${row.facultad}-${row.carrera}-${idx}`}
                              className="space-y-2 px-4 py-3"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug text-[#e7eef9]">
                                  {row.carrera}
                                </p>
                                <span
                                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${nivelAusentismoClass(row.nivel)}`}
                                >
                                  {row.nivel}
                                </span>
                              </div>
                              <p className="break-words text-xs leading-snug text-slate-400">{row.facultad}</p>
                              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs tabular-nums">
                                <div>
                                  <p className="text-slate-500">Cursos</p>
                                  <p className="font-semibold text-[#e7eef9]">{row.totalCursos}</p>
                                </div>
                                <div>
                                  <p className="text-slate-500">Faltas</p>
                                  <p className="font-semibold text-[#e7eef9]">{row.totalFaltas}</p>
                                </div>
                                <div>
                                  <p className="text-slate-500">% Ausentismo</p>
                                  <p className="font-semibold text-amber-300">{row.promedioAusentismo.toFixed(1)}%</p>
                                </div>
                                <div>
                                  <p className="text-slate-500">% Asistencia</p>
                                  <p className="font-semibold text-emerald-300">{row.promedioAsistencia.toFixed(1)}%</p>
                                </div>
                              </div>
                            </li>
                          ))
                        )}
                      </ul>

                      <table className="hidden w-full text-sm text-[#e7eef9] lg:table">
                        <thead className="sticky top-0 bg-[#0b1827] text-xs uppercase text-slate-400">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Facultad</th>
                            <th className="px-3 py-2 text-left font-medium">Carrera</th>
                            <th className="px-3 py-2 text-center font-medium">Cursos</th>
                            <th className="px-3 py-2 text-center font-medium">% Ausentismo</th>
                            <th className="px-3 py-2 text-center font-medium">% Asistencia</th>
                            <th className="px-3 py-2 text-center font-medium">Nivel</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ausentismoDatos.map((row, idx) => (
                            <tr
                              key={`${row.facultad}-${row.carrera}-${idx}`}
                              className="border-t border-slate-800/60"
                            >
                              <td className="px-3 py-2">{row.facultad}</td>
                              <td className="px-3 py-2">{row.carrera}</td>
                              <td className="px-3 py-2 text-center tabular-nums">{row.totalCursos}</td>
                              <td className="px-3 py-2 text-center tabular-nums">
                                {row.promedioAusentismo.toFixed(1)}%
                              </td>
                              <td className="px-3 py-2 text-center tabular-nums">
                                {row.promedioAsistencia.toFixed(1)}%
                              </td>
                              <td className="px-3 py-2 text-center">
                                <span
                                  className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${nivelAusentismoClass(row.nivel)}`}
                                >
                                  {row.nivel}
                                </span>
                              </td>
                            </tr>
                          ))}
                          {ausentismoDatos.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                                {!ausentismoPeriodoListo || !ausentismoAlcanceListo
                                  ? 'Completá periodo y alcance para ver el ranking.'
                                  : 'Sin estadísticas para este periodo.'}
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              </div>
            ) : null}

            <Dialog
              open={confirmCloseOpen && reporteTab === 'cierre'}
              onOpenChange={(open) => {
                setConfirmCloseOpen(open);
                if (!open) { setCierrePasswordConfirm(''); setCierreShowPassword(false); }
              }}
            >
              <DialogContent className="max-w-md gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl ring-1 ring-slate-200/80 dark:border-slate-500/30 dark:bg-gradient-to-b dark:from-[#162d55] dark:to-[#0f2244] dark:text-[#e7eef9] dark:ring-sky-500/20">
                <div className="relative overflow-hidden border-b border-slate-200 bg-slate-50 px-5 pb-5 pt-6 sm:px-6 dark:border-white/10 dark:bg-[#0c1a32]/90">
                  <div className="pointer-events-none absolute -right-8 -top-12 h-36 w-36 rounded-full bg-rose-200/40 blur-2xl dark:bg-rose-500/15" aria-hidden />
                  <div className="pointer-events-none absolute -left-10 top-8 h-28 w-28 rounded-full bg-sky-200/50 blur-2xl dark:bg-sky-500/10" aria-hidden />
                  <DialogHeader className="space-y-3 text-left">
                    <div className="flex items-start gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-rose-100 text-rose-600 shadow-sm dark:border-rose-400/35 dark:from-rose-500/25 dark:to-rose-600/10 dark:text-rose-200 dark:shadow-inner">
                        <span className="material-symbols-outlined text-[26px]" aria-hidden>
                          verified_user
                        </span>
                      </div>
                      <div className="min-w-0 space-y-1 pt-0.5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-600 dark:text-rose-300/90">
                          Confirmación segura
                        </p>
                        <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                          Cerrar módulo mensual
                        </DialogTitle>
                        <DialogDescription className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                          Esta acción marca el período como cerrado y restringe cambios académicos sobre ese módulo. Ingresá tu contraseña de usuario para confirmar.
                        </DialogDescription>
                      </div>
                    </div>
                  </DialogHeader>
                </div>

                <div className="space-y-4 bg-white px-5 py-5 sm:px-6 dark:bg-transparent">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm shadow-sm dark:border-white/10 dark:bg-[#0a162c]/80 dark:shadow-inner">
                    <dl className="grid gap-2.5 sm:grid-cols-2">
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Curso</dt>
                        <dd className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">{cursoId || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Período</dt>
                        <dd className="mt-0.5 font-medium tabular-nums text-slate-900 dark:text-slate-100">{periodo}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Materia</dt>
                        <dd className="mt-0.5 font-medium leading-snug text-slate-900 dark:text-slate-100">{checklist?.materia ?? '—'}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="cierre-password-confirm" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Contraseña de tu usuario
                    </label>
                    <div className="relative">
                      <input
                        id="cierre-password-confirm"
                        type={cierreShowPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600/80 dark:bg-[#071222] dark:text-white dark:shadow-inner dark:placeholder:text-slate-500 dark:focus:border-sky-400/60 dark:focus:ring-sky-500/25"
                        placeholder="••••••••"
                        value={cierrePasswordConfirm}
                        onChange={(e) => setCierrePasswordConfirm(e.target.value)}
                        disabled={closing}
                      />
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                        onClick={() => setCierreShowPassword((prev) => !prev)}
                        disabled={closing}
                        aria-label={cierreShowPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      >
                        <span className="material-symbols-outlined text-[20px]">
                          {cierreShowPassword ? 'visibility_off' : 'visibility'}
                        </span>
                      </button>
                    </div>
                    <p className="text-[11px] leading-snug text-slate-500">
                      Usá la misma contraseña con la que iniciás sesión en el sistema.
                    </p>
                  </div>

                  <div className="btn-mobile-stack flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end sm:gap-3">
                    <button
                      type="button"
                      className="btn-modern btn-modern-ghost btn-mobile-cta lg:h-10 lg:min-h-0 lg:w-auto lg:rounded-xl lg:px-4"
                      onClick={() => {
                        setConfirmCloseOpen(false);
                        setCierrePasswordConfirm('');
                      }}
                      disabled={closing}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="btn-modern btn-modern-danger btn-mobile-cta inline-flex items-center justify-center gap-2 lg:h-10 lg:min-h-0 lg:w-auto lg:rounded-xl lg:border-rose-600/40 lg:bg-gradient-to-r lg:from-rose-600 lg:to-rose-700 lg:px-4 lg:shadow-md lg:shadow-rose-600/25 lg:hover:from-rose-500 lg:hover:to-rose-600"
                      onClick={() => void cerrarModulo()}
                      disabled={!cierrePasswordConfirm.trim() || closing}
                    >
                      <span className="material-symbols-outlined text-[18px]" aria-hidden>
                        lock
                      </span>
                      {closing ? 'Cerrando…' : 'Confirmar cierre'}
                    </button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </section>
        </main>
      </div>
    </div>
  );
}


