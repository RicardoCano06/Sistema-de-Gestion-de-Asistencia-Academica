import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '../utils/toast';
import { AcademicoSubnav } from '../components/AcademicoSubnav';
import { AppSidebar } from '../components/AppSidebar';
import { ScopeSelector, ScopeSelectorSkeleton, useAutoAssignScopeId } from '../components/ScopeSelector';
import { calcularContextoSelectorListo, deriveAlcanceVisual } from '../hooks/useAlcanceVisual';
import { useMisAlcances } from '../hooks/useMisAlcances';
import { AppSelect, appSelectDarkSurfaceClass } from '../components/ui/app-select';
import { Skeleton } from '../components/ui/skeleton';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { EditItemDialog } from '../components/ui/edit-item-dialog';
import type { EditFormField } from '../components/ui/edit-item-dialog';
import { apiFetch } from '../utils/api';
import CronogramaCatedra from '../components/CronogramaCatedra';

type Modulo = {
  id: number;
  materia_id: number;
  anio: number;
  mes: number;
  fecha_inicio: string;
  fecha_fin: string;
  estado: string;
  materia?: string;
  carrera_id?: number;
};

type Curso = {
  id: number;
  modulo_id: number;
  docente_id: string;
  docente?: string;
  estado_modulo?: string;
  materia?: string;
  inscriptos?: number;
  carrera_id?: number;
  anio?: number;
  mes?: number;
  aula?: string | null;
  horario_inicio?: string | null;
  horario_fin?: string | null;
  cupo?: number | null;
  notas?: string | null;
};

type Matricula = {
  id: number;
  alumno_id: string;
  numero_documento: string;
  nombre_completo: string;
  estado_academico: string;
  porcentaje_asistencia: number;
  faltas_acumuladas: number;
  fecha_inscripcion: string;
};

type AlumnoBusqueda = {
  id: string;
  numero_documento: string;
  nombre_apellido?: string;
  nombres?: string;
  apellidos?: string;
};

type LoteAlumnos = {
  id: number;
  descripcion: string | null;
  total_registros: number | null;
  procesados: number | null;
  estado: string;
  ejecutado_en: string;
  destino_carrera: string | null;
  destino_carrera_id: number | null;
  /** Alumnos de la carrera del lote con semestre_curricular = semestre parseado de `descripcion` (0 = vacío). */
  alumnos_en_etiqueta_semestre?: number | null;
  cohorte_anio?: number | null;
};

type DocenteOption = {
  id: string;
  nombres: string;
  apellidos: string;
  email: string;
  username?: string | null;
  persona?: {
    tipo: 'docente';
    id: string;
    legajo?: string | null;
  } | null;
};

type Facultad = {
  id: number;
  nombre: string;
  estado: boolean;
};

type Carrera = {
  id: number;
  facultad_id: number;
  facultad?: string;
  nombre: string;
  codigo?: string | null;
};

type Plan = {
  id: number;
  carrera_id: number;
  carrera?: string;
  nombre: string;
  resolucion?: string | null;
  anio_vigencia?: number | null;
};

/** Respuesta de POST /academico/planes cuando se creó o reutilizó carrera/facultad a partir de sugerencias UI. */
type PlanCreadoResponse = Plan & { carreraResuelta?: Carrera; facultadResuelta?: Facultad };

type Materia = {
  id: number;
  plan_id: number;
  plan?: string;
  nombre: string;
  codigo: string;
  /** Orden curricular dentro del plan (1 = primer semestre). */
  semestre?: number;
};

/** Partes numéricas de códigos tipo 1.1, 1.2, 2.10; null si no encaja en ese patrón. */
function parseCodigoCurricularPartesNumericas(codigo: string | undefined | null): number[] | null {
  if (codigo == null || !String(codigo).trim()) return null;
  const partes = String(codigo)
    .trim()
    .split(/[.\-]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length === 0) return null;
  const nums: number[] = [];
  for (const p of partes) {
    if (!/^\d+$/.test(p)) return null;
    nums.push(Number(p));
  }
  return nums;
}

/** Orden ascendente por código curricular (1.1 antes que 1.2 y que 1.10). Si ambos son N.N… numérico; si no, por código y nombre. */
function compareMateriasCurriculares(a: Materia, b: Materia): number {
  const pa = parseCodigoCurricularPartesNumericas(a.codigo);
  const pb = parseCodigoCurricularPartesNumericas(b.codigo);
  if (pa !== null && pb !== null) {
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const da = pa[i] ?? 0;
      const db = pb[i] ?? 0;
      if (da !== db) return da - db;
    }
    return 0;
  }
  const byCodigo = (a.codigo ?? '').localeCompare(b.codigo ?? '', 'es', { numeric: true, sensitivity: 'base' });
  if (byCodigo !== 0) return byCodigo;
  return a.nombre.localeCompare(b.nombre, 'es');
}

const FACULTADES_PREDEFINIDAS = [
  'Facultad de Ciencias Empresariales',
  'Facultad de Humanidades y Ciencias de la Educación',
  'Facultad de Derecho y Ciencias Sociales',
  'Facultad de Ciencias y Tecnología',
] as const;

const FACULTADES_CANONICAS = new Map(
  FACULTADES_PREDEFINIDAS.map((nombre) => [normalizarTexto(nombre), nombre] as const)
);

const CARRERAS_CANONICAS = new Map<string, string>([
  [normalizarTexto('ing. en informatica'), 'Ingeniería Informática'],
  [normalizarTexto('ing en informatica'), 'Ingeniería Informática'],
  [normalizarTexto('ingenieria informatica'), 'Ingeniería Informática'],
  [normalizarTexto('Ingenieria Informática'), 'Ingeniería Informática'],
  [normalizarTexto('Ingeniería Informática'), 'Ingeniería Informática'],
  [normalizarTexto('Ingenieria Electromecánica'), 'Ingeniería Electromecánica'],
  [normalizarTexto('Ingenieria Agronómica'), 'Ingeniería Agronómica'],
  [normalizarTexto('Ciencias de la Educación'), 'Licenciatura en Ciencias de la Educación'],
  [normalizarTexto('Psicología'), 'Licenciatura en Psicología Clínica'],
  [normalizarTexto('Psicologia'), 'Licenciatura en Psicología Clínica'],
  [normalizarTexto('Ciencias del Deporte'), 'Licenciatura en Ciencias del Deporte'],
  [normalizarTexto('Educación Inicial'), 'Licenciatura en Educación Inicial'],
  [normalizarTexto('Educación Escolar Básica'), 'Licenciatura en Educación Escolar Básica'],
  [normalizarTexto('Diseño Gráfico'), 'Licenciatura en Diseño Gráfico'],
]);

const CARRERAS_PREDEFINIDAS: Readonly<Record<string, readonly string[]>> = {
  'Facultad de Ciencias Empresariales': [
    'Ciencias Contables',
    'Administración de Empresas',
    'Ingeniería Comercial',
  ],
  'Facultad de Humanidades y Ciencias de la Educación': [
    'Licenciatura en Ciencias de la Educación',
    'Licenciatura en Psicología Clínica',
    'Licenciatura en Ciencias del Deporte',
    'Licenciatura en Educación Inicial',
    'Licenciatura en Educación Escolar Básica',
  ],
  'Facultad de Derecho y Ciencias Sociales': [
    'Derecho',
    'Notariado',
  ],
  'Facultad de Ciencias y Tecnología': [
    'Ingeniería Informática',
    'Licenciatura en Diseño Gráfico',
    'Ingeniería Electromecánica',
    'Ingeniería Agronómica',
  ],
};

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

interface Props {
  onLogout?: () => void;
}

interface ApiList<T> {
  total: number;
  datos: T[];
}

function formatDocenteLabel(docente: DocenteOption) {
  const label = `${docente.apellidos ?? ''}, ${docente.nombres ?? ''}`.replace(/^,\s*/, '').trim().replace(/,\s*$/, '').trim();
  return label || docente.username || docente.email || `Usuario ${docente.id}`;
}

function formatHorarioCurso(valor?: string | null): string | null {
  if (!valor) return null;
  const s = String(valor).trim();
  const match = s.match(/^(\d{1,2}:\d{2})/);
  return match ? match[1] : s;
}

/** Aula y horario en una línea secundaria; null si no hay datos. */
function formatCursoUbicacionHorario(curso: Pick<Curso, 'aula' | 'horario_inicio' | 'horario_fin'>): string | null {
  const partes: string[] = [];
  const aula = curso.aula?.trim();
  if (aula) partes.push(`Aula ${aula}`);
  const inicio = formatHorarioCurso(curso.horario_inicio);
  const fin = formatHorarioCurso(curso.horario_fin);
  if (inicio && fin) partes.push(`${inicio} – ${fin}`);
  else if (inicio) partes.push(`desde ${inicio}`);
  else if (fin) partes.push(`hasta ${fin}`);
  return partes.length ? partes.join(' · ') : null;
}

function normalizarTexto(valor: string) {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/°/g, ' ')
    .toLowerCase()
    .trim();
}

function normalizarBusqueda(valor: string) {
  return normalizarTexto(valor)
    .replace(/(\d+)(?:do|da|er|ro|ra)\b/gi, '$1');
}

function textoCoincideBusqueda(haystack: string, query: string): boolean {
  const q = normalizarBusqueda(query);
  if (!q) return true;
  const h = normalizarTexto(haystack);
  if (/^\d+$/.test(q)) {
    // Numeros: match exacto de palabra para que "1" no matchee "10"
    const palabras = h.split(/[\s,.;:()°]+/).filter(Boolean);
    return palabras.some((p) => p === q);
  }
  return h.includes(q);
}

function extraerNumeroSemestre(descripcion?: string | null) {
  if (!descripcion) return null;

  const matchDirecto = descripcion.match(/semestre\s*(\d{1,2})/i);
  if (matchDirecto) return Number(matchDirecto[1]);

  const matchInvertido = descripcion.match(/(\d{1,2})\s*°?\s*semestre/i);
  if (matchInvertido) return Number(matchInvertido[1]);

  return null;
}

function formatearSemestre(numero: number) {
  return `${numero}° Semestre`;
}

/** Semestre del plan (`materias.semestre`) asociado al módulo del curso. */
function obtenerSemestrePlanCurso(curso: Curso, modulos: Modulo[], materias: Materia[]): number | null {
  const modulo = modulos.find((m) => m.id === curso.modulo_id);
  if (!modulo) return null;
  const materia = materias.find((m) => m.id === modulo.materia_id);
  const sem = materia?.semestre;
  if (sem == null || !Number.isFinite(Number(sem)) || Number(sem) < 1) return null;
  return Number(sem);
}

const MAX_SEMESTRE_PLAN = 10;

const ANIO_MODULO_ATRAS = 5;
const ANIO_MODULO_ADELANTE = 10;

function limitesAnioModulo() {
  const y = new Date().getFullYear();
  return { min: y - ANIO_MODULO_ATRAS, max: y + ANIO_MODULO_ADELANTE };
}

function opcionesAnioModulo(): { value: string; label: string }[] {
  const { min, max } = limitesAnioModulo();
  const options: { value: string; label: string }[] = [];
  for (let y = min; y <= max; y++) {
    options.push({ value: String(y), label: String(y) });
  }
  return options;
}

function opcionesAnioVigencia(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let y = 2016; y <= 2036; y++) {
    options.push({ value: String(y), label: String(y) });
  }
  return options;
}

