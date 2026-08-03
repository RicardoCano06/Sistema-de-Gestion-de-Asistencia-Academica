import { Request } from 'express';
import { pool } from '../../config/database';
import { logger } from '../../utils/logger';
import { formatGeneradoParaguay } from '../../utils/pdf-kit-brand';
import { generarAuditoriaEventosPdf } from './auditoria.pdf';
import { generarNombrePdfElegante } from '../reportes/reportes.utils';
import { registrarActaGenerada, type ActaGeneradaRow } from '../../services/actas-generadas.service';

export interface ExportAuditoriaPdfResult {
    acta: ActaGeneradaRow;
    buffer: Buffer;
    fileName: string;
    total: number;
}

export type ResultadoAuditoria = 'ok' | 'error';
export type SeveridadAuditoria = 'baja' | 'media' | 'alta';

export interface AuditoriaContexto {
    requestId?: string;
    actorUsuarioId?: string;
    actorEmail?: string;
    actorUsername?: string;
    actorRoles?: string[];
    ip?: string;
    userAgent?: string;
}

export interface RegistrarEventoAuditoriaInput {
    modulo: string;
    accion: string;
    recursoTipo?: string;
    recursoId?: string | number | null;
    /** Texto legible del recurso (nombre real, semestre, etc.) que se muestra en auditoría y PDF. */
    recursoResumen?: string | null;
    resultado?: ResultadoAuditoria;
    severidad?: SeveridadAuditoria;
    detalle?: unknown;
    antes?: unknown;
    despues?: unknown;
    contexto?: AuditoriaContexto;
}

export interface FiltroEventosAuditoria {
    desde?: string;
    hasta?: string;
    actorUsuarioId?: string;
    modulo?: string;
    accion?: string;
    resultado?: ResultadoAuditoria;
    severidad?: SeveridadAuditoria;
    recursoTipo?: string;
    q?: string;
    limit?: number;
    offset?: number;
}

export interface ExportarAuditoriaPdfMeta {
    exportedBy?: string;
    requestId?: string;
}

export interface EventoAuditoria {
    id: number;
    fecha_hora: string;
    request_id: string | null;
    actor_usuario_id: string | null;
    actor_nombre_completo: string | null;
    actor_email: string | null;
    actor_username: string | null;
    actor_roles: string[];
    modulo: string;
    accion: string;
    recurso_tipo: string | null;
    recurso_id: string | null;
    resultado: ResultadoAuditoria;
    severidad: SeveridadAuditoria;
    ip: string | null;
    user_agent: string | null;
    detalle: unknown;
    antes: unknown;
    despues: unknown;
    /** Descripción legible del recurso asociada al tipo/id, enriquecida a partir de tablas relacionadas. */
    recurso_resumen?: string | null;
}

type RecursoDescripcionMap = Map<string, string>;

function buildRecursoKey(tipo: string, id: string): string {
    return `${tipo}:${id}`;
}

/** Construye un resumen desde el JSON de auditoría cuando no hay recurso_resumen persistido (eventos previos). */
function armarResumenDesdeDetallePromocion(accion: string, detalle: unknown): string | null {
    if (!detalle || typeof detalle !== 'object' || Array.isArray(detalle)) return null;
    const d = detalle as Record<string, unknown>;

    if (accion === 'promocionar_semestre_curricular') {
        const partes: string[] = [];
        const carrera = typeof d.carrera === 'string' ? d.carrera : null;
        if (carrera) partes.push(`Carrera: ${carrera}`);
        const so = d.semestreOrigen != null ? Number(d.semestreOrigen) : NaN;
        const sd = d.semestreDestino != null ? Number(d.semestreDestino) : NaN;
        if (Number.isFinite(so) && Number.isFinite(sd)) partes.push(`Semestre ${so} → ${sd}`);
        const act = d.actualizados != null ? Number(d.actualizados) : NaN;
        if (Number.isFinite(act)) partes.push(`${act} alumno(s)`);
        return partes.length ? partes.join(' · ') : null;
    }

    if (accion === 'promocionar_semestre_curricular_masivo_facultad') {
        const partes: string[] = [];
        const facultad = typeof d.facultad === 'string' ? d.facultad : null;
        if (facultad) partes.push(`Facultad: ${facultad}`);
        const anio = d.anioIngreso != null ? Number(d.anioIngreso) : NaN;
        if (Number.isFinite(anio)) partes.push(`Año de ingreso ${Math.trunc(anio)}`);
        const so = d.semestreOrigen != null ? Number(d.semestreOrigen) : NaN;
        const sd = d.semestreDestino != null ? Number(d.semestreDestino) : NaN;
        if (Number.isFinite(so) && Number.isFinite(sd)) partes.push(`Semestre ${so} → ${sd}`);
        const act = d.actualizados != null ? Number(d.actualizados) : NaN;
        if (Number.isFinite(act)) partes.push(`${act} alumno(s)`);
        return partes.length ? partes.join(' · ') : null;
    }

    return null;
}

function etiquetaEstadoUsuarioAuditoria(estado: unknown): string {
    const e = typeof estado === 'string' ? estado.trim().toLowerCase() : '';
    if (e === 'activo') return 'Activo';
    if (e === 'inactivo' || e === 'suspendido') return 'Inactivo';
    return typeof estado === 'string' && estado.trim() ? estado.trim() : '(sin estado)';
}

