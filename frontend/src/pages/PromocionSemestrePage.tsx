import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '../utils/toast';
import { AcademicoSubnav } from '../components/AcademicoSubnav';
import { AppSidebar } from '../components/AppSidebar';
import { ScopeSelector, ScopeSelectorSkeleton, useAutoAssignScopeId } from '../components/ScopeSelector';
import { useMisAlcances } from '../hooks/useMisAlcances';
import { useScopeForm } from '../hooks/useScopeForm';
import { AppSelect } from '../components/ui/app-select';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { apiFetch } from '../utils/api';
import { esGestionUnicaCarreraAlumnosListado } from '../utils/rbac';
import { readStoredUser } from '../utils/session-user';



interface Props {
  onLogout?: () => void;
}

interface FacultadItem {
  id: number;
  nombre: string;
}

interface CarreraItem {
  id: number;
  nombre: string;
  facultad_id: number;
}

interface AlumnoSemestreRow {
  id: string;
  numero_documento: string;
  nombre_completo: string;
  semestre_curricular: number;
  cohorte_anio?: number | null;
  promocionado_en?: string | null;
}

type CohorteGrupoKey = number | string;

/** Excluir alumno o grupo de la promoción (legible en claro y oscuro). */
const btnEliminarPromocionClass =
  'inline-flex items-center justify-center gap-1 font-medium ' +
  'border border-rose-200 bg-rose-50 text-rose-700 shadow-sm hover:bg-rose-100 hover:border-rose-300 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/40 ' +
  'dark:border-rose-400/55 dark:bg-[rgb(101,36,36)] dark:text-rose-50 dark:shadow-[0_1px_4px_rgba(0,0,0,0.35)] ' +
  'dark:hover:bg-[rgb(122,46,46)] dark:hover:border-rose-300/70 dark:focus-visible:ring-rose-400/45';

const btnEliminarAlumnoClass = `${btnEliminarPromocionClass} shrink-0 text-xs px-2.5 py-1 rounded-lg`;
const btnEliminarGrupoClass = `${btnEliminarPromocionClass} text-[11px] px-2 py-0.5 rounded-lg`;

function etiquetaSemestreOrdinal(n: number): string {
  return `${n}° semestre`;
}

function grupoEsPromovido(filas: AlumnoSemestreRow[]): boolean {
  return filas.some((r) => r.promocionado_en != null);
}

function claveCohorte(row: AlumnoSemestreRow): CohorteGrupoKey {
  const c = row.cohorte_anio;
  if (c == null || !Number.isFinite(Number(c))) return 'sin';
  return row.promocionado_en ? `${Math.trunc(Number(c))}_p` : Math.trunc(Number(c));
}

interface PreviewMasivaFila {
  carreraId: number;
  carreraNombre: string;
  cantidadAlumnos: number;
  promovidos: boolean;
}

function previewKey(fila: PreviewMasivaFila): string {
  return `${fila.carreraId}_${fila.promovidos ? 'p' : 'e'}`;
}

