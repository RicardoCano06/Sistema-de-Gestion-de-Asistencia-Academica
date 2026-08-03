import { pool } from '../config/database';

function normalizeRol(value: string): string {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * Alcance operativo para matrículas, alumnos 360, reportes y panel.
 * - `facultades`: coordinación de facultad (`usuario_scopes.facultad_id`).
 * - `carreras`: jefe de carrera (`usuario_scopes.carrera_id`).
 */
export type AlcanceMatriculasFacultad =
    | { tipo: 'sin_restriccion' }
    | { tipo: 'facultades'; facultadIds: number[] }
    | { tipo: 'carreras'; carreraIds: number[] };

export class ForbiddenScopeError extends Error {
    constructor(message = 'No tenés acceso a este recurso en tu alcance asignado.') {
        super(message);
        this.name = 'ForbiddenScopeError';
    }
}

/**
 * Define filtros por facultades o carreras según rol y `usuario_scopes`.
 * Administración y secretaría: sin filtro.
 * Jefe de carrera: carreras asignadas.
 * Coordinación de facultad: facultades asignadas.
 */
export async function resolverAlcanceMatriculasFacultad(
    usuarioId: string,
    roles: string[]
): Promise<AlcanceMatriculasFacultad> {
    const s = new Set((roles ?? []).map(normalizeRol));
    if (s.has('administrador general') || s.has('secretaria academica')) {
        return { tipo: 'sin_restriccion' };
    }

    if (s.has('jefe de carrera')) {
        const { rows } = await pool.query<{ carrera_id: number }>(
            `SELECT DISTINCT carrera_id
             FROM usuario_scopes
             WHERE usuario_id = $1 AND carrera_id IS NOT NULL`,
            [usuarioId]
        );
        const carreraIds = rows.map((r) => r.carrera_id).filter((n) => Number.isFinite(n));
        return { tipo: 'carreras', carreraIds };
    }

    const esCoordinacionFacultad =
        s.has('coordinador de facultad') ||
        s.has('coordinador/a de facultad') ||
        s.has('coordinadora de facultad');
    if (!esCoordinacionFacultad) {
        return { tipo: 'sin_restriccion' };
    }

    const { rows } = await pool.query<{ facultad_id: number }>(
        `SELECT DISTINCT facultad_id
         FROM usuario_scopes
         WHERE usuario_id = $1 AND facultad_id IS NOT NULL`,
        [usuarioId]
    );
    const facultadIds = rows.map((r) => r.facultad_id).filter((n) => Number.isFinite(n));
    return { tipo: 'facultades', facultadIds };
}

/** Comprueba que el plan pertenezca al alcance (facultad o carrera). */
export async function assertPlanIdEnAlcance(planId: number, alcance: AlcanceMatriculasFacultad): Promise<void> {
    if (alcance.tipo === 'sin_restriccion') return;

    if (alcance.tipo === 'carreras') {
        if (!alcance.carreraIds.length) {
            throw new ForbiddenScopeError('Tu usuario no tiene carreras asignadas.');
        }
        const { rowCount } = await pool.query(
            `SELECT 1 FROM planes_estudio pe WHERE pe.id = $1 AND pe.carrera_id = ANY($2::int[])`,
            [planId, alcance.carreraIds]
        );
        if (!rowCount) throw new ForbiddenScopeError('El plan no está en tu alcance de carrera.');
        return;
    }

    if (!alcance.facultadIds.length) {
        throw new ForbiddenScopeError('Tu usuario no tiene facultades asignadas.');
    }
    const { rowCount } = await pool.query(
        `SELECT 1
         FROM planes_estudio pe
         JOIN carreras ca ON ca.id = pe.carrera_id
         WHERE pe.id = $1 AND ca.facultad_id = ANY($2::int[])`,
        [planId, alcance.facultadIds]
    );
    if (!rowCount) throw new ForbiddenScopeError('El plan no está en tu alcance de facultad.');
}

/** Comprueba que la materia pertenezca al alcance (facultad o carrera). */
export async function assertMateriaIdEnAlcance(materiaId: number, alcance: AlcanceMatriculasFacultad): Promise<void> {
    if (alcance.tipo === 'sin_restriccion') return;

    if (alcance.tipo === 'carreras') {
        if (!alcance.carreraIds.length) {
            throw new ForbiddenScopeError('Tu usuario no tiene carreras asignadas.');
        }
        const { rowCount } = await pool.query(
            `SELECT 1
             FROM materias m
             JOIN planes_estudio pe ON pe.id = m.plan_id
             WHERE m.id = $1 AND pe.carrera_id = ANY($2::int[])`,
            [materiaId, alcance.carreraIds]
        );
        if (!rowCount) throw new ForbiddenScopeError('La materia no está en tu alcance de carrera.');
        return;
    }

    if (!alcance.facultadIds.length) {
        throw new ForbiddenScopeError('Tu usuario no tiene facultades asignadas.');
    }
    const { rowCount } = await pool.query(
        `SELECT 1
         FROM materias m
         JOIN planes_estudio pe ON pe.id = m.plan_id
         JOIN carreras ca ON ca.id = pe.carrera_id
         WHERE m.id = $1 AND ca.facultad_id = ANY($2::int[])`,
        [materiaId, alcance.facultadIds]
    );
    if (!rowCount) throw new ForbiddenScopeError('La materia no está en tu alcance de facultad.');
}

/** Comprueba que el módulo académico pertenezca al alcance (facultad o carrera). */
export async function assertModuloIdEnAlcance(moduloId: number, alcance: AlcanceMatriculasFacultad): Promise<void> {
    if (alcance.tipo === 'sin_restriccion') return;

    if (alcance.tipo === 'carreras') {
        if (!alcance.carreraIds.length) {
            throw new ForbiddenScopeError('Tu usuario no tiene carreras asignadas.');
        }
        const { rowCount } = await pool.query(
            `SELECT 1
             FROM modulos_academicos ma
             JOIN materias m ON m.id = ma.materia_id
             JOIN planes_estudio pe ON pe.id = m.plan_id
             WHERE ma.id = $1 AND pe.carrera_id = ANY($2::int[])`,
            [moduloId, alcance.carreraIds]
        );
        if (!rowCount) throw new ForbiddenScopeError('El módulo no está en tu alcance de carrera.');
        return;
    }

    if (!alcance.facultadIds.length) {
        throw new ForbiddenScopeError('Tu usuario no tiene facultades asignadas.');
    }
    const { rowCount } = await pool.query(
        `SELECT 1
         FROM modulos_academicos ma
         JOIN materias m ON m.id = ma.materia_id
         JOIN planes_estudio pe ON pe.id = m.plan_id
         JOIN carreras ca ON ca.id = pe.carrera_id
         WHERE ma.id = $1 AND ca.facultad_id = ANY($2::int[])`,
        [moduloId, alcance.facultadIds]
    );
    if (!rowCount) throw new ForbiddenScopeError('El módulo no está en tu alcance de facultad.');
}

/** Comprueba que el curso pertenezca al alcance (facultad o carrera). */
export async function assertCursoEnAlcance(cursoId: number, alcance: AlcanceMatriculasFacultad): Promise<void> {
    if (alcance.tipo === 'sin_restriccion') return;

    if (alcance.tipo === 'facultades') {
        if (!alcance.facultadIds.length) {
            throw new ForbiddenScopeError('Tu usuario no tiene facultades asignadas.');
        }
        const { rowCount } = await pool.query(
            `SELECT 1 FROM cursos c
             JOIN modulos_academicos mo ON mo.id = c.modulo_id
             JOIN materias m ON m.id = mo.materia_id
             JOIN planes_estudio pe ON pe.id = m.plan_id
             JOIN carreras ca ON ca.id = pe.carrera_id
             WHERE c.id = $1 AND ca.facultad_id = ANY($2::int[])`,
            [cursoId, alcance.facultadIds]
        );
        if (!rowCount) throw new ForbiddenScopeError('Este curso no está en tu alcance de facultad.');
        return;
    }

    if (!alcance.carreraIds.length) {
        throw new ForbiddenScopeError('Tu usuario no tiene carreras asignadas.');
    }
    const { rowCount } = await pool.query(
        `SELECT 1 FROM cursos c
         JOIN modulos_academicos mo ON mo.id = c.modulo_id
         JOIN materias m ON m.id = mo.materia_id
         JOIN planes_estudio pe ON pe.id = m.plan_id
         WHERE c.id = $1 AND pe.carrera_id = ANY($2::int[])`,
        [cursoId, alcance.carreraIds]
    );
    if (!rowCount) throw new ForbiddenScopeError('Este curso no está en tu alcance de carrera.');
}

/**
 * Indica si la carrera guardada al importar el alumno entra en el alcance del usuario
 * (misma lógica que matrículas por facultad/carrera).
 */
export async function alumnoCarreraReferenciaEnAlcance(
    referenciaCarreraId: number | null | undefined,
    alcance: AlcanceMatriculasFacultad
): Promise<boolean> {
    if (alcance.tipo === 'sin_restriccion') {
        return true;
    }
    const cid =
        referenciaCarreraId != null && Number.isFinite(Number(referenciaCarreraId))
            ? Number(referenciaCarreraId)
            : null;
    if (cid == null) {
        return false;
    }
    if (alcance.tipo === 'carreras') {
        return alcance.carreraIds.includes(cid);
    }
    if (!alcance.facultadIds.length) {
        return false;
    }
    const { rowCount } = await pool.query(
        `SELECT 1 FROM carreras WHERE id = $1 AND facultad_id = ANY($2::int[])`,
        [cid, alcance.facultadIds]
    );
    return !!rowCount;
}

/** Comprueba que la carrera exista y esté en el alcance del usuario (facultad o carrera asignada). */
export async function assertCarreraIdEnAlcance(carreraId: number, alcance: AlcanceMatriculasFacultad): Promise<void> {
    if (!Number.isFinite(carreraId) || carreraId <= 0) {
        throw new ForbiddenScopeError('Identificador de carrera inválido.');
    }
    if (alcance.tipo === 'sin_restriccion') {
        return;
    }
    if (alcance.tipo === 'carreras') {
        if (!alcance.carreraIds.includes(carreraId)) {
            throw new ForbiddenScopeError('La carrera no está en tu alcance asignado.');
        }
        return;
    }
    if (!alcance.facultadIds.length) {
        throw new ForbiddenScopeError('Tu usuario no tiene facultades asignadas.');
    }
    const { rowCount } = await pool.query(
        `SELECT 1 FROM carreras WHERE id = $1 AND facultad_id = ANY($2::int[])`,
        [carreraId, alcance.facultadIds]
    );
    if (!rowCount) {
        throw new ForbiddenScopeError('La carrera no está en tu alcance de facultad.');
    }
}

/** Comprueba que la facultad exista y sea operable según el alcance (todas / asignadas / carreras en esa facultad). */
export async function assertFacultadIdEnAlcance(facultadId: number, alcance: AlcanceMatriculasFacultad): Promise<void> {
    if (!Number.isFinite(facultadId) || facultadId <= 0) {
        throw new ForbiddenScopeError('Identificador de facultad inválido.');
    }
    const { rowCount: facExiste } = await pool.query(`SELECT 1 FROM facultades WHERE id = $1`, [facultadId]);
    if (!facExiste) {
        throw new Error('Facultad no encontrada.');
    }
    if (alcance.tipo === 'sin_restriccion') {
        return;
    }
    if (alcance.tipo === 'facultades') {
        if (!alcance.facultadIds.includes(facultadId)) {
            throw new ForbiddenScopeError('La facultad no está en tu alcance asignado.');
        }
        return;
    }
    if (!alcance.carreraIds.length) {
        throw new ForbiddenScopeError('Tu usuario no tiene carreras asignadas.');
    }
    const { rowCount } = await pool.query(
        `SELECT 1 FROM carreras WHERE facultad_id = $1 AND id = ANY($2::int[])`,
        [facultadId, alcance.carreraIds]
    );
    if (!rowCount) {
        throw new ForbiddenScopeError('No tenés carreras asignadas en esa facultad.');
    }
}