function extraerNombreUsuarioSnapshot(snap: unknown): string | null {
    if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return null;
    const s = snap as Record<string, unknown>;
    const nombres = typeof s.nombres === 'string' ? s.nombres.trim() : '';
    const apellidos = typeof s.apellidos === 'string' ? s.apellidos.trim() : '';
    const nombre = [nombres, apellidos].filter(Boolean).join(' ').trim();
    const email = typeof s.email === 'string' ? s.email.trim() : '';
    return nombre || email || null;
}

function armarResumenCambioEstadoUsuario(ev: EventoAuditoria): string | null {
    if (ev.accion !== 'actualizar_estado_usuario') return null;

    let estadoAnterior: string | null = null;
    let estadoNuevo: string | null = null;
    if (ev.detalle && typeof ev.detalle === 'object' && !Array.isArray(ev.detalle)) {
        const d = ev.detalle as Record<string, unknown>;
        estadoAnterior = typeof d.estadoAnterior === 'string' ? d.estadoAnterior : null;
        estadoNuevo = typeof d.estadoNuevo === 'string' ? d.estadoNuevo : null;
    }
    if (!estadoAnterior && ev.antes && typeof ev.antes === 'object' && !Array.isArray(ev.antes)) {
        estadoAnterior = (ev.antes as Record<string, unknown>).estado as string | undefined ?? null;
    }
    if (!estadoNuevo && ev.despues && typeof ev.despues === 'object' && !Array.isArray(ev.despues)) {
        estadoNuevo = (ev.despues as Record<string, unknown>).estado as string | undefined ?? null;
    }

    const nombre =
        extraerNombreUsuarioSnapshot(ev.antes) ??
        extraerNombreUsuarioSnapshot(ev.despues) ??
        'Usuario';

    return `${nombre}: ${etiquetaEstadoUsuarioAuditoria(estadoAnterior)} → ${etiquetaEstadoUsuarioAuditoria(estadoNuevo)}`;
}

function armarResumenUsuarioDesdeEvento(ev: EventoAuditoria): string | null {
    const resumenEstado = armarResumenCambioEstadoUsuario(ev);
    if (resumenEstado) return resumenEstado;

    const accionesUsuario = new Set([
        'crear_usuario',
        'actualizar_usuario',
        'actualizar_estado_usuario',
        'actualizar_roles_usuario',
        'reset_password_usuario',
        'eliminar_usuario'
    ]);
    if (!accionesUsuario.has(ev.accion)) return null;

    const detalle = ev.detalle;
    if (detalle && typeof detalle === 'object' && !Array.isArray(detalle)) {
        const d = detalle as Record<string, unknown>;
        const nombreCompleto = typeof d.nombreCompleto === 'string' ? d.nombreCompleto.trim() : '';
        const email = typeof d.email === 'string' ? d.email.trim() : '';
        if (nombreCompleto) {
            return ev.accion === 'eliminar_usuario' ? `Usuario eliminado: ${nombreCompleto}` : `Usuario: ${nombreCompleto}`;
        }
        if (email) {
            return ev.accion === 'eliminar_usuario' ? `Usuario eliminado: ${email}` : `Usuario: ${email}`;
        }
    }

    const etiqueta = extraerNombreUsuarioSnapshot(ev.antes) ?? extraerNombreUsuarioSnapshot(ev.despues);
    if (!etiqueta) return null;
    return ev.accion === 'eliminar_usuario' ? `Usuario eliminado: ${etiqueta}` : `Usuario: ${etiqueta}`;
}

function aplicarResumenRecursoListado(ev: EventoAuditoria, descripciones: RecursoDescripcionMap): void {
    const resumenCambioEstado = armarResumenCambioEstadoUsuario(ev);
    if (resumenCambioEstado) {
        ev.recurso_resumen = resumenCambioEstado;
        return;
    }

    const rawPersisted = ev.recurso_resumen;
    const persisted =
        typeof rawPersisted === 'string' ? rawPersisted.trim() : String(rawPersisted ?? '').trim();
    if (persisted) {
        ev.recurso_resumen = persisted;
        return;
    }
    let lookup = '';
    if (ev.recurso_tipo && ev.recurso_id) {
        lookup = descripciones.get(buildRecursoKey(ev.recurso_tipo, ev.recurso_id)) ?? '';
    }
    const desdeDetalle = armarResumenDesdeDetallePromocion(ev.accion, ev.detalle) ?? '';
    const desdeUsuario = armarResumenUsuarioDesdeEvento(ev) ?? '';

    const partes = [...new Set([lookup.trim(), desdeUsuario.trim(), desdeDetalle.trim()].filter(Boolean))];
    ev.recurso_resumen = partes.length ? partes.join(' · ') : null;
}