/** Primer y último día del mes calendario del módulo (mes 1–12). */
function rangoFechasMesModulo(anio: string | number, mes: string | number): { min: string; max: string } | null {
  const a = Number(anio);
  const m = Number(mes);
  if (!Number.isInteger(a) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  const ultimoDia = new Date(a, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return {
    min: `${a}-${mm}-01`,
    max: `${a}-${mm}-${String(ultimoDia).padStart(2, '0')}`,
  };
}

/** Listas académicas: lo más reciente primero (id), luego período. */
function compareModuloRecientePrimero(a: Modulo, b: Modulo) {
  return b.id - a.id || b.anio - a.anio || b.mes - a.mes;
}

function compareCursoRecientePrimero(a: Curso, b: Curso) {
  return b.id - a.id || (b.anio ?? 0) - (a.anio ?? 0) || (b.mes ?? 0) - (a.mes ?? 0);
}

function mensajeErrorFechasModuloEnMes(
  anio: number,
  mes: number,
  fechaInicio: string,
  fechaFin: string
): string | null {
  const rango = rangoFechasMesModulo(anio, mes);
  if (!rango) return 'Año y mes no válidos.';
  const mesNombre = MESES[mes - 1] ?? `mes ${mes}`;
  if (fechaInicio < rango.min || fechaInicio > rango.max) {
    return `La fecha de inicio debe estar dentro de ${mesNombre} ${anio}.`;
  }
  if (fechaFin < rango.min || fechaFin > rango.max) {
    return `La fecha de fin debe estar dentro de ${mesNombre} ${anio}.`;
  }
  if (fechaFin < fechaInicio) {
    return 'La fecha de fin no puede ser anterior a la de inicio.';
  }
  return null;
}

/** Mismo aspecto que filtros del Panel (`ScopeSelector` + `shadow-sm` en claro). */
const inpListaFiltro =
  'w-full pl-7 pr-2 py-1.5 rounded-md border border-slate-300 text-xs text-black placeholder:text-slate-400 ' +
  'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/25 ' +
  'dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9] dark:placeholder:text-slate-500';

const inpScope =
  'w-full py-1.5 text-sm rounded-lg border border-slate-300 bg-white text-black shadow-sm pl-3 pr-3 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 ' +
  appSelectDarkSurfaceClass;

export function AcademicoAdminPage({ onLogout }: Props) {
  const { alcance, listo: alcanceListo } = useMisAlcances();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modulos, setModulos] = useState<Modulo[]>([]);
  const [cursos, setCursos] = useState<Curso[]>([]);
  const [facultades, setFacultades] = useState<Facultad[]>([]);
  const [carreras, setCarreras] = useState<Carrera[]>([]);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [docentes, setDocentes] = useState<DocenteOption[]>([]);
  const [loading, setLoading] = useState(true);

  type PendingDelete = { title: string; description: string; confirmLabel?: string; onConfirm: () => Promise<void> } | null;
  type PendingEdit = { title: string; fields: EditFormField[]; onSave: (v: Record<string, string>) => Promise<void> } | null;
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit>(null);
  const [dialogLoading, setDialogLoading] = useState(false);

  const [moduloForm, setModuloForm] = useState({ materiaId: '', anio: String(new Date().getFullYear()), mes: '', fechaInicio: '', fechaFin: '' });
  /** Filtro de semestre para el formulario "Abrir período académico" (solo materias de ese semestre). */
  const [moduloFiltroSemestre, setModuloFiltroSemestre] = useState('');
  const [cursoForm, setCursoForm] = useState({ moduloId: '', docenteId: '' });
  const [cursoFiltroSemestre, setCursoFiltroSemestre] = useState('');
  const [cursoFiltroAnio, setCursoFiltroAnio] = useState('');
  const [docenteSearch, setDocenteSearch] = useState('');
  const [docenteSearchOpen, setDocenteSearchOpen] = useState(false);
  const [facultadSeleccionadaId, setFacultadSeleccionadaId] = useState('');
  const [carreraSeleccionadaId, setCarreraSeleccionadaId] = useState('');
  const [planForm, setPlanForm] = useState({ nombre: '', resolucion: '', anioVigencia: '' });
  const [materiaForm, setMateriaForm] = useState({ nombre: '', codigo: '' });

  // Planilla de alumnos por curso
  const [selectedCursoId, setSelectedCursoId] = useState<number | null>(null);
  const [planillaMap, setPlanillaMap] = useState<Map<number, Matricula[]>>(new Map());
  const [planillaLoading, setPlanillaLoading] = useState(false);
  const [alumnoSearch, setAlumnoSearch] = useState('');
  const [alumnoResultados, setAlumnoResultados] = useState<AlumnoBusqueda[]>([]);
  const [alumnoSearchLoading, setAlumnoSearchLoading] = useState(false);
  const [alumnoSearchOpen, setAlumnoSearchOpen] = useState(false);
  const alumnoSearchWrapRef = useRef<HTMLDivElement>(null);
  const planillaPanelRef = useRef<HTMLDivElement>(null);
  const [copiarDesdeCursoId, setCopiarDesdeCursoId] = useState('');
  const [lotesAlumnos, setLotesAlumnos] = useState<LoteAlumnos[]>([]);
  const [semestreLotePorCurso, setSemestreLotePorCurso] = useState<Record<number, string>>({});
  const [loteImportLoading, setLoteImportLoading] = useState(false);
  const [expandedPlanId, setExpandedPlanId] = useState<number | null>(null);
  const [showAddPlanForm, setShowAddPlanForm] = useState(false);
  const [addMateriaForPlanId, setAddMateriaForPlanId] = useState<number | null>(null);
  const [materiaSaving, setMateriaSaving] = useState(false);
  /** Semestre elegido por plan (`undefined` = aún no eligió; no se puede agregar materia). */
  const [semestrePorPlan, setSemestrePorPlan] = useState<Partial<Record<number, number>>>({});
  const [moduloListaBusqueda, setModuloListaBusqueda] = useState('');
  const [moduloListaAnio, setModuloListaAnio] = useState('');
  const [cursoListaBusqueda, setCursoListaBusqueda] = useState('');
  const [cursoListaAnio, setCursoListaAnio] = useState('');
  const [modulosPagina, setModulosPagina] = useState(0);
  const [cursosPagina, setCursosPagina] = useState(0);

  const PAGINA_TAMANO = 4;
  const PLANILLA_PAGE_SIZE = 5;
  const [planillaPage, setPlanillaPage] = useState(0);

  const alcanceVisualAcademico = useMemo(
    () => deriveAlcanceVisual(alcance),
    [alcance.carreras.length, alcance.facultades.length]
  );

  const rangoFechasModuloForm = useMemo(
    () => rangoFechasMesModulo(moduloForm.anio, moduloForm.mes),
    [moduloForm.anio, moduloForm.mes]
  );

  const sortedModulos = useMemo(() => {
    if (!carreraSeleccionadaId) return [];
    const carreraId = Number(carreraSeleccionadaId);
    return [...modulos]
      .filter((m) => m.carrera_id === carreraId)
      .sort(compareModuloRecientePrimero);
  }, [modulos, carreraSeleccionadaId]);

  /** Semestres disponibles en los módulos de la carrera seleccionada (para el formulario "Nuevo curso"). */
  const semestresCursoDisponibles = useMemo(() => {
    const carreraId = Number(carreraSeleccionadaId);
    const planIds = new Set(planes.filter((p) => p.carrera_id === carreraId).map((p) => p.id));
    const materiasCarrera = materias.filter((m) => planIds.has(m.plan_id));
    const materiasBySem = new Map<number, Set<number>>();
    for (const mat of materiasCarrera) {
      const sem = mat.semestre ?? 0;
      if (!materiasBySem.has(sem)) materiasBySem.set(sem, new Set());
      materiasBySem.get(sem)!.add(mat.id);
    }
    const sems: number[] = [];
    for (const [sem, matIds] of materiasBySem) {
      if (modulos.some((mod) => matIds.has(mod.materia_id))) sems.push(sem);
    }
    return sems.sort((a, b) => a - b);
  }, [modulos, materias, planes, carreraSeleccionadaId]);

  /** Módulos de la carrera seleccionada filtrados por el semestre del formulario "Nuevo curso". */
  const sortedModulosCurso = useMemo(() => {
    if (!cursoFiltroSemestre) return [];
    const sem = Number(cursoFiltroSemestre);
    const carreraId = Number(carreraSeleccionadaId);
    const planIds = new Set(planes.filter((p) => p.carrera_id === carreraId).map((p) => p.id));
    const materiaIds = new Set(
      materias.filter((m) => planIds.has(m.plan_id) && (m.semestre ?? 0) === sem).map((m) => m.id)
    );
    return [...modulos]
      .filter((m) => materiaIds.has(m.materia_id))
      .sort(compareModuloRecientePrimero);
  }, [modulos, materias, planes, carreraSeleccionadaId, cursoFiltroSemestre]);

  const aniosDisponiblesModulosCurso = useMemo(() => {
    const set = new Set<number>();
    for (const m of sortedModulosCurso) {
      if (m.anio != null && Number.isFinite(m.anio)) set.add(m.anio);
    }
    return [...set].sort((a, b) => a - b);
  }, [sortedModulosCurso]);

  const modulosCursoFiltrados = useMemo(() => {
    const anioFiltro = Number(cursoFiltroAnio);
    if (!Number.isFinite(anioFiltro) || anioFiltro <= 0) return sortedModulosCurso;
    return sortedModulosCurso.filter((m) => m.anio === anioFiltro);
  }, [sortedModulosCurso, cursoFiltroAnio]);

  const docentesOrdenados = useMemo(
    () => [...docentes].sort((a, b) => `${a.apellidos} ${a.nombres}`.localeCompare(`${b.apellidos} ${b.nombres}`, 'es')),
    [docentes]
  );

  const docentesFiltrados = useMemo(() => {
    const term = docenteSearch.trim().toLowerCase();
    const base = term
      ? docentesOrdenados.filter((item) => {
          const text = `${item.nombres ?? ''} ${item.apellidos ?? ''} ${item.email ?? ''} ${item.username ?? ''} ${item.persona?.legajo ?? ''}`.toLowerCase();
          return text.includes(term);
        })
      : docentesOrdenados;

    return base;
  }, [docenteSearch, docentesOrdenados]);

  const facultadesOpciones = useMemo(() => {
    const lista = [...facultades];
    const facultadesUnicas = new Map<string, Facultad>();

    for (const facultad of lista) {
      const key = normalizarTexto(facultad.nombre);
      const canonicalNombre = FACULTADES_CANONICAS.get(key) ?? facultad.nombre;
      const existente = facultadesUnicas.get(key);

      // Preferimos IDs reales positivos cuando hay duplicados.
      if (!existente || (existente.id < 0 && facultad.id > 0)) {
        facultadesUnicas.set(key, { ...facultad, nombre: canonicalNombre });
      }
    }

    const listaFinal = [...facultadesUnicas.values()];
    let syntheticId = -1;

    if (alcanceVisualAcademico === 'institucional') {
      for (const nombre of FACULTADES_PREDEFINIDAS) {
        const existe = listaFinal.some((item) => normalizarTexto(item.nombre) === normalizarTexto(nombre));
        if (existe) continue;
        listaFinal.push({ id: syntheticId, nombre, estado: true });
        syntheticId -= 1;
      }
    }

    return listaFinal.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [facultades, alcanceVisualAcademico]);

  const carrerasOpciones = useMemo(() => {
    const carrerasUnicas = new Map<string, Carrera>();
    for (const carrera of carreras) {
      const canonicalNombre = CARRERAS_CANONICAS.get(normalizarTexto(carrera.nombre)) ?? carrera.nombre;
      const key = `${carrera.facultad_id}:${normalizarTexto(canonicalNombre)}`;
      const existente = carrerasUnicas.get(key);
      if (!existente || (existente.id < 0 && carrera.id > 0)) {
        carrerasUnicas.set(key, { ...carrera, nombre: canonicalNombre });
      }
    }

    const lista = [...carrerasUnicas.values()];
    let syntheticCarreraId = -1;

    if (alcanceVisualAcademico === 'institucional') {
      const facultadesPorNombre = new Map<string, Facultad>();
      facultadesOpciones.forEach((facultad) => {
        facultadesPorNombre.set(normalizarTexto(facultad.nombre), facultad);
      });

      const carreraKeys = new Set(lista.map((carrera) => `${carrera.facultad_id}:${normalizarTexto(carrera.nombre)}`));

      for (const [facultadNombre, carrerasPredefinidas] of Object.entries(CARRERAS_PREDEFINIDAS)) {
        const facultad = facultadesPorNombre.get(normalizarTexto(facultadNombre));
        if (!facultad) continue;

        for (const nombreCarrera of carrerasPredefinidas) {
          const key = `${facultad.id}:${normalizarTexto(nombreCarrera)}`;
          if (carreraKeys.has(key)) continue;

          lista.push({
            id: syntheticCarreraId,
            facultad_id: facultad.id,
            nombre: nombreCarrera,
            codigo: null,
          });
          syntheticCarreraId -= 1;
          carreraKeys.add(key);
        }
      }
    }

    return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [carreras, facultadesOpciones, alcanceVisualAcademico]);

  const facultadesDisponibles = useMemo(() => {
    if (alcance.facultades.length > 0) {
      return alcance.facultades.map((f) => ({ id: f.id, nombre: f.nombre }));
    }
    return facultadesOpciones
      .filter((f) => f.id > 0)
      .map((f) => ({ id: f.id, nombre: f.nombre }));
  }, [alcance.facultades, facultadesOpciones]);

  const carrerasEnAlcance = useMemo(() => {
    const base = carrerasOpciones.filter((c) => Number(c.id) > 0);
    if (alcance.carreras.length === 0) return base;
    const ids = new Set(alcance.carreras.map((c) => c.id));
    return base.filter((c) => ids.has(c.id));
  }, [alcance.carreras, carrerasOpciones]);

  const carrerasFiltradas = useMemo(() => {
    if (alcanceVisualAcademico === 'carrera') {
      return carrerasEnAlcance;
    }
    const facultadId = Number(facultadSeleccionadaId);
    if (!facultadId) return [];
    return carrerasEnAlcance.filter((carrera) => carrera.facultad_id === facultadId);
  }, [facultadSeleccionadaId, carrerasEnAlcance, alcanceVisualAcademico]);

  const carrerasOpcionesSelector = useMemo(
    () => carrerasFiltradas.map((c) => ({ id: c.id, nombre: c.nombre })),
    [carrerasFiltradas]
  );

  useAutoAssignScopeId(
    alcanceVisualAcademico === 'carrera' ? [] : facultadesDisponibles,
    facultadSeleccionadaId,
    setFacultadSeleccionadaId
  );
  useAutoAssignScopeId(carrerasOpcionesSelector, carreraSeleccionadaId, setCarreraSeleccionadaId);

  /** Jefe de carrera: la carrera se autoasigna pero la facultad no; se deriva del catálogo. */
  useEffect(() => {
    if (!carreraSeleccionadaId) return;
    const carrera =
      carrerasFiltradas.find((c) => String(c.id) === carreraSeleccionadaId) ??
      carrerasEnAlcance.find((c) => String(c.id) === carreraSeleccionadaId);
    if (carrera?.facultad_id) {
      const facId = String(carrera.facultad_id);
      if (facultadSeleccionadaId !== facId) setFacultadSeleccionadaId(facId);
    }
  }, [carreraSeleccionadaId, carrerasFiltradas, carrerasEnAlcance, facultadSeleccionadaId]);

  const facultadSeleccionada = useMemo(() => {
    const id = Number(facultadSeleccionadaId);
    return facultadesOpciones.find((facultad) => facultad.id === id) ?? null;
  }, [facultadSeleccionadaId, facultadesOpciones]);

  const carreraSeleccionada = useMemo(() => {
    const id = Number(carreraSeleccionadaId);
    return carrerasFiltradas.find((carrera) => carrera.id === id) ?? null;
  }, [carreraSeleccionadaId, carrerasFiltradas]);

  /** Con carrera seleccionada se habilitan período, curso y planilla (facultad se deriva de la carrera). */
  const contextoAcademicoListo = Boolean(carreraSeleccionadaId);

  const contextoSelectorListo = calcularContextoSelectorListo({
    alcanceListo,
    datosListos: !loading,
    alcanceVisual: alcanceVisualAcademico,
    carrerasOpciones: carrerasOpcionesSelector,
    carreraId: carreraSeleccionadaId,
  });

  const docenteSeleccionado = useMemo(
    () => docentes.find((item) => (item.persona?.id ?? item.id) === cursoForm.docenteId) ?? null,
    [cursoForm.docenteId, docentes]
  );

  const planesDeCarrera = useMemo(() => {
    if (!carreraSeleccionadaId) return [];
    return planes.filter((p) => p.carrera_id === Number(carreraSeleccionadaId));
  }, [planes, carreraSeleccionadaId]);

  const materiasPorPlan = useMemo(() => {
    const map = new Map<number, Materia[]>();
    for (const m of materias) {
      if (!map.has(m.plan_id)) map.set(m.plan_id, []);
      map.get(m.plan_id)!.push(m);
    }
    return map;
  }, [materias]);

  const materiasDeCarrera = useMemo(() => {
    if (!carreraSeleccionadaId) return materias;
    const planIds = new Set(planesDeCarrera.map((p) => p.id));
    return materias.filter((m) => planIds.has(m.plan_id));
  }, [materias, planesDeCarrera, carreraSeleccionadaId]);

  const materiasBaseModulo = useMemo(
    () => (carreraSeleccionadaId ? materiasDeCarrera : materias),
    [carreraSeleccionadaId, materiasDeCarrera, materias]
  );

  const materiasParaModuloPeriodo = useMemo(() => {
    if (moduloFiltroSemestre === '') return [];
    const sem = Number(moduloFiltroSemestre);
    return materiasBaseModulo
      .filter((m) => (m.semestre ?? 1) === sem)
      .sort(compareMateriasCurriculares);
  }, [materiasBaseModulo, moduloFiltroSemestre]);

  // Cursos filtrados: solo los de la carrera seleccionada
  const cursosFiltradosPorCarrera = useMemo(() => {
    if (!carreraSeleccionadaId) return [];
    return cursos
      .filter((c) => c.carrera_id === Number(carreraSeleccionadaId))
      .sort(compareCursoRecientePrimero);
  }, [cursos, carreraSeleccionadaId]);

  const aniosDisponiblesModulos = useMemo(() => {
    const set = new Set<number>();
    for (const m of sortedModulos) {
      if (m.anio != null && Number.isFinite(m.anio)) set.add(m.anio);
    }
    return [...set].sort((a, b) => b - a);
  }, [sortedModulos]);

  const modulosListaVisibles = useMemo(() => {
    const anioFiltro = moduloListaAnio ? Number(moduloListaAnio) : null;
    return sortedModulos.filter((mod) => {
      if (anioFiltro != null && mod.anio !== anioFiltro) return false;
      const periodo = `${MESES[(mod.mes ?? 1) - 1]} ${mod.anio ?? ''}`;
      const mat = materias.find((m) => m.id === mod.materia_id);
      const semTexto = mat?.semestre ? `${formatearSemestre(mat.semestre)} ${mat.semestre}` : '';
      const texto = [mod.materia ?? '', semTexto, periodo, mod.estado ?? ''].join(' ');
      return textoCoincideBusqueda(texto, moduloListaBusqueda);
    });
  }, [sortedModulos, moduloListaAnio, moduloListaBusqueda, materias]);

  const modulosPaginaTotal = Math.max(1, Math.ceil(modulosListaVisibles.length / PAGINA_TAMANO));

  const aniosDisponiblesCursos = useMemo(() => {
    const set = new Set<number>();
    for (const c of cursosFiltradosPorCarrera) {
      if (c.anio != null && Number.isFinite(c.anio)) set.add(c.anio);
    }
    return [...set].sort((a, b) => b - a);
  }, [cursosFiltradosPorCarrera]);

  const cursosListaVisibles = useMemo(() => {
    const anioFiltro = cursoListaAnio ? Number(cursoListaAnio) : null;
    return cursosFiltradosPorCarrera.filter((curso) => {
      if (anioFiltro != null && curso.anio !== anioFiltro) return false;
      const periodo = curso.anio != null ? `${MESES[(curso.mes ?? 1) - 1]} ${curso.anio}` : '';
      const semCurso = obtenerSemestrePlanCurso(curso, modulos, materias);
      const semTexto = semCurso ? `${formatearSemestre(semCurso)} ${semCurso}` : '';
      const texto = [
        curso.materia ?? '',
        semTexto,
        curso.docente ?? '',
        periodo,
        formatCursoUbicacionHorario(curso) ?? '',
      ].join(' ');
      return textoCoincideBusqueda(texto, cursoListaBusqueda);
    });
  }, [cursosFiltradosPorCarrera, cursoListaAnio, cursoListaBusqueda, modulos, materias]);

  const cursosPaginaTotal = Math.max(1, Math.ceil(cursosListaVisibles.length / PAGINA_TAMANO));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [modResp, cursoResp, facResp, carResp, planResp, matResp] = await Promise.all([
        apiFetch<ApiList<Modulo>>('/academico/modulos'),
        apiFetch<ApiList<Curso>>('/academico/cursos'),
        apiFetch<ApiList<Facultad>>('/academico/facultades'),
        apiFetch<ApiList<Carrera>>('/academico/carreras'),
        apiFetch<ApiList<Plan>>('/academico/planes'),
        apiFetch<ApiList<Materia>>('/academico/materias'),
      ]);

      let docentesResp: ApiList<DocenteOption> = { total: 0, datos: [] };
      try {
        docentesResp = await apiFetch<ApiList<DocenteOption>>('/usuarios?rol=Docente');
      } catch {
        /* Roles sin acceso a /usuarios (p. ej. coordinación de facultad): el resto del módulo académico puede usarse igual. */
      }

      setModulos(modResp?.datos ?? []);
      setCursos(cursoResp?.datos ?? []);
      setFacultades(facResp?.datos ?? []);
      setCarreras(carResp?.datos ?? []);
      setPlanes(planResp?.datos ?? []);
      setMaterias(matResp?.datos ?? []);
      setDocentes(docentesResp?.datos ?? []);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'No se pudo cargar la información académica';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    setModuloFiltroSemestre('');
    setModuloForm((f) => ({ ...f, materiaId: '' }));
    setCursoForm({ moduloId: '', docenteId: '' });
    setCursoFiltroSemestre('');
    setCursoFiltroAnio('');
    setDocenteSearch('');
    setDocenteSearchOpen(false);
    setModuloListaBusqueda('');
    setModuloListaAnio('');
    setCursoListaBusqueda('');
    setCursoListaAnio('');
    setAlumnoSearch('');
    setAlumnoResultados([]);
    setAlumnoSearchOpen(false);
    setSelectedCursoId(null);
    setCopiarDesdeCursoId('');
    setModulosPagina(0);
    setCursosPagina(0);
  }, [carreraSeleccionadaId, facultadSeleccionadaId]);

  // Resetear pagina al cambiar filtros
  useEffect(() => { setModulosPagina(0); }, [moduloListaBusqueda, moduloListaAnio]);
  useEffect(() => { setCursosPagina(0); }, [cursoListaBusqueda, cursoListaAnio]);

  // Lotes de alumnos filtrados por carrera y semestre del curso expandido (o del formulario «Nuevo curso»).
  useEffect(() => {
    if (!carreraSeleccionadaId) {
      setLotesAlumnos([]);
      return;
    }
    const cursoExpandido =
      selectedCursoId != null ? cursos.find((c) => c.id === selectedCursoId) ?? null : null;
    const semestreCurso = cursoExpandido
      ? obtenerSemestrePlanCurso(cursoExpandido, modulos, materias)
      : null;
    const semestreForm =
      cursoFiltroSemestre && Number.isFinite(Number(cursoFiltroSemestre))
        ? Number(cursoFiltroSemestre)
        : null;
    const semestreQuery = semestreCurso ?? semestreForm;

    const qs = new URLSearchParams({ carreraId: carreraSeleccionadaId });
    if (semestreQuery != null) qs.set('semestre', String(semestreQuery));

    apiFetch<{ total: number; datos: LoteAlumnos[] }>(`/academico/lotes-alumnos?${qs.toString()}`)
      .then((resp) => setLotesAlumnos(resp?.datos ?? []))
      .catch(() => setLotesAlumnos([]));
  }, [carreraSeleccionadaId, selectedCursoId, cursoFiltroSemestre, cursos, modulos, materias]);

  // Sincronizar selector de lote con el semestre del curso (y con el formulario izquierdo si coincide).
  useEffect(() => {
    if (selectedCursoId == null) return;
    const curso = cursos.find((c) => c.id === selectedCursoId);
    if (!curso) return;
    const semCurso = obtenerSemestrePlanCurso(curso, modulos, materias);
    if (semCurso == null) return;
    const semForm =
      cursoFiltroSemestre && Number.isFinite(Number(cursoFiltroSemestre))
        ? Number(cursoFiltroSemestre)
        : null;
    const semObjetivo = semForm === semCurso ? semForm : semCurso;
    setSemestreLotePorCurso((prev) => {
      if (prev[curso.id] === String(semObjetivo)) return prev;
      return { ...prev, [curso.id]: String(semObjetivo) };
    });
  }, [selectedCursoId, cursoFiltroSemestre, cursos, modulos, materias]);

  const cursoSeleccionado = useMemo(
    () => (selectedCursoId != null ? cursos.find((c) => c.id === selectedCursoId) ?? null : null),
    [selectedCursoId, cursos]
  );

  const planillaSeleccionada = useMemo(
    () => (selectedCursoId != null ? planillaMap.get(selectedCursoId) ?? [] : []),
    [selectedCursoId, planillaMap]
  );

  const moduloDelCursoSeleccionado = useMemo(() => {
    if (!cursoSeleccionado) return null;
    return modulos.find((m) => m.id === cursoSeleccionado.modulo_id) ?? null;
  }, [cursoSeleccionado, modulos]);

  const planillaPageCount = useMemo(
    () => Math.max(1, Math.ceil(planillaSeleccionada.length / PLANILLA_PAGE_SIZE)),
    [planillaSeleccionada.length]
  );
  const planillaMobileItems = useMemo(
    () => planillaSeleccionada.slice(planillaPage * PLANILLA_PAGE_SIZE, (planillaPage + 1) * PLANILLA_PAGE_SIZE),
    [planillaSeleccionada, planillaPage]
  );

  useEffect(() => {
    if (selectedCursoId == null) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!cancelled) {
          planillaPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [selectedCursoId]);

  const handleCreateModulo = async () => {
    if (!carreraSeleccionadaId) {
      toast.error('Seleccioná carrera arriba antes de abrir un período.');
      return;
    }
    if (!moduloFiltroSemestre) {
      toast.error('Seleccioná un semestre para listar las materias del plan.');
      return;
    }
    if (!moduloForm.materiaId) {
      toast.error('Selecciona una materia antes de continuar.');
      return;
    }
    if (!moduloForm.anio || !moduloForm.mes) {
      toast.error('Completa el año y mes del módulo.');
      return;
    }
    const anioNum = Number(moduloForm.anio);
    const { min: anioMin, max: anioMax } = limitesAnioModulo();
    if (!Number.isInteger(anioNum) || anioNum < anioMin || anioNum > anioMax) {
      toast.error(`El año debe ser un número entre ${anioMin} y ${anioMax}.`);
      return;
    }
    if (!moduloForm.fechaInicio || !moduloForm.fechaFin) {
      toast.error('Completa las fechas de inicio y fin.');
      return;
    }
    const mesNum = Number(moduloForm.mes);
    const errFechas = mensajeErrorFechasModuloEnMes(anioNum, mesNum, moduloForm.fechaInicio, moduloForm.fechaFin);
    if (errFechas) {
      toast.error(errFechas);
      return;
    }
    try {
      const payload = {
        materiaId: Number(moduloForm.materiaId),
        anio: anioNum,
        mes: mesNum,
        fechaInicio: moduloForm.fechaInicio,
        fechaFin: moduloForm.fechaFin,
      };
      await apiFetch<Modulo>('/academico/modulos', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      // Recargar desde API para obtener campos JOIN (carrera_id, materia, plan, etc.)
      const modResp = await apiFetch<ApiList<Modulo>>('/academico/modulos');
      setModulos(modResp?.datos ?? []);
      toast.success('Módulo creado');
      setModuloForm((f) => ({
        materiaId: '',
        anio: f.anio || String(new Date().getFullYear()),
        mes: '',
        fechaInicio: '',
        fechaFin: '',
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'No se pudo crear el módulo';
      toast.error(msg);
    }
  };

  const handleCreateCurso = async () => {
    try {
      if (!carreraSeleccionadaId) {
        toast.error('Seleccioná carrera arriba antes de abrir un curso.');
        return;
      }
      if (!cursoForm.docenteId) {
        toast.error('Selecciona un docente desde el buscador.');
        return;
      }

      const payload = {
        moduloId: Number(cursoForm.moduloId),
        docenteId: cursoForm.docenteId,
      };
      const nuevoCurso = await apiFetch<Curso>('/academico/cursos', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      // Recargar cursos y módulos para obtener nombres completos
      const [modResp, cursoResp] = await Promise.all([
        apiFetch<ApiList<Modulo>>('/academico/modulos'),
        apiFetch<ApiList<Curso>>('/academico/cursos'),
      ]);
      setModulos(modResp?.datos ?? []);
      setCursos(cursoResp?.datos ?? []);
      // Auto-seleccionar el nuevo curso
      if (nuevoCurso?.id) {
        setSelectedCursoId(nuevoCurso.id);
      }
      toast.success('Curso creado');
      setCursoForm({ moduloId: '', docenteId: '' });
    setCursoFiltroSemestre('');
      setDocenteSearch('');
      setDocenteSearchOpen(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'No se pudo crear el curso';
      toast.error(msg);
    }
  };

  const handleSelectCurso = async (cursoId: number) => {
    setSelectedCursoId(cursoId);
    setPlanillaPage(0);
    setAlumnoSearch('');
    setAlumnoSearchOpen(false);
    setCopiarDesdeCursoId('');
    if (planillaMap.has(cursoId)) return;
    setPlanillaLoading(true);
    try {
      const resp = await apiFetch<{ total: number; datos: Matricula[] }>(`/academico/cursos/${cursoId}/matriculas`);
      setPlanillaMap((prev) => new Map(prev).set(cursoId, resp?.datos ?? []));
    } catch {
      toast.error('No se pudo cargar la planilla');
    } finally {
      setPlanillaLoading(false);
    }
  };

  const cerrarPlanillaCurso = () => {
    setSelectedCursoId(null);
    setAlumnoSearch('');
    setAlumnoSearchOpen(false);
    setCopiarDesdeCursoId('');
  };

  const puedeBuscarAlumnoPlanilla =
    Boolean(carreraSeleccionadaId) &&
    (alcanceVisualAcademico === 'carrera' || Boolean(facultadSeleccionadaId));

  const cerrarBuscadorAlumnoPlanilla = useCallback(() => {
    setAlumnoSearchOpen(false);
    setAlumnoResultados([]);
  }, []);

  useEffect(() => {
    if (!alumnoSearchOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const root = alumnoSearchWrapRef.current;
      if (root && !root.contains(event.target as Node)) {
        cerrarBuscadorAlumnoPlanilla();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cerrarBuscadorAlumnoPlanilla();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [alumnoSearchOpen, cerrarBuscadorAlumnoPlanilla]);

  const handleBuscarAlumno = useCallback(
    async (q: string) => {
      const termino = q.trim();
      if (!termino) {
        setAlumnoResultados([]);
        return;
      }
      if (!carreraSeleccionadaId) {
        setAlumnoResultados([]);
        return;
      }
      if (alcanceVisualAcademico !== 'carrera' && !facultadSeleccionadaId) {
        setAlumnoResultados([]);
        return;
      }
      setAlumnoSearchLoading(true);
      try {
        const params = new URLSearchParams({ q: termino, limit: '10' });
        params.set('carreraId', carreraSeleccionadaId);
        if (alcanceVisualAcademico !== 'carrera' && facultadSeleccionadaId) {
          params.set('facultadId', facultadSeleccionadaId);
        }
        const resp = await apiFetch<{ total: number; datos: AlumnoBusqueda[] }>(
          `/academico/alumnos/buscar?${params.toString()}`
        );
        setAlumnoResultados(resp?.datos ?? []);
      } catch {
        setAlumnoResultados([]);
      } finally {
        setAlumnoSearchLoading(false);
      }
    },
    [alcanceVisualAcademico, facultadSeleccionadaId, carreraSeleccionadaId]
  );

  const handleMatricularAlumno = async (cursoId: number, alumno: AlumnoBusqueda) => {
    try {
      const nueva = await apiFetch<Matricula>(`/academico/cursos/${cursoId}/matriculas`, {
        method: 'POST',
        body: JSON.stringify({ alumnoId: alumno.id }),
      });
      // enriquecer con nombre
      const enriquecida: Matricula = {
        ...nueva,
        numero_documento: alumno.numero_documento,
        nombre_completo:
          alumno.nombre_apellido ??
          [alumno.apellidos, alumno.nombres].map((s) => s?.trim()).filter(Boolean).join(', '),
      };
      setPlanillaMap((prev) => {
        const lista = [...(prev.get(cursoId) ?? []), enriquecida];
        return new Map(prev).set(cursoId, lista);
      });
      setCursos((prev) => prev.map((c) => c.id === cursoId ? { ...c, inscriptos: (c.inscriptos ?? 0) + 1 } : c));
      setAlumnoSearch('');
      setAlumnoResultados([]);
      setAlumnoSearchOpen(false);
      toast.success(`${enriquecida.nombre_completo} agregado a la planilla`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo agregar el alumno');
    }
  };

  const handleDesmatricularAlumno = (cursoId: number, matricula: Matricula) => {
    setPendingDelete({
      title: 'Quitar alumno',
      description: `¿Quitar a ${matricula.nombre_completo} de la planilla? Se eliminará su matrícula y el historial de asistencia asociado.`,
      onConfirm: async () => {
        setDialogLoading(true);
        try {
          await apiFetch(`/academico/cursos/${cursoId}/matriculas/${matricula.alumno_id}`, { method: 'DELETE' });
          setPlanillaMap((prev) => {
            const lista = (prev.get(cursoId) ?? []).filter((m) => m.id !== matricula.id);
            return new Map(prev).set(cursoId, lista);
          });
          setCursos((prev) => prev.map((c) => c.id === cursoId ? { ...c, inscriptos: Math.max((c.inscriptos ?? 1) - 1, 0) } : c));
          toast.success('Alumno quitado de la planilla');
          setPendingDelete(null);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'No se pudo quitar el alumno');
        } finally {
          setDialogLoading(false);
        }
      },
    });
  };

  const handleMatricularDesdeLote = async (cursoId: number, loteId: number, semestre: number) => {
    if (!loteId) {
      toast.error('Selecciona un semestre');
      return;
    }
    setLoteImportLoading(true);
    try {
      const res = await apiFetch<{
        insertados: number;
        saltados: number;
        omitidosSemestre?: number;
        totalLote: number;
        encontrados: number;
      }>(`/academico/cursos/${cursoId}/matriculas/desde-lote`, { method: 'POST', body: JSON.stringify({ loteId }) });
      const om = res.omitidosSemestre ?? 0;
      const insertados = res.insertados ?? 0;
      const saltados = res.saltados ?? 0;
      const tituloSemestre = `${semestre}º semestre`;

      if (insertados === 0 && om > 0) {
        toast.error(`${tituloSemestre}: ningún alumno inscripto`, {
          description: `${om} alumno(s) omitidos: su semestre curricular no coincide con el de este curso.${saltados > 0 ? ` ${saltados} ya estaban en la planilla.` : ''}`,
        });
      } else if (insertados === 0) {
        toast.error(`${tituloSemestre}: ningún alumno inscripto`, {
          description:
            saltados > 0 ? `${saltados} alumno(s) ya estaban en la planilla.` : 'No había alumnos nuevos para agregar en este lote.',
        });
      } else if (om > 0) {
        toast.warning(`${tituloSemestre}: ${insertados} alumno(s) inscripto(s)`, {
          duration: 8000,
          description: `${om} omitidos por semestre curricular distinto.${saltados > 0 ? ` ${saltados} ya estaban en la planilla.` : ''}`,
        });
      } else {
        toast.success(`${tituloSemestre}: ${insertados} alumno(s) inscripto(s)`, {
          description: saltados > 0 ? `${saltados} ya estaban en la planilla.` : undefined,
        });
      }
      // recargar planilla
      const resp = await apiFetch<{ total: number; datos: Matricula[] }>(`/academico/cursos/${cursoId}/matriculas`);
      setPlanillaMap((prev) => new Map(prev).set(cursoId, resp?.datos ?? []));
      setCursos((prev) => prev.map((c) => c.id === cursoId ? { ...c, inscriptos: resp?.total ?? c.inscriptos } : c));
      setSemestreLotePorCurso((prev) => ({ ...prev, [cursoId]: '' }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo importar la lista');
    } finally {
      setLoteImportLoading(false);
    }
  };

  const handleCopiarMatriculas = async (cursoId: number) => {
    const origenId = Number(copiarDesdeCursoId);
    if (!origenId || origenId === cursoId) {
      toast.error('Selecciona un curso origen diferente');
      return;
    }
    try {
      const res = await apiFetch<{ insertados: number; saltados: number }>(`/academico/cursos/${cursoId}/copiar-matriculas`, {
        method: 'POST',
        body: JSON.stringify({ desdeCursoId: origenId }),
      });
      toast.success(`${res.insertados} alumno(s) copiados${res.saltados ? `, ${res.saltados} ya estaban` : ''}`);
      // recargar planilla
      const resp = await apiFetch<{ total: number; datos: Matricula[] }>(`/academico/cursos/${cursoId}/matriculas`);
      setPlanillaMap((prev) => new Map(prev).set(cursoId, resp?.datos ?? []));
      setCursos((prev) => prev.map((c) => c.id === cursoId ? { ...c, inscriptos: resp?.total ?? c.inscriptos } : c));
      setCopiarDesdeCursoId('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo copiar la planilla');
    }
  };

  const handleCreatePlan = async () => {
    if (!carreraSeleccionadaId) {
      toast.error('Selecciona una carrera primero');
      return;
    }
    const carreraCtx =
      carrerasFiltradas.find((c) => String(c.id) === carreraSeleccionadaId) ??
      carrerasEnAlcance.find((c) => String(c.id) === carreraSeleccionadaId);
    const facultadIdPlan =
      facultadSeleccionadaId ? Number(facultadSeleccionadaId) : carreraCtx?.facultad_id;
    if (!facultadIdPlan) {
      toast.error('No se pudo resolver la facultad de la carrera seleccionada.');
      return;
    }
    try {
      const cid = Number(carreraSeleccionadaId);
      const body: Record<string, unknown> = {
        carreraId: cid,
        facultadId: facultadIdPlan,
        facultadNombre: facultadSeleccionada?.nombre ?? '',
        nombreCarrera: carreraSeleccionada?.nombre ?? '',
        nombre: planForm.nombre,
        resolucion: planForm.resolucion || undefined,
        anioVigencia: planForm.anioVigencia ? Number(planForm.anioVigencia) : undefined,
      };
      const resp = await apiFetch<PlanCreadoResponse>('/academico/planes', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (resp.facultadResuelta) {
        setFacultades((prev) =>
          prev.some((f) => f.id === resp.facultadResuelta!.id) ? prev : [...prev, resp.facultadResuelta!]
        );
        setFacultadSeleccionadaId(String(resp.facultadResuelta.id));
      }
      if (resp.carreraResuelta) {
        setCarreras((prev) =>
          prev.some((c) => c.id === resp.carreraResuelta!.id) ? prev : [...prev, resp.carreraResuelta!]
        );
        setCarreraSeleccionadaId(String(resp.carreraResuelta.id));
      }
      const { carreraResuelta, facultadResuelta, ...nuevoPlan } = resp;
      setPlanes((prev) => [...prev, nuevoPlan]);
      setPlanForm({ nombre: '', resolucion: '', anioVigencia: '' });
      setShowAddPlanForm(false);
      setExpandedPlanId(nuevoPlan.id);
      toast.success(
        facultadResuelta || carreraResuelta ? 'Estructura actualizada y plan creado' : 'Plan creado'
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el plan');
    }
  };

  const handleCreateMateria = async () => {
    if (!addMateriaForPlanId || materiaSaving) return;
    const sem = semestrePorPlan[addMateriaForPlanId];
    if (sem === undefined) {
      toast.error('Seleccioná un semestre antes de agregar una materia.');
      return;
    }
    const nombre = materiaForm.nombre.trim();
    const codigo = materiaForm.codigo.trim();
    if (!nombre || !codigo) {
      toast.error('Los campos "Nombre" y "Código" son obligatorios.');
      return;
    }
    setMateriaSaving(true);
    try {
      const nueva = await apiFetch<Materia>('/academico/materias', {
        method: 'POST',
        body: JSON.stringify({
          planId: addMateriaForPlanId,
          nombre,
          codigo,
          semestre: sem,
        }),
      });
      setMaterias((prev) => [...prev, nueva]);
      setMateriaForm({ nombre: '', codigo: '' });
      setAddMateriaForPlanId(null);
      toast.success('Materia creada');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la materia');
    } finally {
      setMateriaSaving(false);
    }
  };

  const handleEditPlan = (plan: Plan) => {
    setPendingEdit({
      title: 'Editar plan de estudio',
      fields: [
        { key: 'nombre', label: 'Nombre', defaultValue: plan.nombre, required: true },
        { key: 'resolucion', label: 'Resolución (opcional)', defaultValue: plan.resolucion ?? '' },
        { key: 'anioVigencia', label: 'Año de vigencia (opcional)', defaultValue: plan.anio_vigencia ? String(plan.anio_vigencia) : '', options: opcionesAnioVigencia(), columns: 4 },
      ],
      onSave: async (values) => {
        const anioVigencia = values.anioVigencia.trim() ? Number(values.anioVigencia) : null;
        if (values.anioVigencia.trim() && Number.isNaN(anioVigencia)) {
          toast.error('Año de vigencia inválido');
          return;
        }
        setDialogLoading(true);
        try {
          const actualizado = await apiFetch<Plan>(`/academico/planes/${plan.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ nombre: values.nombre, resolucion: values.resolucion.trim() || null, anioVigencia }),
          });
          setPlanes((prev) => prev.map((p) => (p.id === plan.id ? actualizado : p)));
          toast.success('Plan actualizado');
          setPendingEdit(null);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el plan');
        } finally {
          setDialogLoading(false);
        }
      },
    });
  };

  const handleDeletePlan = (plan: Plan) => {
    setPendingDelete({
      title: 'Eliminar plan',
      description: `¿Eliminar el plan "${plan.nombre}"? Esta acción no se puede deshacer.`,
      onConfirm: async () => {
        setDialogLoading(true);
        try {
          await apiFetch(`/academico/planes/${plan.id}`, { method: 'DELETE' });
          setPlanes((prev) => prev.filter((p) => p.id !== plan.id));
          setSemestrePorPlan((prev) => {
            const { [plan.id]: _removed, ...rest } = prev;
            return rest;
          });
          // Limpiar materias del plan eliminado del estado y del formulario
          setMaterias((prev) => {
            const restantes = prev.filter((m) => m.plan_id !== plan.id);
            const selectedStillValid = restantes.some((m) => String(m.id) === moduloForm.materiaId);
            if (!selectedStillValid) setModuloForm((f) => ({ ...f, materiaId: '' }));
            return restantes;
          });
          toast.success('Plan eliminado');
          setPendingDelete(null);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'No se pudo eliminar el plan');
        } finally {
          setDialogLoading(false);
        }
      },
    });
  };

  const handleEditMateria = (materia: Materia) => {
    setPendingEdit({
      title: 'Editar materia',
      fields: [
        { key: 'nombre', label: 'Nombre', defaultValue: materia.nombre, required: true },
        { key: 'codigo', label: 'Código', defaultValue: materia.codigo, required: true },
      ],
      onSave: async (values) => {
        setDialogLoading(true);
        try {
          const actualizada = await apiFetch<Materia>(`/academico/materias/${materia.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              nombre: values.nombre,
              codigo: values.codigo,
            }),
          });
          setMaterias((prev) => prev.map((m) => (m.id === materia.id ? actualizada : m)));
          toast.success('Materia actualizada');
          setPendingEdit(null);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la materia');
        } finally {
          setDialogLoading(false);
        }
      },
    });
  };

  const handleDeleteMateria = (materia: Materia) => {
    setPendingDelete({
      title: 'Eliminar materia',
      description: `¿Eliminar la materia "${materia.nombre}"? Esta acción no se puede deshacer.`,
      onConfirm: async () => {
        setDialogLoading(true);
        try {
          await apiFetch(`/academico/materias/${materia.id}`, { method: 'DELETE' });
          setMaterias((prev) => prev.filter((m) => m.id !== materia.id));
          if (String(materia.id) === moduloForm.materiaId) setModuloForm((f) => ({ ...f, materiaId: '' }));
          toast.success('Materia eliminada');
          setPendingDelete(null);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'No se pudo eliminar la materia');
        } finally {
          setDialogLoading(false);
        }
      },
    });
  };

  const toDateInputValue = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : '');

  const resolveDateBounds = useCallback(
    (v: Record<string, string>) => rangoFechasMesModulo(v.anio, v.mes),
    []
  );

  const handleEditModulo = (mod: Modulo) => {
    const materiaOptions = [...materiasDeCarrera]
      .sort(compareMateriasCurriculares)
      .map((m) => ({ value: String(m.id), label: `${m.codigo} · ${m.nombre}` }));
    const mesOptions = MESES.map((nombre, i) => ({ value: String(i + 1), label: nombre }));
    if (materiaOptions.length === 0) {
      toast.error('No hay materias cargadas para esta carrera.');
      return;
    }

    const moduloHasCurso = cursos.some((c) => c.modulo_id === mod.id);

    setPendingEdit({
      title: 'Editar módulo',
      fields: [
        { key: 'materiaId', label: 'Materia', required: true, defaultValue: String(mod.materia_id), options: materiaOptions, searchable: true, disabled: moduloHasCurso, disabledHint: moduloHasCurso ? 'No se puede cambiar: el módulo ya tiene un curso asignado.' : undefined },
        { key: 'anio', label: 'Año', required: true, defaultValue: String(mod.anio), options: opcionesAnioModulo(), columns: 4 },
        { key: 'mes', label: 'Mes', required: true, defaultValue: String(mod.mes), options: mesOptions, columns: 3, columnsMobile: 1 },
        { key: 'fechaInicio', label: 'Fecha inicio', type: 'date', required: true, defaultValue: toDateInputValue(mod.fecha_inicio) },
        { key: 'fechaFin', label: 'Fecha fin', type: 'date', required: true, defaultValue: toDateInputValue(mod.fecha_fin) },
      ],
      onSave: async (values) => {
        const anioNum = Number(values.anio);
        const mesNum = Number(values.mes);
        const { min, max } = limitesAnioModulo();
        if (!Number.isInteger(anioNum) || anioNum < min || anioNum > max) {
          toast.error(`El año debe ser un número entre ${min} y ${max}.`);
          return;
        }
        if (!Number.isFinite(mesNum) || mesNum < 1 || mesNum > 12) {
          toast.error('El mes no es válido.');
          return;
        }
        if (!values.fechaInicio?.trim() || !values.fechaFin?.trim()) {
          toast.error('Completá las fechas de inicio y fin.');
          return;
        }
        const errFechasEdit = mensajeErrorFechasModuloEnMes(
          anioNum,
          mesNum,
          values.fechaInicio.trim(),
          values.fechaFin.trim()
        );
        if (errFechasEdit) {
          toast.error(errFechasEdit);
          return;
        }
        setDialogLoading(true);
        try {
          await apiFetch(`/academico/modulos/${mod.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              materiaId: Number(values.materiaId),
              anio: anioNum,
              mes: mesNum,
              fechaInicio: values.fechaInicio.trim(),
              fechaFin: values.fechaFin.trim(),
            }),
          });
          const [modResp, cursoResp] = await Promise.all([
            apiFetch<ApiList<Modulo>>('/academico/modulos'),
            apiFetch<ApiList<Curso>>('/academico/cursos'),
          ]);
          setModulos(modResp?.datos ?? []);
          setCursos(cursoResp?.datos ?? []);
          toast.success('Módulo actualizado');
          setPendingEdit(null);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el módulo');
        } finally {
          setDialogLoading(false);
        }
      },
    });
  };

  const handleEditCurso = (curso: Curso) => {
    const semestreCurso = obtenerSemestrePlanCurso(curso, modulos, materias);
    const moduloOptions = sortedModulos
      .filter((m) => {
        if (semestreCurso == null) return true;
        const mat = materias.find((mat) => mat.id === m.materia_id);
        return (mat?.semestre ?? 1) === semestreCurso;
      })
      .map((m) => {
        const mat = materias.find((mat) => mat.id === m.materia_id);
        const sem = mat?.semestre ? ` — ${formatearSemestre(mat.semestre)}` : '';
        return {
          value: String(m.id),
          label: `${m.materia ?? `Módulo ${m.id}`}${sem} · ${MESES[(m.mes ?? 1) - 1]} ${m.anio}`,
        };
      });
    if (moduloOptions.length === 0) {
      toast.error('No hay módulos disponibles para este curso.');
      return;
    }
    const docenteOptions = docentesOrdenados.map((d) => ({
      value: d.id,
      label: formatDocenteLabel(d),
    }));
    if (!docenteOptions.some((o) => o.value === curso.docente_id)) {
      const docenteActual = docentes.find((d) => d.id === curso.docente_id || d.persona?.id === curso.docente_id);
      docenteOptions.unshift({
        value: curso.docente_id,
        label: docenteActual ? formatDocenteLabel(docenteActual) : (curso.docente ?? curso.docente_id),
      });
    }

        const tienePlanilla = (curso.inscriptos ?? 0) > 0;
    setPendingEdit({
      title: 'Editar curso',
      fields: [
        { key: 'moduloId', label: 'Módulo académico', required: true, defaultValue: String(curso.modulo_id), options: moduloOptions, searchable: true, disabled: tienePlanilla, disabledHint: tienePlanilla ? 'No se puede cambiar: el curso ya tiene una planilla asignada.' : undefined },
        { key: 'docenteId', label: 'Docente', required: true, defaultValue: curso.docente_id, options: docenteOptions, searchable: true },
        { key: 'aula', label: 'Aula (opcional)', defaultValue: curso.aula ?? '' },
        { key: 'horarioInicio', label: 'Horario inicio (opcional)', defaultValue: curso.horario_inicio ? String(curso.horario_inicio).slice(0, 5) : '' },
        { key: 'horarioFin', label: 'Horario fin (opcional)', defaultValue: curso.horario_fin ? String(curso.horario_fin).slice(0, 5) : '' },
        { key: 'notas', label: 'Notas (opcional)', defaultValue: curso.notas ?? '' },
      ],
      onSave: async (values) => {
        const horarioIni = values.horarioInicio.trim();
        const horarioFin = values.horarioFin.trim();
        if (horarioIni && !/^\d{1,2}:\d{2}$/.test(horarioIni)) {
          toast.error('Horario inicio: usá formato HH:MM (ej. 08:30).');
          return;
        }
        if (horarioFin && !/^\d{1,2}:\d{2}$/.test(horarioFin)) {
          toast.error('Horario fin: usá formato HH:MM (ej. 10:00).');
          return;
        }
        setDialogLoading(true);
        try {
          await apiFetch(`/academico/cursos/${curso.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              moduloId: Number(values.moduloId),
              docenteId: values.docenteId,
              aula: values.aula.trim() || null,
              horarioInicio: horarioIni || null,
              horarioFin: horarioFin || null,
              notas: values.notas.trim() || null,
            }),
          });
          const [modResp, cursoResp] = await Promise.all([
            apiFetch<ApiList<Modulo>>('/academico/modulos'),
            apiFetch<ApiList<Curso>>('/academico/cursos'),
          ]);
          setModulos(modResp?.datos ?? []);
          setCursos(cursoResp?.datos ?? []);
          toast.success('Curso actualizado');
          setPendingEdit(null);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el curso');
        } finally {
          setDialogLoading(false);
        }
      },
    });
  };

  const handleDeleteModulo = (mod: Modulo) => {
    const mat = materias.find((m) => m.id === mod.materia_id);
    const sem = mat?.semestre ? ` — ${formatearSemestre(mat.semestre)}` : '';
    setPendingDelete({
      title: 'Eliminar módulo',
      description: `¿Eliminar el módulo "${mod.materia ?? `Módulo ${mod.id}`}${sem} · ${MESES[(mod.mes ?? 1) - 1]} ${mod.anio}"? Se eliminarán también sus cursos y sesiones asociadas.`,
      onConfirm: async () => {
        setDialogLoading(true);
        try {
          await apiFetch(`/academico/modulos/${mod.id}`, { method: 'DELETE' });
          setModulos((prev) => prev.filter((m) => m.id !== mod.id));
          toast.success('Módulo eliminado');
          setPendingDelete(null);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'No se pudo eliminar el módulo');
        } finally {
          setDialogLoading(false);
        }
      },
    });
  };

  const handleDeleteCurso = (curso: Curso) => {
    const semCurso = obtenerSemestrePlanCurso(curso, modulos, materias);
    const semCursoStr = semCurso ? ` — ${formatearSemestre(semCurso)}` : '';
    const label = `${curso.materia ?? `Módulo ${curso.modulo_id}`}${semCursoStr} · ${curso.docente ?? curso.docente_id}`;
    setPendingDelete({
      title: 'Eliminar curso',
      description: `¿Eliminar el curso "${label}"? Se eliminarán también sus matrículas y sesiones asociadas.`,
      onConfirm: async () => {
        setDialogLoading(true);
        try {
          await apiFetch(`/academico/cursos/${curso.id}`, { method: 'DELETE' });
          setCursos((prev) => prev.filter((c) => c.id !== curso.id));
          if (selectedCursoId === curso.id) {
            setSelectedCursoId(null);
            setAlumnoSearch('');
            setAlumnoSearchOpen(false);
            setCopiarDesdeCursoId('');
          }
          setPlanillaMap((prev) => {
            const next = new Map(prev);
            next.delete(curso.id);
            return next;
          });
          toast.success('Curso eliminado');
          setPendingDelete(null);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'No se pudo eliminar el curso');
        } finally {
          setDialogLoading(false);
        }
      },
    });
  };

  return (
    <div className="system-bg app-shell-viewport text-slate-800 dark:text-[#e7eef9] min-h-screen h-screen overflow-hidden">
      <div className="app-layout-row">
        {sidebarOpen ? (
          <div className="app-sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
        ) : null}

        <AppSidebar sidebarOpen={sidebarOpen} onLogout={onLogout} onClose={() => setSidebarOpen(false)} />

        <main className="app-layout-main">
          <header className="flex shrink-0 min-h-16 items-center justify-between gap-3 py-2.5 px-4 sm:px-6 bg-white/95 backdrop-blur-md border-b border-slate-200 z-10 dark:bg-[#132a52]/90 dark:border-slate-800">
            <div className="flex items-center gap-3 min-w-0">
              <button
                className="app-menu-toggle text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                onClick={() => setSidebarOpen(true)}
                aria-label="Abrir menú"
              >
                <span className="material-symbols-outlined">menu</span>
              </button>
              <span className="material-symbols-outlined shrink-0 text-blue-600 dark:text-[#6b8bc3]">auto_stories</span>
              <div className="min-w-0">
                <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Gestión académica</p>
                <h1 className="text-xl font-semibold text-black dark:text-[#e7eef9] leading-snug max-lg:text-base">Períodos y Cursos</h1>
              </div>
            </div>
          </header>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="scroll-region app-scroll-content academico-mobile-cards-inset flex-1 p-4 sm:p-6 space-y-6 min-w-0">
            <AcademicoSubnav />
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 text-black shadow-sm dark:border-slate-800 dark:bg-[#132a52] dark:text-[#e7eef9] dark:shadow-none min-w-0">
              <div>
                <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Módulo base</p>
                <h2 className="text-lg font-semibold">Planes y períodos académicos</h2>
              </div>

              {!contextoSelectorListo ? (
                <ScopeSelectorSkeleton soloCarrera={alcanceListo && alcanceVisualAcademico === 'carrera'} />
              ) : (
                <div className={`grid min-w-0 grid-cols-1 gap-4 ${alcanceVisualAcademico === 'carrera' ? '' : 'md:grid-cols-2 xl:grid-cols-2'}`}>
                  {alcanceVisualAcademico === 'carrera' ? null : (
                    <ScopeSelector
                      label="Facultad"
                      options={facultadesDisponibles}
                      value={facultadSeleccionadaId}
                      placeholder="Seleccioná facultad"
                      controlClassName={inpScope}
                      onChange={(id) => {
                        setFacultadSeleccionadaId(id);
                        setCarreraSeleccionadaId('');
                      }}
                    />
                  )}

                  <ScopeSelector
                    label="Carrera"
                    options={carrerasOpcionesSelector}
                    value={carreraSeleccionadaId}
                    placeholder="Seleccioná carrera"
                    emptyOptionsHint={
                      alcanceVisualAcademico !== 'carrera' && !facultadSeleccionadaId
                        ? 'Seleccioná facultad primero'
                        : 'Sin carreras disponibles'
                    }
                    disabled={alcanceVisualAcademico === 'carrera' ? false : !facultadSeleccionadaId}
                    controlClassName={inpScope}
                    onChange={(id) => {
                      setCarreraSeleccionadaId(id);
                      if (id) {
                        const c = carrerasFiltradas.find((x) => String(x.id) === id);
                        if (c?.facultad_id) setFacultadSeleccionadaId(String(c.facultad_id));
                      }
                    }}
                    />
                  </div>
              )}

              {/* ── Planes de estudio – acordeón por carrera ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">
                    Planes de estudio
                    {carreraSeleccionada ? (
                      <span className="ml-2 text-xs font-normal text-slate-600 dark:text-slate-400">· {carreraSeleccionada.nombre}</span>
                    ) : null}
                  </h3>
                  {carreraSeleccionada && (
                    <span className="text-xs text-slate-600 dark:text-slate-400">{planesDeCarrera.length} plan(es)</span>
                  )}
                </div>

                {!contextoSelectorListo ? (
                  <div className="rounded-lg border border-dashed border-slate-200 p-6 space-y-3 dark:border-slate-700">
                    <Skeleton className="h-4 w-40 rounded bg-slate-200 dark:bg-white/10" />
                    <Skeleton className="h-16 w-full rounded-lg bg-slate-200 dark:bg-white/10" />
                    <Skeleton className="h-10 w-full rounded-lg bg-slate-200 dark:bg-white/10" />
                  </div>
                ) : carreraSeleccionada ? (
                  <div className="space-y-2">
                    {planesDeCarrera.length === 0 && !showAddPlanForm && (
                      <p className="text-sm text-slate-600 text-center py-3 dark:text-slate-400">
                        No hay planes para esta carrera. Creá el primero.
                      </p>
                    )}

                    {planesDeCarrera.map((plan) => {
                      const isOpen = expandedPlanId === plan.id;
                      const planMaterias = materiasPorPlan.get(plan.id) ?? [];
                      const semElegido = semestrePorPlan[plan.id] !== undefined;
                      const semActivo = semestrePorPlan[plan.id] ?? 1;
                      const materiasDelSemestre = semElegido
                        ? planMaterias
                            .filter((m) => (m.semestre ?? 1) === semActivo)
                            .sort(compareMateriasCurriculares)
                        : [];
                      return (
                        <div key={plan.id} className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-slate-700 dark:bg-slate-900/50 dark:shadow-none">
                          {/* Plan header */}
                          <button
                            type="button"
                            className="w-full p-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800/50 max-lg:flex max-lg:flex-col max-lg:gap-2 lg:flex lg:items-center lg:justify-between"
                            onClick={() => {
                              if (isOpen) {
                                setExpandedPlanId(null);
                              } else {
                                setExpandedPlanId(plan.id);
                              }
                            }}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="material-symbols-outlined text-slate-400 text-base leading-none">
                                {isOpen ? 'expand_less' : 'expand_more'}
                              </span>
                              <div className="min-w-0">
                                <p className="font-medium text-sm">{plan.nombre}</p>
                                <p className="text-xs text-slate-400">
                                  {plan.anio_vigencia ? `Vigente desde ${plan.anio_vigencia}` : 'Sin año de vigencia'}
                                  {plan.resolucion ? ` · Res. ${plan.resolucion}` : ''}
                                  {' · '}{planMaterias.length} materia{planMaterias.length !== 1 ? 's' : ''}
                                </p>
                              </div>
                            </div>
                            <div className="btn-mobile-row flex shrink-0 gap-2" onClick={(e) => e.stopPropagation()}>
                              <button type="button" className="btn-modern btn-modern-xs btn-modern-edit" onClick={() => handleEditPlan(plan)}>Editar</button>
                              <button type="button" className="btn-modern btn-modern-xs btn-modern-danger" onClick={() => handleDeletePlan(plan)}>Eliminar</button>
                            </div>
                          </button>

                          {/* Plan content (expandable) */}
                          {isOpen && (
                            <div className="border-t border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 space-y-4 dark:border-slate-700/80 dark:from-slate-900/40 dark:to-slate-950/30">
                              <div className="w-full sm:max-w-md">
                                  <AppSelect
                                    aria-label="Semestre del plan"
                                    portal
                                    columnsMobile={3}
                                    listClassName="max-lg:!min-w-0 max-lg:w-full"
                                    value={semElegido ? String(semActivo) : ''}
                                    onChange={(v) => {
                                      if (v === '') return;
                                      setSemestrePorPlan((p) => ({ ...p, [plan.id]: Number(v) }));
                                    }}
                                    placeholder="Seleccionar semestre"
                                    options={Array.from({ length: MAX_SEMESTRE_PLAN }, (_, i) => {
                                      const n = i + 1;
                                      const count = planMaterias.filter((m) => (m.semestre ?? 1) === n).length;
                                      return {
                                        value: String(n),
                                        label: `${formatearSemestre(n)}${count ? ` · ${count} materia${count === 1 ? '' : 's'}` : ''}`,
                                      };
                                    })}
                                    triggerClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-black focus:border-primary focus:outline-none text-sm dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                                  />
                              </div>

                              {!semElegido && (
                                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-center text-xs text-slate-700 dark:border-slate-600/60 dark:bg-slate-900/30 dark:text-slate-400">
                                  Elegí un semestre para ver las materias y poder agregar nuevas.
                                </p>
                              )}
                              {semElegido && planMaterias.length === 0 && (
                                <p className="text-xs text-slate-600 py-1 text-center dark:text-slate-400">
                                  No hay materias en este plan. Agregá la primera con el botón de abajo.
                                </p>
                              )}
                              {semElegido && planMaterias.length > 0 && materiasDelSemestre.length === 0 && (
                                <p className="text-xs text-slate-600 py-1 text-center dark:text-slate-400">
                                  No hay materias en {formatearSemestre(semActivo)}. Podés agregar una con el botón de abajo o elegir otro semestre.
                                </p>
                              )}
                              <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 overflow-hidden bg-white dark:divide-slate-800/90 dark:border-slate-800/80 dark:bg-[#0a1628]/50">
                                {materiasDelSemestre.map((m, idx) => (
                                  <div key={m.id} className="flex flex-col gap-2 py-2 max-md:px-1 md:flex-row md:items-center md:justify-between">
                                    <div className="flex min-w-0 items-center gap-3">
                                      <span className="w-5 shrink-0 text-right text-xs text-slate-500">{idx + 1}.</span>
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium">{m.nombre}</p>
                                        <p className="text-xs text-slate-600 dark:text-slate-400">{m.codigo}</p>
                                      </div>
                                    </div>
                                    <div className="btn-mobile-row flex shrink-0 gap-1 lg:gap-1 mr-4">
                                      <button type="button" className="btn-modern btn-modern-xs btn-modern-edit" onClick={() => handleEditMateria(m)}>Editar</button>
                                      <button type="button" className="btn-modern btn-modern-xs btn-modern-danger" onClick={() => handleDeleteMateria(m)}>Eliminar</button>
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {addMateriaForPlanId === plan.id && semElegido ? (
                                <div className="pt-2 space-y-2 border-t border-slate-200 dark:border-slate-700/80">
                                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                    Nueva materia en {formatearSemestre(semActivo)}
                                  </p>
                                  <div className="grid grid-cols-2 gap-2">
                                    <input
                                      className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-black focus:border-primary focus:outline-none text-sm dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                                      placeholder="Nombre de la materia"
                                      value={materiaForm.nombre}
                                      onChange={(e) => setMateriaForm((f) => ({ ...f, nombre: e.target.value }))}
                                      autoFocus
                                    />
                                    <input
                                      className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-black focus:border-primary focus:outline-none text-sm dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                                      placeholder="Código (ej: INF-001)"
                                      value={materiaForm.codigo}
                                      onChange={(e) => setMateriaForm((f) => ({ ...f, codigo: e.target.value }))}
                                    />
                                  </div>
                                  <div className="btn-mobile-stack flex gap-2">
                                    <button type="button" className="btn-modern btn-modern-primary btn-modern-sm btn-mobile-cta" disabled={materiaSaving} onClick={() => void handleCreateMateria()}>{materiaSaving ? 'Guardando…' : 'Guardar materia'}</button>
                                    <button type="button" className="btn-modern btn-modern-sm btn-modern-ghost btn-mobile-cta" disabled={materiaSaving} onClick={() => { setAddMateriaForPlanId(null); setMateriaForm({ nombre: '', codigo: '' }); }}>Cancelar</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="border-t border-slate-200 pt-1 dark:border-slate-700/80">
                                  <button
                                    type="button"
                                    className="btn-modern btn-modern-primary btn-modern-sm btn-mobile-cta disabled:pointer-events-none disabled:!border-slate-300 disabled:!bg-slate-200 disabled:!text-slate-500 disabled:!opacity-100 disabled:!shadow-none dark:disabled:!border-[#3d7bc9] dark:disabled:!bg-[#4f8cdb] dark:disabled:!text-white dark:disabled:!opacity-40 dark:disabled:!shadow-[0_4px_12px_rgba(79,140,219,0.28)]"
                                    disabled={!semElegido}
                                    title={!semElegido ? 'Primero seleccioná un semestre' : undefined}
                                    onClick={() => {
                                      if (!semElegido) return;
                                      setAddMateriaForPlanId(plan.id);
                                      setMateriaForm({ nombre: '', codigo: '' });
                                    }}
                                  >
                                    <span className="material-symbols-outlined text-base leading-none">add</span>
                                    Agregar materia
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Nuevo plan inline */}
                    {showAddPlanForm ? (
                      <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-3">
                        <p className="text-sm font-semibold text-primary">Nuevo plan · {carreraSeleccionada.nombre}</p>
                        <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
                          <input
                            className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-black focus:border-primary focus:outline-none text-sm dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                            placeholder="Nombre del plan"
                            value={planForm.nombre}
                            onChange={(e) => setPlanForm((f) => ({ ...f, nombre: e.target.value }))}
                            autoFocus
                          />
                          <input
                            className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-black focus:border-primary focus:outline-none text-sm dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                            placeholder="Resolución (opcional)"
                            value={planForm.resolucion}
                            onChange={(e) => setPlanForm((f) => ({ ...f, resolucion: e.target.value }))}
                          />
                          <AppSelect
                            value={planForm.anioVigencia}
                            onChange={(v) => setPlanForm((f) => ({ ...f, anioVigencia: v }))}
                            placeholder="Seleccionar año"
                            options={opcionesAnioVigencia()}
                            columns={4}
                            triggerClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-black focus:border-primary focus:outline-none text-sm dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                          />
                        </div>
                        <div className="btn-mobile-stack flex gap-2">
                          <button type="button" className="btn-modern btn-modern-primary btn-modern-sm btn-mobile-cta" onClick={() => void handleCreatePlan()}>Crear plan</button>
                          <button type="button" className="btn-modern btn-modern-sm btn-modern-ghost btn-mobile-cta" onClick={() => { setShowAddPlanForm(false); setPlanForm({ nombre: '', resolucion: '', anioVigencia: '' }); }}>Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="w-full rounded-lg border border-dashed border-slate-400 py-2 text-sm text-slate-600 hover:border-primary hover:text-primary flex items-center justify-center gap-2 dark:border-slate-600 dark:text-slate-400"
                        onClick={() => setShowAddPlanForm(true)}
                      >
                        <span className="material-symbols-outlined text-base leading-none">add</span>
                        Nuevo plan de estudio
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-600 text-center py-4 border border-dashed border-slate-300 rounded-lg dark:text-slate-400 dark:border-slate-600">
                    Selecciona una carrera arriba para ver y gestionar sus planes de estudio.
                  </p>
                )}
              </div>
            </div>

            <div className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 space-y-4 text-black shadow-sm dark:border-slate-800 dark:bg-[#132a52] dark:text-[#e7eef9] dark:shadow-none">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Nuevo módulo</p>
                    <h2 className="text-lg font-semibold leading-snug break-words">Abrir período académico</h2>
                  </div>
                  <span className="material-symbols-outlined text-primary shrink-0">library_add</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm col-span-2">
                    <span className="text-slate-600 text-xs dark:text-slate-400">Semestre del plan</span>
                    <AppSelect
                      aria-label="Semestre para filtrar materias"
                      columns={5}
                      columnsMobile={3}
                      listClassName="max-lg:!min-w-0 max-lg:w-full"
                      value={moduloFiltroSemestre}
                      disabled={!contextoAcademicoListo}
                      onChange={(v) => {
                        setModuloFiltroSemestre(v);
                        setModuloForm((f) => ({ ...f, materiaId: '' }));
                      }}
                      placeholder="Seleccionar semestre"
                      options={Array.from({ length: MAX_SEMESTRE_PLAN }, (_, i) => {
                        const n = i + 1;
                        return { value: String(n), label: formatearSemestre(n) };
                      })}
                      triggerClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-black focus:border-primary focus:outline-none text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm col-span-2">
                    <span className="text-slate-600 text-xs dark:text-slate-400">Materia</span>
                    <AppSelect
                      aria-label="Materia del módulo"
                      value={moduloForm.materiaId}
                      disabled={
                        !contextoAcademicoListo ||
                        !moduloFiltroSemestre ||
                        (Boolean(moduloFiltroSemestre) && materiasParaModuloPeriodo.length === 0)
                      }
                      title={
                        contextoAcademicoListo && !moduloFiltroSemestre
                          ? 'Primero elegí un semestre'
                          : moduloFiltroSemestre && materiasParaModuloPeriodo.length === 0
                            ? `No hay materias en ${formatearSemestre(Number(moduloFiltroSemestre))}`
                            : undefined
                      }
                      onChange={(v) => setModuloForm((f) => ({ ...f, materiaId: v }))}
                      placeholder={moduloFiltroSemestre ? 'Selecciona una materia' : 'Elige un semestre'}
                      emptyOptionsText={
                        moduloFiltroSemestre && materiasParaModuloPeriodo.length === 0 ? 'Sin opciones' : undefined
                      }
                      options={materiasParaModuloPeriodo.map((m) => ({
                        value: String(m.id),
                        label: `${m.nombre} · ${m.codigo}`,
                      }))}
                      triggerClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-black focus:border-primary focus:outline-none text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                    />
                    {moduloFiltroSemestre && materiasParaModuloPeriodo.length === 0 ? (
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        No hay materias en {formatearSemestre(Number(moduloFiltroSemestre))}
                        {carreraSeleccionadaId ? ' para esta carrera' : ''}. Agregalas en planes de estudio o probá otro semestre.
                      </p>
                    ) : null}
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-slate-600 text-xs dark:text-slate-400">Año</span>
                    <AppSelect
                      value={moduloForm.anio}
                      disabled={!contextoAcademicoListo || !moduloForm.materiaId}
                      onChange={(v) => setModuloForm((f) => ({ ...f, anio: v, fechaInicio: '', fechaFin: '' }))}
                      placeholder="Seleccionar año"
                      options={opcionesAnioModulo()}
                      columns={4}
                      triggerClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-black focus:border-primary focus:outline-none text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-slate-600 text-xs dark:text-slate-400">Mes</span>
                    <AppSelect
                      aria-label="Mes del módulo"
                      value={moduloForm.mes}
                      disabled={!contextoAcademicoListo || !moduloForm.materiaId}
                      onChange={(v) => {
                        setModuloForm((f) => ({ ...f, mes: v, fechaInicio: '', fechaFin: '' }));
                      }}
                      placeholder="Mes"
                      columns={3}
                      columnsMobile={1}
                      options={MESES.map((nombre, i) => ({
                        value: String(i + 1),
                        label: nombre,
                      }))}
                      triggerClassName="px-3 py-2 rounded-lg bg-white border border-slate-300 text-black focus:border-primary focus:outline-none text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-slate-600 text-xs dark:text-slate-400">Fecha inicio</span>
                    <input
                      type="date"
                      lang="es"
                      className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-black focus:border-primary focus:outline-none text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                      value={moduloForm.fechaInicio}
                      disabled={!contextoAcademicoListo || !rangoFechasModuloForm}
                      min={rangoFechasModuloForm?.min}
                      max={rangoFechasModuloForm?.max}
                      onChange={(e) =>
                        setModuloForm((f) => ({
                          ...f,
                          fechaInicio: e.target.value,
                          fechaFin: f.fechaFin && e.target.value && f.fechaFin < e.target.value ? '' : f.fechaFin,
                        }))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-slate-600 text-xs dark:text-slate-400">Fecha fin</span>
                    <input
                      type="date"
                      lang="es"
                      className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-black focus:border-primary focus:outline-none text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                      value={moduloForm.fechaFin}
                      disabled={!contextoAcademicoListo || !rangoFechasModuloForm}
                      min={
                        moduloForm.fechaInicio && rangoFechasModuloForm && moduloForm.fechaInicio >= rangoFechasModuloForm.min
                          ? moduloForm.fechaInicio
                          : rangoFechasModuloForm?.min
                      }
                      max={rangoFechasModuloForm?.max}
                      onChange={(e) => setModuloForm((f) => ({ ...f, fechaFin: e.target.value }))}
                    />
                  </label>
                </div>
                <div className="flex justify-end max-lg:w-full">
                  <button
                    type="button"
                    onClick={handleCreateModulo}
                    className="btn-modern btn-modern-primary btn-mobile-cta lg:w-auto"
                    disabled={loading || !contextoAcademicoListo || !moduloFiltroSemestre || !moduloForm.materiaId}
                  >
                    Crear módulo
                  </button>
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-black shadow-sm dark:border-slate-800 dark:bg-[#132a52] dark:text-[#e7eef9] dark:shadow-none">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold">Módulos</h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {modulosListaVisibles.length === sortedModulos.length
                        ? `${sortedModulos.length} registro${sortedModulos.length !== 1 ? 's' : ''}`
                        : `${modulosListaVisibles.length} de ${sortedModulos.length} registro${sortedModulos.length !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                  <span className="material-symbols-outlined text-slate-500 text-[22px] shrink-0">calendar_month</span>
                </div>
                {carreraSeleccionadaId ? (
                  <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center min-w-0">
                    <div className="relative w-full min-w-0 flex-1 lg:min-w-[8.5rem]">
                      <span className="material-symbols-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[16px]">
                        search
                      </span>
                      <input
                        type="search"
                        aria-label="Buscar en módulos"
                        className={inpListaFiltro}
                        placeholder="Buscar materia, semestre o período…"
                        value={moduloListaBusqueda}
                        onChange={(e) => setModuloListaBusqueda(e.target.value)}
                      />
                    </div>
                    <AppSelect
                      aria-label="Filtrar módulos por año"
                      className="w-20 shrink-0"
                      size="xs"
                      value={moduloListaAnio}
                      onChange={setModuloListaAnio}
                      placeholder="Todos"
                      compactMenu
                      disabled={aniosDisponiblesModulos.length === 0}
                      options={[
                        { value: '', label: 'Todos' },
                        ...aniosDisponiblesModulos.map((anio) => ({
                          value: String(anio),
                          label: String(anio),
                        })),
                      ]}
                      triggerClassName="w-full px-2 py-1.5 rounded-md bg-white border border-slate-300 text-xs text-black dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                    />
                  </div>
                ) : null}
                {/* Altura ≈ 3 filas de tarjeta; a partir de la 4ª aparece scroll vertical */}
                <div className="lg:scroll-region-at-lg space-y-2 pr-0.5 lg:max-h-[270px]">
                  {!carreraSeleccionadaId ? (
                    <p className="text-sm text-slate-500 py-6 text-center">Selecciona una carrera para ver los módulos.</p>
                  ) : sortedModulos.length === 0 ? (
                    <p className="text-sm text-slate-600 py-6 text-center dark:text-slate-400">Sin módulos para esta carrera.</p>
                  ) : modulosListaVisibles.length === 0 ? (
                    <p className="text-sm text-slate-600 py-6 text-center dark:text-slate-400">
                      Ningún módulo coincide con la búsqueda o el año seleccionado.
                    </p>
                  ) : modulosListaVisibles.map((mod, i) => {
                    const enPagina = i >= modulosPagina * PAGINA_TAMANO && i < (modulosPagina + 1) * PAGINA_TAMANO;
                    const formatDateLocal = (iso: string | null | undefined) => {
                      if (!iso) return '—';
                      const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
                      return new Date(y, m - 1, d).toLocaleDateString('es-PY', { day: '2-digit', month: 'short', year: 'numeric' });
                    };
                    const fechaInicio = formatDateLocal(mod.fecha_inicio);
                    const fechaFin    = formatDateLocal(mod.fecha_fin);
                    const periodo = `${MESES[(mod.mes ?? 1) - 1]} ${mod.anio}`;
                    const materiaModulo = materias.find((m) => m.id === mod.materia_id);
                    const semestreModulo = materiaModulo?.semestre;
                    return (
                      <div key={mod.id} className={`flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 hover:bg-slate-100 dark:border-slate-700/70 dark:bg-slate-900/40 dark:hover:bg-slate-800/40 max-lg:items-stretch lg:flex-row lg:items-center lg:justify-between lg:gap-3${enPagina ? '' : ' max-lg:hidden'}`}>
                        <div className="flex min-w-0 items-start gap-2.5">
                          <span className="material-symbols-outlined text-primary/70 text-[20px] mt-0.5 shrink-0">book</span>
                          <div className="min-w-0 space-y-0.5">
                            <p className="text-sm font-semibold">
                              <span className="break-words">{mod.materia ?? 'Materia'}</span>
                              {semestreModulo ? (
                                <span className="font-normal text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                  {' — '}{formatearSemestre(semestreModulo)}
                                </span>
                              ) : null}
                            </p>
                            <p className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                              <span className="material-symbols-outlined text-[13px]">calendar_today</span>
                              {periodo}
                            </p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-500">{fechaInicio} → {fechaFin}</p>
                          </div>
                        </div>
                        <div className="btn-mobile-row flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            className="btn-modern btn-modern-xs btn-modern-edit"
                            onClick={() => handleEditModulo(mod)}
                          >
                            Editar
                          </button>
                          <button type="button" className="btn-modern btn-modern-xs btn-modern-danger" onClick={() => handleDeleteModulo(mod)}>
                            Eliminar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {modulosPaginaTotal > 1 && (
                    <div className="lg:hidden flex items-center justify-center gap-1 pt-1">
                      <button type="button" onClick={() => setModulosPagina((p) => p - 1)} disabled={modulosPagina === 0}
                        className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 disabled:opacity-30">
                        ←
                      </button>
                      {Array.from({ length: modulosPaginaTotal }, (_, n) => (
                        <button key={n} type="button" onClick={() => setModulosPagina(n)}
                          className={`px-2 py-1 text-xs rounded border ${n === modulosPagina ? 'bg-primary text-white border-primary' : 'border-slate-300 dark:border-slate-700'}`}>
                          {n + 1}
                        </button>
                      ))}
                      <button type="button" onClick={() => setModulosPagina((p) => p + 1)} disabled={modulosPagina >= modulosPaginaTotal - 1}
                        className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 disabled:opacity-30">
                        →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4 min-w-0">
            <div className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 space-y-4 text-black shadow-sm dark:border-slate-800 dark:bg-[#132a52] dark:text-[#e7eef9] dark:shadow-none">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Nuevo curso</p>
                    <h2 className="text-lg font-semibold leading-snug break-words">Abrir curso</h2>
                  </div>
                  <span className="material-symbols-outlined text-primary shrink-0">add_circle</span>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <label className="flex min-w-0 flex-col gap-1 text-sm">
                    <span className="text-slate-600 text-xs dark:text-slate-400">Semestre</span>
                    <AppSelect
                      aria-label="Semestre del curso"
                      columns={5}
                      columnsMobile={3}
                      listClassName="max-lg:!min-w-0 max-lg:w-full"
                      value={cursoFiltroSemestre}
                      disabled={!contextoAcademicoListo || !carreraSeleccionadaId}
                      onChange={(v) => {
                        setCursoFiltroSemestre(v);
                        setCursoFiltroAnio(String(new Date().getFullYear()));
                        setCursoForm((f) => ({ ...f, moduloId: '' }));
                      }}
                      placeholder={carreraSeleccionadaId ? 'Selecciona un semestre' : 'Elige una carrera primero'}
                      options={semestresCursoDisponibles.map((s) => ({
                        value: String(s),
                        label: s > 0 ? formatearSemestre(s) : 'Sin semestre asignado',
                      }))}
                      triggerClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-black focus:border-primary focus:outline-none text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                    />
                  </label>
                  <div className="grid grid-cols-[1fr_auto] gap-3">
                    <label className="flex min-w-0 flex-col gap-1 text-sm">
                      <span className="text-slate-600 text-xs dark:text-slate-400">Módulo (materia + mes)</span>
                      <AppSelect
                        aria-label="Módulo del curso"
                        value={cursoForm.moduloId}
                        disabled={
                          !contextoAcademicoListo ||
                          !cursoFiltroSemestre ||
                          (Boolean(cursoFiltroSemestre) && modulosCursoFiltrados.length === 0)
                        }
                        onChange={(v) => setCursoForm((f) => ({ ...f, moduloId: v }))}
                        placeholder={cursoFiltroSemestre ? 'Selecciona un módulo' : 'Elige un semestre primero'}
                        emptyOptionsText={
                          cursoFiltroSemestre && modulosCursoFiltrados.length === 0 ? 'Sin opciones' : undefined
                        }
                        options={modulosCursoFiltrados.map((m) => {
                          const mat = materias.find((mat) => mat.id === m.materia_id);
                          const sem = mat?.semestre ? ` — ${formatearSemestre(mat.semestre)}` : '';
                          return {
                            value: String(m.id),
                            label: `${m.materia ?? `Materia ${m.materia_id}`}${sem} · ${MESES[(m.mes ?? 1) - 1]} ${m.anio}`,
                          };
                        })}
                        triggerClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-black focus:border-primary focus:outline-none text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                      />
                    </label>
                    <label className="flex min-w-0 flex-col gap-1 text-sm">
                      <span className="text-slate-600 text-xs dark:text-slate-400">Año</span>
                      <AppSelect
                        aria-label="Filtrar módulos del curso por año"
                        className="w-20"
                        size="xs"
                        value={cursoFiltroAnio}
                        onChange={(v) => {
                          setCursoFiltroAnio(v);
                          setCursoForm((f) => ({ ...f, moduloId: '' }));
                        }}
                        placeholder="−"
                        compactMenu
                        disabled={!cursoFiltroSemestre || aniosDisponiblesModulosCurso.length === 0}
                        options={aniosDisponiblesModulosCurso.map((anio) => ({
                          value: String(anio),
                          label: String(anio),
                        }))}
                        triggerClassName="w-full px-2 py-1.5 rounded-md bg-white border border-slate-300 text-xs text-black dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                      />
                    </label>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1 text-sm relative">
                    <span className="text-slate-600 text-xs dark:text-slate-400">Docente</span>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 material-symbols-outlined text-[16px]">
                        search
                      </span>
                      <input
                        aria-label="Buscar docente por nombre"
                        className="w-full pl-8 pr-3 py-2 rounded-lg bg-white border border-slate-300 text-black focus:border-primary focus:outline-none text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                        value={docenteSearch}
                        disabled={!contextoAcademicoListo}
                        onChange={(e) => {
                          setDocenteSearch(e.target.value);
                          setDocenteSearchOpen(true);
                          setCursoForm((f) => ({ ...f, docenteId: '' }));
                        }}
                        onFocus={() => {
                          if (contextoAcademicoListo) setDocenteSearchOpen(true);
                        }}
                        onBlur={() => setTimeout(() => setDocenteSearchOpen(false), 150)}
                        placeholder="Buscar por nombre o correo"
                      />
                    </div>
                    {contextoAcademicoListo && docenteSearchOpen ? (
                      <div className="app-dropdown-panel absolute top-full z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl ring-1 ring-slate-200/80 dark:border-slate-700/60 dark:bg-[#0b1427] dark:ring-white/5">
                        {docentesFiltrados.length ? (
                          <div className="max-h-[170px] overflow-y-auto overscroll-contain divide-y divide-slate-100 dark:divide-slate-800/60">
                            {docentesFiltrados.map((docente) => (
                              <button
                                key={docente.id}
                                type="button"
                                className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800/70"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  // Usa docente.id (usuario) si no tiene persona vinculada; el backend resuelve ambos
                                  setCursoForm((f) => ({ ...f, docenteId: docente.persona?.id || docente.id }));
                                  setDocenteSearch(formatDocenteLabel(docente));
                                  setDocenteSearchOpen(false);
                                }}
                              >
                                <span className="material-symbols-outlined text-slate-500 text-[18px] shrink-0">person</span>
                                <div className="min-w-0 flex-1">
                                  <p className="app-dropdown-option-line text-sm font-medium text-black dark:text-[#e7eef9]">
                                    {formatDocenteLabel(docente)}
                                  </p>
                                  <p className="app-dropdown-option-line text-xs text-slate-600 dark:text-slate-400">
                                    {docente.email}
                                    {docente.persona?.legajo ? ` · Legajo ${docente.persona.legajo}` : ''}
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                            <span className="material-symbols-outlined text-[18px]">search_off</span>
                            Sin coincidencias
                          </div>
                        )}
                      </div>
                    ) : null}
                    <div className="min-h-5">
                      {docenteSeleccionado ? (
                        <p className="text-xs text-emerald-700 flex items-center gap-1 dark:text-emerald-300">
                          <span className="material-symbols-outlined text-[13px]">check_circle</span>
                          {formatDocenteLabel(docenteSeleccionado)}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500">Elige una opción de la lista.</p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end max-lg:w-full">
                  <button
                    type="button"
                    onClick={handleCreateCurso}
                    className="btn-modern btn-modern-primary btn-mobile-cta lg:w-auto"
                    disabled={loading || !contextoAcademicoListo || !cursoForm.moduloId || !cursoForm.docenteId}
                  >
                    Crear curso
                  </button>
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-black shadow-sm dark:border-slate-800 dark:bg-[#132a52] dark:text-[#e7eef9] dark:shadow-none">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold">Cursos</h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {cursosListaVisibles.length === cursosFiltradosPorCarrera.length
                        ? `${cursosFiltradosPorCarrera.length} registro${cursosFiltradosPorCarrera.length !== 1 ? 's' : ''}`
                        : `${cursosListaVisibles.length} de ${cursosFiltradosPorCarrera.length} registro${cursosFiltradosPorCarrera.length !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                  <span className="material-symbols-outlined text-slate-500 text-[22px] shrink-0">school</span>
                </div>
                {carreraSeleccionadaId ? (
                  <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center min-w-0">
                    <div className="relative w-full min-w-0 flex-1 lg:min-w-[8.5rem]">
                      <span className="material-symbols-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[16px]">
                        search
                      </span>
                      <input
                        type="search"
                        aria-label="Buscar en cursos"
                        className={inpListaFiltro}
                        placeholder="Buscar materia, semestre o docente…"
                        value={cursoListaBusqueda}
                        onChange={(e) => setCursoListaBusqueda(e.target.value)}
                      />
                    </div>
                    <AppSelect
                      aria-label="Filtrar cursos por año"
                      className="w-full min-w-0 shrink-0 lg:w-20"
                      size="xs"
                      value={cursoListaAnio}
                      onChange={setCursoListaAnio}
                      placeholder="Año"
                      compactMenu
                      disabled={aniosDisponiblesCursos.length === 0}
                      options={aniosDisponiblesCursos.map((anio) => ({
                        value: String(anio),
                        label: String(anio),
                      }))}
                      triggerClassName="w-full px-2 py-1.5 rounded-md bg-white border border-slate-300 text-xs text-black dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                    />
                  </div>
                ) : null}

                {/* Altura ≈ 3 filas de tarjeta; a partir de la 4ª aparece scroll vertical */}
                <div className="lg:scroll-region-at-lg pr-0.5 lg:max-h-[270px]">
                  {!carreraSeleccionadaId ? (
                    <p className="text-sm text-slate-500 py-6 text-center">Selecciona una carrera para ver los cursos.</p>
                  ) : !cursosFiltradosPorCarrera.length ? (
                    <p className="text-sm text-slate-600 py-6 text-center dark:text-slate-400">Sin cursos para esta carrera.</p>
                  ) : cursosListaVisibles.length === 0 ? (
                    <p className="text-sm text-slate-600 py-6 text-center dark:text-slate-400">
                      Ningún curso coincide con la búsqueda o el año seleccionado.
                    </p>
                  ) : (
                    <div className="w-full min-w-0">
                      <div
                        className="sticky top-0 z-10 mb-1.5 hidden items-center gap-x-2 border-b border-slate-200 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 shadow-[0_1px_3px_rgba(15,23,42,0.06)] dark:border-slate-700 dark:bg-[#132a52] dark:text-slate-400 dark:shadow-[0_1px_0_#1e293b] lg:grid lg:grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,8.5rem)_minmax(2.5rem,3.5rem)_minmax(0,8.75rem)]"
                        aria-hidden
                      >
                        <span />
                        <span>Materia</span>
                        <span className="truncate">Docente</span>
                        <span className="text-right">Alumnos</span>
                        <span />
                      </div>
                      <div className="space-y-1.5 pt-0.5 max-lg:space-y-2">
                      {cursosListaVisibles.map((curso, i) => {
                        const enPagina = i >= cursosPagina * PAGINA_TAMANO && i < (cursosPagina + 1) * PAGINA_TAMANO;
                        const isSelected = selectedCursoId === curso.id;
                        const materiaTitulo = curso.materia ?? `Módulo ${curso.modulo_id}`;
                        const semestreCursoCard = obtenerSemestrePlanCurso(curso, modulos, materias);
                        const docenteNombre = curso.docente ?? String(curso.docente_id ?? '—');
                        const inscriptos = curso.inscriptos ?? 0;
                        return (
                          <div
                            key={curso.id}
                            className={`rounded-lg border transition-colors max-lg:flex max-lg:flex-col max-lg:gap-2 max-lg:p-3 lg:grid lg:grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,8.5rem)_minmax(2.5rem,3.5rem)_minmax(0,8.75rem)] lg:items-center lg:gap-x-2 lg:px-3 lg:py-2.5${enPagina ? '' : ' max-lg:hidden'} ${
                              isSelected
                                ? 'border-primary/60 bg-primary/5 ring-2 ring-primary/30 dark:bg-primary/10'
                                : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm dark:border-slate-700/70 dark:bg-slate-900/30 dark:hover:border-slate-600/80'
                            }`}
                          >
                            <button
                              type="button"
                              className="text-left max-lg:flex max-lg:w-full max-lg:flex-col max-lg:gap-2 lg:contents"
                              onClick={() => void handleSelectCurso(curso.id)}
                            >
                              <div className="flex min-w-0 items-start gap-2 max-lg:w-full lg:contents">
                                <span
                                  className={`material-symbols-outlined shrink-0 text-[18px] leading-none cursor-pointer lg:justify-self-center ${
                                    isSelected ? 'text-primary' : 'text-slate-400 dark:text-slate-500'
                                  }`}
                                >
                                  {isSelected ? 'check_circle' : 'school'}
                                </span>
                                <div className="min-w-0 flex-1 lg:contents">
                                  <span className="min-w-0 cursor-pointer text-sm font-semibold leading-snug text-slate-900 max-lg:block max-lg:break-words max-lg:whitespace-normal dark:text-[#e7eef9]">
                                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 lg:hidden">
                                      Materia
                                    </span>
                                    <span>{materiaTitulo}</span>
                                    {semestreCursoCard ? (
                                      <span className="block text-xs font-normal text-slate-500 dark:text-slate-400 mt-0.5">
                                        {formatearSemestre(semestreCursoCard)}
                                      </span>
                                    ) : null}
                                  </span>
                                </div>
                              </div>
                              <div className="min-w-0 max-lg:pl-7 lg:contents">
                                <span
                                  className="min-w-0 cursor-pointer text-xs leading-snug text-slate-600 max-lg:block max-lg:break-words max-lg:whitespace-normal dark:text-slate-400 lg:truncate"
                                  title={docenteNombre}
                                >
                                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 lg:hidden">
                                    Docente
                                  </span>
                                  {docenteNombre}
                                </span>
                              </div>
                              <span className="cursor-pointer text-xs leading-snug tabular-nums max-lg:pl-7 lg:justify-self-end lg:whitespace-nowrap">
                                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 lg:hidden">
                                  Alumnos
                                </span>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">{inscriptos}</span>
                                <span className="text-slate-500 dark:text-slate-500"> insc.</span>
                              </span>
                            </button>
                            <div
                              data-curso-acciones
                              className="btn-mobile-row flex items-center justify-end gap-1 max-lg:border-t max-lg:border-slate-200/80 max-lg:pt-2 dark:max-lg:border-slate-700/80 lg:col-start-5 lg:border-l lg:border-slate-200/80 lg:pl-1.5 dark:lg:border-slate-700/80"
                            >
                              <button
                                type="button"
                                className="btn-modern btn-modern-xs btn-modern-edit"
                                onClick={() => handleEditCurso(curso)}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                className="btn-modern btn-modern-xs btn-modern-danger"
                                onClick={() => handleDeleteCurso(curso)}
                              >
                                Eliminar
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {cursosPaginaTotal > 1 && (
                        <div className="lg:hidden flex items-center justify-center gap-1 pt-1">
                          <button type="button" onClick={() => setCursosPagina((p) => p - 1)} disabled={cursosPagina === 0}
                            className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 disabled:opacity-30">
                            ←
                          </button>
                          {Array.from({ length: cursosPaginaTotal }, (_, n) => (
                            <button key={n} type="button" onClick={() => setCursosPagina(n)}
                              className={`px-2 py-1 text-xs rounded border ${n === cursosPagina ? 'bg-primary text-white border-primary' : 'border-slate-300 dark:border-slate-700'}`}>
                              {n + 1}
                            </button>
                          ))}
                          <button type="button" onClick={() => setCursosPagina((p) => p + 1)} disabled={cursosPagina >= cursosPaginaTotal - 1}
                            className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 disabled:opacity-30">
                            →
                          </button>
                        </div>
                      )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div
              ref={planillaPanelRef}
              className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm scroll-mt-4 dark:border-slate-800 dark:bg-[#132a52] dark:shadow-none flex flex-col min-h-0"
            >
              {cursoSeleccionado ? (
                <>                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800 max-lg:flex-col max-lg:gap-2 max-lg:p-3">
                  <div className="min-w-0 space-y-1 max-lg:w-full">
                    <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Planilla de alumnos</p>
                    <h3 className="text-lg font-semibold text-black dark:text-[#e7eef9] max-lg:break-words max-lg:leading-snug max-lg:whitespace-normal lg:truncate">
                      {cursoSeleccionado.materia ?? `Módulo ${cursoSeleccionado.modulo_id}`}
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 break-words leading-relaxed">
                      {cursoSeleccionado.docente ?? cursoSeleccionado.docente_id} ·{' '}
                      <span className="tabular-nums">{planillaSeleccionada.length} alumno{planillaSeleccionada.length !== 1 ? 's' : ''}</span>
                    </p>
                    {formatCursoUbicacionHorario(cursoSeleccionado) ? (
                      <p className="text-xs text-slate-500 flex items-center gap-1 dark:text-slate-500">
                        <span className="material-symbols-outlined text-[14px]">meeting_room</span>
                        {formatCursoUbicacionHorario(cursoSeleccionado)}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn-modern btn-modern-ghost btn-modern-sm btn-mobile-cta shrink-0 lg:w-auto"
                    onClick={cerrarPlanillaCurso}
                    aria-label="Cerrar planilla"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                    Cerrar
                  </button>
                </div>

                <div className="space-y-4 p-4 max-lg:space-y-3 max-lg:p-3">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Agregar alumno</p>
                      <div ref={alumnoSearchWrapRef} className="relative">
                        <input
                          aria-label="Buscar alumno"
                          className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-black placeholder:text-slate-400 focus:border-primary focus:outline-none text-sm disabled:opacity-60 disabled:cursor-not-allowed dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9] dark:placeholder:text-slate-500"
                          placeholder={
                            puedeBuscarAlumnoPlanilla
                              ? 'Buscar por nombre o documento...'
                              : carreraSeleccionadaId
                                ? 'Seleccioná facultad arriba para buscar alumnos'
                                : 'Seleccioná facultad y carrera arriba'
                          }
                          disabled={!puedeBuscarAlumnoPlanilla}
                          value={alumnoSearch}
                          onChange={(e) => {
                            setAlumnoSearch(e.target.value);
                            setAlumnoSearchOpen(true);
                            void handleBuscarAlumno(e.target.value);
                          }}
                          onFocus={() => {
                            if (!puedeBuscarAlumnoPlanilla) return;
                            setAlumnoSearchOpen(true);
                          }}
                          onBlur={() => {
                            window.setTimeout(() => cerrarBuscadorAlumnoPlanilla(), 150);
                          }}
                        />
                        {alumnoSearchOpen && (alumnoResultados.length > 0 || alumnoSearchLoading) ? (
                          <div className="app-dropdown-panel absolute top-full z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-600 dark:bg-[#0b1427]">
                            {alumnoSearchLoading ? (
                              <p className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400">Buscando...</p>
                            ) : (
                              <div
                                className="max-h-40 overflow-y-auto overscroll-contain"
                                role="listbox"
                                aria-label="Resultados de búsqueda de alumnos"
                              >
                                {alumnoResultados.map((al) => {
                                  const nombre =
                                    al.nombre_apellido ??
                                    [al.apellidos, al.nombres].map((s) => s?.trim()).filter(Boolean).join(', ');
                                  return (
                                    <button
                                      key={al.id}
                                      type="button"
                                      role="option"
                                      className="flex w-full shrink-0 flex-col justify-center px-3 py-2.5 text-left hover:bg-slate-100 border-b border-slate-100 last:border-b-0 dark:hover:bg-slate-800 dark:border-slate-800"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        void handleMatricularAlumno(cursoSeleccionado.id, al);
                                      }}
                                    >
                                      <p className="app-dropdown-option-line text-sm font-medium text-black dark:text-[#e7eef9]">
                                        {nombre}
                                      </p>
                                      <p className="app-dropdown-option-line text-xs text-slate-600 dark:text-slate-400">
                                        Doc: {al.numero_documento}
                                      </p>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {(() => {
                      const curso = cursoSeleccionado;
                      const semestreCurso = obtenerSemestrePlanCurso(curso, modulos, materias);
                      const lotesParaCurso = lotesAlumnos.filter((l) => {
                        if (l.destino_carrera_id && curso.carrera_id) {
                          return l.destino_carrera_id === curso.carrera_id;
                        }
                        if (l.destino_carrera && carreraSeleccionada) {
                          return normalizarTexto(l.destino_carrera) === normalizarTexto(carreraSeleccionada.nombre);
                        }
                        return false;
                      });
                      const lotesPorSemestre = new Map<string, LoteAlumnos>();
                      for (const lote of [...lotesParaCurso].sort((a, b) => b.id - a.id)) {
                        const semestre = extraerNumeroSemestre(lote.descripcion);
                        if (!semestre) continue;
                        if (semestreCurso != null && semestre !== semestreCurso) continue;
                        if (lote.alumnos_en_etiqueta_semestre === 0) continue;
                        const key = `${semestre}_${lote.cohorte_anio ?? 's/c'}`;
                        if (lotesPorSemestre.has(key)) continue;
                        lotesPorSemestre.set(key, lote);
                      }
                      const semestresDisponibles = Array.from(lotesPorSemestre.entries()).sort((a, b) => {
                        const sA = parseInt(a[0]);
                        const sB = parseInt(b[0]);
                        return sA - sB;
                      });
                      const sinPlanillasCompatibles = semestreCurso == null || semestresDisponibles.length === 0;
                      const semestreSelRaw = semestreLotePorCurso[curso.id] ?? '';
                      const semestreSeleccionado =
                        !sinPlanillasCompatibles && semestresDisponibles.some(([s]) => s === semestreSelRaw)
                          ? semestreSelRaw
                          : !sinPlanillasCompatibles && semestresDisponibles.length === 1
                            ? semestresDisponibles[0][0]
                            : '';
                      const loteSeleccionado = semestreSeleccionado
                        ? lotesPorSemestre.get(semestreSeleccionado) ?? null
                        : null;
                      const placeholderLote = sinPlanillasCompatibles
                        ? 'Sin planilla para este semestre'
                        : 'Seleccionar semestre...';

                      return (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Asignar planilla importada</p>
                          <div className="flex items-center gap-2 max-lg:flex-col max-lg:items-stretch">
                            <AppSelect
                              aria-label="Seleccionar semestre importado para asignar al curso"
                              columnsMobile={3}
                              listClassName="max-lg:!min-w-0 max-lg:w-full"
                              className="min-w-0 flex-1 max-lg:w-full"
                              value={semestreSeleccionado}
                              disabled={sinPlanillasCompatibles}
                              onChange={(v) => setSemestreLotePorCurso((prev) => ({ ...prev, [curso.id]: v }))}
                              placeholder={placeholderLote}
                              options={semestresDisponibles.map(([key, lote]) => {
                                const semNum = parseInt(key);
                                const cohorteLabel = lote.cohorte_anio ? ` - Año Ingreso: ${lote.cohorte_anio}` : '';
                                return {
                                  value: key,
                                  label: `${formatearSemestre(semNum)}${cohorteLabel}`,
                                };
                              })}
                              triggerClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm text-black focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                            />
                            <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="btn-modern btn-modern-sm btn-modern-primary btn-mobile-cta shrink-0 lg:w-auto max-lg:max-w-[260px]"
                              disabled={sinPlanillasCompatibles || !loteSeleccionado || loteImportLoading}
                              onClick={() =>
                                loteSeleccionado &&
                                void handleMatricularDesdeLote(
                                  curso.id,
                                  loteSeleccionado.id,
                                  parseInt(semestreSeleccionado)
                                )
                              }
                            >
                              {loteImportLoading ? '...' : 'Asignar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                 setPendingDelete({
                                  title: 'Limpiar planilla',
                                  description: 'Se desmatricularán todos los alumnos de este curso.',
                                  confirmLabel: 'Limpiar',
                                  onConfirm: async () => {
                                    setDialogLoading(true);
                                    try {
                                      await apiFetch(`/academico/cursos/${curso.id}/planilla`, { method: 'DELETE' });
                                      setPlanillaMap((prev) => {
                                        const next = new Map(prev);
                                        next.set(curso.id, []);
                                        return next;
                                      });
                                      setCursos((prev) => prev.map((c) => c.id === curso.id ? { ...c, inscriptos: 0 } : c));
                                      toast.success('Planilla limpiada');
                                      setPendingDelete(null);
                                    } catch (error) {
                                      toast.error(error instanceof Error ? error.message : 'No se pudo limpiar la planilla');
                                    } finally {
                                      setDialogLoading(false);
                                    }
                                  },
                                });
                              }}
                              className="shrink-0 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 flex items-center"
                              title="Limpiar planilla"
                              disabled={(curso.inscriptos ?? 0) === 0}
                            >
                              <span className="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="flex flex-col gap-2 pt-1 border-t border-slate-200 dark:border-slate-700 lg:flex-row lg:flex-wrap lg:items-center min-w-0">
                    <AppSelect
                      aria-label="Curso origen para copiar planilla"
                      className="w-full min-w-0 flex-1 lg:min-w-[12rem]"
                      value={copiarDesdeCursoId}
                      onChange={setCopiarDesdeCursoId}
                      allowEmpty
                      emptyLabel="Copiar planilla desde otro curso..."
                      options={cursosFiltradosPorCarrera
                        .filter((c) => {
                          if (c.id === cursoSeleccionado.id) return false;
                          const semOrigen = obtenerSemestrePlanCurso(c, modulos, materias);
                          const semDestino = obtenerSemestrePlanCurso(cursoSeleccionado, modulos, materias);
                          if (semDestino == null) return true;
                          return semOrigen === semDestino;
                        })
                        .map((c) => {
                          const semCurso = obtenerSemestrePlanCurso(c, modulos, materias);
                          const semStr = semCurso ? ` — ${formatearSemestre(semCurso)}` : '';
                          const docenteStr = c.docente ? ` · ${c.docente}` : '';
                          const nombre = c.materia ?? 'Módulo ' + c.modulo_id;
                          return { value: String(c.id), label: `${nombre}${semStr}${docenteStr}` };
                        })}
                      triggerClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm text-black focus:border-primary focus:outline-none dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                    />
                    <button
                      type="button"
                      className="btn-modern btn-modern-sm btn-modern-ghost btn-mobile-cta shrink-0 border-slate-300 dark:border-slate-600 lg:w-auto"
                      disabled={!copiarDesdeCursoId}
                      onClick={() => void handleCopiarMatriculas(cursoSeleccionado.id)}
                    >
                      Copiar planilla
                    </button>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-950/20 overflow-hidden min-w-0">
                    {planillaLoading ? (
                      <p className="text-sm text-slate-600 text-center py-12 dark:text-slate-400">Cargando planilla...</p>
                    ) : planillaSeleccionada.length === 0 ? (
                      <p className="text-sm text-slate-600 text-center py-12 dark:text-slate-400">
                        Sin alumnos inscritos. Usá el buscador o asigná una planilla importada.
                      </p>
                    ) : (
                      <>
                        <ul className="divide-y divide-slate-200 dark:divide-slate-800 md:hidden">
                          {planillaMobileItems.map((m, idx) => (
                            <li
                              key={m.id}
                              className="flex flex-col gap-2 bg-white px-4 py-3 dark:bg-transparent"
                            >
                              <div className="flex items-start gap-2">
                                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                  #{planillaPage * PLANILLA_PAGE_SIZE + idx + 1}
                                </span>
                              </div>
                              <p className="text-[15px] font-medium leading-snug break-words text-black dark:text-[#e7eef9]">
                                {m.nombre_completo}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                                <span>
                                  <span className="text-slate-500 dark:text-slate-500">Documento </span>
                                  <span className="tabular-nums font-medium text-slate-800 dark:text-slate-200">
                                    {m.numero_documento}
                                  </span>
                                </span>
                                <span className="capitalize">
                                  <span className="text-slate-500 dark:text-slate-500">Estado </span>
                                  {m.estado_academico.replace(/_/g, ' ')}
                                </span>
                              </div>
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  className="text-[11px] text-red-600 hover:text-red-700 font-medium dark:text-red-400 dark:hover:text-red-300"
                                  onClick={() => handleDesmatricularAlumno(cursoSeleccionado.id, m)}
                                >
                                  Quitar
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                        {planillaPageCount > 1 && (
                          <div className="md:hidden flex items-center justify-center gap-1 py-2 border-t border-slate-200 dark:border-slate-800">
                            <button type="button" onClick={() => setPlanillaPage((p) => p - 1)} disabled={planillaPage === 0}
                              className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 disabled:opacity-30">
                              ←
                            </button>
                            {Array.from({ length: planillaPageCount }, (_, n) => (
                              <button key={n} type="button" onClick={() => setPlanillaPage(n)}
                                className={`px-2 py-1 text-xs rounded border ${n === planillaPage ? 'bg-primary text-white border-primary' : 'border-slate-300 dark:border-slate-700'}`}>
                                {n + 1}
                              </button>
                            ))}
                            <button type="button" onClick={() => setPlanillaPage((p) => p + 1)} disabled={planillaPage >= planillaPageCount - 1}
                              className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 disabled:opacity-30">
                              →
                            </button>
                          </div>
                        )}
                        <div className="scroll-region hidden h-[min(28rem,55vh)] lg:block">
                          <table className="w-full min-w-[32rem] border-collapse text-sm">
                            <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-[#0d1b2e]">
                              <tr className="text-left text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400">
                                <th className="w-10 px-3 py-2.5 font-semibold">#</th>
                                <th className="px-3 py-2.5 font-semibold">Apellidos y nombres</th>
                                <th className="w-28 px-3 py-2.5 font-semibold">Documento</th>
                                <th className="w-24 px-3 py-2.5 font-semibold">Estado</th>
                                <th className="w-24 px-3 py-2.5 text-right font-semibold">Acción</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                              {planillaSeleccionada.map((m, idx) => (
                                <tr
                                  key={m.id}
                                  className="bg-white hover:bg-slate-50 dark:bg-transparent dark:hover:bg-slate-900/50"
                                >
                                  <td className="px-3 py-3 text-xs tabular-nums text-slate-500">{idx + 1}</td>
                                  <td className="px-3 py-3 font-medium text-black dark:text-[#e7eef9]">{m.nombre_completo}</td>
                                  <td className="px-3 py-3 tabular-nums text-slate-600 dark:text-slate-400">{m.numero_documento}</td>
                                  <td className="px-3 py-3 capitalize text-slate-600 dark:text-slate-400">{m.estado_academico.replace(/_/g, ' ')}</td>
                                  <td className="px-3 py-3 text-right">
                                    <button
                                      type="button"
                                      className="btn-modern btn-modern-xs btn-modern-danger"
                                      onClick={() => handleDesmatricularAlumno(cursoSeleccionado.id, m)}
                                    >
                                      Quitar
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 py-16 px-4 text-center">
                  <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-600">group</span>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Planilla de alumnos</p>
                    <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">Seleccioná un curso para ver su planilla</p>
                  </div>
                </div>
              )}
            </div>

            {cursoSeleccionado && moduloDelCursoSeleccionado && (
              <CronogramaCatedra
                cursoId={cursoSeleccionado.id}
                fechaInicio={moduloDelCursoSeleccionado.fecha_inicio.slice(0, 10)}
                fechaFin={moduloDelCursoSeleccionado.fecha_fin.slice(0, 10)}
              />
            )}
            </div>
            </div>

          </section>
        </main>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) void pendingDelete.onConfirm(); }}
        title={pendingDelete?.title ?? ''}
        description={pendingDelete?.description}
        confirmLabel={pendingDelete?.confirmLabel ?? 'Eliminar'}
        variant="danger"
        loading={dialogLoading}
      />

      <EditItemDialog
        open={pendingEdit !== null}
        title={pendingEdit?.title ?? ''}
        fields={pendingEdit?.fields ?? []}
        onCancel={() => setPendingEdit(null)}
        onSave={(values) => { if (pendingEdit) void pendingEdit.onSave(values); }}
        loading={dialogLoading}
        resolveDateBounds={resolveDateBounds}
      />
    </div>
  );
}