export function PromocionSemestrePage({ onLogout }: Props) {
  const ocultarFacultad = esGestionUnicaCarreraAlumnosListado(readStoredUser()?.roles);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { alcance: alcanceUsuario, listo: alcanceListo } = useMisAlcances();
  const [catalogoListo, setCatalogoListo] = useState(false);
  const [facultades, setFacultades] = useState<FacultadItem[]>([]);
  const [carreras, setCarreras] = useState<CarreraItem[]>([]);
  const [facultadId, setFacultadId] = useState('');
  const [carreraId, setCarreraId] = useState('');
  const [semestre, setSemestre] = useState('1');
  const [anioIngresoCarrera, setAnioIngresoCarrera] = useState('');
  const [lista, setLista] = useState<AlumnoSemestreRow[]>([]);
  /** Alumnos que participarán en la promoción (se puede quitar antes de confirmar). */
  const [idsIncluidos, setIdsIncluidos] = useState<Set<string>>(new Set());
  const [loadingLista, setLoadingLista] = useState(false);
  const [loadingPromo, setLoadingPromo] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  /** Promoción masiva: todas las carreras de la facultad (en tu alcance) con alumnos en el semestre elegido. */
  const [facultadMasivaId, setFacultadMasivaId] = useState('');
  const [semestreMasivo, setSemestreMasivo] = useState('1');
  const [cohorteAnioMasivo, setCohorteAnioMasivo] = useState('');
  const [previewMasiva, setPreviewMasiva] = useState<PreviewMasivaFila[] | null>(null);
  const [excluirCarrerasMasiva, setExcluirCarrerasMasiva] = useState<Set<string>>(new Set());
  const [loadingPreviewMasiva, setLoadingPreviewMasiva] = useState(false);
  const [loadingEjecutarMasiva, setLoadingEjecutarMasiva] = useState(false);
  const [confirmMasivaOpen, setConfirmMasivaOpen] = useState(false);
  const [gruposColapsados, setGruposColapsados] = useState<Set<string>>(new Set());
  const listaAlumnosRef = useRef<HTMLDivElement>(null);
  const scrollListaTrasCargaRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [facResp, carResp] = await Promise.all([
          apiFetch<{ datos: FacultadItem[] }>('/academico/facultades?limit=500'),
          apiFetch<{ datos: CarreraItem[] }>('/academico/carreras?limit=500'),
        ]);
        if (!cancelled) {
          setFacultades(facResp?.datos ?? []);
          setCarreras(carResp?.datos ?? []);
        }
      } catch {
        if (!cancelled) {
          setFacultades([]);
          setCarreras([]);
        }
      } finally {
        if (!cancelled) setCatalogoListo(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const facultadesFallback = useMemo(
    () => facultades.map((f) => ({ id: f.id, nombre: f.nombre })),
    [facultades]
  );

  const carrerasCatalogo = useMemo(
    () => carreras.map((c) => ({ id: c.id, nombre: c.nombre, facultad_id: c.facultad_id })),
    [carreras]
  );

  const {
    facultadesDisponibles,
    carrerasDisponibles,
    requiereElegirFacultad,
    contextoSelectorListo,
  } = useScopeForm({
    alcance: alcanceUsuario,
    carrerasCatalogo,
    ocultarFacultad,
    facultadId,
    setFacultadId,
    carreraId,
    setCarreraId,
    facultadesFallback,
    alcanceListo,
    datosListos: catalogoListo,
  });

  useAutoAssignScopeId(facultadesDisponibles, facultadMasivaId, setFacultadMasivaId);

  const cargarLista = useCallback(async () => {
    const cid = Number(carreraId);
    const sem = Number(semestre);
    if (!cid || !Number.isFinite(sem)) {
      return;
    }
    setLoadingLista(true);
    try {
      const params = new URLSearchParams({ semestre: String(sem) });
      const anio = anioIngresoCarrera !== '' ? Number(anioIngresoCarrera) : null;
      if (anio != null && Number.isFinite(anio)) {
        params.set('cohorteAnio', String(anio));
      }
      const data = await apiFetch<{ total: number; datos: AlumnoSemestreRow[] }>(
        `/academico/carreras/${cid}/alumnos-semestre-curricular?${params.toString()}`
      );
      const rowsRaw = data?.datos ?? [];
      const rows: AlumnoSemestreRow[] = rowsRaw.map((r) => ({
        ...r,
        cohorte_anio: r.cohorte_anio ?? null,
      }));
      setLista(rows);
      // Excluir automaticamente a los promocionados, igual que en facultad
      setIdsIncluidos(new Set(rows.filter((r) => !r.promocionado_en).map((r) => r.id)));
      // Colapsar grupos si hay mas de uno
      const claves = new Set(rows.map((r) => claveCohorte(r)));
      setGruposColapsados(claves.size > 1 ? new Set([...claves].map(String)) : new Set());
      if (rows.length) {
        toast.success(`${rows.length} alumno(s) en semestre ${sem}.`);
      } else {
        scrollListaTrasCargaRef.current = false;
        toast.error('Sin registros para ese semestre y año de ingreso.');
      }
    } catch (e) {
      scrollListaTrasCargaRef.current = false;
      const msg = e instanceof Error ? e.message : 'No se pudo cargar la lista';
      toast.error(msg);
      setLista([]);
      setIdsIncluidos(new Set());
    } finally {
      setLoadingLista(false);
    }
  }, [carreraId, semestre, anioIngresoCarrera]);

  useEffect(() => {
    if (!scrollListaTrasCargaRef.current || lista.length === 0) return;
    scrollListaTrasCargaRef.current = false;
    const id = requestAnimationFrame(() => {
      listaAlumnosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(id);
  }, [lista]);

  const handleCargarLista = () => {
    const cid = Number(carreraId);
    const sem = Number(semestre);
    if (!cid || !Number.isFinite(sem)) {
      toast.error('Elegí carrera y semestre.');
      return;
    }
    scrollListaTrasCargaRef.current = true;
    void cargarLista();
  };

  const quitarDePromocion = (alumnoId: string) => {
    setIdsIncluidos((prev) => {
      const next = new Set(prev);
      next.delete(alumnoId);
      return next;
    });
  };

  const restaurarTodos = () => {
    setIdsIncluidos(new Set(lista.map((r) => r.id)));
  };

  const ejecutarPromocion = async () => {
    const cid = Number(carreraId);
    const sem = Number(semestre);
    const ids = lista.filter((r) => idsIncluidos.has(r.id)).map((r) => r.id);
    if (!cid || !ids.length) {
      toast.error('No hay alumnos seleccionados para promocionar.');
      setConfirmOpen(false);
      return;
    }
    if (sem >= 10) {
      toast.error('No se puede ascender desde el semestre 10.');
      setConfirmOpen(false);
      return;
    }
    setLoadingPromo(true);
    try {
      const res = await apiFetch<{ actualizados: number }>(`/academico/carreras/${cid}/promocion-semestre-curricular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ semestreOrigen: sem, alumnoIds: ids }),
      });
      toast.success(`Promoción aplicada: ${res.actualizados} alumno(s) pasados a semestre ${sem + 1}.`);
      setConfirmOpen(false);
      await cargarLista();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo promocionar';
      toast.error(msg);
    } finally {
      setLoadingPromo(false);
    }
  };

  const semNum = Number(semestre);
  const puedePromocionar = Number.isFinite(semNum) && semNum >= 1 && semNum < 10 && lista.length > 0;
  const cantIncluidos = lista.filter((r) => idsIncluidos.has(r.id)).length;

  const maxCohorteEnLista = useMemo(() => {
    const nums = lista
      .map(claveCohorte)
      .filter((k) => k !== 'sin')
      .map((k) => parseInt(String(k)));
    return nums.length ? Math.max(...nums) : null;
  }, [lista]);

  const listaPorCohorte = useMemo(() => {
    const m = new Map<CohorteGrupoKey, AlumnoSemestreRow[]>();
    for (const row of lista) {
      const k = claveCohorte(row);
      const g = m.get(k);
      if (g) g.push(row);
      else m.set(k, [row]);
    }
    const keys = [...m.keys()].sort((a, b) => {
      if (a === 'sin') return 1;
      if (b === 'sin') return -1;
      const aProm = String(a).endsWith('_p');
      const bProm = String(b).endsWith('_p');
      const aNum = parseInt(String(a));
      const bNum = parseInt(String(b));
      if (aNum !== bNum) return bNum - aNum;
      if (aProm && !bProm) return 1;
      if (!aProm && bProm) return -1;
      return 0;
    });
    return keys.map((cohorte) => ({ cohorte, filas: m.get(cohorte) ?? [] }));
  }, [lista]);

  const totalMasivaEfectivo = useMemo(() => {
    if (!previewMasiva?.length) return 0;
    return previewMasiva
      .filter((f) => !excluirCarrerasMasiva.has(previewKey(f)))
      .reduce((acc, f) => acc + f.cantidadAlumnos, 0);
  }, [previewMasiva, excluirCarrerasMasiva]);

  const semMasivoNum = Number(semestreMasivo);
  const cohorteAnioMasivoNum = cohorteAnioMasivo !== '' ? Number(cohorteAnioMasivo) : null;
  const puedeEjecutarMasiva =
    Boolean(facultadMasivaId) &&
    Number.isFinite(semMasivoNum) &&
    semMasivoNum >= 1 &&
    semMasivoNum < 10 &&
    cohorteAnioMasivoNum != null &&
    Number.isFinite(cohorteAnioMasivoNum) &&
    totalMasivaEfectivo > 0;

  const vistaPreviaMasiva = useCallback(async () => {
    const fid = Number(facultadMasivaId);
    const sem = Number(semestreMasivo);
    const cohorte = cohorteAnioMasivo !== '' ? Number(cohorteAnioMasivo) : null;
    if (!fid || !Number.isFinite(sem)) {
      toast.error('Elegí facultad y semestre de origen.');
      return;
    }
    if (cohorte == null || !Number.isFinite(cohorte)) {
      toast.error('Elegí el año de ingreso para filtrar la promoción.');
      return;
    }
    setLoadingPreviewMasiva(true);
    try {
      const data = await apiFetch<{ filas: PreviewMasivaFila[]; totalAlumnos: number }>(
        '/academico/promocion-semestre-curricular/preview-facultad',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ facultadId: fid, semestreOrigen: sem, cohorteAnio: cohorte }),
        }
      );
      setPreviewMasiva(data.filas ?? []);
      const autoExcluir = new Set<string>();
      for (const f of data.filas ?? []) {
        if (f.promovidos) autoExcluir.add(previewKey(f));
      }
      setExcluirCarrerasMasiva(autoExcluir);
      const tot = data.totalAlumnos ?? 0;
      if (tot) {
        toast.success(`Vista previa: ${tot} alumno(s) en semestre ${sem}.`);
      } else {
        toast.error('Sin registros para ese semestre y año de ingreso.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo generar la vista previa';
      toast.error(msg);
      setPreviewMasiva(null);
      setExcluirCarrerasMasiva(new Set());
    } finally {
      setLoadingPreviewMasiva(false);
    }
  }, [facultadMasivaId, semestreMasivo, cohorteAnioMasivo]);

  const ejecutarMasiva = async () => {
    const fid = Number(facultadMasivaId);
    const sem = Number(semestreMasivo);
    const cohorte = cohorteAnioMasivo !== '' ? Number(cohorteAnioMasivo) : null;
    if (!puedeEjecutarMasiva || !fid || cohorte == null) {
      setConfirmMasivaOpen(false);
      return;
    }
    setLoadingEjecutarMasiva(true);
    try {
      const res = await apiFetch<{ actualizados: number }>('/academico/promocion-semestre-curricular/ejecutar-facultad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facultadId: fid,
          semestreOrigen: sem,
          excluirCarreraIds: [...new Set([...excluirCarrerasMasiva].map((k) => parseInt(k)))],
          cohorteAnio: cohorte,
        }),
      });
      toast.success(
        `Promoción masiva: ${res.actualizados} alumno(s) pasados de semestre ${sem} a ${sem + 1}.`
      );
      setConfirmMasivaOpen(false);
      await vistaPreviaMasiva();
      if (carreraId) void cargarLista();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo ejecutar la promoción masiva';
      toast.error(msg);
    } finally {
      setLoadingEjecutarMasiva(false);
    }
  };

  const toggleExcluirCarreraMasiva = (key: string) => {
    setExcluirCarrerasMasiva((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };


  return (
    <div className="system-bg app-shell-viewport text-slate-800 dark:text-[#e7eef9] overflow-hidden">
      <div className="app-layout-row">
        {sidebarOpen ? (
          <div className="app-sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
        ) : null}
        <AppSidebar sidebarOpen={sidebarOpen} onLogout={onLogout} onClose={() => setSidebarOpen(false)} />
        <main className="app-layout-main">
          <header className="flex shrink-0 min-h-16 min-w-0 items-center justify-between gap-3 py-2.5 px-4 sm:px-6 bg-white/95 backdrop-blur-md border-b border-slate-200 dark:bg-[#132a52]/90 dark:border-slate-800">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                className="app-menu-toggle text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                onClick={() => setSidebarOpen(true)}
                aria-label="Abrir menú"
              >
                <span className="material-symbols-outlined">menu</span>
              </button>
              <span className="material-symbols-outlined text-blue-600 dark:text-[#6b8bc3] shrink-0">upgrade</span>
              <div className="min-w-0">
                <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Gestión académica</p>
                <h1 className="text-xl font-semibold truncate max-lg:text-base">Promoción de semestre</h1>
              </div>
            </div>
          </header>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="scroll-region flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4">
            <AcademicoSubnav />
            {!ocultarFacultad ? (
              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 text-black shadow-sm dark:border-slate-800 dark:bg-[#132a52] dark:text-[#e7eef9] dark:shadow-none">
                <h2 className="text-lg font-semibold text-black dark:text-[#e7eef9]">Promoción por facultad</h2>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Permite avanzar el semestre curricular de todos los alumnos de una facultad en un único paso.
                  Seleccioná la <strong className="text-black dark:text-[#e7eef9]">facultad</strong>, el{' '}
                  <strong className="text-black dark:text-[#e7eef9]">semestre de origen</strong> y el{' '}
                  <strong className="text-black dark:text-[#e7eef9]">año de ingreso</strong> para acotar la operación a un grupo
                  específico y evitar que distintas promociones sean afectadas simultáneamente.
                  En la vista previa podés <strong className="text-black dark:text-[#e7eef9]">excluir carreras</strong> antes de confirmar.
                </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {!contextoSelectorListo ? (
                  <ScopeSelectorSkeleton soloFacultad className="lg:col-span-1" gridClassName="grid-cols-1" />
                ) : (
                <ScopeSelector
                  className="lg:col-span-1"
                  label="Facultad"
                  options={facultadesDisponibles}
                  value={facultadMasivaId}
                  placeholder="Seleccioná facultad"
                  onChange={(id) => {
                    setFacultadMasivaId(id);
                    setCohorteAnioMasivo('');
                    setPreviewMasiva(null);
                    setExcluirCarrerasMasiva(new Set());
                  }}
                />
                )}
                <div className="space-y-2">
                  <label className="text-xs uppercase text-slate-500 dark:text-slate-400">Semestre de origen</label>
                    <AppSelect
                      portal
                      columns={3}
                      columnsMobile={3}
                      aria-label="Semestre masivo"
                      listClassName="max-lg:!min-w-0 max-lg:w-full"
                    value={semestreMasivo}
                    disabled={!facultadMasivaId}
                    onChange={(v) => {
                      setSemestreMasivo(v);
                      setPreviewMasiva(null);
                      setExcluirCarrerasMasiva(new Set());
                    }}
                    options={Array.from({ length: 9 }, (_, i) => i + 1).map((n) => ({
                      value: String(n),
                      label: etiquetaSemestreOrdinal(n),
                    }))}
                    triggerClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 focus:border-primary focus:outline-none text-sm text-black dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9] disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase text-slate-500 dark:text-slate-400">
                    Año de ingreso <span className="text-rose-500 dark:text-rose-400 normal-case">*</span>
                  </label>
                    <AppSelect
                      portal
                      columns={5}
                      aria-label="Año de ingreso masiva"
                    value={cohorteAnioMasivo}
                    disabled={!facultadMasivaId}
                    onChange={(v) => {
                      setCohorteAnioMasivo(v);
                      setPreviewMasiva(null);
                      setExcluirCarrerasMasiva(new Set());
                    }}
                    placeholder="Año de ingreso"
                    options={Array.from({ length: new Date().getFullYear() - 2014 }, (_, i) => new Date().getFullYear() - i).map(
                      (y) => ({ value: String(y), label: String(y) })
                    )}
                    triggerClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 focus:border-primary focus:outline-none text-sm text-black dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9] disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="app-mobile-cta-footer flex items-end max-lg:w-full">
                  <button
                    type="button"
                    disabled={!facultadMasivaId || !cohorteAnioMasivo || loadingPreviewMasiva}
                    onClick={() => void vistaPreviaMasiva()}
                    className="btn-modern btn-modern-primary btn-mobile-cta w-full px-4 py-2 text-sm font-medium md:w-auto"
                  >
                    {loadingPreviewMasiva ? 'Calculando…' : 'Vista previa'}
                  </button>
                </div>
              </div>

              {previewMasiva && previewMasiva.length > 0 ? (
                <div>
                <div className="space-y-3 border border-slate-200 rounded-lg p-3 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/25">
                    <div className="flex flex-col gap-3 text-sm max-lg:items-stretch sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <span className="text-slate-600 dark:text-slate-300">
                      Total a promocionar:{' '}
                      <strong className="text-black dark:text-[#e7eef9]">{totalMasivaEfectivo}</strong> alumno(s) del año de ingreso{' '}
                      <strong className="text-black dark:text-[#e7eef9]">{cohorteAnioMasivo}</strong> → semestre{' '}
                      {Number(semestreMasivo) + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!puedeEjecutarMasiva}
                        onClick={() => setConfirmMasivaOpen(true)}
                        className="btn-modern btn-modern-success btn-mobile-cta shrink-0 px-3 py-1.5 text-sm font-medium max-md:w-full md:w-auto"
                      >
                        Promocionar todo (facultad)
                      </button>
                      <button
                        type="button"
                        onClick={() => { setPreviewMasiva(null); setExcluirCarrerasMasiva(new Set()); }}
                        className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:text-slate-300 dark:hover:bg-slate-800"
                        aria-label="Cerrar vista previa"
                      >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                      </button>
                    </div>
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-200 dark:border-slate-800 max-lg:max-h-none max-lg:overflow-visible lg:max-h-[min(280px,40vh)] lg:overflow-y-auto lg:overscroll-contain">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-100 dark:bg-slate-950/50 text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                        <tr>
                      <th className="px-3 py-2 w-10">Excluir</th>
                      <th className="px-3 py-2">Carrera</th>
                      <th className="px-3 py-2 text-right">Alumnos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewMasiva.map((fila) => {
                      const excl = excluirCarrerasMasiva.has(previewKey(fila));
                      const key = previewKey(fila);
                      return (
                        <tr
                          key={key}
                          className={excl ? 'opacity-45 border-t border-slate-800' : 'border-t border-slate-800'}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={excl}
                              onChange={() => toggleExcluirCarreraMasiva(key)}
                              aria-label={`Excluir ${fila.carreraNombre}`}
                            />
                          </td>
                          <td className="px-3 py-2 text-black dark:text-[#e7eef9]">
                            {fila.carreraNombre}
                            {fila.promovidos ? (
                              <span className="ml-1.5 text-[11px] text-amber-500">Promocionado</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{fila.cantidadAlumnos}</td>
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

            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 text-black shadow-sm dark:border-slate-800 dark:bg-[#132a52] dark:text-[#e7eef9] dark:shadow-none">
              <h2 className="text-lg font-semibold text-black dark:text-[#e7eef9]">Promoción por carrera</h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Permite revisar y ajustar individualmente los alumnos que serán promovidos al siguiente semestre.
                Seleccioná la <strong className="text-black dark:text-[#e7eef9]">carrera</strong>, el{' '}
                <strong className="text-black dark:text-[#e7eef9]">semestre de origen</strong> y el{' '}
                <strong className="text-black dark:text-[#e7eef9]">año de ingreso</strong> para visualizar el padrón correspondiente.
                Podés excluir alumnos de forma individual antes de confirmar la promoción.
              </p>

              {/* Fila 1: Facultad + Carrera (alcance del backend; cascada facultad → carrera) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {!contextoSelectorListo ? (
                  <ScopeSelectorSkeleton
                    soloCarrera={ocultarFacultad}
                    gridClassName={ocultarFacultad ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}
                    className="lg:col-span-4"
                  />
                ) : (
                  <>
                    {!ocultarFacultad ? (
                      <ScopeSelector
                        className="lg:col-span-2"
                        label="Facultad"
                        options={facultadesDisponibles}
                        value={facultadId}
                        placeholder="Seleccioná facultad"
                        onChange={(id) => {
                          setFacultadId(id);
                          setCarreraId('');
                          setLista([]);
                          setIdsIncluidos(new Set());
                        }}
                      />
                    ) : null}
                    <ScopeSelector
                      className={ocultarFacultad || facultadesDisponibles.length === 1 ? 'lg:col-span-4' : 'lg:col-span-2'}
                      label="Carrera"
                      options={carrerasDisponibles}
                      value={carreraId}
                      placeholder="Seleccioná carrera"
                      emptyOptionsHint={
                        requiereElegirFacultad ? 'Seleccioná facultad primero' : 'Sin carreras disponibles'
                      }
                      disabled={requiereElegirFacultad}
                      onChange={(id) => {
                        setCarreraId(id);
                        setLista([]);
                        setIdsIncluidos(new Set());
                      }}
                    />
                  </>
                )}
              </div>
              {/* Fila 2: Semestre + Año de ingreso + Botón */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <label className="text-xs uppercase text-slate-500 dark:text-slate-400">Semestre de origen</label>
                    <AppSelect
                      portal
                      columns={3}
                      columnsMobile={3}
                      aria-label="Semestre"
                      listClassName="max-lg:!min-w-0 max-lg:w-full"
                    value={semestre}
                    disabled={!carreraId}
                    onChange={(v) => {
                      setSemestre(v);
                      setLista([]);
                      setIdsIncluidos(new Set());
                    }}
                    options={Array.from({ length: 9 }, (_, i) => i + 1).map((n) => ({
                      value: String(n),
                      label: etiquetaSemestreOrdinal(n),
                    }))}
                    triggerClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 focus:border-primary focus:outline-none text-sm text-black dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9] disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase text-slate-500 dark:text-slate-400">
                    Año de ingreso <span className="text-rose-500 dark:text-rose-400 normal-case">*</span>
                  </label>
                    <AppSelect
                      portal
                      columns={5}
                      aria-label="Año de ingreso carrera"
                    value={anioIngresoCarrera}
                    disabled={!carreraId}
                    onChange={(v) => {
                      setAnioIngresoCarrera(v);
                      setLista([]);
                      setIdsIncluidos(new Set());
                    }}
                    placeholder="Año de ingreso"
                    options={Array.from({ length: new Date().getFullYear() - 2014 }, (_, i) => new Date().getFullYear() - i).map(
                      (y) => ({ value: String(y), label: String(y) })
                    )}
                    triggerClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 focus:border-primary focus:outline-none text-sm text-black dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9] disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="app-mobile-cta-footer flex items-end max-lg:w-full md:col-span-2">
                  <button
                    type="button"
                    disabled={!carreraId || !anioIngresoCarrera || loadingLista}
                    onClick={handleCargarLista}
                    className="btn-modern btn-modern-primary btn-mobile-cta w-full px-4 py-2 text-sm font-medium md:w-auto"
                  >
                    {loadingLista ? 'Cargando…' : 'Cargar lista'}
                  </button>
                </div>
              </div>
            </div>

            {lista.length > 0 ? (
              <div
                ref={listaAlumnosRef}
                className="scroll-mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-5 text-black shadow-sm dark:border-slate-800 dark:bg-[#132a52] dark:text-[#e7eef9] dark:shadow-none max-lg:p-3 max-lg:space-y-2.5"
              >
                <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-4 py-3.5 dark:border-slate-700 dark:from-[#0b2147]/55 dark:to-[#132a52] max-lg:px-3 max-lg:py-3">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between max-lg:gap-3">
                    <div className="min-w-0 space-y-2 max-lg:w-full">
                      <p className="text-xs font-semibold tracking-wide text-slate-600 dark:text-[#8fb4e8]">
                        Alumnos a promocionar
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 max-lg:flex-col max-lg:items-stretch max-lg:gap-2">
                        <span className="text-sm text-slate-600 dark:text-slate-300 max-lg:sr-only">De</span>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 max-lg:w-full">
                        <span className="text-sm text-slate-600 dark:text-slate-300 lg:hidden">De</span>
                        <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-base font-bold tabular-nums text-slate-900 shadow-sm dark:border-slate-600 dark:bg-[#0b2147] dark:text-[#e7eef9] dark:shadow-none">
                          <span className="material-symbols-outlined text-[18px] text-slate-500 dark:text-[#8fb4e8]" aria-hidden>
                            school
                          </span>
                          {etiquetaSemestreOrdinal(Number(semestre))}
                        </span>
                        <span className="material-symbols-outlined text-[20px] text-slate-400 dark:text-slate-500" aria-hidden>
                          arrow_forward
                        </span>
                        <span className="text-sm text-slate-600 dark:text-slate-300">a</span>
                        <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-base font-bold tabular-nums text-emerald-800 shadow-sm dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-100">
                          <span className="material-symbols-outlined text-[18px] text-emerald-600 dark:text-emerald-300" aria-hidden>
                            trending_up
                          </span>
                          {etiquetaSemestreOrdinal(Number(semestre) + 1)}
                        </span>
                        </div>
                      </div>
                      <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300 max-lg:w-full">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-medium tabular-nums text-slate-800 dark:border-slate-600 dark:bg-[#0b2147] dark:text-[#e7eef9]">
                          <span className="material-symbols-outlined text-[16px] text-primary dark:text-[#8fb4e8]" aria-hidden>
                            groups
                          </span>
                          {cantIncluidos} de {lista.length} alumnos incluidos
                        </span>
                      </p>
                    </div>
                    <div className="app-mobile-cta-footer btn-mobile-stack flex shrink-0 flex-wrap gap-2 max-lg:w-full max-lg:flex-col-reverse">
                      <button
                        type="button"
                        onClick={restaurarTodos}
                        className="btn-modern btn-modern-ghost btn-mobile-cta inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium max-md:w-full md:w-auto"
                      >
                        <span className="material-symbols-outlined text-[18px]" aria-hidden>
                          group_add
                        </span>
                        Incluir todos
                      </button>
                      <button
                        type="button"
                        disabled={!puedePromocionar || cantIncluidos === 0}
                        onClick={() => setConfirmOpen(true)}
                        className="btn-modern btn-modern-success btn-mobile-cta inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-semibold max-md:w-full max-md:py-3 md:w-auto"
                      >
                        <span className="material-symbols-outlined text-[18px]" aria-hidden>
                          upgrade
                        </span>
                        Promocionar al {etiquetaSemestreOrdinal(Number(semestre) + 1)}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setLista([]); setIdsIncluidos(new Set()); }}
                        className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:text-slate-300 dark:hover:bg-slate-700"
                        aria-label="Cerrar lista"
                      >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 max-lg:max-h-none max-lg:overflow-visible lg:max-h-[min(420px,50vh)] lg:overflow-hidden lg:overflow-y-auto lg:overscroll-contain">
                  {listaPorCohorte.map(({ cohorte, filas }) => {
                    const variasCohortes = listaPorCohorte.length > 1;
                    const esPromovido = cohorte !== 'sin' && grupoEsPromovido(filas);
                    const badgeReciente =
                      variasCohortes &&
                      cohorte !== 'sin' &&
                      maxCohorteEnLista != null &&
                      parseInt(String(cohorte)) === maxCohorteEnLista &&
                      !esPromovido;
                    const badgePrevia =
                      variasCohortes &&
                      cohorte !== 'sin' &&
                      maxCohorteEnLista != null &&
                      parseInt(String(cohorte)) < maxCohorteEnLista &&
                      !esPromovido;
                    const inclEnGrupo = filas.filter((r) => idsIncluidos.has(r.id)).length;
                    const idsGrupo = filas.map((r) => r.id);
                    const colapsado = gruposColapsados.has(String(cohorte));
                    return (
                      <div key={String(cohorte)} id={`grupo-${String(cohorte)}`} className="border-b border-slate-200 dark:border-slate-800 last:border-b-0">
                        <div
                          className="sticky top-0 z-[1] flex flex-wrap items-center gap-2 gap-y-1 border-b border-slate-200 bg-slate-50/95 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/95 max-lg:flex-col max-lg:items-stretch max-lg:gap-1.5 max-lg:px-4 max-lg:py-2.5 cursor-pointer"
                          onClick={() => {
                            const key = String(cohorte);
                            setGruposColapsados((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) {
                                next.delete(key);
                                // Scroll al expandir
                                setTimeout(() => {
                                  document.getElementById(`grupo-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }, 50);
                              } else {
                                next.add(key);
                              }
                              return next;
                            });
                          }}
                        >
                          <span className="material-symbols-outlined text-[16px] text-slate-400 shrink-0">{colapsado ? 'chevron_right' : 'expand_more'}</span>
                          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 max-lg:break-words">
                            {cohorte === 'sin'
                              ? 'Sin año de ingreso registrado'
                              : `Año de ingreso ${String(cohorte).replace('_p', '')}`}
                          </span>
                          {badgeReciente ? (
                            <span className="text-[10px] sm:text-xs rounded px-2 py-0.5 bg-emerald-900/50 text-emerald-200 border border-emerald-800/60">
                              Existente
                            </span>
                          ) : null}
                          {badgePrevia ? (
                            <span className="text-[10px] sm:text-xs rounded px-2 py-0.5 bg-slate-800 text-slate-300 border border-slate-600">
                              Año de ingreso anterior
                            </span>
                          ) : null}
                          {esPromovido ? (
                            <span className="text-[10px] sm:text-xs rounded px-2 py-0.5 bg-amber-900/50 text-amber-200 border border-amber-800/60">
                              Promocionado
                            </span>
                          ) : null}
                          <span className="text-xs tabular-nums text-slate-500 max-lg:w-full">
                            {inclEnGrupo}/{filas.length} incluidos
                          </span>
                          {variasCohortes ? (
                            <div className="ml-auto flex shrink-0 gap-1.5 max-lg:ml-0 max-lg:w-full max-lg:flex-wrap" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className="text-[11px] px-2 py-0.5 rounded border border-emerald-700/70 text-emerald-300 hover:bg-emerald-900/40"
                                title="Deseleccionar todos los otros grupos y quedarse solo con este"
                                onClick={() =>
                                  setIdsIncluidos(
                                    new Set(idsGrupo)
                                  )
                                }
                              >
                                Solo este grupo
                              </button>
                              {inclEnGrupo > 0 ? (
                                <button
                                  type="button"
                                  className={btnEliminarGrupoClass}
                                  title="Quitar todos los alumnos de este grupo de la promoción"
                                  onClick={() =>
                                    setIdsIncluidos((prev) => {
                                      const next = new Set(prev);
                                      idsGrupo.forEach((id) => next.delete(id));
                                      return next;
                                    })
                                  }
                                >
                                  <span className="material-symbols-outlined text-[14px]" aria-hidden>
                                    group_remove
                                  </span>
                                  No incluir grupo
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="text-[11px] px-2 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-800"
                                  title="Volver a incluir todos los alumnos de este grupo"
                                  onClick={() =>
                                    setIdsIncluidos((prev) => {
                                      const next = new Set(prev);
                                      idsGrupo.forEach((id) => next.add(id));
                                      return next;
                                    })
                                  }
                                >
                                  Incluir grupo
                                </button>
                              )}
                            </div>
                          ) : null}
                        </div>
                        {!colapsado ? (
                        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                          {filas.map((row) => {
                            const incl = idsIncluidos.has(row.id);
                            return (
                              <li
                                key={row.id}
                                className={`flex gap-3 px-3 py-2.5 text-sm max-lg:flex-col max-lg:items-stretch max-lg:gap-2 max-lg:px-4 max-lg:py-3 lg:items-center lg:justify-between ${
                                  incl ? 'bg-white dark:bg-slate-900/30' : 'bg-slate-50 opacity-60 dark:bg-slate-950/40'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium leading-snug max-lg:break-words max-lg:text-[15px] max-lg:whitespace-normal lg:truncate">
                                    {row.nombre_completo || '—'}
                                  </p>
                                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                    CI {row.numero_documento}
                                  </p>
                                </div>
                                {incl ? (
                                  <button
                                    type="button"
                                    onClick={() => quitarDePromocion(row.id)}
                                    className={`${btnEliminarAlumnoClass} max-lg:w-full max-lg:justify-center max-lg:py-2`}
                                    title="Eliminar de la promoción"
                                  >
                                    <span className="material-symbols-outlined text-[16px]" aria-hidden>
                                      person_remove
                                    </span>
                                    Eliminar
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setIdsIncluidos((prev) => new Set(prev).add(row.id))}
                                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-200 dark:hover:bg-slate-800 max-lg:w-full max-lg:justify-center max-lg:py-2"
                                  >
                                    <span className="material-symbols-outlined text-[16px]" aria-hidden>
                                      person_add
                                    </span>
                                    Incluir
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            </div>
          </section>
        </main>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void ejecutarPromocion()}
        title="Confirmar promoción de semestre"
        description={`Se actualizará el semestre curricular de ${cantIncluidos} alumno(s) de ${semestre} a ${Number(semestre) + 1}. Esta acción no crea ni modifica matrículas en cursos.`}
        confirmLabel="Promocionar"
        variant="warning"
        loading={loadingPromo}
      />

      <ConfirmDialog
        open={confirmMasivaOpen}
        onCancel={() => setConfirmMasivaOpen(false)}
        onConfirm={() => void ejecutarMasiva()}
        title="Confirmar promoción masiva"
        description={`Se actualizará el semestre curricular de ${totalMasivaEfectivo} alumno(s) del año de ingreso ${cohorteAnioMasivo} de semestre ${semestreMasivo} a ${Number(semestreMasivo) + 1} en todas las carreras incluidas. No modifica matrículas en cursos.`}
        confirmLabel="Promocionar todo"
        variant="warning"
        loading={loadingEjecutarMasiva}
      />
    </div>
  );
}
