import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode, SyntheticEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from '../utils/toast';
import { AppSidebar } from '../components/AppSidebar';
import { UserAvatar } from '../components/ui/user-avatar';
import { SkeletonRow } from '../components/ui/skeleton';
import { AppSelect } from '../components/ui/app-select';
import { BotonVolverListadoMovil } from '../components/ui/boton-volver-listado-movil';
import { ConfirmDialog } from '../components/ui/confirm-dialog';


import { generarYAbrirPdf, apiFetch } from '../utils/api';
import { formatDateOnly } from '../utils/datetime';
import { appPath } from '../navigation/app-paths';
import { readStoredUser } from '../utils/session-user';
import { etiquetaRol, etiquetasRoles } from '../utils/role-labels';

/** Checkbox de carreras: círculo y punto como rol/facultad (ver .scope-radio-dot en index.css). */
const SCOPE_CARRERA_CHOICE_CLASS =
  'scope-radio-dot size-5 rounded-full border-slate-600 text-primary focus:ring-primary';

const USUARIO_PANEL_CARD_CLASS =
  'usuario-detail-panel-card rounded-2xl border border-slate-200 bg-white shadow-sm max-lg:shadow-md dark:border-[#1c2a50] dark:bg-transparent dark:max-lg:shadow-none';

const USUARIO_PANEL_HERO_CLASS =
  'overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-sky-50/70 p-2.5 shadow-sm dark:border-[#1c2a50] dark:from-[#162347] dark:via-[#131e3c] dark:to-[#101a33]';

