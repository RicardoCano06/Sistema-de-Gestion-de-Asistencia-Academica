import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '../utils/toast';
import { AppSidebar } from '../components/AppSidebar';
import {
  PanelAsistenciaAlertasChart,
  PanelCarreraInhabilitadosChart,
  PanelFunnelRetencionChart,
  PanelScatterAsistenciaRiesgoChart,
} from '../components/panel/PanelAnalyticCharts';
import { ScopeSelector, ScopeSelectorSkeleton } from '../components/ScopeSelector';
import { deriveAlcanceVisual } from '../hooks/useAlcanceVisual';
import { AppSelect, appSelectDarkSurfaceClass } from '../components/ui/app-select';
import { useMisAlcances } from '../hooks/useMisAlcances';
import { useScopeForm } from '../hooks/useScopeForm';
import { useTheme } from '../contexts/ThemeContext';
import { abrirDocumento, apiFetch, toastApiError } from '../utils/api';
import type { AppView } from '../utils/rbac';
import { puedeAprobarJustificaciones } from '../utils/rbac';
import {
  buildAsistenciaAlertasMes,
  buildCarreraInhabilitadosData,
  buildFunnelRetencionData,
  buildScatterAsistenciaRiesgo,
} from '../utils/panel-chart-data';
import { resumenesUltimoMesPorCurso } from '../utils/panel-resumenes';
import { readStoredUser } from '../utils/session-user';
type UsersAction = 'list' | 'create';

interface Props {
  onLogout?: () => void;
  onNavigate?: (view: AppView, options?: { usersAction?: UsersAction }) => void;
}

interface CurrentUser {
  nombres?: string;
  apellidos?: string;
  email?: string;
  usuario?: string;
  roles?: string[];
}

interface ApiList<T> {
  total: number;
  datos: T[];
}

interface Alerta {
  id: number;
  tipo_alerta: 'preventiva' | 'riesgo' | 'critica';
  estado: string;
  curso_id: number;
  materia: string;
  alumno: string;
  numero_documento: string;
  faltas_acumuladas: number;
  generado_en?: string;
  anio?: number;
  mes?: number;
}

interface CursoGeoRef {
  id: number;
  carrera_id?: number;
}

interface Estadistica {
  id: number;
  curso_id: number;
  periodo: string;
  porcentaje_ausentismo: number;
  total_faltas: number;
  total_sesiones: number;
  materia: string;
}

type JustificacionEstado = 'pendiente' | 'aprobada' | 'rechazada';

interface JustificacionRow {
  id: number;
  asistencia_id: number;
  motivo: string;
  documento_url: string | null;
  estado_revision: JustificacionEstado;
  revisado_por: string | null;
  revisado_en: string | null;
  comentarios_revision?: string | null;
  estado_asistencia: string;
  justificada: boolean;
  sesion_id: number;
  fecha: string;
  curso_id: number;
  materia: string;
  matricula_id: number;
  alumno: string;
  numero_documento: string;
  carrera?: string | null;
  facultad?: string | null;
  modulo_anio?: number | null;
  modulo_mes?: number | null;
}

/** Misma clave que en la bandeja: un mismo PDF / motivo con varios días = una solicitud. */
function claveGrupoJustificacion(j: JustificacionRow): string {
  return `${j.matricula_id}|${j.motivo}|${j.documento_url ?? ''}|${j.estado_revision}`;
}

interface ResumenCurso {
  curso_id: number;
  anio: number;
  mes: number;
  materia?: string;
  total_matriculas: number;
  alumnos_regulares: number;
  alumnos_riesgo: number;
  alumnos_irregulares: number;
  promedio_asistencia: number;
  faltas_totales: number;
}

interface ResumenGeneral {
  total_usuarios_activos: number;
  total_usuarios: number;
  total_docentes: number;
  total_alumnos: number;
  total_facultades: number;
  total_carreras: number;
  total_materias: number;
  total_cursos: number;
  total_matriculas: number;
  total_roles: number;
  alcance_visual?: string;
  alcance_sin_datos?: boolean;
}

interface FacultadOpt {
  id: number;
  nombre: string;
}

interface CarreraOpt {
  id: number;
  nombre: string;
  facultad_id: number;
}

type AlcanceVisualPanel = 'institucional' | 'facultad' | 'carrera';