async function construirDescripcionesRecursos(eventos: EventoAuditoria[]): Promise<RecursoDescripcionMap> {
    const porTipo: Record<string, Set<string>> = {};
    for (const ev of eventos) {
        if (!ev.recurso_tipo || !ev.recurso_id) continue;
        const tipo = ev.recurso_tipo;
        if (!porTipo[tipo]) porTipo[tipo] = new Set<string>();
        porTipo[tipo].add(ev.recurso_id);
    }

    const map: RecursoDescripcionMap = new Map();

    const toIntArray = (ids: Set<string> | undefined): number[] => {
        if (!ids?.size) return [];
        return [...ids].map((id) => Number(id)).filter((n) => Number.isFinite(n) && Number.isInteger(n));
    };

    const toBigIntArray = (ids: Set<string> | undefined): string[] => {
        if (!ids?.size) return [];
        return [...ids].filter((id) => /^\d+$/.test(id));
    };

    // Usuarios
    const usuarioIds = Array.from(porTipo.usuario ?? []);
    if (usuarioIds.length) {
        const { rows } = await pool.query<{ id: string; nombre: string | null; email: string | null }>(
            `SELECT id, NULLIF(trim(concat_ws(' ', nombres, apellidos)), '') AS nombre, email
             FROM usuarios
             WHERE id = ANY($1::uuid[])`,
            [usuarioIds]
        );
        for (const row of rows) {
            const etiquetaBase = row.nombre || row.email || 'Usuario';
            map.set(buildRecursoKey('usuario', row.id), `Usuario: ${etiquetaBase}`);
        }
    }

    // Sesión de auth (mismo id que usuario)
    const sesionAuthIds = Array.from(porTipo.sesion ?? []);
    if (sesionAuthIds.length) {
        const { rows } = await pool.query<{ id: string; nombre: string | null; email: string | null }>(
            `SELECT id, NULLIF(trim(concat_ws(' ', nombres, apellidos)), '') AS nombre, email
             FROM usuarios
             WHERE id = ANY($1::uuid[])`,
            [sesionAuthIds]
        );
        for (const row of rows) {
            const etiquetaBase = row.nombre || row.email || 'Usuario';
            map.set(buildRecursoKey('sesion', row.id), `Sesión (auth): ${etiquetaBase}`);
        }
    }

    // Alumnos
    const alumnoIds = Array.from(porTipo.alumno ?? []);
    if (alumnoIds.length) {
        const { rows } = await pool.query<{ id: string; nombre_apellido: string | null; numero_documento: string | null }>(
            `SELECT id, nombre_apellido, numero_documento
             FROM alumnos
             WHERE id = ANY($1::uuid[])`,
            [alumnoIds]
        );
        for (const row of rows) {
            const nombre = row.nombre_apellido || 'Alumno';
            const ci = row.numero_documento ? ` (CI ${row.numero_documento})` : '';
            map.set(buildRecursoKey('alumno', row.id), `${nombre}${ci}`);
        }
    }

    // Actas generadas
    const actaIds = toBigIntArray(porTipo.acta_generada);
    if (actaIds.length) {
        const { rows } = await pool.query<{ id: string; tipo_acta: string; curso_id: number; materia: string | null }>(
            `SELECT ag.id::text, ag.tipo_acta, ag.curso_id, m.nombre AS materia
             FROM actas_generadas ag
             LEFT JOIN cursos c ON c.id = ag.curso_id
             LEFT JOIN modulos_academicos mo ON mo.id = c.modulo_id
             LEFT JOIN materias m ON m.id = mo.materia_id
             WHERE ag.id = ANY($1::bigint[])`,
            [actaIds]
        );
        for (const row of rows) {
            const tipo = row.tipo_acta.replace(/_/g, ' ');
            const materia = row.materia ? ` · ${row.materia}` : ` · curso ${row.curso_id}`;
            map.set(buildRecursoKey('acta_generada', String(row.id)), `Acta #${row.id}: ${tipo}${materia}`);
        }
    }

    // Módulos académicos
    const moduloIds = toIntArray(porTipo.modulo_academico);
    if (moduloIds.length) {
        const { rows } = await pool.query<{ id: number; materia: string; anio: number; mes: number; estado: string }>(
            `SELECT ma.id, m.nombre AS materia, ma.anio, ma.mes, ma.estado
             FROM modulos_academicos ma
             JOIN materias m ON m.id = ma.materia_id
             WHERE ma.id = ANY($1::int[])`,
            [moduloIds]
        );
        for (const row of rows) {
            map.set(
                buildRecursoKey('modulo_academico', String(row.id)),
                `Módulo académico #${row.id}: ${row.materia} (${row.anio}-${String(row.mes).padStart(2, '0')}, ${row.estado})`
            );
        }
    }

    // Cursos (también usado como recurso en estadística de ausentismo)
    const cursoIds = new Set<string>([...(porTipo.curso ?? []), ...(porTipo.estadistica_ausentismo ?? [])]);
    const cursoIdNums = toIntArray(cursoIds);
    if (cursoIdNums.length) {
        const { rows } = await pool.query<{ id: number; materia: string; anio: number; mes: number }>(
            `SELECT c.id, m.nombre AS materia, mo.anio, mo.mes
             FROM cursos c
             JOIN modulos_academicos mo ON mo.id = c.modulo_id
             JOIN materias m ON m.id = mo.materia_id
             WHERE c.id = ANY($1::int[])`,
            [cursoIdNums]
        );
        for (const row of rows) {
            const etiqueta = `Curso #${row.id}: ${row.materia} (${row.anio}-${String(row.mes).padStart(2, '0')})`;
            map.set(buildRecursoKey('curso', String(row.id)), etiqueta);
            map.set(buildRecursoKey('estadistica_ausentismo', String(row.id)), `Estadística ausentismo · ${etiqueta}`);
        }
    }

    // Sesiones de clase
    const sesionClaseIds = toIntArray(porTipo.sesion_clase);
    if (sesionClaseIds.length) {
        const { rows } = await pool.query<{ id: number; fecha: string; curso_id: number; materia: string | null; docente: string | null }>(
            `SELECT sc.id, sc.fecha::text AS fecha, sc.curso_id, m.nombre AS materia,
                    COALESCE(u.nombres || ' ' || u.apellidos, 'Docente desconocido') AS docente
             FROM sesiones_clase sc
             LEFT JOIN cursos c ON c.id = sc.curso_id
             LEFT JOIN modulos_academicos mo ON mo.id = c.modulo_id
             LEFT JOIN materias m ON m.id = mo.materia_id
             LEFT JOIN docentes d ON d.id = c.docente_id
             LEFT JOIN usuarios u ON u.id = d.usuario_id
             WHERE sc.id = ANY($1::int[])`,
            [sesionClaseIds]
        );
        for (const row of rows) {
            const fechaTxt = String(row.fecha).slice(0, 10);
            const materiaTxt = row.materia ?? `Curso #${row.curso_id}`;
            map.set(
                buildRecursoKey('sesion_clase', String(row.id)),
                `Sesión clase #${row.id}: ${materiaTxt} · ${row.docente} · ${fechaTxt}`
            );
        }
        // Fallback para sesiones que fueron eliminadas
        for (const id of sesionClaseIds) {
            const key = buildRecursoKey('sesion_clase', String(id));
            if (!map.has(key)) {
                map.set(key, `Sesión de clase #${id}`);
            }
        }
    }

    // Matrículas
    const matriculaIds = toIntArray(porTipo.matricula);
    const matriculaAlumnoUuids = [...(porTipo.matricula ?? [])].filter((id) => !/^\d+$/.test(id));
    if (matriculaIds.length) {
        const { rows } = await pool.query<{
            id: number;
            alumno: string | null;
            numero_documento: string | null;
            curso_id: number;
            materia: string | null;
        }>(
            `SELECT mat.id,
                    NULLIF(trim(concat_ws(', ', NULLIF(trim(al.apellidos), ''), NULLIF(trim(al.nombres), ''))), '') AS alumno,
                    al.numero_documento,
                    mat.curso_id,
                    m.nombre AS materia
             FROM matriculas mat
             JOIN alumnos al ON al.id = mat.alumno_id
             JOIN cursos c ON c.id = mat.curso_id
             JOIN modulos_academicos mo ON mo.id = c.modulo_id
             JOIN materias m ON m.id = mo.materia_id
             WHERE mat.id = ANY($1::int[])`,
            [matriculaIds]
        );
        for (const row of rows) {
            const nom = row.alumno || 'Alumno';
            const ci = row.numero_documento ? ` CI ${row.numero_documento}` : '';
            const mat = row.materia ? ` · ${row.materia}` : '';
            map.set(
                buildRecursoKey('matricula', String(row.id)),
                `Matrícula #${row.id}: ${nom}${ci}${mat} (curso ${row.curso_id})`
            );
        }
    }
    // Matrículas referenciadas por alumno_id (UUID)
    if (matriculaAlumnoUuids.length) {
        const { rows } = await pool.query<{
            alumno_id: string;
            alumno: string | null;
            numero_documento: string | null;
            materia: string | null;
        }>(
            `SELECT DISTINCT ON (al.id)
                    al.id AS alumno_id,
                    NULLIF(trim(concat_ws(', ', NULLIF(trim(al.apellidos), ''), NULLIF(trim(al.nombres), ''))), '') AS alumno,
                    al.numero_documento,
                    m.nombre AS materia
             FROM matriculas mat
             JOIN alumnos al ON al.id = mat.alumno_id
             JOIN cursos c ON c.id = mat.curso_id
             JOIN modulos_academicos mo ON mo.id = c.modulo_id
             JOIN materias m ON m.id = mo.materia_id
             WHERE al.id = ANY($1::uuid[])`,
            [matriculaAlumnoUuids]
        );
        for (const row of rows) {
            const nom = row.alumno || 'Alumno';
            const ci = row.numero_documento ? ` CI ${row.numero_documento}` : '';
            const mat = row.materia ? ` · ${row.materia}` : '';
            map.set(
                buildRecursoKey('matricula', row.alumno_id),
                `Alumno desmatriculado: ${nom}${ci}${mat}`
            );
        }
    }

    // Asistencias
    const asistenciaIds = toBigIntArray(porTipo.asistencia);
    if (asistenciaIds.length) {
        const { rows } = await pool.query<{ id: string; sesion_id: number; fecha: string; alumno: string | null; materia: string | null }>(
            `SELECT a.id::text, a.sesion_id, sc.fecha::text AS fecha,
                    NULLIF(trim(concat_ws(', ', NULLIF(trim(al.apellidos), ''), NULLIF(trim(al.nombres), ''))), '') AS alumno,
                    m.nombre AS materia
             FROM asistencias a
             JOIN sesiones_clase sc ON sc.id = a.sesion_id
             JOIN matriculas mat ON mat.id = a.matricula_id
             JOIN alumnos al ON al.id = mat.alumno_id
             JOIN cursos c ON c.id = sc.curso_id
             JOIN modulos_academicos mo ON mo.id = c.modulo_id
             JOIN materias m ON m.id = mo.materia_id
             WHERE a.id = ANY($1::bigint[])`,
            [asistenciaIds]
        );
        for (const row of rows) {
            const fechaTxt = String(row.fecha).slice(0, 10);
            const nombre = row.alumno || 'Alumno';
            const materia = row.materia ? ` · ${row.materia}` : '';
            map.set(
                buildRecursoKey('asistencia', row.id),
                `Asistencia #${row.id}: ${nombre}${materia} · sesión ${row.sesion_id} (${fechaTxt})`
            );
        }
    }

    // Justificaciones
    const justificacionIds = toBigIntArray(porTipo.justificacion);
    if (justificacionIds.length) {
        const { rows } = await pool.query<{ id: string; estado_revision: string; alumno: string | null; materia: string | null }>(
            `SELECT j.id::text, j.estado_revision,
                    NULLIF(trim(concat_ws(', ', NULLIF(trim(al.apellidos), ''), NULLIF(trim(al.nombres), ''))), '') AS alumno,
                    m.nombre AS materia
             FROM justificaciones j
             JOIN asistencias a ON a.id = j.asistencia_id
             JOIN matriculas mat ON mat.id = a.matricula_id
             JOIN alumnos al ON al.id = mat.alumno_id
             JOIN cursos c ON c.id = mat.curso_id
             JOIN modulos_academicos mo ON mo.id = c.modulo_id
             JOIN materias m ON m.id = mo.materia_id
             WHERE j.id = ANY($1::bigint[])`,
            [justificacionIds]
        );
        for (const row of rows) {
            const nombre = row.alumno || 'Alumno';
            const materia = row.materia ? ` · ${row.materia}` : '';
            map.set(
                buildRecursoKey('justificacion', row.id),
                `Justificación #${row.id}: ${nombre}${materia} · ${row.estado_revision}`
            );
        }
    }

    // Lotes de importación
    const loteIds = toBigIntArray(porTipo.lote_alumnos);
    if (loteIds.length) {
        const { rows } = await pool.query<{ id: string; tipo_lote: string; descripcion: string | null; estado: string }>(
            `SELECT id::text, tipo_lote, descripcion, estado
             FROM lotes_importacion
             WHERE id = ANY($1::bigint[])`,
            [loteIds]
        );
        for (const row of rows) {
            const carrera = (row.descripcion ?? '').split('·')[2]?.trim() || '';
            const partes = (row.descripcion ?? '').split('·');
            const semestre = partes.find((p) => /semestre/i.test(p))?.trim() || '';
            const cohorte = partes.find((p) => /año de ingreso/i.test(p))?.trim() || '';
            const info = [carrera, semestre, cohorte].filter(Boolean).join(', ');
            const etiqueta = info ? `Lote #${row.id}: ${info}` : `Lote #${row.id} (${row.tipo_lote})`;
            map.set(buildRecursoKey('lote_alumnos', row.id), etiqueta);
        }
    }

    // Alertas de asistencia
    const alertaIds = toIntArray(porTipo.alerta_asistencia);
    if (alertaIds.length) {
        const { rows } = await pool.query<{
            id: number;
            matricula_id: number;
            tipo_alerta: string;
            estado: string | null;
            alumno: string | null;
        }>(
            `SELECT aa.id, aa.matricula_id, aa.tipo_alerta::text AS tipo_alerta, aa.estado,
                    NULLIF(trim(concat_ws(', ', NULLIF(trim(al.apellidos), ''), NULLIF(trim(al.nombres), ''))), '') AS alumno
             FROM alertas_asistencia aa
             JOIN matriculas mat ON mat.id = aa.matricula_id
             JOIN alumnos al ON al.id = mat.alumno_id
             WHERE aa.id = ANY($1::int[])`,
            [alertaIds]
        );
        for (const row of rows) {
            const alum = row.alumno ? ` · ${row.alumno}` : '';
            map.set(
                buildRecursoKey('alerta_asistencia', String(row.id)),
                `Alerta #${row.id}: ${row.tipo_alerta} · matrícula ${row.matricula_id}${alum} (${row.estado ?? 'sin estado'})`
            );
        }
    }

    // Carreras
    const carreraIds = toIntArray(porTipo.carrera);
    if (carreraIds.length) {
        const { rows } = await pool.query<{ id: number; nombre: string }>(
            `SELECT id, nombre FROM carreras WHERE id = ANY($1::int[])`,
            [carreraIds]
        );
        for (const row of rows) {
            map.set(buildRecursoKey('carrera', String(row.id)), `Carrera: ${row.nombre}`);
        }
    }

    // Facultades
    const facultadIds = toIntArray(porTipo.facultad);
    if (facultadIds.length) {
        const { rows } = await pool.query<{ id: number; nombre: string }>(
            `SELECT id, nombre FROM facultades WHERE id = ANY($1::int[])`,
            [facultadIds]
        );
        for (const row of rows) {
            map.set(buildRecursoKey('facultad', String(row.id)), `Facultad: ${row.nombre}`);
        }
    }

    // Materias
    const materiaIds = toIntArray(porTipo.materia);
    if (materiaIds.length) {
        const { rows } = await pool.query<{ id: number; nombre: string; codigo: string }>(
            `SELECT id, nombre, codigo FROM materias WHERE id = ANY($1::int[])`,
            [materiaIds]
        );
        for (const row of rows) {
            map.set(buildRecursoKey('materia', String(row.id)), `Materia: ${row.nombre} (${row.codigo})`);
        }
    }

    // Planes de estudio
    const planIds = toIntArray(porTipo.plan);
    if (planIds.length) {
        const { rows } = await pool.query<{ id: number; nombre: string }>(
            `SELECT id, nombre FROM planes_estudio WHERE id = ANY($1::int[])`,
            [planIds]
        );
        for (const row of rows) {
            map.set(buildRecursoKey('plan', String(row.id)), `Plan: ${row.nombre}`);
        }
    }

    const cronogramaSemanaIds = toIntArray(porTipo.curso_cronograma_semanas);
    if (cronogramaSemanaIds.length) {
        const { rows } = await pool.query<{ id: number; semana_numero: number; materia: string; docente: string }>(
            `SELECT cs.id, cs.semana_numero, m.nombre AS materia,
                    u.nombres || ' ' || u.apellidos AS docente
             FROM curso_cronograma_semanas cs
             JOIN cursos c ON c.id = cs.curso_id
             JOIN modulos_academicos ma ON ma.id = c.modulo_id
             JOIN materias m ON m.id = ma.materia_id
             JOIN docentes d ON d.id = c.docente_id
             JOIN usuarios u ON u.id = d.usuario_id
             WHERE cs.id = ANY($1::int[])`,
            [cronogramaSemanaIds]
        );
        for (const row of rows) {
            map.set(buildRecursoKey('curso_cronograma_semanas', String(row.id)),
                `Cronograma: Semana ${row.semana_numero} · ${row.materia} · ${row.docente}`);
        }
    }

    const cronogramaEvalIds = toIntArray(porTipo.curso_evaluaciones);
    if (cronogramaEvalIds.length) {
        const { rows } = await pool.query<{ id: number; tipo: string; materia: string; docente: string }>(
            `SELECT ce.id, ce.tipo, m.nombre AS materia,
                    u.nombres || ' ' || u.apellidos AS docente
             FROM curso_evaluaciones ce
             JOIN cursos c ON c.id = ce.curso_id
             JOIN modulos_academicos ma ON ma.id = c.modulo_id
             JOIN materias m ON m.id = ma.materia_id
             JOIN docentes d ON d.id = c.docente_id
             JOIN usuarios u ON u.id = d.usuario_id
             WHERE ce.id = ANY($1::int[])`,
            [cronogramaEvalIds]
        );
        for (const row of rows) {
            const tipoLabel = row.tipo === 'parcial' ? 'Parcial' : 'Final';
            map.set(buildRecursoKey('curso_evaluaciones', String(row.id)),
                `Cronograma: Eval. ${tipoLabel} · ${row.materia} · ${row.docente}`);
        }
    }

    // Lote de importación (descartado o en proceso)
    const loteImportacionIds = toBigIntArray(porTipo.lote_importacion);
    if (loteImportacionIds.length) {
        const { rows } = await pool.query<{ id: string; descripcion: string | null; estado: string; carrera: string | null }>(
            `SELECT li.id::text, li.descripcion, li.estado, cr.nombre AS carrera
             FROM lotes_importacion li
             LEFT JOIN carreras cr ON cr.id = li.destino_carrera_id
             WHERE li.id = ANY($1::bigint[])`,
            [loteImportacionIds]
        );
        for (const row of rows) {
            const desc = row.descripcion ? ` · ${row.descripcion.slice(0, 80)}` : '';
            const carrera = row.carrera ? ` · ${row.carrera}` : '';
            map.set(
                buildRecursoKey('lote_importacion', row.id),
                `Lote importación #${row.id}: ${row.estado}${carrera}${desc}`
            );
        }
    }

    // Reportes PDF (genéricos)
    const pdfLabels: Record<string, string> = {
        reporte_usuarios: 'Exportación de Usuarios',
        reporte_auditoria: 'Exportación de Auditoría',
        reporte_ausentismo: 'Estadísticas de Ausentismo',
        reporte_consolidado: 'Consolidado de Inhabilitados',
    };
    for (const [tipo, label] of Object.entries(pdfLabels)) {
        const ids = Array.from(porTipo[tipo] ?? []);
        for (const id of ids) {
            map.set(buildRecursoKey(tipo, id), `${label}${id ? ` #${id}` : ''}`);
        }
    }

    return map;
}

function obtenerPrimerValor(value: string | string[] | undefined): string | undefined {
    if (!value) {
        return undefined;
    }

    const texto = Array.isArray(value) ? value[0] : value;
    const [primero] = texto.split(',');
    const limpio = primero?.trim();
    return limpio || undefined;
}

export function construirContextoAuditoria(req: Request): AuditoriaContexto {
    return {
        requestId: req.requestId,
        actorUsuarioId: req.usuario?.usuarioId,
        actorEmail: req.usuario?.email,
        actorRoles: req.usuario?.roles ?? [],
        ip: obtenerPrimerValor(req.headers['x-forwarded-for']) ?? req.ip,
        userAgent: req.headers['user-agent'] ?? undefined
    };
}

export async function registrarEventoAuditoria(input: RegistrarEventoAuditoriaInput): Promise<void> {
    const contexto = input.contexto ?? {};
    const actorRoles = Array.isArray(contexto.actorRoles) ? contexto.actorRoles : [];

    await pool.query(
        `INSERT INTO auditoria_eventos (
            request_id,
            actor_usuario_id,
            actor_email,
            actor_username,
            actor_roles,
            modulo,
            accion,
            recurso_tipo,
            recurso_id,
            recurso_resumen,
            resultado,
            severidad,
            ip,
            user_agent,
            detalle,
            antes,
            despues
        ) VALUES (
            $1::uuid,
            $2::uuid,
            $3,
            $4,
            $5::text[],
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15::jsonb,
            $16::jsonb,
            $17::jsonb
        )`,
        [
            contexto.requestId ?? null,
            contexto.actorUsuarioId ?? null,
            contexto.actorEmail ?? null,
            contexto.actorUsername ?? null,
            actorRoles,
            input.modulo,
            input.accion,
            input.recursoTipo ?? null,
            input.recursoId !== undefined && input.recursoId !== null ? String(input.recursoId) : null,
            input.recursoResumen ?? null,
            input.resultado ?? 'ok',
            input.severidad ?? 'baja',
            contexto.ip ?? null,
            contexto.userAgent ?? null,
            JSON.stringify(input.detalle ?? {}),
            input.antes === undefined ? null : JSON.stringify(input.antes),
            input.despues === undefined ? null : JSON.stringify(input.despues)
        ]
    );
}

export function registrarEventoAuditoriaSegura(input: RegistrarEventoAuditoriaInput): void {
    registrarEventoAuditoria(input).catch((error) => {
        logger.warn({ err: error, input }, 'No se pudo registrar evento de auditoria en segundo plano');
    });
}

export async function listarEventosAuditoria(filtro: FiltroEventosAuditoria = {}): Promise<{ total: number; datos: EventoAuditoria[] }> {
    try {
        const condiciones: string[] = [];
        const valores: Array<string | number> = [];

    if (filtro.desde) {
        valores.push(filtro.desde);
        condiciones.push(`fecha_hora >= $${valores.length}::timestamptz`);
    }

    if (filtro.hasta) {
        valores.push(filtro.hasta);
        condiciones.push(`fecha_hora <= $${valores.length}::timestamptz`);
    }

    if (filtro.actorUsuarioId) {
        valores.push(filtro.actorUsuarioId);
        condiciones.push(`actor_usuario_id = $${valores.length}::uuid`);
    }

    if (filtro.modulo) {
        valores.push(filtro.modulo);
        condiciones.push(`modulo = $${valores.length}`);
    }

    if (filtro.accion) {
        valores.push(filtro.accion);
        condiciones.push(`accion = $${valores.length}`);
    }

    if (filtro.resultado) {
        valores.push(filtro.resultado);
        condiciones.push(`resultado = $${valores.length}`);
    }

    if (filtro.severidad) {
        valores.push(filtro.severidad);
        condiciones.push(`severidad = $${valores.length}`);
    }

    if (filtro.recursoTipo) {
        valores.push(filtro.recursoTipo);
        condiciones.push(`recurso_tipo = $${valores.length}`);
    }

    if (filtro.q) {
        valores.push(`%${filtro.q}%`);
        const idx = valores.length;
        condiciones.push(`(
            COALESCE(modulo, '') ILIKE $${idx}
            OR COALESCE(accion, '') ILIKE $${idx}
            OR COALESCE(recurso_tipo, '') ILIKE $${idx}
            OR COALESCE(actor_email, '') ILIKE $${idx}
            OR COALESCE(actor_username, '') ILIKE $${idx}
            OR COALESCE(recurso_id, '') ILIKE $${idx}
            OR COALESCE(recurso_resumen, '') ILIKE $${idx}
            OR COALESCE(detalle::text, '') ILIKE $${idx}
        )`);
    }

        const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
        const limit = Math.min(Math.max(filtro.limit ?? 100, 1), 500);
        const offset = Math.max(filtro.offset ?? 0, 0);

        const { rows: totalRows } = await pool.query<{ total: number }>(
            `SELECT COUNT(*)::int AS total FROM auditoria_eventos ${where}`,
            valores
        );

        const valoresListado = [...valores, limit, offset];
        const { rows } = await pool.query<EventoAuditoria>(
            `SELECT
                ae.id,
                ae.fecha_hora,
                ae.request_id,
                ae.actor_usuario_id,
                NULLIF(trim(concat_ws(' ', u.nombres, u.apellidos)), '') AS actor_nombre_completo,
                ae.actor_email,
                ae.actor_username,
                ae.actor_roles,
                ae.modulo,
                ae.accion,
                ae.recurso_tipo,
                ae.recurso_id,
                ae.recurso_resumen,
                ae.resultado,
                ae.severidad,
                ae.ip,
                ae.user_agent,
                ae.detalle,
                ae.antes,
                ae.despues
            FROM auditoria_eventos ae
            LEFT JOIN usuarios u ON u.id = ae.actor_usuario_id
         ${where}
            ORDER BY ae.fecha_hora DESC, ae.id DESC
         LIMIT $${valores.length + 1}
         OFFSET $${valores.length + 2}`,
            valoresListado
        );

        const descripciones = await construirDescripcionesRecursos(rows);
        for (const row of rows) {
            aplicarResumenRecursoListado(row, descripciones);
        }

        return {
            total: totalRows[0]?.total ?? 0,
            datos: rows
        };
    } catch (error: any) {
        if (error?.code === '42P01') {
            throw new Error('La tabla auditoria_eventos no existe. Ejecuta la migración 20260316_add_auditoria_eventos.sql');
        }
        throw error;
    }
}

export async function obtenerEventoAuditoriaPorId(id: number): Promise<EventoAuditoria | null> {
    try {
        const { rows } = await pool.query<EventoAuditoria>(
            `SELECT
            ae.id,
            ae.fecha_hora,
            ae.request_id,
            ae.actor_usuario_id,
            NULLIF(trim(concat_ws(' ', u.nombres, u.apellidos)), '') AS actor_nombre_completo,
            ae.actor_email,
            ae.actor_username,
            ae.actor_roles,
            ae.modulo,
            ae.accion,
            ae.recurso_tipo,
            ae.recurso_id,
            ae.recurso_resumen,
            ae.resultado,
            ae.severidad,
            ae.ip,
            ae.user_agent,
            ae.detalle,
            ae.antes,
            ae.despues
         FROM auditoria_eventos ae
         LEFT JOIN usuarios u ON u.id = ae.actor_usuario_id
         WHERE ae.id = $1`,
            [id]
        );

        const ev = rows[0] ?? null;
        if (ev) {
            const descripciones = await construirDescripcionesRecursos([ev]);
            aplicarResumenRecursoListado(ev, descripciones);
        }

        return ev;
    } catch (error: any) {
        if (error?.code === '42P01') {
            throw new Error('La tabla auditoria_eventos no existe. Ejecuta la migración 20260316_add_auditoria_eventos.sql');
        }
        throw error;
    }
}

export async function construirExportAuditoriaPdfBuffer(
    filtro: FiltroEventosAuditoria = {},
    meta?: ExportarAuditoriaPdfMeta
): Promise<{ buffer: Buffer; fileName: string; total: number }> {
    const capExportacion = 500;
    const lim = Math.min(Math.max(filtro.limit ?? capExportacion, 1), capExportacion);
    const { total, datos } = await listarEventosAuditoria({
        ...filtro,
        limit: lim,
        offset: 0,
    });

    if (!datos.length) {
        throw new Error('No hay eventos de auditoría para exportar con los filtros actuales');
    }

    const filtrosResumen = [
        filtro.desde ? `desde=${filtro.desde}` : null,
        filtro.hasta ? `hasta=${filtro.hasta}` : null,
        filtro.modulo ? `modulo=${filtro.modulo}` : null,
        filtro.accion ? `accion=${filtro.accion}` : null,
        filtro.resultado ? `resultado=${filtro.resultado}` : null,
        filtro.q ? `q=${filtro.q}` : null,
    ].filter(Boolean).join(' | ') || 'sin filtros';

    const fileName = generarNombrePdfElegante({
        titulo: 'Reporte de Auditoría del Sistema',
    });

    const describirActor = (item: EventoAuditoria): string => {
        const nombre = item.actor_nombre_completo?.trim();
        const correo = item.actor_email?.trim();
        const usuario = item.actor_username?.trim();
        if (nombre && correo) return `${nombre} (${correo})`;
        if (nombre && usuario) return `${nombre} (${usuario})`;
        if (nombre) return nombre;
        if (correo) return correo;
        if (usuario) return usuario;
        return 'Sistema';
    };

    const describirRecurso = (item: EventoAuditoria): string => {
        const res = item.recurso_resumen?.trim();
        if (res) return res;
        const tipo = (item.recurso_tipo ?? '-').toLowerCase();
        const recursoId = item.recurso_id ? `#${item.recurso_id}` : '';
        if (tipo === 'sesion' && ['login', 'logout', 'refresh_token'].includes(item.accion)) {
            return `usuario ${recursoId}`.trim();
        }
        if (!item.recurso_id) return item.recurso_tipo ?? '-';
        return `${item.recurso_tipo ?? '-'} ${recursoId}`.trim();
    };

    const describirAccion = (accion: string): string => {
        const mapa: Record<string, string> = {
            crear_acta: 'Crear Acta (PDF Legal/Habilitados)',
            generar_informe_alumno_pdf: 'Generar Informe Alumno PDF',
            generar_consolidado_riesgo_pdf: 'Generar Consolidado Riesgo PDF',
            generar_estadisticas_ausentismo_pdf: 'Generar Estadísticas Ausentismo PDF',
            promocionar_semestre_curricular: 'Promoción semestre curricular (por carrera)',
            promocionar_semestre_curricular_masivo_facultad: 'Promoción semestre curricular (masiva por facultad)',
            actualizar_scopes_usuario: 'Actualizar Alcance de Usuario',
            reset_password_usuario: 'Restablecer Contraseña de Usuario',
        };
        return mapa[accion] ?? accion
            .split('_')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    };

    const buffer = await generarAuditoriaEventosPdf({
        titulo: 'REPORTE DE AUDITORÍA DEL SISTEMA',
        filtros: filtrosResumen,
        total,
        generadoEn: formatGeneradoParaguay(new Date()),
        capExportacion: lim,
        exportedBy: meta?.exportedBy,
        requestId: meta?.requestId,
        eventos: datos.map((item) => ({
            fecha_hora: item.fecha_hora,
            actor: describirActor(item),
            modulo: item.modulo,
            accion: describirAccion(item.accion),
            recurso: describirRecurso(item),
            resultado: item.resultado,
        })),
    });

    return { buffer, fileName, total };
}

export async function exportarEventosAuditoriaPdf(
    filtro: FiltroEventosAuditoria = {},
    meta?: ExportarAuditoriaPdfMeta,
    usuarioId?: string
): Promise<ExportAuditoriaPdfResult> {
    const { buffer, fileName, total } = await construirExportAuditoriaPdfBuffer(filtro, meta);

    if (!usuarioId) {
        throw new Error('No se pudo determinar el usuario que exporta');
    }

    const acta = await registrarActaGenerada({
        cursoId: null,
        tipoActa: 'export_auditoria',
        parametros: { ...filtro },
        generadoPor: usuarioId,
    });

    return { acta, buffer, fileName, total };
}