/** Campos de formulario (móvil y escritorio, claro/oscuro). */
const USUARIO_INP =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 dark:border-slate-700 dark:bg-[#0b2147] dark:text-[#e7eef9] dark:placeholder:text-slate-500 dark:shadow-none';

const USUARIO_LABEL = 'block space-y-1.5 text-xs font-medium text-slate-600 dark:text-white';

const USUARIO_SECTION_HEADING =
  'text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white';

const USUARIO_ROLE_IDLE =
  'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-[#0b2147]/80 dark:hover:border-slate-600';

const USUARIO_ROLE_ACTIVE =
  'border-primary/30 bg-primary/5 dark:border-primary/50 dark:bg-primary/15';

const USUARIO_SCOPE_IDLE =
  'border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-surface-darker dark:hover:border-slate-600';

const USUARIO_SCOPE_ACTIVE = 'border-primary/50 bg-primary/5 dark:border-primary/60 dark:bg-primary/10';

/** Panel lateral derecho: mismo fondo que AppSidebar (ver .usuario-detail-panel en index.css). */
const USUARIO_DETAIL_SHELL = 'usuario-detail-panel';
const USUARIO_DETAIL_HEADER =
  'usuario-detail-panel-header border-b border-slate-200 bg-slate-50 dark:border-[#132a52] dark:bg-[#132a52]';
const USUARIO_DETAIL_BODY = 'usuario-detail-panel-body bg-white';
const USUARIO_DETAIL_FOOTER =
  'usuario-detail-panel-footer border-t border-slate-200 bg-white dark:border-[#132a52] dark:bg-[#132a52]';

function UsuarioCampoLecturaMovil({ etiqueta, valor }: { etiqueta: string; valor: ReactNode }) {
  return (
    <div className="border-b border-slate-200/90 px-4 py-3 last:border-b-0 dark:border-slate-700/70">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{etiqueta}</p>
      <div className="mt-1.5 text-sm leading-relaxed text-slate-800 dark:text-slate-100">{valor}</div>
    </div>
  );
}

function UsuarioFormCardMovil({
  titulo,
  badge,
  children,
}: {
  titulo: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className={`${USUARIO_PANEL_CARD_CLASS} overflow-hidden lg:rounded-none lg:border-0 lg:bg-transparent lg:shadow-none dark:lg:border-b dark:lg:border-[#1c2a50] dark:lg:pb-6 dark:lg:last:border-b-0`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-[#1c2a50] lg:hidden">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {titulo}
        </p>
        {badge ?? null}
      </div>
      <div className="space-y-4 p-4 max-lg:space-y-3 lg:p-0">{children}</div>
    </section>
  );
}

function normalizeRolSesion(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Administrador General y Secretaría Académica (alineado con API DELETE /usuarios). */
function puedeEliminarUsuariosSesion(roles: string[] | undefined): boolean {
  const set = new Set((roles ?? []).map(normalizeRolSesion));
  return set.has('administrador general') || set.has('secretaria academica');
}

function usuarioCoincideFiltroRol(roles: string[], roleFilter: string): boolean {
  if (roleFilter === 'all') return true;
  if (roleFilter === 'Administrador General') {
    return roles.some((rol) => rol.toLowerCase().includes('admin'));
  }
  if (roleFilter === 'Coordinador de Facultad') {
    return usuarioTieneCoordinacionFacultad(roles);
  }
  return roles.includes(roleFilter);
}

function roleFilterToExportBody(
  roleFilter: string
): { rol?: string; rolCategoria?: 'admins' | 'secretaria' | 'directores' | 'docentes' } {
  if (roleFilter === 'all') return {};
  if (roleFilter === 'Administrador General') return { rolCategoria: 'admins' };
  if (roleFilter === 'Secretaría Académica') return { rolCategoria: 'secretaria' };
  if (roleFilter === 'Docente') return { rolCategoria: 'docentes' };
  if (roleFilter === 'Coordinador de Facultad') return { rolCategoria: 'directores' };
  return { rol: roleFilter };
}

type EstadoUsuario = 'activo' | 'inactivo' | 'suspendido';

type PersonaTipo = 'docente';

interface PersonaInfo {
  tipo: PersonaTipo;
  id: string;
  legajo?: string | null;
  tituloAcademico?: string | null;
}

interface UsuarioScope {
  facultad_id: number | null;
  facultad_nombre: string | null;
  carrera_id: number | null;
  carrera_nombre: string | null;
}

interface Usuario {
  id: string;
  nombres: string;
  apellidos: string;
  email: string;
  usuario: string;
  telefono: string | null;
  estado: EstadoUsuario;
  roles: string[];
  creadoEn: string;
  actualizadoEn: string;
  permisos: PermisosEspeciales;
  persona?: PersonaInfo | null;
  scopes?: UsuarioScope[];
}

interface Facultad {
  id: number;
  nombre: string;
}

interface Carrera {
  id: number;
  nombre: string;
  facultad_id: number;
}

interface UsuariosResponse {
  total: number;
  datos: Usuario[];
}

interface CreateUserPayload {
  nombres: string;
  apellidos: string;
  email: string;
  usuario?: string;
  telefono?: string;
  password: string;
  roles: string[];
  estado?: EstadoUsuario;
  persona?: { tipo: 'docente'; id: string };
  permisos?: PermisosEspeciales;
  scope?: { facultad_ids?: number[]; carrera_ids?: number[] };
}

interface EditableUserState {
  nombres: string;
  apellidos: string;
  email: string;
  usuario: string;
  telefono: string;
  estado: EstadoUsuario;
  roles: string[];
}

interface PermisosEspeciales {
  aprobarHorarios: boolean;
  gestionarMatriculas: boolean;
  accesoBitacoras: boolean;
}

interface ResetPasswordResponse {
  passwordTemporal: string;
}

type UsersAction = 'list' | 'create';

interface UsersPageProps {
  onLogout?: () => void;
  requestedAction?: UsersAction;
}

const ESTADO_USUARIO_OPTIONS: { value: 'activo' | 'inactivo'; label: string }[] = [
  { value: 'activo', label: 'Activo' },
  { value: 'inactivo', label: 'Inactivo' },
];

/** Valor mostrado en el selector (legacy `suspendido` se trata como inactivo). */
function estadoParaSelector(estado: EstadoUsuario): 'activo' | 'inactivo' {
  return estado === 'activo' ? 'activo' : 'inactivo';
}

function etiquetaEstadoUsuario(estado: EstadoUsuario): string {
  if (estado === 'suspendido') return 'Inactivo';
  return ESTADO_USUARIO_OPTIONS.find((o) => o.value === estado)?.label ?? estado;
}

function claseEstadoUsuarioMovil(estado: EstadoUsuario): string {
  if (estado === 'activo') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300';
  }
  return 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-700/40 dark:text-slate-400';
}

const ROLE_OPTIONS = [
  {
    value: 'Administrador General',
    label: 'Administrador General',
    description: 'Configuración avanzada y control total.',
    icon: 'admin_panel_settings',
  },
  {
    value: 'Secretaría Académica',
    label: 'Secretaría Académica',
    description: 'Gestión de alumnos, inscripciones e importaciones.',
    icon: 'support_agent',
  },
  {
    value: 'Docente',
    label: 'Docente',
    description: 'Registro de asistencias y planillas de curso.',
    icon: 'school',
  },
  {
    value: 'Coordinador de Facultad',
    label: 'Coordinador de Facultad',
    description: 'Gestión académica y reportes por facultad.',
    icon: 'domain',
  },
  {
    value: 'Jefe de Carrera',
    label: 'Jefe de Carrera',
    description: 'Gestión académica y reportes por carrera.',
    icon: 'manage_accounts',
  },
];

/** Nombres posibles del rol de coordinación de facultad en BD (renombres / variantes). */
/** Nombres históricos en BD; el vigente es «Coordinador de Facultad». */
const ROLES_COORDINACION_FACULTAD_ALCANCE = new Set([
  'Coordinador de Facultad',
  'Coordinador/a de Facultad',
  'Coordinadora de Facultad',
]);

function esRolCoordinacionFacultad(rol: string | undefined): boolean {
  if (!rol) return false;
  return ROLES_COORDINACION_FACULTAD_ALCANCE.has(rol);
}

function usuarioTieneCoordinacionFacultad(roles: string[]): boolean {
  return roles.some(esRolCoordinacionFacultad);
}

function primaryRoleSelection(roles: string[]): string[] {
  const canon = etiquetasRoles(roles);
  if (!canon.length) return [];
  for (const opt of ROLE_OPTIONS) {
    if (canon.includes(opt.value)) return [opt.value];
  }
  return [canon[0]];
}

function scopesFromApiToFormState(scopes?: UsuarioScope[]): { facultadIds: number[]; carreraIds: number[] } {
  if (!scopes?.length) return { facultadIds: [], carreraIds: [] };
  const facultadIds = [
    ...new Set(scopes.map((s) => s.facultad_id).filter((id): id is number => id != null)),
  ];
  const carreraIds = [...new Set(scopes.map((s) => s.carrera_id).filter((id): id is number => id != null))];
  return { facultadIds, carreraIds };
}

function normalizedScopePayload(facultadIds: number[], carreraIds: number[]) {
  return {
    facultad_ids: [...new Set(facultadIds)].sort((a, b) => a - b),
    carrera_ids: [...new Set(carreraIds)].sort((a, b) => a - b),
  };
}

function scopePayloadMatchesUser(
  facultadIds: number[],
  carreraIds: number[],
  scopes: UsuarioScope[] | undefined
): boolean {
  const fromDb = scopesFromApiToFormState(scopes);
  const a = normalizedScopePayload(fromDb.facultadIds, fromDb.carreraIds);
  const b = normalizedScopePayload(facultadIds, carreraIds);
  return a.facultad_ids.join(',') === b.facultad_ids.join(',') && a.carrera_ids.join(',') === b.carrera_ids.join(',');
}

function arraysAreEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function formatName(usuario: Usuario | EditableUserState): string {
  return `${usuario.nombres} ${usuario.apellidos}`.trim();
}

export function UsersPage({ onLogout, requestedAction = 'list' }: UsersPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [users, setUsers] = useState<Usuario[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | EstadoUsuario>('all');
  const [pagina, setPagina] = useState(1);
  const [sortOrder, setSortOrder] = useState<'default' | 'az' | 'za'>(() => {
    const saved = localStorage.getItem('usuariosSortOrder');
    return saved === 'az' || saved === 'za' ? saved : 'default';
  });
  const USUARIOS_POR_PAGINA = 8;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableUserState | null>(null);
  const [saving, setSaving] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const usuariosListScrollRef = useRef<HTMLDivElement | null>(null);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [toggleAccessConfirmOpen, setToggleAccessConfirmOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [puedeEliminarUsuario] = useState(() => puedeEliminarUsuariosSesion(readStoredUser()?.roles));
  const [editScopeFacultadIds, setEditScopeFacultadIds] = useState<number[]>([]);
  const [editScopeCarreraIds, setEditScopeCarreraIds] = useState<number[]>([]);
  const [editFacultades, setEditFacultades] = useState<Facultad[]>([]);
  const [editCarreras, setEditCarreras] = useState<Carrera[]>([]);
  const autoEditRef = useRef(false);

  const loadUsers = useCallback(async (focusId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<UsuariosResponse>('/usuarios');
      const lista = data?.datos ?? [];
      setUsers(lista);
      setSelectedUserId((current) => {
        if (focusId) return focusId;
        if (current && lista.some((item) => item.id === current)) {
          return current;
        }
        return null;
      });
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : 'No se pudieron cargar los usuarios';
      setError(mensaje);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (requestedAction === 'create') {
      setIsCreateOpen(true);
    } else {
      setIsCreateOpen(false);
    }
  }, [requestedAction]);

  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const panelDetalleAbierto = Boolean(selectedUser) || isCreateOpen;


  const hydrateDraftFromSelected = useCallback(() => {
    if (!selectedUser) {
      setDraft(null);
      setEditScopeFacultadIds([]);
      setEditScopeCarreraIds([]);
      return;
    }
    const fromScopes = scopesFromApiToFormState(selectedUser.scopes);
    setEditScopeFacultadIds(fromScopes.facultadIds);
    setEditScopeCarreraIds(fromScopes.carreraIds);
    setDraft({
      nombres: selectedUser.nombres,
      apellidos: selectedUser.apellidos,
      email: selectedUser.email,
      usuario: selectedUser.usuario,
      telefono: selectedUser.telefono ?? '',
      estado: selectedUser.estado,
      roles: primaryRoleSelection(selectedUser.roles),
    });
  }, [selectedUser]);

  useEffect(() => {
    hydrateDraftFromSelected();
    if (autoEditRef.current && selectedUser) {
      setIsEditing(true);
    } else {
      setIsEditing(false);
    }
    autoEditRef.current = false;
  }, [hydrateDraftFromSelected, selectedUser]);

  useEffect(() => {
    if (!isEditing) {
      setNewPassword('');
      setConfirmNewPassword('');
    }
  }, [isEditing]);

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const text = `${user.nombres} ${user.apellidos} ${user.email} ${user.usuario}`.toLowerCase();
      const matchesSearch = text.includes(searchTerm.trim().toLowerCase());

      const matchesRole = usuarioCoincideFiltroRol(user.roles, roleFilter);

      const matchesStatus = statusFilter === 'all' ? true : user.estado === statusFilter;
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, searchTerm, roleFilter, statusFilter]);

  const sortedUsers = useMemo(() => {
    if (sortOrder === 'default') return filteredUsers;
    const sorted = [...filteredUsers];
    sorted.sort((a, b) => {
      const nameA = `${a.nombres ?? ''} ${a.apellidos ?? ''}`.trim().toLowerCase();
      const nameB = `${b.nombres ?? ''} ${b.apellidos ?? ''}`.trim().toLowerCase();
      return sortOrder === 'az' ? nameA.localeCompare(nameB, 'es') : nameB.localeCompare(nameA, 'es');
    });
    return sorted;
  }, [filteredUsers, sortOrder]);

  const usuariosPaginados = useMemo(() => {
    const inicio = (pagina - 1) * USUARIOS_POR_PAGINA;
    return sortedUsers.slice(inicio, inicio + USUARIOS_POR_PAGINA);
  }, [sortedUsers, pagina]);

  const totalPaginas = Math.max(1, Math.ceil(sortedUsers.length / USUARIOS_POR_PAGINA));

  // Reset pagina al cambiar filtros
  useEffect(() => { localStorage.setItem('usuariosSortOrder', sortOrder); }, [sortOrder]);
  useEffect(() => { setPagina(1); }, [searchTerm, roleFilter, statusFilter, sortOrder]);

  // Clamp pagina si excede el total
  useEffect(() => {
    if (pagina > totalPaginas) setPagina(totalPaginas);
  }, [pagina, totalPaginas]);

  const rolEdicion = draft?.roles[0];

  useEffect(() => {
    const necesita =
      esRolCoordinacionFacultad(rolEdicion) || rolEdicion === 'Jefe de Carrera';
    if (!necesita || !selectedUser) return;
    void apiFetch<Facultad[]>('/facultades').then(setEditFacultades).catch(() => {});
  }, [rolEdicion, selectedUser]);

  useEffect(() => {
    if (rolEdicion !== 'Jefe de Carrera' || editScopeFacultadIds.length === 0) {
      setEditCarreras([]);
      return;
    }
    const promises = editScopeFacultadIds.map((fid) =>
      apiFetch<{ total: number; datos: Carrera[] }>(`/academico/carreras?facultadId=${fid}`).then((r) => r.datos)
    );
    void Promise.all(promises)
      .then((results) => {
        const todas = results.flat();
        setEditCarreras(todas);
        setEditScopeCarreraIds((prev) => prev.filter((cid) => todas.some((c) => c.id === cid)));
      })
      .catch(() => {});
  }, [rolEdicion, editScopeFacultadIds]);

  useEffect(() => {
    if (rolEdicion !== 'Jefe de Carrera') return;
    if (editScopeFacultadIds.length > 0 || editScopeCarreraIds.length === 0) return;
    let cancelled = false;
    void apiFetch<{ total: number; datos: Carrera[] }>('/academico/carreras')
      .then((r) => {
        if (cancelled) return;
        const match = r.datos.find((c) => editScopeCarreraIds.includes(c.id));
        if (match) setEditScopeFacultadIds([match.facultad_id]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rolEdicion, editScopeFacultadIds.length, editScopeCarreraIds]);

  const handleStartEditing = () => setIsEditing(true);

  const handleCancelEditing = () => {
    hydrateDraftFromSelected();
    setNewPassword('');
    setConfirmNewPassword('');
    setIsEditing(false);
  };

  const handleInlineEditClick = (userId: string) => {
    setIsCreateOpen(false);
    if (location.pathname.endsWith('/usuarios/nuevo')) {
      navigate('/app/usuarios', { replace: true });
    }
    if (selectedUserId === userId) {
      setIsEditing(true);
      return;
    }
    autoEditRef.current = true;
    setIsEditing(false);
    setSelectedUserId(userId);
  };

  const handleSaveChanges = async () => {
    if (!selectedUser || !draft || !isEditing) return;

    const trimmedNewPassword = newPassword.trim();
    if (trimmedNewPassword) {
      if (trimmedNewPassword.length < 8) {
        toast.error('La nueva contraseña debe tener al menos 8 caracteres');
        return;
      }
      if (trimmedNewPassword !== confirmNewPassword.trim()) {
        toast.error('La confirmación de contraseña no coincide');
        return;
      }
    }

    if (!draft.roles.length) {
      toast.error('Seleccioná al menos un rol');
      return;
    }

    const draftRol = draft.roles[0];
    const draftNecesitaScope =
      esRolCoordinacionFacultad(draftRol) || draftRol === 'Jefe de Carrera';

    if (draftNecesitaScope) {
      if (editScopeFacultadIds.length === 0) {
        toast.error('Seleccioná una facultad.');
        return;
      }
      if (draftRol === 'Jefe de Carrera' && editScopeCarreraIds.length === 0) {
        toast.error('Seleccioná al menos una carrera.');
        return;
      }
    }

    setSaving(true);
    try {
      const promises: Array<Promise<unknown>> = [];
      const baseChanges: {
        nombres?: string;
        apellidos?: string;
        email?: string;
        telefono?: string;
        usuario?: string;
      } = {};

      if (selectedUser.nombres !== draft.nombres) baseChanges.nombres = draft.nombres;
      if (selectedUser.apellidos !== draft.apellidos) baseChanges.apellidos = draft.apellidos;
      if (selectedUser.email !== draft.email) baseChanges.email = draft.email;
      if (selectedUser.usuario !== draft.usuario) baseChanges.usuario = draft.usuario;
      if ((selectedUser.telefono ?? '') !== draft.telefono) baseChanges.telefono = draft.telefono || undefined;
      if (Object.keys(baseChanges).length) {
        promises.push(
          apiFetch(`/usuarios/${selectedUser.id}`, {
            method: 'PATCH',
            body: JSON.stringify(baseChanges),
          })
        );
      }

      if (selectedUser.estado !== draft.estado) {
        promises.push(
          apiFetch(`/usuarios/${selectedUser.id}/estado`, {
            method: 'PATCH',
            body: JSON.stringify({ estado: draft.estado }),
          })
        );
      }

      if (!arraysAreEqual(selectedUser.roles, draft.roles)) {
        promises.push(
          apiFetch(`/usuarios/${selectedUser.id}/roles`, {
            method: 'PUT',
            body: JSON.stringify({ roles: draft.roles }),
          })
        );
      }

      const scopeBody = normalizedScopePayload(
        draftNecesitaScope ? editScopeFacultadIds : [],
        draftNecesitaScope && draftRol === 'Jefe de Carrera' ? editScopeCarreraIds : []
      );

      if (!scopePayloadMatchesUser(scopeBody.facultad_ids, scopeBody.carrera_ids, selectedUser.scopes)) {
        promises.push(
          apiFetch(`/usuarios/${selectedUser.id}/scopes`, {
            method: 'PATCH',
            body: JSON.stringify(scopeBody),
          })
        );
      }

      if (trimmedNewPassword) {
        promises.push(
          apiFetch(`/usuarios/${selectedUser.id}/reset-password`, {
            method: 'POST',
            body: JSON.stringify({ nuevaPassword: trimmedNewPassword }),
          })
        );
      }

      if (!promises.length) {
        toast.info('No se detectaron cambios');
        setSaving(false);
        return;
      }

      await Promise.all(promises);
      await loadUsers(selectedUser.id);
      toast.success('Cambios guardados correctamente');
      setNewPassword('');
      setConfirmNewPassword('');
      setIsEditing(false);
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : 'No se pudieron guardar los datos del usuario';
      toast.error(mensaje);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAccessClick = () => {
    if (!selectedUser) return;
    setToggleAccessConfirmOpen(true);
  };

  const doToggleAccess = async () => {
    if (!selectedUser) return;
    setToggleAccessConfirmOpen(false);
    const nextEstado: EstadoUsuario = selectedUser.estado === 'activo' ? 'inactivo' : 'activo';
    await handleChangeUserStatus(selectedUser, nextEstado);
  };

  const handleResetPassword = async () => {
    if (!selectedUser) return;
    setResetConfirmOpen(true);
  };

  const doResetPassword = async () => {
    if (!selectedUser) return;
    setResetConfirmOpen(false);
    setResettingPassword(true);
    try {
      const data = await apiFetch<ResetPasswordResponse>(`/usuarios/${selectedUser.id}/reset-password`, {
        method: 'POST',
      });
      toast.success(`Contraseña temporal: ${data.passwordTemporal}`, { duration: 10000 });
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : 'No se pudo restablecer la contraseña';
      toast.error(mensaje);
    } finally {
      setResettingPassword(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!puedeEliminarUsuario || !selectedUser) return;
    setDeleteConfirmOpen(true);
  };

  const doDeleteUser = async () => {
    if (!puedeEliminarUsuario || !selectedUser) return;
    setDeleteConfirmOpen(false);
    setDeletingUser(true);
    try {
      await apiFetch<void>(`/usuarios/${selectedUser.id}`, { method: 'DELETE' });
      toast.success('Usuario eliminado correctamente');
      setSelectedUserId(null);
      setDraft(null);
      await loadUsers();
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : '';
      if (/foreign key|llave foránea|violates.*constraint|cursos_docente_id/i.test(rawMsg)) {
        toast.error('No se puede eliminar este usuario porque tiene cursos asignados. Reasigná o cerrá sus cursos primero.');
      } else {
        toast.error(rawMsg || 'No se pudo eliminar el usuario');
      }
    } finally {
      setDeletingUser(false);
    }
  };

  const handleChangeUserStatus = async (user: Usuario, estado: EstadoUsuario) => {
    if (user.estado === estado) return;
    setTogglingUserId(user.id);
    try {
      await apiFetch(`/usuarios/${user.id}/estado`, {
        method: 'PATCH',
        body: JSON.stringify({ estado }),
      });
      await loadUsers();
      toast.success(
        estado === 'activo'
          ? `Acceso reactivado para ${formatName(user)}`
          : estado === 'inactivo'
            ? `Acceso deshabilitado para ${formatName(user)}`
            : `Estado actualizado a ${etiquetaEstadoUsuario(estado)}`,
      );
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : 'No se pudo actualizar el estado';
      toast.error(mensaje);
    } finally {
      setTogglingUserId(null);
    }
  };

  const handleExport = useCallback(async () => {
    setExportLoading(true);
    try {
      const body: Record<string, unknown> = {};
      const q = searchTerm.trim();
      if (q) body.q = q;
      if (statusFilter !== 'all') body.estado = statusFilter;
      Object.assign(body, roleFilterToExportBody(roleFilter));
      if (sortOrder !== 'default') body.orden = sortOrder;

      await generarYAbrirPdf('/usuarios/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast.success('PDF de usuarios generado.');
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : 'No se pudo exportar el listado';
      toast.error(mensaje);
    } finally {
      setExportLoading(false);
    }
  }, [searchTerm, statusFilter, roleFilter, sortOrder]);

  const handleCreateUser = async (payload: CreateUserPayload) => {
    setCreateLoading(true);
    try {
      const nuevoUsuario = await apiFetch<Usuario>('/usuarios', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setIsCreateOpen(false);
      if (location.pathname.endsWith('/usuarios/nuevo')) {
        navigate('/app/usuarios', { replace: true });
      }
      await loadUsers(nuevoUsuario.id);
      toast.success('Usuario creado correctamente');
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : 'No se pudo crear el usuario';
      toast.error(mensaje);
    } finally {
      setCreateLoading(false);
    }
  };

  const clearSelection = () => {
    setSelectedUserId(null);
    setDraft(null);
    setIsEditing(false);
  };

  const cerrarPanelDetalle = () => {
    clearSelection();
    setIsCreateOpen(false);
    if (location.pathname.endsWith('/usuarios/nuevo')) {
      navigate('/app/usuarios', { replace: true });
    }
  };

  const seleccionarUsuario = (userId: string) => {
    setIsCreateOpen(false);
    if (location.pathname.endsWith('/usuarios/nuevo')) {
      navigate('/app/usuarios', { replace: true });
    }
    autoEditRef.current = false;
    setIsEditing(false);
    setSelectedUserId(userId);
  };

  const stopRowSelection = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div className="system-bg app-shell-viewport overflow-hidden text-slate-800 dark:text-[#e7eef9]">
      <div className="app-layout-row">
        {sidebarOpen ? (
          <div
            className="app-sidebar-scrim"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        ) : null}

        <AppSidebar sidebarOpen={sidebarOpen} onLogout={onLogout} onClose={() => setSidebarOpen(false)} />

        <main className="app-layout-main">
          <header className="flex min-h-16 flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-6 py-3 backdrop-blur-md dark:border-slate-800 dark:bg-[#132a52]/90 max-lg:gap-2 max-lg:px-4 max-lg:py-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-3 max-lg:gap-2">
              <button
                type="button"
                className="app-menu-toggle rounded-lg p-1 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                onClick={() => setSidebarOpen(true)}
                aria-label="Abrir menú"
              >
                <span className="material-symbols-outlined">menu</span>
              </button>
              <span className="material-symbols-outlined shrink-0 text-blue-600 dark:text-[#6b8bc3]">manage_accounts</span>
              <div className="min-w-0 flex flex-col">
                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Control de acceso</p>
                <h1 className="truncate text-xl font-semibold text-slate-900 dark:text-[#f0f4f8] max-lg:text-base">
                  Usuarios y permisos
                </h1>
              </div>
            </div>
          </header>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row">
            <section
              className={`min-w-0 flex min-h-0 flex-1 flex-col overflow-hidden ${
                panelDetalleAbierto ? 'max-lg:hidden' : ''
              }`}
            >
              <div className="shrink-0 space-y-4 p-4 max-lg:space-y-2 max-lg:p-2 sm:p-6 sm:space-y-6">
              <div className="min-w-0 space-y-4 max-lg:space-y-2">
                <div className="max-lg:rounded-2xl max-lg:border max-lg:border-slate-200/90 max-lg:bg-white max-lg:p-2 max-lg:shadow-sm dark:max-lg:border-slate-700/80 dark:max-lg:bg-[#0e1e38]">
                <div className="flex flex-wrap items-center justify-between gap-4 max-lg:flex-col max-lg:gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 max-lg:w-full max-lg:flex-col max-lg:items-stretch">
                    <div className="relative min-w-0 w-full max-w-md flex-1 max-lg:max-w-none max-lg:flex-none">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-slate-400 max-lg:left-2.5 max-lg:text-[18px]">
                        search
                      </span>
                      <input
                        type="search"
                        aria-label="Buscar usuarios"
                        className={`${USUARIO_INP} rounded-xl py-2.5 pl-10 pr-4 max-lg:min-h-9 max-lg:rounded-lg max-lg:py-2 max-lg:pl-9 max-lg:text-sm`}
                        placeholder="Nombre, correo o rol…"
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-2 max-lg:btn-mobile-row max-lg:w-full max-lg:gap-2">
                      <button
                        type="button"
                        onClick={() => setFiltersOpen((prev) => !prev)}
                        className={`btn-modern btn-modern-ghost btn-modern-sm max-lg:min-h-9 max-lg:flex-1 max-lg:rounded-lg max-lg:py-1.5 max-lg:text-xs ${
                          filtersOpen ? 'border-primary/40 bg-primary/5 dark:bg-primary/10' : ''
                        }`}
                      >
                        <span className="material-symbols-outlined text-[18px] max-lg:text-[17px]">filter_list</span>
                        Filtrar
                      </button>
                      <button
                        type="button"
                        className="btn-modern btn-modern-ghost btn-modern-sm max-lg:min-h-9 max-lg:flex-1 max-lg:rounded-lg max-lg:py-1.5 max-lg:text-xs"
                        disabled={exportLoading}
                        onClick={() => {
                          void handleExport();
                        }}
                      >
                        <span className="material-symbols-outlined text-[18px] max-lg:text-[17px]">download</span>
                        {exportLoading ? 'Exportando…' : 'Exportar'}
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedUserId(null);
                      setDraft(null);
                      setIsEditing(false);
                      navigate(appPath('usuarios', { usersAction: 'create' }));
                    }}
                    className="btn-modern btn-modern-primary btn-modern-sm shrink-0 max-lg:min-h-9 max-lg:w-full max-lg:rounded-lg max-lg:py-2 max-lg:text-sm"
                  >
                    <span className="material-symbols-outlined text-[18px]">person_add</span>
                    Nuevo usuario
                  </button>
                </div>

                {filtersOpen ? (
                  <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-surface-dark max-lg:mt-2 max-lg:gap-2 max-lg:border-slate-200 max-lg:bg-slate-50/80 max-lg:p-2 max-lg:shadow-none max-lg:grid-cols-2 dark:max-lg:border-slate-700 dark:max-lg:bg-[#0b2147]/40 lg:mt-5 lg:flex lg:flex-wrap lg:items-end lg:gap-x-6 lg:gap-y-3 lg:p-4">
                    <label className={`${USUARIO_LABEL} lg:w-64 lg:shrink-0`}>
                      <span>Rol</span>
                      <AppSelect
                        className="lg:max-w-[16rem]"
                        value={roleFilter}
                        onChange={setRoleFilter}
                        clearOption={{ value: 'all', label: 'Todos' }}
                        options={ROLE_OPTIONS.map((role) => ({
                          value: role.value,
                          label: role.label,
                        }))}
                        triggerClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-black text-sm dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                      />
                    </label>
                    <label className={`${USUARIO_LABEL} lg:w-52 lg:shrink-0`}>
                      <span>Estado</span>
                      <AppSelect
                        className="lg:max-w-[13rem]"
                        value={statusFilter}
                        onChange={(v) => setStatusFilter(v as 'all' | EstadoUsuario)}
                        clearOption={{ value: 'all', label: 'Todos' }}
                        options={ESTADO_USUARIO_OPTIONS}
                        triggerClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-black text-sm dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9] lg:max-w-[13rem]"
                      />
                    </label>
                  </div>
                ) : null}
                </div>
              </div>
              </div>

              <div className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pb-4 max-lg:px-2 max-lg:pb-2 sm:px-6 sm:pb-6">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm max-lg:rounded-none max-lg:border-0 max-lg:bg-transparent max-lg:shadow-none dark:border-slate-800 dark:bg-surface-dark dark:max-lg:bg-transparent dark:shadow-none">
                <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800 max-lg:flex-col max-lg:items-stretch max-lg:gap-0.5 max-lg:border-0 max-lg:px-0 max-lg:py-0 max-lg:pb-1.5">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 max-lg:text-[10px] max-lg:tracking-wider">
                      <span className="max-lg:hidden">Directorio de usuarios</span>
                      <span className="lg:hidden">Directorio</span>
                    </p>
                    <p className="text-sm text-[#c9d7ed] max-lg:text-[13px] max-lg:font-medium max-lg:text-slate-800 dark:max-lg:text-[#c9d7ed]">
                      <span className="max-lg:hidden">{sortedUsers.length} registros · Página {pagina} de {totalPaginas}</span>
                      <span className="lg:hidden flex items-center gap-1.5">
                        <span>{sortedUsers.length} {sortedUsers.length === 1 ? 'usuario' : 'usuarios'} · Pág. {pagina}/{totalPaginas}</span>
                        <button
                          type="button"
                          className="inline-flex items-center gap-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                          onClick={() => setSortOrder(sortOrder === 'default' ? 'az' : sortOrder === 'az' ? 'za' : 'default')}
                          title={sortOrder === 'default' ? 'Ordenar A-Z' : sortOrder === 'az' ? 'Ordenar Z-A' : 'Sin ordenar'}
                        >
                          <span className="material-symbols-outlined text-[15px]">
                            {sortOrder === 'default' ? 'swap_vert' : sortOrder === 'az' ? 'arrow_upward' : 'arrow_downward'}
                          </span>
                          <span className="text-[10px] font-medium">
                            {sortOrder === 'default' ? 'Más reciente' : sortOrder === 'az' ? 'A-Z' : 'Z-A'}
                          </span>
                        </button>
                      </span>
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500 max-lg:hidden">
                    Actualizado {formatDateOnly(new Date(), 'es-AR')}
                  </span>
                </div>
                <div
                  ref={usuariosListScrollRef}
                  className="scroll-region app-scroll-content flex min-h-0 flex-1 flex-col pb-4"
                >

                  <ul className="space-y-2 p-0 max-lg:pt-0.5 lg:hidden">
                    {loading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <li key={i} className="overflow-hidden rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-[#0e1e38]">
                          <div className="h-14 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800/60" />
                        </li>
                      ))
                    ) : error ? (
                      <li className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-[#0e1e38]">
                        {error}
                        <button
                          type="button"
                          className="btn-modern btn-modern-ghost btn-modern-xs mt-3"
                          onClick={() => loadUsers()}
                        >
                          Reintentar
                        </button>
                      </li>
                    ) : filteredUsers.length ? (
                      usuariosPaginados.map((user) => {
                        const rolesVisibles = etiquetasRoles(user.roles);
                        const seleccionado = selectedUserId === user.id;
                        return (
                          <li key={user.id}>
                            <article
                              className={`rounded-xl border bg-white shadow-sm transition-shadow dark:bg-[#0e1e38] dark:shadow-none ${
                                seleccionado
                                  ? 'border-primary/40 ring-2 ring-primary/15 dark:border-primary/50'
                                  : 'border-slate-200/90 hover:shadow-md dark:border-slate-700/80'
                              }`}
                            >
                              <div className="overflow-hidden rounded-t-xl">
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 p-2 text-left active:bg-slate-50 dark:active:bg-slate-800/40"
                                  onClick={() => seleccionarUsuario(user.id)}
                                >
                                  <UserAvatar nombres={user.nombres} apellidos={user.apellidos} size="sm" />
                                  <div className="min-w-0 flex-1">
                                    <p className="break-words text-sm font-semibold leading-snug text-slate-900 dark:text-[#f0f4f8]">
                                      {formatName(user)}
                                    </p>
                                    <p className="mt-0.5 truncate text-[11px] text-slate-500">{user.email}</p>
                                  </div>
                                  <span
                                    className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${claseEstadoUsuarioMovil(user.estado)}`}
                                  >
                                    {etiquetaEstadoUsuario(user.estado)}
                                  </span>
                                </button>

                                {rolesVisibles.length ? (
                                  <div className="flex flex-wrap gap-1 px-3 pb-2">
                                    {rolesVisibles.map((role) => (
                                      <span
                                        key={role}
                                        className="max-w-full truncate rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800/80 dark:text-slate-300"
                                      >
                                        {role}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>

                              <div
                                className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/50 px-1.5 py-1.5 rounded-b-xl dark:border-slate-800/80 dark:bg-[#0a1628]/50"
                                onClick={stopRowSelection}
                                onMouseDown={stopRowSelection}
                                onPointerDown={stopRowSelection}
                              >
                                <AppSelect
                                  className="min-w-0 flex-1"
                                  aria-label={`Cambiar estado de ${formatName(user)}`}
                                  value={estadoParaSelector(user.estado)}
                                  disabled={togglingUserId === user.id}
                                  size="xs"
                                  onChange={(v) => {
                                    handleChangeUserStatus(user, v as 'activo' | 'inactivo');
                                  }}
                                  options={ESTADO_USUARIO_OPTIONS}
                                  triggerClassName="w-full min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-primary dark:border-slate-600 dark:bg-[#0b2147] dark:text-[#e7eef9]"
                                />
                                <button
                                  type="button"
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary dark:border-slate-600 dark:bg-[#0b2147] dark:text-slate-300 dark:hover:text-primary"
                                  onClick={() => handleInlineEditClick(user.id)}
                                  aria-label={`Editar ${formatName(user)}`}
                                >
                                  <span className="material-symbols-outlined text-[20px]">edit</span>
                                </button>
                              </div>
                            </article>
                          </li>
                        );
                      })
                    ) : (
                      <li className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-600 dark:bg-[#0e1e38]">
                        <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                          <span className="material-symbols-outlined text-[40px] text-slate-600">
                            {users.length === 0 ? 'group_off' : 'filter_alt_off'}
                          </span>
                          <p>
                            {users.length === 0
                              ? 'Todavía no hay usuarios registrados en el sistema.'
                              : 'Ningún usuario coincide con los filtros o la búsqueda actual.'}
                          </p>
                          {users.length === 0 ? (
                            <button
                              type="button"
                              className="btn-modern btn-modern-primary btn-modern-sm btn-mobile-cta mt-1 w-full max-w-xs"
                              onClick={() => {
                                setSelectedUserId(null);
                                setDraft(null);
                                setIsEditing(false);
                                navigate(appPath('usuarios', { usersAction: 'create' }));
                              }}
                            >
                              <span className="material-symbols-outlined text-[18px]">person_add</span>
                              Crear primer usuario
                            </button>
                          ) : null}
                        </div>
                      </li>
                    )}
                  </ul>

                  <table className="hidden w-full min-w-[640px] border-separate border-spacing-0 text-left lg:table">
                    <thead>
                      <tr className="text-xs font-semibold uppercase tracking-wider text-slate-900 dark:text-white">
                        <th className="sticky top-0 z-10 bg-slate-50 px-6 py-4 dark:bg-[#0b2147] cursor-pointer select-none" onClick={() => setSortOrder((o) => o === 'default' ? 'az' : o === 'az' ? 'za' : 'default')}>
                          <span className="inline-flex items-center gap-1">
                            Nombre e identificación
                            <span className="inline-flex items-center gap-0.5 text-[11px] font-normal text-slate-400 normal-case">
                              {sortOrder === 'default' ? (
                                <><span className="material-symbols-outlined text-[14px]">swap_vert</span> Más reciente</>
                              ) : (
                                <>
                                  <span className="material-symbols-outlined text-[14px]">{sortOrder === 'az' ? 'arrow_upward' : 'arrow_downward'}</span>
                                  {sortOrder === 'az' ? 'A – Z' : 'Z – A'}
                                </>
                              )}
                            </span>
                          </span>
                        </th>
                        <th className="sticky top-0 z-10 bg-slate-50 px-6 py-4 dark:bg-[#0b2147]">
                          Rol
                        </th>
                        <th className="sticky top-0 z-10 bg-slate-50 px-6 py-4 dark:bg-[#0b2147]">
                          Estado
                        </th>
                        <th className="sticky top-0 z-10 bg-slate-50 px-6 py-4 text-right dark:bg-[#0b2147]">
                          Acciones
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-sm">
                      {loading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <tr key={i}>
                            <td colSpan={4} className="px-0 py-0">
                              <SkeletonRow cols={4} />
                            </td>
                          </tr>
                        ))
                      ) : error ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-6 text-center text-slate-400">
                            {error}
                            <button
                              type="button"
                              className="ml-3 btn-modern btn-modern-ghost btn-modern-xs"
                              onClick={() => loadUsers()}
                            >
                              Reintentar
                            </button>
                          </td>
                        </tr>
                      ) : filteredUsers.length ? (
                        usuariosPaginados.map((user) => {
                          const isSelected = selectedUserId === user.id;
                          return (
                            <tr
                              key={user.id}
                              className={isSelected ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-slate-800/30'}
                            >
                              <td
                                className="cursor-pointer px-6 py-4"
                                onClick={() => seleccionarUsuario(user.id)}
                              >
                                <div className="flex items-center gap-3">
                                  <UserAvatar nombres={user.nombres} apellidos={user.apellidos} size="sm" />
                                  <div className="flex flex-col">
                                    <span className="font-medium text-[#f0f4f8]">{formatName(user)}</span>
                                    <span className="text-xs text-slate-500">{user.email}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="cursor-pointer px-6 py-4" onClick={() => seleccionarUsuario(user.id)}>
                                <div className="flex flex-wrap gap-2">
                                  {etiquetasRoles(user.roles).slice(0, 2).map((role) => (
                                    <span
                                      key={role}
                                      className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-primary/10 text-primary border border-primary/20"
                                    >
                                      {role}
                                    </span>
                                  ))}
                                  {etiquetasRoles(user.roles).length > 2 ? (
                                    <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700">
                                      +{etiquetasRoles(user.roles).length - 2}
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="w-[1%] whitespace-nowrap px-4 py-4">
                                <div
                                  className="inline-block w-auto max-w-[10.5rem]"
                                  onClick={stopRowSelection}
                                  onMouseDown={stopRowSelection}
                                  onPointerDown={stopRowSelection}
                                >
                                  <AppSelect
                                    aria-label={`Cambiar estado de ${formatName(user)}`}
                                    value={estadoParaSelector(user.estado)}
                                    disabled={togglingUserId === user.id}
                                    size="xs"
                                    className="!w-auto"
                                    onChange={(v) => {
                                      handleChangeUserStatus(user, v as 'activo' | 'inactivo');
                                    }}
                                    options={ESTADO_USUARIO_OPTIONS}
                                    triggerClassName="!w-auto max-w-full rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide bg-white border border-slate-300 text-black focus:outline-none focus:border-primary dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                                  />
                                </div>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button
                                  type="button"
                                  className="text-slate-500 hover:text-[#f0f4f8] "
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleInlineEditClick(user.id);
                                  }}
                                >
                                  <span className="material-symbols-outlined text-[20px]">edit</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={4} className="px-6 py-10 text-center text-slate-400">
                            <div className="flex flex-col items-center gap-3 max-w-sm mx-auto">
                              <span className="material-symbols-outlined text-slate-600 text-[40px]">
                                {users.length === 0 ? 'group_off' : 'filter_alt_off'}
                              </span>
                              <p className="text-sm">
                                {users.length === 0
                                  ? 'Todavía no hay usuarios registrados en el sistema.'
                                  : 'Ningún usuario coincide con los filtros o la búsqueda actual.'}
                              </p>
                              {users.length === 0 ? (
                                <button
                                  type="button"
                                  className="btn-modern btn-modern-primary btn-modern-sm mt-1"
                                  onClick={() => {
                                    setSelectedUserId(null);
                                    setDraft(null);
                                    setIsEditing(false);
                                    navigate(appPath('usuarios', { usersAction: 'create' }));
                                  }}
                                >
                                  <span className="material-symbols-outlined text-[18px]">person_add</span>
                                  Crear primer usuario
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                   </table>
                </div>
                {totalPaginas > 1 ? (
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-4 py-2.5 dark:border-slate-800 max-lg:justify-center">
                    <span className="text-xs tabular-nums text-slate-500 mr-2">Mostrando {(pagina - 1) * USUARIOS_POR_PAGINA + 1}–{Math.min(pagina * USUARIOS_POR_PAGINA, sortedUsers.length)} de {sortedUsers.length}</span>
                    <div className="flex items-center gap-1.5">
                      <button type="button" className="btn-modern btn-modern-ghost h-8 w-8 shrink-0 !min-h-0 !p-0 hover:!translate-y-0 active:!translate-y-0"
                        disabled={loading} onClick={() => { setPagina(1); loadUsers(); }}>
                        <span className="material-symbols-outlined text-[18px]">refresh</span>
                      </button>
                      <button type="button" className="btn-modern btn-modern-ghost h-8 w-8 shrink-0 !min-h-0 !p-0 hover:!translate-y-0 active:!translate-y-0"
                        disabled={pagina <= 1} onClick={() => setPagina(1)}>
                        <span className="material-symbols-outlined text-[18px]">first_page</span>
                      </button>
                      <button type="button" className="btn-modern btn-modern-ghost h-8 w-8 shrink-0 !min-h-0 !p-0 hover:!translate-y-0 active:!translate-y-0"
                        disabled={pagina <= 1} onClick={() => setPagina((p) => Math.max(1, p - 1))}>
                        <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                      </button>
                      <span className="min-w-[6.5rem] px-1 text-center text-xs tabular-nums text-slate-500">Página {pagina} de {totalPaginas}</span>
                      <button type="button" className="btn-modern btn-modern-ghost h-8 w-8 shrink-0 !min-h-0 !p-0 hover:!translate-y-0 active:!translate-y-0"
                        disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}>
                        <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                      </button>
                      <button type="button" className="btn-modern btn-modern-ghost h-8 w-8 shrink-0 !min-h-0 !p-0 hover:!translate-y-0 active:!translate-y-0"
                        disabled={pagina >= totalPaginas} onClick={() => setPagina(totalPaginas)}>
                        <span className="material-symbols-outlined text-[18px]">last_page</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              </div>
            </section>

            {selectedUser ? (
              <div
                className={`master-detail-detail z-10 flex h-full w-full min-w-0 flex-col border-t border-slate-200 shadow-xl max-lg:min-h-0 max-lg:flex-1 max-lg:max-h-none max-lg:overflow-hidden dark:border-[#1c2a50] lg:max-h-none lg:w-[450px] lg:shrink-0 lg:border-t-0 lg:border-l ${USUARIO_DETAIL_SHELL}`}
              >
                <div className={`shrink-0 px-3 py-2.5 lg:hidden ${USUARIO_DETAIL_HEADER}`}>
                  <BotonVolverListadoMovil onClick={cerrarPanelDetalle} />
                </div>

                <div className={`hidden shrink-0 p-4 sm:p-6 lg:block ${USUARIO_DETAIL_HEADER}`}>
                  <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-[#9fb3d4]">
                        Perfil y permisos
                      </p>
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-[#f0f4f8]">
                        {formatName(draft ?? selectedUser)}
                      </h3>
                      <p className="text-sm font-medium text-primary">
                        {etiquetasRoles(selectedUser.roles).join(' · ') || 'Sin rol'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={isEditing ? handleCancelEditing : handleStartEditing}
                        className={`flex size-10 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 ${
                          isEditing
                            ? 'border-primary/40 bg-primary/10 text-primary'
                            : 'text-slate-500 hover:text-slate-900 dark:text-[#9fb3d4] dark:hover:text-[#f0f4f8]'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[20px]">edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={cerrarPanelDetalle}
                        className="flex size-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:text-[#f0f4f8]"
                      >
                        <span className="material-symbols-outlined text-[22px]">close</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="relative flex size-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/20">
                      <span className="material-symbols-outlined text-3xl text-primary">person</span>
                      <div
                        className={`absolute -bottom-1 -right-1 size-4 rounded-full border-2 border-white dark:border-[#131e3c] ${
                          selectedUser.estado === 'activo' ? 'bg-emerald-500' : 'bg-amber-500'
                        }`}
                      />
                    </div>
                    <div className="flex flex-col">
                      <p className="text-sm text-slate-400">{selectedUser.email}</p>
                      <p className="mt-1 font-mono text-[11px] text-slate-500">UUID · {selectedUser.id}</p>
                    </div>
                  </div>
                </div>

                <div className="shrink-0 px-3 pb-2 pt-0.5 lg:hidden">
                  <div className={USUARIO_PANEL_HERO_CLASS}>
                    <div className="flex items-center gap-2.5">
                      <div className="relative shrink-0">
                        <UserAvatar nombres={selectedUser.nombres} apellidos={selectedUser.apellidos} size="md" />
                        <div
                          className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border border-white dark:border-[#131e3c] ${
                            selectedUser.estado === 'activo' ? 'bg-emerald-500' : 'bg-amber-500'
                          }`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Perfil y permisos</p>
                        <h3 className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-tight text-slate-900 dark:text-white">
                          {formatName(draft ?? selectedUser)}
                        </h3>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex max-w-full rounded-full border border-blue-200 bg-blue-50 px-2 py-px text-[10px] font-semibold leading-tight text-blue-800 dark:border-primary/25 dark:bg-primary/10 dark:text-primary">
                            {etiquetasRoles(selectedUser.roles).join(' · ') || 'Sin rol'}
                          </span>
                          {isEditing ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                              <span className="material-symbols-outlined text-[12px]">edit</span>
                              Editando
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-600 dark:text-slate-400">{selectedUser.email}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className={`scroll-region app-scroll-content flex-1 space-y-5 p-3 scrollbar-hide sm:space-y-8 sm:p-6 ${USUARIO_DETAIL_BODY}`}
                >

                    <UsuarioFormCardMovil
                      titulo="Información básica"
                      badge={
                        isEditing ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                            Edición
                          </span>
                        ) : null
                      }
                    >
                      <label className="hidden text-xs font-bold uppercase tracking-widest text-slate-400 lg:block">
                        Información básica
                      </label>
                      {!isEditing ? (
                        <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 lg:hidden dark:divide-slate-700 dark:border-slate-700 dark:bg-[#0a1628]/80">
                          <UsuarioCampoLecturaMovil etiqueta="Nombres" valor={selectedUser.nombres} />
                          <UsuarioCampoLecturaMovil etiqueta="Apellidos" valor={selectedUser.apellidos} />
                          <UsuarioCampoLecturaMovil etiqueta="Correo" valor={selectedUser.email} />
                          <UsuarioCampoLecturaMovil etiqueta="Usuario" valor={selectedUser.usuario} />
                          <UsuarioCampoLecturaMovil
                            etiqueta="Teléfono"
                            valor={selectedUser.telefono?.trim() || '—'}
                          />
                          <UsuarioCampoLecturaMovil
                            etiqueta="Estado"
                            valor={
                              <span className="capitalize">
                                {etiquetaEstadoUsuario(selectedUser.estado)}
                              </span>
                            }
                          />
                        </div>
                      ) : null}
                      <div
                        className={`grid grid-cols-1 gap-4 ${
                          isEditing ? '' : 'hidden lg:grid'
                        }`}
                      >
                        <label className={USUARIO_LABEL}>
                          <span>Nombres</span>
                          <input
                            type="text"
                            value={draft?.nombres ?? ''}
                            disabled={!isEditing}
                            onChange={(event) => setDraft((prev) => (prev ? { ...prev, nombres: event.target.value } : prev))}
                            className={`${USUARIO_INP} disabled:opacity-50`}
                          />
                        </label>
                        <label className={USUARIO_LABEL}>
                          <span>Apellidos</span>
                          <input
                            type="text"
                            value={draft?.apellidos ?? ''}
                            disabled={!isEditing}
                            onChange={(event) => setDraft((prev) => (prev ? { ...prev, apellidos: event.target.value } : prev))}
                            className={`${USUARIO_INP} disabled:opacity-50`}
                          />
                        </label>
                        <label className={USUARIO_LABEL}>
                          <span>Correo institucional</span>
                          <input
                            type="email"
                            value={draft?.email ?? ''}
                            disabled={!isEditing}
                            onChange={(event) => setDraft((prev) => (prev ? { ...prev, email: event.target.value } : prev))}
                            className={`${USUARIO_INP} disabled:opacity-50`}
                          />
                        </label>
                        <label className={USUARIO_LABEL}>
                          <span>Usuario</span>
                          <input
                            type="text"
                            value={draft?.usuario ?? ''}
                            disabled={!isEditing}
                            onChange={(event) => setDraft((prev) => (prev ? { ...prev, usuario: event.target.value } : prev))}
                            className={`${USUARIO_INP} disabled:opacity-50`}
                          />
                        </label>
                        <label className={USUARIO_LABEL}>
                          <span>Teléfono</span>
                          <input
                            type="tel"
                            value={draft?.telefono ?? ''}
                            disabled={!isEditing}
                            maxLength={10}
                            onChange={(event) => {
                              const val = event.target.value.replace(/\D/g, '').slice(0, 10);
                              setDraft((prev) => (prev ? { ...prev, telefono: val } : prev));
                            }}
                            className={`${USUARIO_INP} disabled:opacity-50`}
                          />
                        </label>
                        <label className={USUARIO_LABEL}>
                          <span>Estado</span>
                          <AppSelect
                            value={estadoParaSelector(draft?.estado ?? 'activo')}
                            disabled={!isEditing}
                            onChange={(v) =>
                              setDraft((prev) => (prev ? { ...prev, estado: v as 'activo' | 'inactivo' } : prev))
                            }
                            options={ESTADO_USUARIO_OPTIONS}
                            triggerClassName="w-full rounded-lg px-3 py-2 text-sm bg-white border border-slate-300 text-black focus:border-primary disabled:opacity-50 dark:bg-[#0b2147] dark:hover:bg-[#091c3d] dark:border-slate-700 dark:text-[#e7eef9]"
                          />
                        </label>
                      </div>
                    </UsuarioFormCardMovil>

                    <UsuarioFormCardMovil
                      titulo="Roles"
                      badge={
                        isEditing ? (
                          <button
                            type="button"
                            onClick={() => {
                              setDraft((prev) => (prev ? { ...prev, roles: [] } : prev));
                              setEditScopeFacultadIds([]);
                              setEditScopeCarreraIds([]);
                            }}
                            className="text-[11px] font-medium text-primary hover:underline"
                          >
                            Limpiar
                          </button>
                        ) : null
                      }
                    >
                      <label className="hidden text-xs font-bold uppercase tracking-widest text-slate-400 lg:block">
                        Roles
                      </label>
                      <div className="space-y-2">
                        {ROLE_OPTIONS.map((role) => (
                          <label
                            key={role.value}
                            className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
                              draft?.roles.includes(role.value)
                                ? USUARIO_ROLE_ACTIVE
                                : USUARIO_ROLE_IDLE
                            } ${isEditing ? 'cursor-pointer' : 'opacity-70 cursor-not-allowed'}`}
                          >
                            <input
                              type="radio"
                              name="edit_role_option"
                              checked={draft?.roles.includes(role.value)}
                              disabled={!isEditing}
                              onChange={() => {
                                setDraft((prev) => (prev ? { ...prev, roles: [role.value] } : prev));
                                const necesita =
                                  role.value === 'Coordinador de Facultad' ||
                                  role.value === 'Jefe de Carrera';
                                if (!necesita) {
                                  setEditScopeFacultadIds([]);
                                  setEditScopeCarreraIds([]);
                                } else if (role.value === 'Coordinador de Facultad') {
                                  setEditScopeCarreraIds([]);
                                }
                              }}
                              className="size-5 border-slate-600 text-primary focus:ring-primary"
                            />
                            <div>
                              <p className="flex items-center gap-2 text-sm text-slate-800 dark:text-[#f0f4f8]">
                                <span className="material-symbols-outlined text-base text-slate-400">{role.icon}</span>
                                {role.label}
                              </p>
                              <p className="text-xs text-slate-600 dark:text-slate-400">{role.description}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </UsuarioFormCardMovil>

                    {(esRolCoordinacionFacultad(rolEdicion) || rolEdicion === 'Jefe de Carrera') && (
                      <UsuarioFormCardMovil titulo="Alcance de visibilidad">
                        <label className="hidden text-xs font-bold uppercase tracking-widest text-slate-400 lg:block">
                          Alcance de visibilidad
                        </label>
                        {!isEditing ? (
                          selectedUser.scopes?.length ? (
                            <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                              {selectedUser.scopes.map((s, idx) => (
                                <li
                                  key={`${s.facultad_id ?? ''}-${s.carrera_id ?? ''}-${idx}`}
                                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-[#132a52]"
                                >
                                  {s.facultad_nombre ? (
                                    <span className="text-slate-800 dark:text-[#f0f4f8]">Facultad: {s.facultad_nombre}</span>
                                  ) : null}
                                  {s.carrera_nombre ? (
                                    <span className="text-slate-800 dark:text-[#f0f4f8]">
                                      {s.facultad_nombre ? ' · ' : null}
                                      Carrera: {s.carrera_nombre}
                                    </span>
                                  ) : null}
                                  {!s.facultad_nombre && !s.carrera_nombre ? (
                                    <span className="text-slate-500">Alcance registrado (sin nombre en catálogo)</span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-slate-500">Sin facultad o carrera en la ficha.</p>
                          )
                        ) : (
                          <>
                            <div className="space-y-2">
                              <p className="text-xs text-slate-500">Facultad</p>
                              {editFacultades.map((f) => {
                                const checked = editScopeFacultadIds.includes(f.id);
                                const icon = f.nombre.toLowerCase().includes('tecnolog')
                                  ? 'computer'
                                  : f.nombre.toLowerCase().includes('empresa')
                                    ? 'business_center'
                                    : f.nombre.toLowerCase().includes('derecho')
                                      ? 'gavel'
                                      : 'menu_book';
                                return (
                                  <label
                                    key={f.id}
                                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${
                                      checked
                                        ? USUARIO_SCOPE_ACTIVE
                                        : USUARIO_SCOPE_IDLE
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name="edit_scope_facultad"
                                      checked={checked}
                                      onChange={() => setEditScopeFacultadIds([f.id])}
                                      className="size-5 border-slate-600 text-primary focus:ring-primary"
                                    />
                                    <div>
                                      <p className="flex items-center gap-2 text-sm text-slate-800 dark:text-[#f0f4f8]">
                                        <span className="material-symbols-outlined text-base text-slate-400">{icon}</span>
                                        {f.nombre}
                                      </p>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>

                            {rolEdicion === 'Jefe de Carrera' && editScopeFacultadIds.length > 0 && (
                              <div className="space-y-2 pt-2">
                                <p className="text-xs text-slate-500">Carreras</p>
                                {editCarreras.map((c) => {
                                  const checked = editScopeCarreraIds.includes(c.id);
                                  return (
                                    <label
                                      key={c.id}
                                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${
                                        checked
                                          ? 'border-primary/60 bg-primary/10'
                                          : USUARIO_SCOPE_IDLE
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) =>
                                          setEditScopeCarreraIds((prev) =>
                                            e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                                          )
                                        }
                                        className={SCOPE_CARRERA_CHOICE_CLASS}
                                      />
                                      <p className="text-sm text-slate-800 dark:text-[#f0f4f8]">{c.nombre}</p>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </UsuarioFormCardMovil>
                    )}

                    <UsuarioFormCardMovil titulo="Seguridad">
                      <label className="hidden text-xs font-bold uppercase tracking-widest text-slate-400 lg:block">
                        Seguridad
                      </label>
                      {isEditing ? (
                        <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-[#132a52]">
                          <label className={USUARIO_LABEL}>
                            <span>Nueva contraseña</span>
                            <div className="relative">
                              <input
                                type={showNewPassword ? 'text' : 'password'}
                                value={newPassword}
                                onChange={(event) => setNewPassword(event.target.value)}
                                placeholder="Minimo 8 caracteres"
                                autoComplete="new-password"
                                className={`${USUARIO_INP} pr-10`}
                              />
                              <button
                                type="button"
                                className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-slate-400 hover:text-slate-600 focus:outline-none dark:text-slate-500 dark:hover:text-slate-300"
                                onClick={() => setShowNewPassword((prev) => !prev)}
                                aria-label={showNewPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                aria-pressed={showNewPassword}
                              >
                                <span className="material-symbols-outlined text-[20px]">
                                  {showNewPassword ? 'visibility_off' : 'visibility'}
                                </span>
                              </button>
                            </div>
                          </label>
                          <label className={USUARIO_LABEL}>
                            <span>Confirmar nueva contraseña</span>
                            <div className="relative">
                              <input
                                type={showConfirmNewPassword ? 'text' : 'password'}
                                value={confirmNewPassword}
                                onChange={(event) => setConfirmNewPassword(event.target.value)}
                                placeholder="Repite la contraseña"
                                autoComplete="new-password"
                                className={`${USUARIO_INP} pr-10`}
                              />
                              <button
                                type="button"
                                className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-slate-400 hover:text-slate-600 focus:outline-none dark:text-slate-500 dark:hover:text-slate-300"
                                onClick={() => setShowConfirmNewPassword((prev) => !prev)}
                                aria-label={showConfirmNewPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                aria-pressed={showConfirmNewPassword}
                              >
                                <span className="material-symbols-outlined text-[20px]">
                                  {showConfirmNewPassword ? 'visibility_off' : 'visibility'}
                                </span>
                              </button>
                            </div>
                          </label>
                        </div>
                      ) : null}
                      <div className="btn-mobile-stack flex flex-col gap-2 max-lg:gap-2.5">
                        <button
                          type="button"
                          onClick={handleToggleAccessClick}
                          disabled={!selectedUser || togglingUserId === selectedUser.id}
                          className="btn-modern btn-modern-danger btn-modern-sm btn-mobile-cta w-full justify-between lg:justify-between disabled:opacity-50"
                        >
                          <span className="text-xs font-semibold">
                            {selectedUser?.estado !== 'activo' ? 'Reactivar acceso' : 'Deshabilitar acceso'}
                          </span>
                          <span className="material-symbols-outlined text-[18px]">lock</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleResetPassword}
                          disabled={resettingPassword}
                          className="btn-modern btn-modern-primary btn-modern-sm btn-mobile-cta w-full justify-between"
                        >
                          <span className="text-xs font-semibold">
                            {resettingPassword ? 'Generando contraseña…' : 'Restablecer credenciales'}
                          </span>
                          <span className="material-symbols-outlined text-[18px]">lock_reset</span>
                        </button>
                      </div>
                    </UsuarioFormCardMovil>

                    <div className="lg:hidden space-y-2 pt-2 pb-1">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <button type="button" onClick={handleCancelEditing}
                            className="btn-modern btn-modern-ghost btn-modern-sm flex-1">
                            Cancelar
                          </button>
                          <button type="button" onClick={handleSaveChanges} disabled={saving}
                            className="btn-modern btn-modern-primary btn-modern-sm flex-[1.35]">
                            {saving ? 'Guardando…' : 'Guardar'}
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={handleStartEditing}
                          className="btn-modern btn-modern-primary btn-modern-sm w-full">
                          <span className="material-symbols-outlined text-[18px]">edit</span>
                          Editar datos
                        </button>
                      )}
                      {puedeEliminarUsuario ? (
                        <button type="button" onClick={handleDeleteUser} disabled={deletingUser}
                          className="btn-modern btn-modern-danger btn-modern-sm w-full disabled:opacity-50">
                          {deletingUser ? 'Eliminando usuario…' : 'Eliminar usuario'}
                        </button>
                      ) : null}
                    </div>
              </div>

                <div
                  className={`shrink-0 p-4 max-lg:hidden sm:p-6 ${USUARIO_DETAIL_FOOTER}`}
                >
                  {isEditing ? (
                    <div className="btn-mobile-stack flex gap-2 max-lg:items-stretch lg:grid lg:grid-cols-2 lg:gap-3">
                      <button
                        type="button"
                        onClick={handleCancelEditing}
                        className="btn-modern btn-modern-ghost btn-modern-sm btn-mobile-cta w-full lg:flex-1"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveChanges}
                        disabled={saving}
                        className="btn-modern btn-modern-primary btn-modern-sm btn-mobile-cta w-full lg:flex-[1.35]"
                      >
                        {saving ? 'Guardando…' : 'Guardar'}
                      </button>
                    </div>
                  ) : (
                    <div className="btn-mobile-stack space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
                      <button
                        type="button"
                        onClick={handleStartEditing}
                        className="btn-modern btn-modern-primary btn-modern-sm btn-mobile-cta w-full lg:hidden"
                      >
                        <span className="material-symbols-outlined text-[18px]">edit</span>
                        Editar datos
                      </button>
                      <button
                        type="button"
                        onClick={cerrarPanelDetalle}
                        className="btn-modern btn-modern-ghost btn-modern-sm btn-mobile-cta hidden w-full lg:inline-flex"
                      >
                        Cerrar
                      </button>
                      <button
                        type="button"
                        onClick={handleStartEditing}
                        className="btn-modern btn-modern-primary btn-modern-sm hidden w-full lg:inline-flex"
                      >
                        Editar datos
                      </button>
                    </div>
                  )}
                  {puedeEliminarUsuario ? (
                    <button
                      type="button"
                      onClick={handleDeleteUser}
                      disabled={deletingUser}
                      className="btn-modern btn-modern-danger btn-modern-sm btn-mobile-cta mt-2 w-full disabled:opacity-50 max-lg:mt-2.5 lg:mt-3"
                    >
                      {deletingUser ? 'Eliminando usuario…' : 'Eliminar usuario'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : isCreateOpen ? (
              <div
                className={`master-detail-detail z-10 flex h-full w-full min-w-0 flex-col border-t border-slate-200 shadow-xl max-lg:min-h-0 max-lg:flex-1 max-lg:max-h-none max-lg:overflow-hidden dark:border-[#1c2a50] lg:max-h-none lg:w-[450px] lg:shrink-0 lg:border-t-0 lg:border-l ${USUARIO_DETAIL_SHELL}`}
              >
                <div className={`shrink-0 px-3 py-2.5 lg:hidden ${USUARIO_DETAIL_HEADER}`}>
                  <BotonVolverListadoMovil onClick={cerrarPanelDetalle} />
                </div>
                <CreateUserModal
                  onClose={cerrarPanelDetalle}
                  onSubmit={handleCreateUser}
                  saving={createLoading}
                  existingUsers={users}
                />
              </div>
            ) : null}
          </div>
        </main>
      </div>

      {puedeEliminarUsuario ? (
        <ConfirmDialog
          open={deleteConfirmOpen}
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={() => { void doDeleteUser(); }}
          title="Eliminar usuario"
          description={selectedUser ? `¿Deseas eliminar a ${formatName(selectedUser)}? Esta acción no se puede deshacer.` : ''}
          confirmLabel="Eliminar"
          variant="danger"
          loading={deletingUser}
        />
      ) : null}
      <ConfirmDialog
        open={resetConfirmOpen}
        onCancel={() => setResetConfirmOpen(false)}
        onConfirm={() => { void doResetPassword(); }}
        title="Restablecer contraseña"
        description={selectedUser ? `¿Generás una contraseña temporal para ${formatName(selectedUser)}? Se mostrará una sola vez.` : ''}
        confirmLabel="Generar contraseña"
        variant="warning"
        loading={resettingPassword}
      />
      <ConfirmDialog
        open={toggleAccessConfirmOpen}
        onCancel={() => setToggleAccessConfirmOpen(false)}
        onConfirm={() => { void doToggleAccess(); }}
        title={selectedUser?.estado !== 'activo' ? 'Reactivar acceso' : 'Deshabilitar acceso'}
        description={
          selectedUser
            ? selectedUser.estado !== 'activo'
              ? `¿Reactivar el acceso de ${formatName(selectedUser)}? Podrá volver a iniciar sesión.`
              : `¿Deshabilitar el acceso de ${formatName(selectedUser)}? No podrá iniciar sesión hasta que lo reactives.`
            : ''
        }
        confirmLabel={selectedUser?.estado !== 'activo' ? 'Reactivar' : 'Deshabilitar'}
        variant={selectedUser?.estado !== 'activo' ? 'default' : 'danger'}
        loading={selectedUser ? togglingUserId === selectedUser.id : false}
      />
    </div>
  );
}

interface CreateUserModalProps {
  onClose: () => void;
  onSubmit: (payload: CreateUserPayload) => Promise<void>;
  saving: boolean;
  existingUsers: Usuario[];
}

function CreateUserModal({ onClose, onSubmit, saving, existingUsers: _existingUsers }: CreateUserModalProps) {
  const [form, setForm] = useState({
    nombres: '',
    apellidos: '',
    email: '',
    usuario: '',
    telefono: '',
    password: '',
    personaTipo: 'docente' as PersonaTipo,
    personaId: '',
    roles: [] as string[],
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [facultades, setFacultades] = useState<Facultad[]>([]);
  const [carreras, setCarreras] = useState<Carrera[]>([]);
  const [scopeFacultadIds, setScopeFacultadIds] = useState<number[]>([]);
  const [scopeCarreraIds, setScopeCarreraIds] = useState<number[]>([]);
  const [showPassword, setShowPassword] = useState(false);

  const scopeRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const carreraRef = useRef<HTMLDivElement>(null);

  const esDirector = usuarioTieneCoordinacionFacultad(form.roles);
  const esCoordinador = form.roles.includes('Jefe de Carrera');
  const necesitaScope = esDirector || esCoordinador;

  useEffect(() => {
    if (!necesitaScope) {
      queueMicrotask(() => {
        setScopeFacultadIds([]);
        setScopeCarreraIds([]);
      });
      return;
    }
    apiFetch<Facultad[]>('/facultades').then(setFacultades).catch(() => {});
    setTimeout(() => {
      scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  }, [necesitaScope]);

  useEffect(() => {
    if (!esCoordinador || scopeFacultadIds.length === 0) {
      queueMicrotask(() => {
        setCarreras([]);
        setScopeCarreraIds([]);
      });
      return;
    }
    const promises = scopeFacultadIds.map(fid =>
      apiFetch<{ total: number; datos: Carrera[] }>(`/academico/carreras?facultadId=${fid}`).then(r => r.datos)
    );
    Promise.all(promises).then(results => {
      const todas = results.flat();
      setCarreras(todas);
      setScopeCarreraIds(prev => prev.filter(cid => todas.some(c => c.id === cid)));
      setTimeout(() => {
        scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
      }, 50);
    }).catch(() => {});
  }, [esCoordinador, scopeFacultadIds]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const newErrors: Record<string, string> = {};
    if (!form.nombres.trim()) newErrors.nombres = 'Obligatorio';
    if (!form.apellidos.trim()) newErrors.apellidos = 'Obligatorio';
    if (!form.email.trim()) newErrors.email = 'Obligatorio';
    if (!form.usuario.trim()) newErrors.usuario = 'Obligatorio';
    if (!form.password.trim()) newErrors.password = 'Obligatorio';

    if (Object.keys(newErrors).length) {
      setErrors(newErrors);
      return;
    }

    await onSubmit({
      nombres: form.nombres.trim(),
      apellidos: form.apellidos.trim(),
      email: form.email.trim(),
      usuario: form.usuario.trim(),
      telefono: form.telefono.trim() || undefined,
      password: form.password,
      roles: form.roles,
      persona:
        form.personaId.trim() && form.personaTipo
          ? { tipo: form.personaTipo, id: form.personaId.trim() }
          : undefined,
      ...(necesitaScope ? {
        scope: {
          facultad_ids: scopeFacultadIds,
          carrera_ids: scopeCarreraIds,
        }
      } : {}),
    });
  };

  const handleRoleChange = (role: string) => {
    setForm((prev) => ({ ...prev, roles: [role] }));
  };

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-1 flex-col max-lg:max-h-none max-lg:border-0 max-lg:shadow-none lg:z-10 lg:max-h-none lg:border-t-0 lg:border-l lg:shadow-xl ${USUARIO_DETAIL_SHELL}`}
    >
      <form onSubmit={handleSubmit} className="flex h-full min-h-0 min-w-0 flex-col">
        <div className={`hidden shrink-0 p-4 sm:p-6 lg:block ${USUARIO_DETAIL_HEADER}`}>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-[#9fb3d4]">Perfil y permisos</p>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-[#f0f4f8]">
                {`${form.nombres} ${form.apellidos}`.trim() || 'Nuevo usuario'}
              </h3>
              <p className="text-sm font-medium text-primary">{etiquetaRol(form.roles[0] ?? '') || 'Sin rol'}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn-modern btn-modern-ghost size-10 border border-slate-200 text-slate-500 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:text-[#f0f4f8]"
            >
              <span className="material-symbols-outlined text-[22px]">close</span>
            </button>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative flex size-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/20">
              <span className="material-symbols-outlined text-3xl text-primary">person</span>
              <div className="absolute -bottom-1 -right-1 size-4 rounded-full border-2 border-white bg-emerald-500 dark:border-[#131e3c]" />
            </div>
            <div className="flex flex-col">
              <p className="text-sm text-slate-400 dark:text-[#c9d7ed]">{form.email || 'Sin correo'}</p>
              <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">UUID · pendiente de creación</p>
            </div>
          </div>
        </div>

        <div className="shrink-0 px-3 pb-2 pt-0.5 lg:hidden">
          <div className={USUARIO_PANEL_HERO_CLASS}>
            <div className="flex items-center gap-2.5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 dark:border-primary/30 dark:bg-primary/20">
                <span className="material-symbols-outlined text-2xl text-blue-700 dark:text-primary">person_add</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Alta de usuario</p>
                <h3 className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-tight text-slate-900 dark:text-white">
                  {`${form.nombres} ${form.apellidos}`.trim() || 'Nuevo usuario'}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-px text-[10px] font-semibold leading-tight text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                    Creación
                  </span>
                  {form.roles[0] ? (
                    <span className="text-[10px] font-medium text-blue-700 dark:text-primary">{etiquetaRol(form.roles[0])}</span>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-xs text-slate-600 dark:text-slate-400">
                  {form.email || 'Completá el correo institucional'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div
          ref={scrollContainerRef}
          className={`scroll-region app-scroll-content flex-1 space-y-5 p-3 scrollbar-hide sm:space-y-8 sm:p-6 ${USUARIO_DETAIL_BODY}`}
        >
          <UsuarioFormCardMovil titulo="Información básica">
            <label className={`hidden lg:block ${USUARIO_SECTION_HEADING}`}>
              Información básica
            </label>
            <div className="grid grid-cols-1 gap-4">
              <label className={USUARIO_LABEL}>
                <span>Nombres</span>
                <input
                  type="text"
                  value={form.nombres}
                  onChange={(event) => setForm((prev) => ({ ...prev, nombres: event.target.value }))}
                  className={`${USUARIO_INP} ${errors.nombres ? 'border-rose-400' : ''}`}
                />
                {errors.nombres ? <p className="text-xs text-rose-400">{errors.nombres}</p> : null}
              </label>
              <label className={USUARIO_LABEL}>
                <span>Apellidos</span>
                <input
                  type="text"
                  value={form.apellidos}
                  onChange={(event) => setForm((prev) => ({ ...prev, apellidos: event.target.value }))}
                  className={`${USUARIO_INP} ${errors.apellidos ? 'border-rose-400' : ''}`}
                />
                {errors.apellidos ? <p className="text-xs text-rose-400">{errors.apellidos}</p> : null}
              </label>
              <label className={USUARIO_LABEL}>
                <span>Correo institucional</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                  className={`${USUARIO_INP} ${errors.email ? 'border-rose-400' : ''}`}
                />
                {errors.email ? <p className="text-xs text-rose-400">{errors.email}</p> : null}
              </label>
              <label className={USUARIO_LABEL}>
                <span>Usuario</span>
                <input
                  type="text"
                  value={form.usuario}
                  onChange={(event) => setForm((prev) => ({ ...prev, usuario: event.target.value }))}
                  className={`${USUARIO_INP} ${errors.usuario ? 'border-rose-400' : ''}`}
                />
                {errors.usuario ? <p className="text-xs text-rose-400">{errors.usuario}</p> : null}
              </label>
              <label className={USUARIO_LABEL}>
                <span>Teléfono</span>
                <input
                  type="tel"
                  value={form.telefono}
                  maxLength={10}
                  onChange={(event) => {
                    const val = event.target.value.replace(/\D/g, '').slice(0, 10);
                    setForm((prev) => ({ ...prev, telefono: val }));
                  }}
                  className={USUARIO_INP}
                />
              </label>
              <label className={USUARIO_LABEL}>
                <span>Contraseña inicial</span>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                    className={`${USUARIO_INP} pr-10 ${errors.password ? 'border-rose-400' : ''}`}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-slate-400 hover:text-slate-600 focus:outline-none dark:text-slate-500 dark:hover:text-slate-300"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    aria-pressed={showPassword}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
                {errors.password ? <p className="text-xs text-rose-400">{errors.password}</p> : null}
              </label>
            </div>
          </UsuarioFormCardMovil>

          <UsuarioFormCardMovil
            titulo="Roles"
            badge={
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, roles: [] }))}
                className="text-[11px] font-medium text-primary hover:underline"
              >
                Limpiar
              </button>
            }
          >
            <label className={`hidden lg:block ${USUARIO_SECTION_HEADING}`}>Roles</label>
            <div className="space-y-2">
              {ROLE_OPTIONS.map((role) => (
                <label
                  key={role.value}
                  className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 ${
                    form.roles.includes(role.value) ? USUARIO_ROLE_ACTIVE : USUARIO_ROLE_IDLE
                  }`}
                >
                  <input
                    type="radio"
                    name="role_option"
                    checked={form.roles.includes(role.value)}
                    onChange={() => handleRoleChange(role.value)}
                    className="size-5 border-slate-600 text-primary focus:ring-primary"
                  />
                  <div>
                    <p className="flex items-center gap-2 text-sm text-slate-800 dark:text-[#f0f4f8]">
                      <span className="material-symbols-outlined text-base text-slate-400">{role.icon}</span>
                      {role.label}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">{role.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </UsuarioFormCardMovil>

          {necesitaScope && (
            <UsuarioFormCardMovil titulo="Alcance de visibilidad">
              <div ref={scopeRef}>
              <label className={`hidden lg:block ${USUARIO_SECTION_HEADING}`}>
                Alcance de visibilidad
              </label>

              <div className="space-y-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">Facultad</p>
                {facultades.map(f => {
                  const checked = scopeFacultadIds.includes(f.id);
                  const icon = f.nombre.toLowerCase().includes('tecnolog') ? 'computer'
                    : f.nombre.toLowerCase().includes('empresa') ? 'business_center'
                    : f.nombre.toLowerCase().includes('derecho') ? 'gavel'
                    : 'menu_book';
                  return (
                    <label key={f.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${
                      checked
                        ? 'border-primary/60 bg-primary/10'
                        : USUARIO_SCOPE_IDLE
                    }`}>
                      <input
                        type="radio"
                        name="scope_facultad"
                        checked={checked}
                        onChange={() => setScopeFacultadIds([f.id])}
                        className="size-5 border-slate-600 text-primary focus:ring-primary"
                      />
                      <div>
                        <p className="flex items-center gap-2 text-sm text-slate-800 dark:text-[#f0f4f8]">
                          <span className="material-symbols-outlined text-base text-slate-400">{icon}</span>
                          {f.nombre}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>

              {esCoordinador && scopeFacultadIds.length > 0 && (
                <div ref={carreraRef} className="space-y-2 pt-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Carreras</p>
                  {carreras.map(c => {
                    const checked = scopeCarreraIds.includes(c.id);
                    return (
                      <label key={c.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${
                        checked
                          ? USUARIO_SCOPE_ACTIVE
                          : USUARIO_SCOPE_IDLE
                      }`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => setScopeCarreraIds(prev =>
                            e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id)
                          )}
                          className={SCOPE_CARRERA_CHOICE_CLASS}
                        />
                        <p className="text-sm text-slate-800 dark:text-[#f0f4f8]">{c.nombre}</p>
                      </label>
                    );
                  })}
                </div>
              )}
              </div>
            </UsuarioFormCardMovil>
          )}
        </div>

        <div
          className={`app-mobile-bottom-bar shrink-0 p-4 max-lg:sticky max-lg:bottom-0 max-lg:z-10 max-lg:px-3 max-lg:py-3 sm:p-6 ${USUARIO_DETAIL_FOOTER}`}
        >
          <div className="btn-mobile-stack flex gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-modern btn-modern-ghost btn-modern-sm btn-mobile-cta w-full lg:flex-1"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn-modern btn-modern-primary btn-modern-sm btn-mobile-cta w-full lg:flex-[1.35]"
            >
              {saving ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