function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return 'Buenos días';
  if (h >= 12 && h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function KpiCard({
  label, value, borderColor, icon,
}: { label: string; value: number | string; borderColor: string; icon: string }) {
  return (
    <div
      className={`flex min-w-0 items-center gap-3 rounded-xl border bg-[#132a52] p-3 max-lg:flex-col max-lg:items-start max-lg:gap-2 lg:gap-4 lg:p-4 ${borderColor}`}
    >
      <div className="shrink-0 rounded-lg bg-white/5 p-1.5 max-lg:p-1 sm:p-2">
        <span className="material-symbols-outlined text-[20px] text-slate-300 sm:text-[22px]">{icon}</span>
      </div>
      <div className="min-w-0 w-full max-lg:w-full">
        <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-400 max-lg:line-clamp-2 sm:text-xs sm:tracking-wider">
          {label}
        </p>
        <p className="text-xl font-bold leading-tight text-[#e7eef9] tabular-nums lg:text-2xl">{value}</p>
      </div>
    </div>
  );
}

export function PanelPage({ onLogout, onNavigate: _onNavigate }: Props) {
  const { isDark } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const currentUser = readStoredUser() as CurrentUser | null;
  const puedeAprobar = puedeAprobarJustificaciones(currentUser?.roles ?? []);

  /** Estilo de controles de alcance/filtros del panel (chevron alineado vía AppSelect `ml-auto`). */
  const panelNativeSelectClass = isDark
    ? `rounded-lg pl-3 pr-3 ${appSelectDarkSurfaceClass}`
    : 'rounded-lg border border-slate-300 bg-white text-black shadow-sm pl-3 pr-3';

  /** Selects de la barra 'Ver estadísticas de:' (nombres largos de carrera/facultad). */
  const panelStatsFilterSelectClass = `${panelNativeSelectClass} min-w-[12rem] w-full max-w-md sm:w-auto sm:min-w-[14rem]`;

  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [estadisticas, setEstadisticas] = useState<Estadistica[]>([]);
  const [resumenes, setResumenes] = useState<ResumenCurso[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);

  const [resumenGeneral, setResumenGeneral] = useState<ResumenGeneral | null>(null);
  const [generalLoading, setGeneralLoading] = useState(false);

  const { alcance, listo: alcanceListo } = useMisAlcances();
  const [filtroFacultadId, setFiltroFacultadId] = useState('');
  const [filtroCarreraId, setFiltroCarreraId] = useState('');
  const [facultadesCatalogo, setFacultadesCatalogo] = useState<FacultadOpt[]>([]);
  const [carrerasCatalogo, setCarrerasCatalogo] = useState<CarreraOpt[]>([]);
  const [cursoCarreraMap, setCursoCarreraMap] = useState<Map<number, number>>(new Map());

  const alcanceFiltrosPanel: AlcanceVisualPanel = useMemo(
    () => deriveAlcanceVisual(alcance),
    [alcance.carreras.length, alcance.facultades.length]
  );

  /** Alcance efectivo de datos/gráficos según filtros activos. */
  const alcanceVisualPanel: AlcanceVisualPanel = useMemo(() => {
    if (filtroCarreraId) return 'carrera';
    if (filtroFacultadId) return 'facultad';
    return alcanceFiltrosPanel;
  }, [filtroCarreraId, filtroFacultadId, alcanceFiltrosPanel]);

  const carrerasCatalogoScope = useMemo(
    () =>
      carrerasCatalogo.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        facultad_id: c.facultad_id,
      })),
    [carrerasCatalogo],
  );

  const facultadesFallback = useMemo(
    () => facultadesCatalogo.map((f) => ({ id: f.id, nombre: f.nombre })),
    [facultadesCatalogo],
  );

  const catalogoScopeListo = facultadesCatalogo.length > 0 || carrerasCatalogo.length > 0;

  const { facultadesDisponibles, carrerasDisponibles, contextoSelectorListo: contextoFiltrosListo } = useScopeForm({
    alcance,
    carrerasCatalogo: carrerasCatalogoScope,
    ocultarFacultad: alcanceFiltrosPanel === 'carrera',
    facultadId: filtroFacultadId,
    setFacultadId: setFiltroFacultadId,
    carreraId: filtroCarreraId,
    setCarreraId: setFiltroCarreraId,
    facultadesFallback,
    alcanceListo,
    datosListos: catalogoScopeListo,
  });

  const facultadesList = facultadesDisponibles;
  const carrerasList = carrerasDisponibles;

  const [justificaciones, setJustificaciones] = useState<JustificacionRow[]>([]);
  const [justLoading, setJustLoading] = useState(false);
  const [justEstado, setJustEstado] = useState<'' | JustificacionEstado>('pendiente');
  const [showJustificaciones, setShowJustificaciones] = useState(false);
  const [resolviendoId, setResolviendoId] = useState<number | null>(null);
  const [comentarios, setComentarios] = useState<Record<number, string>>({});
  const cargarEstadisticas = useCallback(async (facultadId?: number, carreraId?: number) => {
    setStatsLoading(true);
    setGeneralLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '200' });
      const soloCarrera = alcanceVisualPanel === 'carrera';
      if (carreraId) qs.set('carreraId', String(carreraId));
      else if (!soloCarrera && facultadId) qs.set('facultadId', String(facultadId));

      const query = qs.toString();
      const necesitaMapaCarreras = alcanceVisualPanel !== 'carrera';
      const [general, alertasResp, statsResp, resumenResp, cursosResp] = await Promise.all([
        apiFetch<ResumenGeneral>(`/reportes/resumen-general?${query}`),
        apiFetch<ApiList<Alerta>>(`/reportes/alertas?${query}`),
        apiFetch<ApiList<Estadistica>>(`/reportes/estadisticas?${query}`),
        apiFetch<ApiList<ResumenCurso>>(`/reportes/resumen-cursos?${query}`),
        necesitaMapaCarreras
          ? apiFetch<ApiList<CursoGeoRef>>(`/academico/cursos?limit=500&${query}`)
          : Promise.resolve(null),
      ]);
      setResumenGeneral(general ?? null);
      setAlertas(alertasResp?.datos ?? []);
      setEstadisticas(statsResp?.datos ?? []);
      setResumenes(resumenResp?.datos ?? []);
      if (necesitaMapaCarreras && cursosResp?.datos) {
        const map = new Map<number, number>();
        for (const c of cursosResp.datos) {
          if (c.carrera_id != null) map.set(c.id, c.carrera_id);
        }
        setCursoCarreraMap(map);
      } else {
        setCursoCarreraMap(new Map());
      }
    } catch (e) {
      toastApiError(e, 'Error al cargar estadisticas');
    } finally {
      setStatsLoading(false);
      setGeneralLoading(false);
    }
  }, [alcanceVisualPanel]);

  const cargarJustificaciones = useCallback(async () => {
    if (!puedeAprobar) return;
    setJustLoading(true);
    try {
      const qs = justEstado ? `estado=${encodeURIComponent(justEstado)}` : '';
      const endpoint = `/asistencias/justificaciones${qs ? `?${qs}` : ''}`;
      const resp = await apiFetch<ApiList<JustificacionRow>>(endpoint);
      setJustificaciones(resp?.datos ?? []);
    } catch (e) {
      toastApiError(e, 'Error al cargar justificaciones');
      setJustificaciones([]);
    } finally {
      setJustLoading(false);
    }
  }, [puedeAprobar, justEstado]);

  useEffect(() => { if (puedeAprobar) void cargarJustificaciones(); }, [cargarJustificaciones, puedeAprobar]);

  useEffect(() => {
    if (!puedeAprobar) {
      setJustificaciones([]);
      setShowJustificaciones(false);
      setComentarios({});
      setResolviendoId(null);
    }
  }, [puedeAprobar]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [facs, carrs] = await Promise.all([
          apiFetch<{ datos: FacultadOpt[] }>('/academico/facultades'),
          apiFetch<{ datos: CarreraOpt[] }>('/academico/carreras'),
        ]);
        if (cancelled) return;
        setFacultadesCatalogo(facs?.datos ?? []);
        setCarrerasCatalogo(carrs?.datos ?? []);
      } catch {
        if (!cancelled) {
          setFacultadesCatalogo([]);
          setCarrerasCatalogo([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!contextoFiltrosListo) return;
    const facNum = filtroFacultadId ? Number(filtroFacultadId) : undefined;
    const carNum = filtroCarreraId ? Number(filtroCarreraId) : undefined;
    void cargarEstadisticas(
      alcanceVisualPanel === 'carrera' ? undefined : facNum,
      carNum,
    );
  }, [filtroFacultadId, filtroCarreraId, alcanceVisualPanel, cargarEstadisticas, contextoFiltrosListo]);

  const resolver = useCallback(async (justificacionId: number, accion: 'aprobar' | 'rechazar') => {
    setResolviendoId(justificacionId);
    try {
      await apiFetch(`/asistencias/justificaciones/${justificacionId}/resolucion`, {
        method: 'POST',
        body: JSON.stringify({
          accion,
          comentarios: comentarios[justificacionId]?.trim() || undefined,
        }),
      });
      toast.success(`Justificacion ${accion === 'aprobar' ? 'aprobada' : 'rechazada'} correctamente`);
      await cargarJustificaciones();
    } catch (e) {
      toastApiError(e, 'Error al procesar la justificacion');
    } finally {
      setResolviendoId(null);
    }
  }, [cargarJustificaciones, comentarios]);

  const riesgo = useMemo(() => {
    let preventiva = 0; let enRiesgo = 0; let critica = 0;
    for (const a of alertas) {
      if (a.tipo_alerta === 'critica') critica++;
      else if (a.tipo_alerta === 'riesgo') enRiesgo++;
      else preventiva++;
    }
    return { total: alertas.length, preventiva, enRiesgo, critica };
  }, [alertas]);

  const resumenesRecientesPorCurso = useMemo(
    () => resumenesUltimoMesPorCurso(resumenes),
    [resumenes],
  );

  const materiaPorCurso = useMemo(() => {
    const map = new Map<number, string>();
    for (const e of estadisticas) {
      if (!map.has(e.curso_id) && e.materia) map.set(e.curso_id, e.materia);
    }
    for (const r of resumenesRecientesPorCurso) {
      if (r.materia && !map.has(r.curso_id)) map.set(r.curso_id, r.materia);
    }
    return map;
  }, [estadisticas, resumenesRecientesPorCurso]);

  const carrerasPorId = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of carrerasCatalogo) map.set(c.id, c.nombre);
    for (const c of carrerasList) {
      if (!map.has(c.id)) map.set(c.id, c.nombre);
    }
    return map;
  }, [carrerasCatalogo, carrerasList]);

  const funnelRetencionData = useMemo(
    () => buildFunnelRetencionData(resumenesRecientesPorCurso),
    [resumenesRecientesPorCurso],
  );

  const scatterAsistenciaRiesgoData = useMemo(
    () => buildScatterAsistenciaRiesgo(resumenesRecientesPorCurso, materiaPorCurso),
    [resumenesRecientesPorCurso, materiaPorCurso],
  );

  const carreraInhabilitadosData = useMemo(
    () => buildCarreraInhabilitadosData(resumenesRecientesPorCurso, cursoCarreraMap, carrerasPorId),
    [resumenesRecientesPorCurso, cursoCarreraMap, carrerasPorId],
  );

  const asistenciaAlertasMesData = useMemo(
    () => buildAsistenciaAlertasMes(resumenes, alertas),
    [resumenes, alertas],
  );

  const panelChartsAnimKey = useMemo(
    () =>
      `panel-charts-${filtroFacultadId || 'all'}-${filtroCarreraId || 'all'}-${funnelRetencionData.length}-${scatterAsistenciaRiesgoData.length}-${carreraInhabilitadosData.length}-${asistenciaAlertasMesData.map((d) => `${d.periodo}:${d.asistencia}:${d.alertas}`).join('|')}`,
    [
      filtroFacultadId,
      filtroCarreraId,
      funnelRetencionData,
      scatterAsistenciaRiesgoData,
      carreraInhabilitadosData,
      asistenciaAlertasMesData,
    ],
  );

  const totalAlumnos = useMemo(
    () => resumenesRecientesPorCurso.reduce((acc, r) => acc + (Number(r.total_matriculas) || 0), 0),
    [resumenesRecientesPorCurso],
  );
  const promedioAsistencia = useMemo(() => {
    if (!resumenesRecientesPorCurso.length) return 0;
    let sumWeighted = 0;
    let matriculas = 0;
    for (const r of resumenesRecientesPorCurso) {
      const m = Math.max(0, Number(r.total_matriculas) || 0);
      const p = Number(r.promedio_asistencia) || 0;
      sumWeighted += p * m;
      matriculas += m;
    }
    return matriculas > 0 ? Number((sumWeighted / matriculas).toFixed(1)) : 0;
  }, [resumenesRecientesPorCurso]);

  const pendientesAgrupados = useMemo(() => {
    const pendientes = justificaciones.filter((j) => j.estado_revision === 'pendiente');
    const claves = new Set<string>();
    for (const j of pendientes) {
      claves.add(claveGrupoJustificacion(j));
    }
    return { solicitudes: claves.size, registros: pendientes.length };
  }, [justificaciones]);

  const esVistaInstitucional =
    resumenGeneral == null ||
    resumenGeneral.alcance_visual === 'institucional' ||
    resumenGeneral.alcance_visual === undefined;

  const displayName = useMemo(() => {
    if (!currentUser) return 'Usuario';
    const full = `${currentUser.nombres ?? ''} ${currentUser.apellidos ?? ''}`.trim();
    return full || currentUser.usuario || currentUser.email || 'Usuario';
  }, [currentUser?.nombres, currentUser?.apellidos, currentUser?.usuario, currentUser?.email]);

  const abrirBandejaJustificacionesPendientes = useCallback(() => {
    setJustEstado('pendiente');
    setShowJustificaciones(true);
  }, []);

  const scrollRegionRef = useCallback((node: HTMLDivElement | null) => {
    if (node !== null) {
      node.scrollTop = 0;
    }
  }, []);

  return (
    <div className="system-bg app-shell-viewport text-[#e7eef9] min-h-dvh h-dvh overflow-clip">
      <div className="app-layout-row">
        {sidebarOpen ? (
          <div className="app-sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
        ) : null}

        <AppSidebar sidebarOpen={sidebarOpen} onLogout={onLogout} onClose={() => setSidebarOpen(false)} />

        <main className="app-layout-main">
          <header className="flex-shrink-0 min-h-16 bg-[#132a52]/90 backdrop-blur-md border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 z-10">
            <div className="flex min-w-0 items-center gap-3">
              <button
                className="app-menu-toggle text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                onClick={() => setSidebarOpen(true)}
                aria-label="Abrir menu"
              >
                <span className="material-symbols-outlined">menu</span>
              </button>
              <span className="material-symbols-outlined shrink-0 text-blue-600 dark:text-[#6b8bc3]">dashboard</span>
              <div className="min-w-0">
                <p className="text-xs uppercase text-slate-500 dark:text-slate-400 truncate">{getGreeting()}, {displayName}</p>
                <h1 className="text-xl font-semibold truncate max-lg:text-base">Panel de control</h1>
              </div>
            </div>
          </header>

          <section ref={scrollRegionRef} className="scroll-region app-scroll-content flex-1 min-h-0 min-w-0 space-y-5 p-4 sm:p-6 max-lg:space-y-4 max-lg:p-3">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 max-lg:mb-1.5">
                Resumen general
              </p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                {esVistaInstitucional ? (
                  <KpiCard
                    label="Usuarios activos"
                    value={generalLoading ? '...' : (resumenGeneral?.total_usuarios_activos ?? 0)}
                    borderColor="border-indigo-400/20"
                    icon="manage_accounts"
                  />
                ) : null}
                <KpiCard
                  label="Docentes"
                  value={generalLoading ? '...' : (resumenGeneral?.total_docentes ?? 0)}
                  borderColor="border-cyan-400/20"
                  icon="school"
                />
                <KpiCard
                  label="Alumnos"
                  value={generalLoading ? '...' : (resumenGeneral?.total_alumnos ?? 0)}
                  borderColor="border-teal-400/20"
                  icon="groups"
                />
                <KpiCard
                  label="Carreras activas"
                  value={generalLoading ? '...' : (resumenGeneral?.total_carreras ?? 0)}
                  borderColor="border-violet-400/20"
                  icon="domain"
                />
                <KpiCard
                  label="Materias"
                  value={generalLoading ? '...' : (resumenGeneral?.total_materias ?? 0)}
                  borderColor="border-blue-400/20"
                  icon="menu_book"
                />
                <KpiCard
                  label="Cursos"
                  value={generalLoading ? '...' : (resumenGeneral?.total_cursos ?? 0)}
                  borderColor="border-sky-400/20"
                  icon="class"
                />
                <KpiCard
                  label="Matriculas"
                  value={generalLoading ? '...' : (resumenGeneral?.total_matriculas ?? 0)}
                  borderColor="border-emerald-400/20"
                  icon="assignment_ind"
                />
                <KpiCard
                  label="Facultades"
                  value={generalLoading ? '...' : (resumenGeneral?.total_facultades ?? 0)}
                  borderColor="border-orange-400/20"
                  icon="account_balance"
                />
              </div>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
              <span className="material-symbols-outlined text-slate-800 dark:text-white text-[18px] shrink-0">filter_list</span>
              <p className="text-xs font-semibold text-slate-800 dark:text-white uppercase tracking-wider shrink-0">Ver estadísticas de:</p>
              {!contextoFiltrosListo ? (
                <ScopeSelectorSkeleton
                  soloCarrera={alcanceListo && alcanceFiltrosPanel === 'carrera'}
                  hideLabel
                  gridClassName="flex flex-wrap gap-3 flex-1 min-w-[12rem]"
                  className="flex-1"
                />
              ) : alcanceFiltrosPanel === 'carrera' ? (
                <ScopeSelector
                  hideLabel
                  label="Filtrar por carrera"
                  options={carrerasList}
                  value={filtroCarreraId}
                  placeholder="Seleccioná carrera"
                  controlClassName={`py-1.5 text-sm focus:border-primary focus:outline-none ${panelStatsFilterSelectClass}`}
                  onChange={(id) => {
                    setFiltroCarreraId(id);
                    if (id) {
                      const c = carrerasCatalogo.find((x) => x.id === Number(id));
                      if (c) setFiltroFacultadId(String(c.facultad_id));
                    }
                  }}
                />
              ) : alcanceFiltrosPanel === 'facultad' ? (
                <>
                  <ScopeSelector
                    hideLabel
                    label="Filtrar por facultad"
                    options={facultadesList}
                    value={filtroFacultadId}
                    placeholder="Seleccioná facultad"
                    controlClassName={`py-1.5 text-sm focus:border-primary focus:outline-none ${panelStatsFilterSelectClass}`}
                    onChange={(id) => {
                      setFiltroFacultadId(id);
                      setFiltroCarreraId('');
                    }}
                  />
                  {(filtroFacultadId || facultadesList.length === 1) && carrerasList.length > 0 ? (
                    <ScopeSelector
                      hideLabel
                      label="Filtrar por carrera"
                      options={carrerasList}
                      value={filtroCarreraId}
                      placeholder="Seleccioná carrera"
                      disabled={facultadesList.length > 1 && !filtroFacultadId}
                      controlClassName={`py-1.5 text-sm focus:border-primary focus:outline-none ${panelStatsFilterSelectClass}`}
                      onChange={setFiltroCarreraId}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <ScopeSelector
                    hideLabel
                    label="Filtrar por facultad"
                    options={facultadesList}
                    value={filtroFacultadId}
                    placeholder="Seleccioná facultad"
                    allowEmptyOption
                    emptyOptionLabel="Todas las facultades"
                    controlClassName={`py-1.5 text-sm focus:border-primary focus:outline-none ${panelStatsFilterSelectClass}`}
                    onChange={(id) => {
                      setFiltroFacultadId(id);
                      setFiltroCarreraId('');
                    }}
                  />
                  {filtroFacultadId && carrerasList.length > 0 ? (
                    <ScopeSelector
                      hideLabel
                      label="Filtrar por carrera"
                      options={carrerasList}
                      value={filtroCarreraId}
                      placeholder="Seleccioná carrera"
                      allowEmptyOption
                      emptyOptionLabel="Todas las carreras"
                      controlClassName={`py-1.5 text-sm focus:border-primary focus:outline-none ${panelStatsFilterSelectClass}`}
                      onChange={setFiltroCarreraId}
                    />
                  ) : null}
                </>
              )}
            </div>

            {/* Banner de justificaciones pendientes para aprobadores */}
            {puedeAprobar && pendientesAgrupados.solicitudes > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-col gap-3 shadow-sm max-lg:gap-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/40 dark:bg-amber-500/10 dark:shadow-none">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="material-symbols-outlined shrink-0 text-amber-700 text-[22px] dark:text-amber-300">pending_actions</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
                      {pendientesAgrupados.solicitudes === 1
                        ? pendientesAgrupados.registros > 1
                          ? `1 solicitud de justificación pendiente (${pendientesAgrupados.registros} días)`
                          : '1 solicitud de justificación pendiente'
                        : `${pendientesAgrupados.solicitudes} solicitudes de justificación pendientes`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-mobile-cta shrink-0 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 shadow-sm hover:bg-amber-100 max-lg:min-h-11 max-lg:w-full dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-100 dark:shadow-none dark:hover:bg-amber-500/25 sm:w-auto"
                  onClick={abrirBandejaJustificacionesPendientes}
                >
                  Ver pendientes
                </button>
              </div>
            ) : null}

            {/* Bandeja de justificaciones */}
            {puedeAprobar && showJustificaciones ? (
              <div className="rounded-xl border border-slate-800 bg-[#132a52]">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 gap-3 flex-wrap">
                  <div>
                    <p className="text-xs uppercase text-slate-400">Revisión y resolución</p>
                    <h2 className="text-lg font-semibold">Justificaciones de inasistencia</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      title="Cerrar bandeja"
                      className="text-slate-400 hover:text-slate-200 "
                      onClick={() => setShowJustificaciones(false)}
                    >
                      <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                    <AppSelect
                      aria-label="Filtrar justificaciones por estado"
                      value={justEstado}
                      onChange={(v) => setJustEstado(v as '' | JustificacionEstado)}
                      allowEmpty
                      emptyLabel="Todos los estados"
                      options={[
                        { value: 'pendiente', label: 'Pendiente' },
                        { value: 'aprobada', label: 'Aprobada' },
                        { value: 'rechazada', label: 'Rechazada' },
                      ]}
                      triggerClassName={`py-2 text-sm focus:border-primary focus:outline-none ${panelNativeSelectClass}`}
                    />
                  </div>
                </div>

              {justificaciones.length === 0 && !justLoading ? (
                <div className="px-4 py-10 text-center">
                  <span className="material-symbols-outlined text-[40px] text-slate-600 mb-2 block">task_alt</span>
                  <p className="text-slate-500 text-sm">No hay justificaciones para el filtro seleccionado.</p>
                </div>
              ) : (
              <div className="scroll-region-at-lg divide-y divide-slate-800 lg:max-h-[520px]">
                {justLoading ? (
                  <div className="px-4 py-10 text-center text-slate-400 text-sm">Cargando justificaciones...</div>
                ) : (() => {
                  // Agrupar por alumno + motivo + documento + estado
                  const grupos = new Map<string, { ids: number[]; j: typeof justificaciones[0]; fechas: string[] }>();
                  for (const j of justificaciones) {
                    const key = claveGrupoJustificacion(j);
                    const existing = grupos.get(key);
                    if (existing) {
                      existing.ids.push(j.id);
                      existing.fechas.push(String(j.fecha).slice(0, 10));
                    } else {
                      grupos.set(key, { ids: [j.id], j, fechas: [String(j.fecha).slice(0, 10)] });
                    }
                  }
                  return [...grupos.values()].map(({ ids, j, fechas }) => {
                  const pendiente = j.estado_revision === 'pendiente';
                  const resolviendo = ids.some((id) => resolviendoId === id);
                  const primerIdKey = ids[0];
                  const fechasOrdenadas = [...fechas].sort((a, b) => a.localeCompare(b));
                  const semestreLabel = j.modulo_anio && j.modulo_mes
                    ? `${j.modulo_mes <= 6 ? '1er' : '2do'} Semestre ${j.modulo_anio}`
                    : null;
                  return (
                    <div key={ids.join('-')} className="px-5 py-4">
                      {/* Fila superior: alumno + estado */}
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-[#132a52] border border-slate-700 flex items-center justify-center flex-shrink-0">
                            <span className="material-symbols-outlined text-[18px] text-[#9fb3d4]">person</span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-[#e7eef9] truncate">{j.alumno}</p>
                            <p className="text-xs text-slate-500">Matrícula #{j.matricula_id} · CI {j.numero_documento}</p>
                          </div>
                        </div>
                        <span className={`flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                          j.estado_revision === 'aprobada'
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                            : j.estado_revision === 'rechazada'
                              ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                              : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                        }`}>
                          <span className="material-symbols-outlined text-[13px]">
                            {j.estado_revision === 'aprobada' ? 'check_circle' : j.estado_revision === 'rechazada' ? 'cancel' : 'schedule'}
                          </span>
                          {j.estado_revision.charAt(0).toUpperCase() + j.estado_revision.slice(1)}
                        </span>
                      </div>

                      {/* Cuerpo: info académica + motivo */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                        {/* Info académica */}
                        <div className="rounded-lg bg-[#07101f] border border-slate-800 px-3 py-2.5 space-y-1.5">
                          {/* Fechas como chips */}
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">
                              {fechasOrdenadas.length > 1 ? `${fechasOrdenadas.length} días a justificar` : 'Día a justificar'}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {fechasOrdenadas.map((f) => (
                                <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#132a52] border border-slate-700 text-[11px] text-[#9fb3d4] font-medium">
                                  <span className="material-symbols-outlined text-[11px]">calendar_today</span>
                                  {new Date(`${f}T00:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' })}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 text-slate-300">
                            <span className="material-symbols-outlined text-[14px] text-slate-500">book</span>
                            <span className="text-xs font-semibold">{j.materia}</span>
                          </div>
                          {j.carrera ? (
                            <div className="flex items-center gap-1.5 text-slate-400">
                              <span className="material-symbols-outlined text-[14px] text-slate-500">school</span>
                              <span className="text-xs">{j.carrera}</span>
                            </div>
                          ) : null}
                          {j.facultad ? (
                            <div className="flex items-center gap-1.5 text-slate-500">
                              <span className="material-symbols-outlined text-[14px] text-slate-600">account_balance</span>
                              <span className="text-xs">{j.facultad}</span>
                            </div>
                          ) : null}
                          {semestreLabel ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#132a52] border border-slate-700 text-[11px] text-[#9fb3d4] font-medium">
                              {semestreLabel}
                            </span>
                          ) : null}
                        </div>

                        {/* Motivo */}
                        <div className="rounded-lg bg-[#07101f] border border-slate-800 px-3 py-2.5">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Motivo</p>
                          <p className="text-sm text-[#e7eef9] leading-snug">{j.motivo}</p>
                          {j.documento_url ? (
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                void abrirDocumento(j.documento_url).catch((err) => toastApiError(err, 'No se pudo abrir el PDF'));
                              }}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-2 "
                            >
                              <span className="material-symbols-outlined text-[14px]">picture_as_pdf</span>
                              Ver documento adjunto
                            </a>
                          ) : null}
                        </div>
                      </div>

                      {/* Acciones */}
                      {pendiente ? (
                        <div className="flex flex-col gap-2 max-lg:gap-2.5 lg:flex-row lg:flex-wrap lg:items-center">
                          <input
                            className="w-full min-w-0 flex-1 px-3 py-1.5 rounded-lg bg-[#07101f] border border-slate-700 text-xs text-[#e7eef9] placeholder-slate-500 focus:outline-none focus:border-[#4f8cdb] max-lg:min-h-11 lg:min-w-[180px]"
                            placeholder="Comentario (opcional)"
                            value={comentarios[primerIdKey] ?? ''}
                            onChange={(e) => setComentarios((prev) => ({ ...prev, [primerIdKey]: e.target.value }))}
                          />
                          <div className="btn-mobile-row flex gap-2 flex-wrap lg:contents">
                            <button
                              type="button"
                              className="btn-modern btn-modern-success btn-modern-xs btn-mobile-cta lg:min-h-0 lg:w-auto"
                              onClick={() => void Promise.all(ids.map((id) => resolver(id, 'aprobar')))}
                              disabled={resolviendo}
                            >
                              <span className="material-symbols-outlined text-[14px]">check_circle</span>
                              Aprobar
                            </button>
                            <button
                              type="button"
                              className="btn-modern btn-modern-danger btn-modern-xs btn-mobile-cta lg:min-h-0 lg:w-auto"
                              onClick={() => void Promise.all(ids.map((id) => resolver(id, 'rechazar')))}
                              disabled={resolviendo}
                            >
                              <span className="material-symbols-outlined text-[14px]">cancel</span>
                              Rechazar
                            </button>
                          </div>
                        </div>
                      ) : j.comentarios_revision ? (
                        <div className="flex items-start gap-1.5 text-xs text-slate-500 italic">
                          <span className="material-symbols-outlined text-[14px] mt-0.5">comment</span>
                          {j.comentarios_revision}
                        </div>
                      ) : null}
                    </div>
                  );
                })})()}
              </div>
              )}
              </div>
            ) : null}

            {/* KPI Cards de alertas académicas (debajo de la bandeja de justificaciones) */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
                Alertas de asistencia{filtroCarreraId || filtroFacultadId ? ' · filtrado' : ''}
              </p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                {puedeAprobar ? (
                  <KpiCard
                    label="Solicitudes pend."
                    value={justLoading ? '...' : pendientesAgrupados.solicitudes}
                    borderColor="border-amber-500/30"
                    icon="pending_actions"
                  />
                ) : null}
                <KpiCard
                  label="Alerta preventiva"
                  value={statsLoading ? '...' : riesgo.preventiva}
                  borderColor="border-blue-400/20"
                  icon="notifications"
                />
                <KpiCard
                  label="En riesgo"
                  value={statsLoading ? '...' : riesgo.enRiesgo}
                  borderColor="border-amber-400/20"
                  icon="warning"
                />
                <KpiCard
                  label="Críticos / Inhabilitados"
                  value={statsLoading ? '...' : riesgo.critica}
                  borderColor="border-rose-500/20"
                  icon="crisis_alert"
                />
              </div>
            </div>

            <div className="min-w-0 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Visualización analítica
                {promedioAsistencia > 0 ? (
                  <span className="text-slate-600 dark:text-slate-400 font-normal normal-case tracking-normal ml-2">
                    Promedio asistencia (último mes por curso): {promedioAsistencia}%
                  </span>
                ) : null}
              </p>
              <div className="grid min-w-0 grid-cols-1 gap-5 2xl:grid-cols-2">
                <PanelFunnelRetencionChart
                  statsLoading={statsLoading}
                  data={funnelRetencionData}
                  chartKey={`${panelChartsAnimKey}-funnel`}
                  totalAlumnos={totalAlumnos}
                  isDark={isDark}
                />
                <PanelScatterAsistenciaRiesgoChart
                  statsLoading={statsLoading}
                  data={scatterAsistenciaRiesgoData}
                  chartKey={`${panelChartsAnimKey}-scatter`}
                  isDark={isDark}
                />
                {alcanceVisualPanel !== 'carrera' ? (
              <div className="min-w-0 2xl:col-span-2">
                <PanelCarreraInhabilitadosChart
                      statsLoading={statsLoading}
                      data={carreraInhabilitadosData}
                      chartKey={`${panelChartsAnimKey}-carreras`}
                      isDark={isDark}
                    />
                  </div>
                ) : null}
              <div className="min-w-0 2xl:col-span-2">
                <PanelAsistenciaAlertasChart
                    statsLoading={statsLoading}
                    data={asistenciaAlertasMesData}
                    chartKey={`${panelChartsAnimKey}-composed`}
                    isDark={isDark}
                  />
                </div>
              </div>
            </div>

          </section>
        </main>
      </div>
    </div>
  );
}
