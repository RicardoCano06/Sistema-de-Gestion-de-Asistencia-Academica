import type { PoolClient } from 'pg';
import { pool } from '../../config/database';
import type { AlcanceMatriculasFacultad } from '../../utils/alumnos-scope';
import {
    alumnoCarreraReferenciaEnAlcance,
    assertCarreraIdEnAlcance,
    assertFacultadIdEnAlcance,
    ForbiddenScopeError
} from '../../utils/alumnos-scope';

export type MatriculaIdsBusquedaAlumnos =
    | { matriculaFacultadIds?: number[]; matriculaCarreraIds?: number[] }
    | { vacio: true };

/**
 * Filtros geográficos enviados por el cliente (facultad/carrera en pantalla).
 * La validación de alcance del usuario se hace en `resolverMatriculaIdsParaBusquedaAlumnos`.
 */
export function filtrosGeoBusquedaAlumnosDesdeCliente(
    _alcance: AlcanceMatriculasFacultad,
    desdeCliente: { facultadId?: number; carreraId?: number }
): { facultadId?: number; carreraId?: number } {
    return desdeCliente;
}

/**
 * Combina el alcance del usuario con filtros opcionales de facultad/carrera (listado de alumnos).
 * `carreraId` tiene prioridad sobre `facultadId`.
 */
export async function resolverMatriculaIdsParaBusquedaAlumnos(
    alcance: AlcanceMatriculasFacultad,
    opciones?: { facultadId?: number; carreraId?: number }
): Promise<MatriculaIdsBusquedaAlumnos> {
    const fac = opciones?.facultadId;
    const car = opciones?.carreraId;
    const facOk = fac != null && Number.isFinite(fac) && fac > 0;
    const carOk = car != null && Number.isFinite(car) && car > 0;

    if (carOk) {
        const carreraId = car as number;
        if (alcance.tipo === 'sin_restriccion') {
            return { matriculaCarreraIds: [carreraId] };
        }
        if (alcance.tipo === 'carreras') {
            if (!alcance.carreraIds.includes(carreraId)) {
                throw new ForbiddenScopeError('La carrera seleccionada no está en tu alcance.');
            }
            return { matriculaCarreraIds: [carreraId] };
        }
        const { rowCount } = await pool.query(
            `SELECT 1 FROM carreras ca WHERE ca.id = $1 AND ca.facultad_id = ANY($2::int[])`,
            [carreraId, alcance.facultadIds]
        );
        if (!rowCount) {
            throw new ForbiddenScopeError('La carrera no pertenece a tu alcance de facultad.');
        }
        return { matriculaCarreraIds: [carreraId] };
    }

    if (facOk) {
        const facultadId = fac as number;
        if (alcance.tipo === 'sin_restriccion') {
            return { matriculaFacultadIds: [facultadId] };
        }
        if (alcance.tipo === 'facultades') {
            if (!alcance.facultadIds.includes(facultadId)) {
                throw new ForbiddenScopeError('La facultad seleccionada no está en tu alcance.');
            }
            return { matriculaFacultadIds: [facultadId] };
        }
        const { rows } = await pool.query<{ id: number }>(
            `SELECT id FROM carreras WHERE facultad_id = $1 AND id = ANY($2::int[])`,
            [facultadId, alcance.carreraIds]
        );
        const ids = rows.map((r) => r.id).filter((n) => Number.isFinite(n));
        if (!ids.length) {
            return { vacio: true };
        }
        return { matriculaCarreraIds: ids };
    }

    if (alcance.tipo === 'facultades') {
        return { matriculaFacultadIds: [...alcance.facultadIds] };
    }
    if (alcance.tipo === 'carreras') {
        return { matriculaCarreraIds: [...alcance.carreraIds] };
    }
    return {};
}

interface ModuloFiltro {
    anio?: number;
    mes?: number;
    materiaId?: number;
    estado?: string;
    limit?: number;
    /** Alcance coordinación de facultad (excluye carreras ajenas). */
    facultadIds?: number[];
    /** Alcance jefe/coord. de carrera. */
    carreraIds?: number[];
}

interface CrearModuloInput {
    materiaId: number;
    anio: number;
    mes: number;
    fechaInicio: string;
    fechaFin: string;
    estado?: string;
}

interface ActualizarModuloInput {
    materiaId?: number;
    anio?: number;
    mes?: number;
    fechaInicio?: string;
    fechaFin?: string;
    estado?: string;
}

interface CursoFiltro {
    moduloId?: number;
    materiaId?: number;
    docenteId?: string;
    anio?: number;
    mes?: number;
    /** Semestre del plan de estudios (`materias.semestre`, 1–10). Usado en Reportes al listar cursos. */
    semestre?: number;
    carreraId?: number;
    /** Solo cursos cuya carrera pertenezca a alguna de estas facultades (coordinación de facultad). */
    facultadIds?: number[];
    /** Solo cursos cuya carrera esté en esta lista (jefe de carrera). */
    carreraIds?: number[];
    limit?: number;
}

interface CrearCursoInput {
    moduloId: number;
    docenteId: string;
    aula?: string;
    horarioInicio?: string;
    horarioFin?: string;
    cupo?: number;
    notas?: string;
}

interface ActualizarCursoInput {
    moduloId?: number;
    docenteId?: string;
    aula?: string | null;
    horarioInicio?: string | null;
    horarioFin?: string | null;
    cupo?: number | null;
    notas?: string | null;
}

interface CopiarMatriculasResultado {
    insertados: number;
    saltados: number;
    totalOrigen: number;
}

interface BusquedaAlumnoFiltro {
    termino: string;
    limit?: number;
    offset?: number;
    /** Matrículas en carreras de estas facultades (coordinación de facultad). Vacío = no aplicar. */
    matriculaFacultadIds?: number[];
    /** Matrículas en estas carreras (jefe de carrera). Vacío = no aplicar. */
    matriculaCarreraIds?: number[];
    /** `alumnos.semestre_curricular` (1–10). Sin valor = no filtrar. */
    semestreCurricular?: number;
}

export async function listarMatriculasDeCurso(cursoId: number) {
    const { rows } = await pool.query(
        `SELECT
            mt.id,
            mt.alumno_id,
            mt.estado_academico,
            mt.porcentaje_asistencia,
            mt.faltas_acumuladas,
            mt.fecha_inscripcion,
            al.numero_documento,
            COALESCE(al.nombre_apellido, CONCAT(COALESCE(al.apellidos, ''), ', ', COALESCE(al.nombres, ''))) AS nombre_completo
         FROM matriculas mt
         JOIN alumnos al ON al.id = mt.alumno_id
         WHERE mt.curso_id = $1
         ORDER BY mt.orden_lista NULLS LAST, al.apellidos NULLS LAST, al.nombres NULLS LAST, al.nombre_apellido NULLS LAST, mt.id`,
        [cursoId]
    );
    return rows;
}

/** Cuando la carrera de referencia coincide con la del plan del curso, el semestre curricular del alumno debe coincidir con el semestre de la materia. */
export class MatriculaSemestreIncompatibleError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MatriculaSemestreIncompatibleError';
    }
}

type ClienteQuery = Pick<typeof pool, 'query'>;

interface CursoSemestrePlanCarrera {
    materiaSemestre: number;
    planCarreraId: number;
}

async function obtenerCursoSemestreYPlanCarrera(
    cursoId: number,
    ejecutor: ClienteQuery = pool
): Promise<CursoSemestrePlanCarrera | null> {
    const { rows } = await ejecutor.query<{ materia_semestre: number; plan_carrera_id: number }>(
        `SELECT m.semestre AS materia_semestre, p.carrera_id AS plan_carrera_id
         FROM cursos c
         JOIN modulos_academicos mo ON mo.id = c.modulo_id
         JOIN materias m ON m.id = mo.materia_id
         JOIN planes_estudio p ON p.id = m.plan_id
         WHERE c.id = $1`,
        [cursoId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
        materiaSemestre: Number(row.materia_semestre) || 1,
        planCarreraId: Number(row.plan_carrera_id)
    };
}

/**
 * Si el alumno tiene `referencia_carrera_id` y coincide con la carrera del plan del curso,
 * exige `semestre_curricular === semestre` de la materia del curso.
 */
export async function assertAlumnoSemestreCurricularPermiteMatriculaEnCurso(
    cursoId: number,
    alumnoId: string,
    ejecutor: ClienteQuery = pool
): Promise<void> {
    const curso = await obtenerCursoSemestreYPlanCarrera(cursoId, ejecutor);
    if (!curso) {
        throw new Error('Curso no encontrado');
    }
    const { rows } = await ejecutor.query<{
        referencia_carrera_id: number | null;
        semestre_curricular: number | null;
    }>(
        `SELECT referencia_carrera_id, semestre_curricular FROM alumnos WHERE id = $1`,
        [alumnoId]
    );
    const al = rows[0];
    if (!al) {
        throw new Error('Alumno no encontrado');
    }
    const ref = al.referencia_carrera_id != null && Number.isFinite(Number(al.referencia_carrera_id))
        ? Number(al.referencia_carrera_id)
        : null;
    const semCur = al.semestre_curricular != null && Number.isFinite(Number(al.semestre_curricular))
        ? Number(al.semestre_curricular)
        : 1;
    if (ref == null) {
        return;
    }
    if (ref !== curso.planCarreraId) {
        return;
    }
    if (semCur !== curso.materiaSemestre) {
        throw new MatriculaSemestreIncompatibleError(
            `El alumno está en semestre curricular ${semCur} para esa carrera; este curso corresponde al semestre ${curso.materiaSemestre} del plan. Usá un curso del semestre correcto o ajustá la promoción del alumno.`
        );
    }
}

export async function matricularAlumno(cursoId: number, alumnoId: string) {
    const { rows: cursoRows } = await pool.query(
        `SELECT c.id FROM cursos c WHERE c.id = $1`,
        [cursoId]
    );
    if (!cursoRows[0]) {
        throw new Error('Curso no encontrado');
    }

    const { rows: alumnoRows } = await pool.query(
        `SELECT id FROM alumnos WHERE id = $1`,
        [alumnoId]
    );
    if (!alumnoRows[0]) {
        throw new Error('Alumno no encontrado');
    }

    // Matrícula individual: sin exigir coincidencia de semestre curricular (recursantes, adeudadas, etc.).

    const { rows } = await pool.query(
        `INSERT INTO matriculas (curso_id, alumno_id, estado_academico, porcentaje_asistencia, faltas_acumuladas, justificaciones_aprobadas, fecha_inscripcion, orden_lista)
         VALUES (
            $1, $2, 'regular', 0, 0, 0, CURRENT_DATE,
            (SELECT COALESCE(MAX(orden_lista), 0) + 1 FROM matriculas WHERE curso_id = $1)
         )
         ON CONFLICT (curso_id, alumno_id) DO NOTHING
         RETURNING id, alumno_id, estado_academico, fecha_inscripcion`,
        [cursoId, alumnoId]
    );

    if (!rows[0]) {
        throw new Error('El alumno ya está matriculado en este curso');
    }

    const { rows: actualizado } = await pool.query(
        `SELECT id, alumno_id, estado_academico, porcentaje_asistencia, faltas_acumuladas, fecha_inscripcion
         FROM matriculas WHERE id = $1`,
        [rows[0].id]
    );

    return actualizado[0] ?? rows[0];
}

export async function desmatricularAlumno(cursoId: number, alumnoId: string) {
    const { rows } = await pool.query(
        `DELETE FROM matriculas WHERE curso_id = $1 AND alumno_id = $2 RETURNING id`,
        [cursoId, alumnoId]
    );
    if (!rows[0]) {
        throw new Error('Matrícula no encontrada');
    }
    return rows[0];
}

/** Misma heurística que el front (descripción del lote de alumnos). */
function extraerNumeroSemestreEnDescripcionLote(descripcion: string | null | undefined): number | null {
    if (!descripcion) return null;
    const matchDirecto = descripcion.match(/semestre\s*(\d{1,2})/i);
    if (matchDirecto) return Number(matchDirecto[1]);
    const matchInvertido = descripcion.match(/(\d{1,2})\s*°?\s*semestre/i);
    if (matchInvertido) return Number(matchInvertido[1]);
    return null;
}

/** Documento del registro (alineado con matricularDesdeLote). */
const SQL_DOC_REGISTRO_RI = `NULLIF(TRIM(COALESCE(
  ri.datos->>'numero_documento',
  ri.datos->>'ci',
  ri.datos->>'CI',
  ri.datos->>'cedula',
  ri.datos->>'Cedula',
  ri.datos->>'cedula de identidad civil',
  ri.datos->>'Cédula de identidad civil',
  ri.datos->>'cedula_identidad_civil',
  ri.datos->>'documento',
  ri.datos->>'num_documento',
  ri.datos->>'numero_doc',
  ri.datos->>'documento_numero',
  ri.datos->>'numero_c'
)), '')`;

export async function listarLotesAlumnos(carreraId?: number, semestre?: number) {
    const condiciones: string[] = [
        `l.tipo_lote = 'alumnos'`,
        `COALESCE(l.total_registros, 0) > 0`
    ];
    const valores: number[] = [];

    if (carreraId) {
        valores.push(carreraId);
        condiciones.push(`l.destino_carrera_id = $${valores.length}`);
    }

    const where = `WHERE ${condiciones.join(' AND ')}`;

    const { rows: rowsRaw } = await pool.query<{
        id: number;
        descripcion: string | null;
        total_registros: number | null;
        procesados: number | null;
        estado: string;
        ejecutado_en: string;
        destino_carrera_id: number | null;
        destino_carrera: string | null;
        cohorte_anio: number | null;
    }>(
        `SELECT
            l.id,
            l.descripcion,
            l.total_registros,
            l.procesados,
            l.estado,
            l.ejecutado_en,
            l.destino_carrera_id,
            l.destino_carrera,
            l.cohorte_anio
         FROM lotes_importacion l
         ${where}
         ORDER BY l.id DESC
         LIMIT 100`,
        valores
    );

    const semestreFiltro =
        semestre !== undefined && Number.isFinite(semestre) && semestre >= 1 && semestre <= 10
            ? Math.trunc(semestre)
            : undefined;

    const rows =
        semestreFiltro !== undefined
            ? rowsRaw.filter((r) => extraerNumeroSemestreEnDescripcionLote(r.descripcion) === semestreFiltro)
            : rowsRaw;

    const inputs: { lote_id: number; carrera_id: number; sem_etiqueta: number }[] = [];
    for (const r of rows) {
        const sem = extraerNumeroSemestreEnDescripcionLote(r.descripcion);
        if (sem != null && r.destino_carrera_id != null) {
            inputs.push({ lote_id: r.id, carrera_id: r.destino_carrera_id, sem_etiqueta: sem });
        }
    }

    const countMap = new Map<number, number>();
    if (inputs.length) {
        const parts: string[] = [];
        const params: unknown[] = [];
        for (const x of inputs) {
            const n = params.length;
            parts.push(`($${n + 1}::bigint, $${n + 2}::int, $${n + 3}::int)`);
            params.push(x.lote_id, x.carrera_id, x.sem_etiqueta);
        }
        const { rows: countRows } = await pool.query<{ lote_id: string; n: string }>(
            `WITH lotes_input (lote_id, carrera_id, sem_etiqueta) AS (VALUES ${parts.join(',')})
             SELECT li.lote_id::text, COUNT(DISTINCT al.id)::text AS n
             FROM lotes_input li
             INNER JOIN registros_importacion ri ON ri.lote_id = li.lote_id AND COALESCE(ri.valido, TRUE)
             INNER JOIN alumnos al ON BTRIM(al.numero_documento) = (${SQL_DOC_REGISTRO_RI})
               AND (al.referencia_carrera_id IS NULL OR al.referencia_carrera_id = li.carrera_id)
               AND COALESCE(al.semestre_curricular, 1) = li.sem_etiqueta
             WHERE (${SQL_DOC_REGISTRO_RI}) IS NOT NULL
             GROUP BY li.lote_id`,
            params
        );
        for (const c of countRows) {
            countMap.set(Number(c.lote_id), Number(c.n) || 0);
        }
    }

    return rows.map((r) => {
        const sem = extraerNumeroSemestreEnDescripcionLote(r.descripcion);
        const conCarrera = sem != null && r.destino_carrera_id != null;
        const loteIdNum = Number(r.id);
        return {
            ...r,
            alumnos_en_etiqueta_semestre: conCarrera ? countMap.get(loteIdNum) ?? 0 : null
        };
    });
}

export async function matricularDesdeLote(cursoId: number, loteId: number) {
    const { rows: cursoRows } = await pool.query(
        `SELECT c.id FROM cursos c WHERE c.id = $1`,
        [cursoId]
    );
    if (!cursoRows[0]) throw new Error('Curso no encontrado');

    const { rows: moduloRows } = await pool.query<{ estado: string }>(
        `SELECT ma.estado FROM cursos c JOIN modulos_academicos ma ON ma.id = c.modulo_id WHERE c.id = $1`,
        [cursoId]
    );
    if (moduloRows[0] && String(moduloRows[0].estado).toLowerCase() === 'cerrado') {
        throw new Error('No se pueden registrar matrículas en un módulo académico cerrado');
    }

    const { rows: loteRows } = await pool.query(
        `SELECT id FROM lotes_importacion WHERE id = $1 AND tipo_lote = 'alumnos'`,
        [loteId]
    );
    if (!loteRows[0]) throw new Error('Lote no encontrado o no es de tipo alumnos');

    const { rows: loteMetaRows } = await pool.query<{ descripcion: string | null }>(
        `SELECT descripcion FROM lotes_importacion WHERE id = $1`,
        [loteId]
    );
    const semestreLote = extraerNumeroSemestreEnDescripcionLote(loteMetaRows[0]?.descripcion);

    const { rows: cursoPlanPre } = await pool.query<{ materia_semestre: number }>(
        `SELECT m.semestre AS materia_semestre
         FROM cursos c
         JOIN modulos_academicos mo ON mo.id = c.modulo_id
         JOIN materias m ON m.id = mo.materia_id
         WHERE c.id = $1`,
        [cursoId]
    );
    const materiaSemestreCurso = cursoPlanPre[0] ? Number(cursoPlanPre[0].materia_semestre) || 1 : null;
    if (
        semestreLote != null &&
        materiaSemestreCurso != null &&
        semestreLote !== materiaSemestreCurso
    ) {
        throw new Error(
            `El lote corresponde al ${semestreLote}° semestre y el curso al ${materiaSemestreCurso}° semestre del plan. Elegí un lote compatible.`
        );
    }

    const { rows: registros } = await pool.query<{
        numero_documento: string | null;
        nombre_apellido: string | null;
        nombres: string | null;
        apellidos: string | null;
    }>(
        `SELECT
            NULLIF(TRIM(COALESCE(
                ri.datos->>'numero_documento',
                ri.datos->>'ci',
                ri.datos->>'CI',
                ri.datos->>'cedula',
                ri.datos->>'Cedula',
                ri.datos->>'cedula de identidad civil',
                ri.datos->>'Cédula de identidad civil',
                ri.datos->>'cedula_identidad_civil',
                ri.datos->>'documento',
                ri.datos->>'num_documento',
                ri.datos->>'numero_doc',
                ri.datos->>'documento_numero',
                ri.datos->>'numero_c'
            )), '') AS numero_documento,
            ri.datos->>'nombre_apellido' AS nombre_apellido,
            ri.datos->>'nombres'         AS nombres,
            ri.datos->>'apellidos'       AS apellidos
         FROM registros_importacion ri
         WHERE ri.lote_id = $1
         ORDER BY COALESCE(ri.fila, 0), ri.id`,
        [loteId]
    );

    if (!registros.length) throw new Error('El lote no tiene registros');

    const registrosConCI = registros.filter((r) => r.numero_documento);
    if (!registrosConCI.length) {
        throw new Error(
            'El lote no tiene números de documento (CI). Asegurate de que el Excel incluya una columna "numero_documento", "CI" o "cédula de identidad civil".'
        );
    }

    const documentosOrdenados: string[] = [];
    const ordenPorDocumento = new Map<string, number>();
    const vistos = new Set<string>();
    let orden = 0;
    for (const reg of registrosConCI) {
        const doc = reg.numero_documento!.trim();
        if (vistos.has(doc)) {
            continue;
        }
        vistos.add(doc);
        orden += 1;
        documentosOrdenados.push(doc);
        ordenPorDocumento.set(doc, orden);
    }

    const documentos = documentosOrdenados;

    const { rows: yaExistentes } = await pool.query<{ id: string; numero_documento: string }>(
        `SELECT id, numero_documento FROM alumnos WHERE numero_documento = ANY($1::varchar[])`,
        [documentos]
    );
    const docsExistentes = new Set(yaExistentes.map((a) => a.numero_documento));

    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');

        const alumnosFaltantes = registrosConCI.filter((r) => !docsExistentes.has(r.numero_documento!));

        if (alumnosFaltantes.length) {
            const fDocs: string[] = [];
            const fNombres: (string | null)[] = [];
            const fApellidos: (string | null)[] = [];

            for (const reg of alumnosFaltantes) {
                const apellidos = (reg.apellidos ?? '').trim();
                const nombres = (reg.nombres ?? '').trim();
                let nombreApellido = (reg.nombre_apellido ?? '').trim();
                if (!nombreApellido) {
                    nombreApellido = [apellidos, nombres].filter(Boolean).join(', ') || `Alumno ${reg.numero_documento}`;
                }
                fDocs.push(reg.numero_documento!);
                fNombres.push(nombreApellido);
                fApellidos.push(apellidos || null);
            }

            await cliente.query(
                `INSERT INTO alumnos (numero_documento, nombre_apellido, apellidos, nombres)
                 SELECT u.doc, u.nombre, u.apellido, u.nomb
                 FROM unnest(
                     $1::varchar[],
                     $2::varchar[],
                     $3::varchar[],
                     $4::varchar[]
                 ) AS u(doc, nombre, apellido, nomb)
                 ON CONFLICT (numero_documento) DO UPDATE SET
                     apellidos = COALESCE(EXCLUDED.apellidos, alumnos.apellidos),
                     nombres   = COALESCE(EXCLUDED.nombres,   alumnos.nombres)`,
                [fDocs, fNombres, fApellidos, alumnosFaltantes.map((r) => (r.nombres ?? '').trim() || null)]
            );
        }

        const { rows: todosLosAlumnos } = await cliente.query<{ id: string; numero_documento: string }>(
            `SELECT al.id, al.numero_documento
             FROM unnest($1::varchar[]) WITH ORDINALITY AS u(doc, ord)
             JOIN alumnos al ON al.numero_documento = u.doc
             ORDER BY u.ord`,
            [documentosOrdenados]
        );

        if (!todosLosAlumnos.length) {
            await cliente.query('ROLLBACK');
            throw new Error('No se pudieron registrar los alumnos del lote. Verificá los datos del Excel.');
        }

        const alumnoIds = todosLosAlumnos.map((a) => a.id);
        const ordenPorAlumnoId = new Map<string, number>();
        for (const al of todosLosAlumnos) {
            const ord = ordenPorDocumento.get(al.numero_documento);
            if (ord != null) {
                ordenPorAlumnoId.set(al.id, ord);
            }
        }

        const { rows: cursoPlan } = await cliente.query<{ materia_semestre: number; plan_carrera_id: number }>(
            `SELECT m.semestre AS materia_semestre, p.carrera_id AS plan_carrera_id
             FROM cursos c
             JOIN modulos_academicos mo ON mo.id = c.modulo_id
             JOIN materias m ON m.id = mo.materia_id
             JOIN planes_estudio p ON p.id = m.plan_id
             WHERE c.id = $1`,
            [cursoId]
        );

        let elegibles = alumnoIds;
        let omitidosSemestre = 0;

        if (cursoPlan[0]) {
            const { rows: alRows } = await cliente.query<{
                id: string;
                referencia_carrera_id: number | null;
                semestre_curricular: number | null;
            }>(
                `SELECT id, referencia_carrera_id, semestre_curricular FROM alumnos WHERE id = ANY($1::uuid[])`,
                [alumnoIds]
            );
            const planCarreraId = Number(cursoPlan[0].plan_carrera_id);
            const materiaSemestre = Number(cursoPlan[0].materia_semestre) || 1;
            const bloqueados = new Set<string>();

            for (const al of alRows) {
                const ref = al.referencia_carrera_id != null && Number.isFinite(Number(al.referencia_carrera_id))
                    ? Number(al.referencia_carrera_id)
                    : null;
                if (ref == null || ref !== planCarreraId) continue;
                const semCur = al.semestre_curricular != null && Number.isFinite(Number(al.semestre_curricular))
                    ? Number(al.semestre_curricular)
                    : 1;
                if (semCur !== materiaSemestre) {
                    bloqueados.add(al.id);
                }
            }

            if (bloqueados.size) {
                elegibles = alumnoIds.filter((id) => !bloqueados.has(id));
                omitidosSemestre = bloqueados.size;
            }
        }

        let insertados = 0;
        let saltados = 0;

        if (elegibles.length) {
            const idsOrdenados = elegibles
                .slice()
                .sort((a, b) => (ordenPorAlumnoId.get(a) ?? Number.MAX_SAFE_INTEGER) - (ordenPorAlumnoId.get(b) ?? Number.MAX_SAFE_INTEGER));
            const ordenes = idsOrdenados.map((id) => ordenPorAlumnoId.get(id) ?? 0);
            const { rowCount } = await cliente.query(
                `INSERT INTO matriculas (curso_id, alumno_id, estado_academico, porcentaje_asistencia, faltas_acumuladas, justificaciones_aprobadas, fecha_inscripcion, orden_lista)
                 SELECT $1::int, u.aid::uuid, 'regular', 0, 0, 0, CURRENT_DATE, u.ord::int
                 FROM unnest($2::uuid[], $3::int[]) AS u(aid, ord)
                 ON CONFLICT (curso_id, alumno_id) DO NOTHING`,
                [cursoId, idsOrdenados, ordenes]
            );
            insertados = rowCount ?? 0;
            saltados = elegibles.length - insertados;
        }

        await cliente.query('COMMIT');

        return {
            insertados,
            saltados,
            omitidosSemestre,
            totalLote: registros.length,
            encontrados: todosLosAlumnos.length
        };
    } catch (error) {
        try { await cliente.query('ROLLBACK'); } catch (_e) { /* already rolled back or committed */ }
        throw error;
    } finally {
        cliente.release();
    }
}

function normalizeLimit(valor?: number, max = 2_000_000_000) {
    if (typeof valor !== 'number' || Number.isNaN(valor)) return 2_000_000_000;
    return Math.min(Math.max(valor, 1), max);
}

export async function listarModulos(filtro: ModuloFiltro = {}) {
    const condiciones: string[] = [];
    const valores: Array<string | number | number[]> = [];

    if (typeof filtro.anio === 'number') {
        valores.push(filtro.anio);
        condiciones.push(`ma.anio = $${valores.length}`);
    }

    if (typeof filtro.mes === 'number') {
        valores.push(filtro.mes);
        condiciones.push(`ma.mes = $${valores.length}`);
    }

    if (typeof filtro.materiaId === 'number') {
        valores.push(filtro.materiaId);
        condiciones.push(`ma.materia_id = $${valores.length}`);
    }

    if (filtro.estado) {
        valores.push(filtro.estado);
        condiciones.push(`ma.estado = $${valores.length}`);
    }

    const carreraIdsFiltro = filtro.carreraIds?.filter((n) => Number.isFinite(n)) ?? [];
    const facultadIdsFiltro = filtro.facultadIds?.filter((n) => Number.isFinite(n)) ?? [];
    if (carreraIdsFiltro.length > 0) {
        valores.push(carreraIdsFiltro);
        condiciones.push(`c.id = ANY($${valores.length}::int[])`);
    } else if (facultadIdsFiltro.length > 0) {
        valores.push(facultadIdsFiltro);
        condiciones.push(`c.facultad_id = ANY($${valores.length}::int[])`);
    }

    const limit = normalizeLimit(filtro.limit);
    valores.push(limit);

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const { rows } = await pool.query(
        `SELECT
            ma.id,
            ma.materia_id,
            ma.anio,
            ma.mes,
            ma.fecha_inicio,
            ma.fecha_fin,
            ma.estado,
            m.nombre AS materia,
            m.codigo,
            p.nombre AS plan,
            c.nombre AS carrera,
            c.id AS carrera_id
         FROM modulos_academicos ma
         JOIN materias m ON m.id = ma.materia_id
         JOIN planes_estudio p ON p.id = m.plan_id
         JOIN carreras c ON c.id = p.carrera_id
         ${where}
         ORDER BY ma.anio DESC, ma.mes DESC, ma.id DESC
         LIMIT $${valores.length}`,
        valores
    );

    return rows;
}

function toIsoDateOnly(valor: string | Date | null | undefined): string | null {
    if (valor == null) return null;
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
        return valor.toISOString().slice(0, 10);
    }
    const s = String(valor).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function validarFechasModuloDentroDelMes(
    anio: number,
    mes: number,
    fechaInicio: string,
    fechaFin: string
): void {
    if (mes < 1 || mes > 12) {
        throw new Error('El mes debe estar entre 1 y 12');
    }
    const ultimoDia = new Date(anio, mes, 0).getDate();
    const pref = `${anio}-${String(mes).padStart(2, '0')}-`;
    const min = `${pref}01`;
    const max = `${pref}${String(ultimoDia).padStart(2, '0')}`;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaFin)) {
        throw new Error('Las fechas deben tener formato AAAA-MM-DD');
    }
    if (fechaInicio < min || fechaInicio > max) {
        throw new Error(`La fecha de inicio debe estar dentro del mes ${mes} del año ${anio}`);
    }
    if (fechaFin < min || fechaFin > max) {
        throw new Error(`La fecha de fin debe estar dentro del mes ${mes} del año ${anio}`);
    }
    if (fechaFin < fechaInicio) {
        throw new Error('La fecha de fin no puede ser anterior a la de inicio');
    }
}

export async function crearModulo(input: CrearModuloInput) {
    if (!input.materiaId) {
        throw new Error('Debes seleccionar una materia para crear el módulo');
    }
    if (input.mes < 1 || input.mes > 12) {
        throw new Error('El mes debe estar entre 1 y 12');
    }
    validarFechasModuloDentroDelMes(input.anio, input.mes, input.fechaInicio, input.fechaFin);

    const { rows: existeRows } = await pool.query(
        `SELECT id
         FROM modulos_academicos
         WHERE materia_id = $1 AND anio = $2 AND mes = $3`,
        [input.materiaId, input.anio, input.mes]
    );
    if (existeRows[0]) {
        throw new Error('Ya existe un módulo para esa materia en el mismo año y mes');
    }

    const { rows } = await pool.query(
        `WITH inserted AS (
            INSERT INTO modulos_academicos (materia_id, anio, mes, fecha_inicio, fecha_fin, estado)
            VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'planificado'))
            RETURNING id, materia_id, anio, mes, fecha_inicio, fecha_fin, estado
         )
         SELECT ins.*, m.nombre AS materia, m.codigo
         FROM inserted ins
         JOIN materias m ON m.id = ins.materia_id`,
        [
            input.materiaId,
            input.anio,
            input.mes,
            input.fechaInicio,
            input.fechaFin,
            input.estado ?? null
        ]
    );

    return rows[0];
}

export async function actualizarModulo(moduloId: number, input: ActualizarModuloInput) {
    const setFragments: string[] = [];
    const valores: Array<string | number> = [];

    const { rows: moduloActual } = await pool.query(
        'SELECT materia_id, anio, mes FROM modulos_academicos WHERE id = $1',
        [moduloId]
    );
    if (!moduloActual[0]) {
        throw new Error('Módulo no encontrado');
    }
    const cur = moduloActual[0];

    if (typeof input.materiaId === 'number') {
        if (input.materiaId !== cur.materia_id) {
            const { rows: cursos } = await pool.query(
                'SELECT id FROM cursos WHERE modulo_id = $1 LIMIT 1',
                [moduloId]
            );
            if (cursos.length > 0) {
                throw new Error('No se puede cambiar la materia de un módulo que ya tiene cursos asignados.');
            }
        }
        valores.push(input.materiaId);
        setFragments.push(`materia_id = $${valores.length}`);
    }

    if (typeof input.anio === 'number') {
        if (input.anio !== cur.anio) {
            const { rows: cursos } = await pool.query(
                'SELECT id FROM cursos WHERE modulo_id = $1 LIMIT 1',
                [moduloId]
            );
            if (cursos.length > 0) {
                throw new Error('No se puede cambiar el año de un módulo que ya tiene cursos asignados.');
            }
        }
        valores.push(input.anio);
        setFragments.push(`anio = $${valores.length}`);
    }

    if (typeof input.mes === 'number') {
        if (input.mes < 1 || input.mes > 12) {
            throw new Error('El mes debe estar entre 1 y 12');
        }
        if (input.mes !== cur.mes) {
            const { rows: cursos } = await pool.query(
                'SELECT id FROM cursos WHERE modulo_id = $1 LIMIT 1',
                [moduloId]
            );
            if (cursos.length > 0) {
                throw new Error('No se puede cambiar el mes de un módulo que ya tiene cursos asignados.');
            }
        }
        valores.push(input.mes);
        setFragments.push(`mes = $${valores.length}`);
    }

    if (input.fechaInicio) {
        valores.push(input.fechaInicio);
        setFragments.push(`fecha_inicio = $${valores.length}`);
    }

    if (input.fechaFin) {
        valores.push(input.fechaFin);
        setFragments.push(`fecha_fin = $${valores.length}`);
    }

    if (input.estado) {
        valores.push(input.estado);
        setFragments.push(`estado = $${valores.length}`);
    }

    if (!setFragments.length) {
        throw new Error('No hay campos para actualizar');
    }

    const { rows: baseRows } = await pool.query<{
        id: number;
        materia_id: number;
        anio: number;
        mes: number;
        fecha_inicio: string | Date;
        fecha_fin: string | Date;
    }>(
        `SELECT id, materia_id, anio, mes, fecha_inicio, fecha_fin FROM modulos_academicos WHERE id = $1`,
        [moduloId]
    );
    const base = baseRows[0];
    if (!base) {
        throw new Error('Módulo académico no encontrado');
    }

    const materiaIdNuevo = typeof input.materiaId === 'number' ? input.materiaId : base.materia_id;
    const anioNuevo = typeof input.anio === 'number' ? input.anio : base.anio;
    const mesNuevo = typeof input.mes === 'number' ? input.mes : base.mes;
    const fechaInicioNueva = toIsoDateOnly(input.fechaInicio) ?? toIsoDateOnly(base.fecha_inicio);
    const fechaFinNueva = toIsoDateOnly(input.fechaFin) ?? toIsoDateOnly(base.fecha_fin);
    if (!fechaInicioNueva || !fechaFinNueva) {
        throw new Error('Las fechas de inicio y fin son obligatorias');
    }
    validarFechasModuloDentroDelMes(anioNuevo, mesNuevo, fechaInicioNueva, fechaFinNueva);

    const { rows: existeRows } = await pool.query(
        `SELECT id
         FROM modulos_academicos
         WHERE materia_id = $1 AND anio = $2 AND mes = $3 AND id <> $4`,
        [materiaIdNuevo, anioNuevo, mesNuevo, moduloId]
    );
    if (existeRows[0]) {
        throw new Error('Ya existe un módulo para esa materia en el mismo año y mes');
    }

    valores.push(moduloId);
    const { rows } = await pool.query(
        `UPDATE modulos_academicos
         SET ${setFragments.join(', ')}
         WHERE id = $${valores.length}
         RETURNING id, materia_id, anio, mes, fecha_inicio, fecha_fin, estado`,
        valores
    );

    return rows[0];
}

export async function eliminarModulo(moduloId: number) {
    const { rows: cursosRows } = await pool.query(
        `SELECT COUNT(*) AS total FROM cursos WHERE modulo_id = $1`,
        [moduloId]
    );
    const totalCursos = Number(cursosRows[0]?.total ?? 0);
    if (totalCursos > 0) {
        throw new Error('No se puede eliminar un módulo con cursos asociados');
    }

    const { rows } = await pool.query(
        `DELETE FROM modulos_academicos WHERE id = $1 RETURNING id`,
        [moduloId]
    );

    if (!rows[0]) {
        throw new Error('Módulo académico no encontrado');
    }

    return rows[0];
}

export async function listarCursos(filtro: CursoFiltro = {}) {
    const condiciones: string[] = [];
    const valores: Array<string | number | number[]> = [];

    if (filtro.moduloId !== undefined) {
        valores.push(filtro.moduloId);
        condiciones.push(`c.modulo_id = $${valores.length}`);
    }

    if (filtro.materiaId !== undefined) {
        valores.push(filtro.materiaId);
        condiciones.push(`m.id = $${valores.length}`);
    }

    if (filtro.docenteId) {
        valores.push(filtro.docenteId);
        condiciones.push(`c.docente_id = $${valores.length}`);
    }

    if (filtro.anio !== undefined) {
        valores.push(filtro.anio);
        condiciones.push(`ma.anio = $${valores.length}`);
    }

    if (filtro.mes !== undefined) {
        valores.push(filtro.mes);
        condiciones.push(`ma.mes = $${valores.length}`);
    }

    if (filtro.carreraId !== undefined) {
        valores.push(filtro.carreraId);
        condiciones.push(`crr.id = $${valores.length}`);
    }

    if (filtro.carreraIds && filtro.carreraIds.length > 0) {
        valores.push(filtro.carreraIds);
        condiciones.push(`crr.id = ANY($${valores.length}::int[])`);
    }

    if (filtro.facultadIds && filtro.facultadIds.length > 0) {
        valores.push(filtro.facultadIds);
        condiciones.push(`f.id = ANY($${valores.length}::int[])`);
    }

    if (filtro.semestre !== undefined) {
        valores.push(filtro.semestre);
        condiciones.push(`m.semestre = $${valores.length}`);
    }

    const limit = normalizeLimit(filtro.limit);
    valores.push(limit);

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const { rows } = await pool.query(
        `SELECT
            c.id,
            c.modulo_id,
            c.docente_id,
            c.aula,
            c.horario_inicio,
            c.horario_fin,
            c.cupo,
            c.notas,
            ma.anio,
            ma.mes,
            ma.fecha_inicio,
            ma.fecha_fin,
            ma.estado AS estado_modulo,
            m.nombre AS materia,
            m.codigo AS codigo_materia,
            crr.id AS carrera_id,
            crr.nombre AS carrera,
            f.id AS facultad_id,
            f.nombre AS facultad,
            d.usuario_id AS docente_usuario_id,
            CONCAT(u.nombres, ' ', u.apellidos) AS docente,
            COALESCE(sub_m.total, 0)::int AS inscriptos
         FROM cursos c
         JOIN modulos_academicos ma ON ma.id = c.modulo_id
         JOIN materias m ON m.id = ma.materia_id
         JOIN planes_estudio p ON p.id = m.plan_id
         JOIN carreras crr ON crr.id = p.carrera_id
         JOIN facultades f ON f.id = crr.facultad_id
         JOIN docentes d ON d.id = c.docente_id
         JOIN usuarios u ON u.id = d.usuario_id
         LEFT JOIN (
            SELECT curso_id, COUNT(*)::int AS total
            FROM matriculas
            GROUP BY curso_id
         ) sub_m ON sub_m.curso_id = c.id
         ${where}
         ORDER BY ma.anio DESC, ma.mes DESC, c.id DESC
         LIMIT $${valores.length}`,
        valores
    );

    return rows;
}

export async function crearCurso(input: CrearCursoInput) {
    const { rows: moduloRows } = await pool.query(
        `SELECT id, estado FROM modulos_academicos WHERE id = $1`,
        [input.moduloId]
    );
    const modulo = moduloRows[0];
    if (!modulo) {
        throw new Error('Módulo académico no encontrado');
    }

    if (String(modulo.estado).toLowerCase() === 'cerrado') {
        throw new Error('No se pueden crear cursos en un módulo académico cerrado');
    }

    // Verificar que el modulo no tenga ya un curso asignado
    const { rows: existente } = await pool.query(
        `SELECT id FROM cursos WHERE modulo_id = $1 LIMIT 1`,
        [input.moduloId]
    );
    if (existente.length > 0) {
        throw new Error('Este módulo académico ya tiene un curso asignado. Cada módulo solo puede tener un curso.');
    }

    // Acepta tanto docente.id (tabla docentes) como usuario_id (tabla usuarios)
    const { rows: docenteRows } = await pool.query(
        `SELECT id FROM docentes WHERE id = $1 OR usuario_id = $1`,
        [input.docenteId]
    );
    if (!docenteRows[0]) {
        throw new Error('Docente no encontrado. El usuario debe tener un perfil de docente vinculado.');
    }
    const resolvedDocenteId: string = docenteRows[0].id;

    const { rows } = await pool.query(
        `INSERT INTO cursos (modulo_id, docente_id, aula, horario_inicio, horario_fin, cupo, notas)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, modulo_id, docente_id, aula, horario_inicio, horario_fin, cupo, notas`,
        [
            input.moduloId,
            resolvedDocenteId,
            input.aula ?? null,
            input.horarioInicio ?? null,
            input.horarioFin ?? null,
            input.cupo ?? null,
            input.notas ?? null
        ]
    );

    return rows[0];
}

export async function actualizarCurso(cursoId: number, input: ActualizarCursoInput) {
    const { rows: baseRows } = await pool.query(
        `SELECT c.id, c.modulo_id, ma.estado AS estado_modulo
         FROM cursos c
         JOIN modulos_academicos ma ON ma.id = c.modulo_id
         WHERE c.id = $1`,
        [cursoId]
    );
    const base = baseRows[0];
    if (!base) {
        throw new Error('Curso no encontrado');
    }

    if (String(base.estado_modulo).toLowerCase() === 'cerrado') {
        throw new Error('No se pueden editar cursos en un módulo académico cerrado');
    }

    const setFragments: string[] = [];
    const valores: Array<string | number | null> = [];

    if (typeof input.moduloId === 'number') {
        // Verificar que el curso no tenga planilla asignada antes de cambiar de modulo
        if (input.moduloId !== base.modulo_id) {
            const { rows: matriculas } = await pool.query(
                'SELECT id FROM matriculas WHERE curso_id = $1 LIMIT 1',
                [cursoId]
            );
            if (matriculas.length > 0) {
                throw new Error('No se puede cambiar el módulo de un curso que ya tiene planilla asignada.');
            }
        }
        const { rows: moduloRows } = await pool.query(
            `SELECT id, estado FROM modulos_academicos WHERE id = $1`,
            [input.moduloId]
        );
        const moduloNuevo = moduloRows[0];
        if (!moduloNuevo) {
            throw new Error('Módulo académico destino no encontrado');
        }
        if (String(moduloNuevo.estado).toLowerCase() === 'cerrado') {
            throw new Error('No se pueden mover cursos a un módulo cerrado');
        }
        // Verificar que el nuevo modulo no tenga ya otro curso distinto
        const { rows: cursoExistente } = await pool.query(
            `SELECT id FROM cursos WHERE modulo_id = $1 AND id != $2 LIMIT 1`,
            [input.moduloId, cursoId]
        );
        if (cursoExistente.length > 0) {
            throw new Error('El módulo académico destino ya tiene un curso asignado. Cada módulo solo puede tener un curso.');
        }
        valores.push(input.moduloId);
        setFragments.push(`modulo_id = $${valores.length}`);
    }

    if (input.docenteId) {
        // Acepta tanto docente.id (tabla docentes) como usuario_id (tabla usuarios)
        const { rows: docenteRows } = await pool.query(
            `SELECT id FROM docentes WHERE id = $1 OR usuario_id = $1`,
            [input.docenteId]
        );
        if (!docenteRows[0]) {
            throw new Error('Docente no encontrado');
        }
        const resolvedDocenteId: string = docenteRows[0].id;
        valores.push(resolvedDocenteId);
        setFragments.push(`docente_id = $${valores.length}`);
    }

    if (input.aula !== undefined) {
        valores.push(input.aula);
        setFragments.push(`aula = $${valores.length}`);
    }

    if (input.horarioInicio !== undefined) {
        valores.push(input.horarioInicio);
        setFragments.push(`horario_inicio = $${valores.length}`);
    }

    if (input.horarioFin !== undefined) {
        valores.push(input.horarioFin);
        setFragments.push(`horario_fin = $${valores.length}`);
    }

    if (input.cupo !== undefined) {
        valores.push(input.cupo);
        setFragments.push(`cupo = $${valores.length}`);
    }

    if (input.notas !== undefined) {
        valores.push(input.notas);
        setFragments.push(`notas = $${valores.length}`);
    }

    if (!setFragments.length) {
        throw new Error('No hay campos para actualizar');
    }

    valores.push(cursoId);
    const { rows } = await pool.query(
        `UPDATE cursos
         SET ${setFragments.join(', ')}
         WHERE id = $${valores.length}
         RETURNING id, modulo_id, docente_id, aula, horario_inicio, horario_fin, cupo, notas`,
        valores
    );

    return rows[0];
}

export async function eliminarCurso(cursoId: number) {
    const { rows: [{ count: asistencias }] } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM asistencias a
         INNER JOIN sesiones_clase sc ON sc.id = a.sesion_id
         WHERE sc.curso_id = $1`,
        [cursoId]
    );
    if (parseInt(asistencias, 10) > 0) {
        throw new Error('No se puede eliminar el curso porque tiene asistencias registradas.');
    }

    const { rows: [{ count: matriculas }] } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM matriculas WHERE curso_id = $1`,
        [cursoId]
    );
    if (parseInt(matriculas, 10) > 0) {
        throw new Error('No se puede eliminar el curso porque tiene alumnos matriculados.');
    }

    const { rows: [{ count: cronograma }] } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM curso_cronograma_semanas WHERE curso_id = $1`,
        [cursoId]
    );
    if (parseInt(cronograma, 10) > 0) {
        throw new Error('No se puede eliminar el curso porque tiene contenido de cronograma de cátedra.');
    }

    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');

        // Borrar en cascada: asistencias → justificaciones → sesiones → matrículas → curso
        await cliente.query(
            `DELETE FROM asistencias WHERE sesion_id IN (SELECT id FROM sesiones_clase WHERE curso_id = $1)`,
            [cursoId]
        );
        await cliente.query(`DELETE FROM sesiones_clase WHERE curso_id = $1`, [cursoId]);
        await cliente.query(`DELETE FROM matriculas WHERE curso_id = $1`, [cursoId]);

        const { rows } = await cliente.query(
            `DELETE FROM cursos WHERE id = $1 RETURNING id`,
            [cursoId]
        );

        if (!rows[0]) {
            await cliente.query('ROLLBACK');
            throw new Error('Curso no encontrado');
        }

        await cliente.query('COMMIT');
        return rows[0];
    } catch (error) {
        await cliente.query('ROLLBACK');
        throw error;
    } finally {
        cliente.release();
    }
}

export async function copiarMatriculasDesdeCurso(
    cursoDestinoId: number,
    cursoOrigenId: number
): Promise<CopiarMatriculasResultado> {
    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');

        const { rows: origenRows } = await cliente.query(
            `SELECT COUNT(*) AS total FROM cursos WHERE id = $1`,
            [cursoOrigenId]
        );
        if (!origenRows[0] || Number(origenRows[0].total) === 0) {
            throw new Error('Curso origen no encontrado');
        }

        const { rows: destinoRows } = await cliente.query(
            `SELECT COUNT(*) AS total FROM cursos WHERE id = $1`,
            [cursoDestinoId]
        );
        if (!destinoRows[0] || Number(destinoRows[0].total) === 0) {
            throw new Error('Curso destino no encontrado');
        }

        const { rows: totalOrigenRows } = await cliente.query(
            `SELECT COUNT(*) AS total FROM matriculas WHERE curso_id = $1`,
            [cursoOrigenId]
        );
        const totalOrigen = Number(totalOrigenRows[0]?.total ?? 0);

        const { rows: insertados } = await cliente.query(
            `INSERT INTO matriculas (curso_id, alumno_id, estado_academico, porcentaje_asistencia, faltas_acumuladas, justificaciones_aprobadas, fecha_inscripcion, orden_lista)
             SELECT $1, m.alumno_id, 'regular', 0, 0, 0, CURRENT_DATE, m.orden_lista
             FROM matriculas m
             JOIN alumnos al ON al.id = m.alumno_id
             CROSS JOIN LATERAL (
                 SELECT mat.semestre AS ms, pl.carrera_id AS cid
                 FROM cursos cu
                 JOIN modulos_academicos mo ON mo.id = cu.modulo_id
                 JOIN materias mat ON mat.id = mo.materia_id
                 JOIN planes_estudio pl ON pl.id = mat.plan_id
                 WHERE cu.id = $1
                 LIMIT 1
             ) dest
             CROSS JOIN LATERAL (
                 SELECT MIN(al2.cohorte_anio) AS cohorte_anio
                 FROM matriculas m2
                 JOIN alumnos al2 ON al2.id = m2.alumno_id
                 WHERE m2.curso_id = $2 AND al2.cohorte_anio IS NOT NULL
                 HAVING MIN(al2.cohorte_anio) = MAX(al2.cohorte_anio)
             ) origen_cohorte
             WHERE m.curso_id = $2
               AND NOT EXISTS (
                   SELECT 1 FROM matriculas mt WHERE mt.curso_id = $1 AND mt.alumno_id = m.alumno_id
               )
               AND (
                   al.referencia_carrera_id IS NULL
                   OR al.referencia_carrera_id <> dest.cid
                   OR COALESCE(al.semestre_curricular, 1) = dest.ms
               )
               AND (
                   origen_cohorte.cohorte_anio IS NULL
                   OR al.cohorte_anio IS NULL
                   OR al.cohorte_anio = origen_cohorte.cohorte_anio
               )
             ORDER BY m.orden_lista NULLS LAST, m.id
              RETURNING id`,
             [cursoDestinoId, cursoOrigenId]
         );

        await cliente.query('COMMIT');

        return {
            insertados: insertados.length,
            saltados: Math.max(totalOrigen - insertados.length, 0),
            totalOrigen
        };
    } catch (error) {
        await cliente.query('ROLLBACK');
        throw error;
    } finally {
        cliente.release();
    }
}

/** Palabras del término (espacios o comas): "acosta laura" y "acosta, laura" buscan igual. */
function tokensBusquedaAlumno(termino: string): string[] {
    return termino
        .split(/[\s,;]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
}

function condicionTokenBusquedaAlumno(paramIndex: number): string {
    return `(
            al.numero_documento ILIKE $${paramIndex}
            OR al.nombres ILIKE $${paramIndex}
            OR al.apellidos ILIKE $${paramIndex}
            OR COALESCE(al.nombre_apellido, '') ILIKE $${paramIndex}
            OR CONCAT_WS(' ', TRIM(COALESCE(al.apellidos, '')), TRIM(COALESCE(al.nombres, ''))) ILIKE $${paramIndex}
        )`;
}

export async function actualizarAlumno(
    alumnoId: string,
    input: { nombres?: string; apellidos?: string; numero_documento?: string }
) {
    const alumnoIdSanitizado = String(alumnoId ?? '').trim();
    if (!alumnoIdSanitizado) throw new Error('ID de alumno inválido');

    const cliente = await pool.connect();
    try {
        const { rows: antesRows } = await cliente.query(
            `SELECT id, numero_documento, nombres, apellidos, nombre_apellido,
                    semestre_curricular, referencia_carrera_id, cohorte_anio
             FROM alumnos WHERE id = $1`,
            [alumnoIdSanitizado]
        );
        if (!antesRows[0]) throw new Error('Alumno no encontrado');

        const antes = antesRows[0];

        const nuevosNombres = input.nombres != null ? String(input.nombres).trim() : antes.nombres;
        const nuevosApellidos = input.apellidos != null ? String(input.apellidos).trim() : antes.apellidos;
        const nuevoDoc = input.numero_documento != null ? String(input.numero_documento).trim() : antes.numero_documento;

        if (input.numero_documento != null && nuevoDoc !== antes.numero_documento) {
            const { rows: dup } = await cliente.query(
                `SELECT id FROM alumnos WHERE numero_documento = $1 AND id <> $2 LIMIT 1`,
                [nuevoDoc, alumnoIdSanitizado]
            );
            if (dup.length > 0) {
                throw new Error('El número de documento ya está registrado en otro alumno.');
            }
        }

        const nombreApellido = [nuevosApellidos, nuevosNombres].filter(Boolean).join(', ') || `Alumno ${nuevoDoc}`;

        const { rows: actualizado } = await cliente.query(
            `UPDATE alumnos SET
                nombres = $1,
                apellidos = $2,
                numero_documento = $3,
                nombre_apellido = $4
             WHERE id = $5
             RETURNING id, numero_documento, nombres, apellidos, nombre_apellido,
                       semestre_curricular, referencia_carrera_id, cohorte_anio`,
            [nuevosNombres || null, nuevosApellidos || null, nuevoDoc, nombreApellido, alumnoIdSanitizado]
        );

        return { alumno: actualizado[0] ?? antes, antes };
    } finally {
        cliente.release();
    }
}

export async function buscarAlumnos(filtro: BusquedaAlumnoFiltro) {
    const termino = filtro.termino.trim();
    const limit = Math.min(Math.max(filtro.limit ?? 30, 1), 500);
    const offset = Math.max(0, filtro.offset ?? 0);

    const valores: Array<string | number | number[]> = [];
    const condiciones: string[] = [];

    const tokens = tokensBusquedaAlumno(termino);
    for (const token of tokens) {
        valores.push(`%${token}%`);
        condiciones.push(condicionTokenBusquedaAlumno(valores.length));
    }

    const facIds = filtro.matriculaFacultadIds?.filter((n) => Number.isFinite(n)) ?? [];
    const carIds = filtro.matriculaCarreraIds?.filter((n) => Number.isFinite(n)) ?? [];

    const tieneFiltroMatricula = facIds.length > 0 || carIds.length > 0;

    if (tieneFiltroMatricula) {
        const innerParts: string[] = ['mf.alumno_id = al.id'];
        if (facIds.length > 0) {
            valores.push(facIds);
            innerParts.push(`caf.facultad_id = ANY($${valores.length}::int[])`);
        }
        if (carIds.length > 0) {
            valores.push(carIds);
            innerParts.push(`pf.carrera_id = ANY($${valores.length}::int[])`);
        }
        const innerWhere = innerParts.join(' AND ');
        const existeMatricula = `EXISTS (
            SELECT 1
            FROM matriculas mf
            JOIN cursos cf ON cf.id = mf.curso_id
            JOIN modulos_academicos mof ON mof.id = cf.modulo_id
            JOIN materias mf2 ON mf2.id = mof.materia_id
            JOIN planes_estudio pf ON pf.id = mf2.plan_id
            JOIN carreras caf ON caf.id = pf.carrera_id
            WHERE ${innerWhere}
        )`;
        const refParts: string[] = [];
        if (carIds.length > 0) {
            valores.push(carIds);
            refParts.push(`al.referencia_carrera_id = ANY($${valores.length}::int[])`);
        }
        if (facIds.length > 0) {
            valores.push(facIds);
            refParts.push(
                `EXISTS (SELECT 1 FROM carreras cr WHERE cr.id = al.referencia_carrera_id AND cr.facultad_id = ANY($${valores.length}::int[]))`
            );
        }
        const refMatch = refParts.length ? refParts.join(' AND ') : 'FALSE';
        condiciones.push(`((${existeMatricula}) OR (${refMatch}))`);
    }

    const semFiltro = filtro.semestreCurricular;
    if (semFiltro != null && Number.isFinite(semFiltro)) {
        const sem = Math.trunc(semFiltro);
        if (sem >= 1 && sem <= 10) {
            valores.push(sem);
            condiciones.push(`COALESCE(al.semestre_curricular, 1) = $${valores.length}`);
        }
    }

    const whereClause = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const limitIdx = valores.length + 1;
    const offsetIdx = valores.length + 2;
    valores.push(limit + 1);
    valores.push(offset);

    const { rows } = await pool.query(
        `SELECT
            al.id,
            al.numero_documento,
            al.nombres,
            al.apellidos,
            al.nombre_apellido,
            al.referencia_carrera_id,
            al.semestre_curricular,
            al.cohorte_anio,
            ref_c.nombre AS carrera_referencia_nombre,
            ref_f.nombre AS facultad_referencia_nombre,
            COUNT(DISTINCT mat.id)::int AS total_matriculas,
            STRING_AGG(DISTINCT ca.nombre, ' | ') FILTER (WHERE ca.nombre IS NOT NULL) AS carreras
         FROM alumnos al
         LEFT JOIN carreras ref_c ON ref_c.id = al.referencia_carrera_id
         LEFT JOIN facultades ref_f ON ref_f.id = ref_c.facultad_id
         LEFT JOIN matriculas mat ON mat.alumno_id = al.id
         LEFT JOIN cursos c ON c.id = mat.curso_id
         LEFT JOIN modulos_academicos mo ON mo.id = c.modulo_id
         LEFT JOIN materias m ON m.id = mo.materia_id
         LEFT JOIN planes_estudio p ON p.id = m.plan_id
         LEFT JOIN carreras ca ON ca.id = p.carrera_id
         ${whereClause}
         GROUP BY al.id, al.numero_documento, al.nombres, al.apellidos, al.nombre_apellido,
                  al.referencia_carrera_id, al.semestre_curricular, al.cohorte_anio, ref_c.nombre, ref_f.nombre
         ORDER BY al.apellidos NULLS LAST, al.nombres NULLS LAST, al.numero_documento ASC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        valores
    );

    const hasMore = rows.length > limit;
    return { datos: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

export async function obtenerFichaAlumno(
    alumnoId: string,
    alcance: AlcanceMatriculasFacultad = { tipo: 'sin_restriccion' }
) {
    const { rows: alumnoRows } = await pool.query<{
        id: string;
        numero_documento: string;
        nombres: string;
        apellidos: string;
        nombre_apellido: string | null;
        referencia_carrera_id: number | null;
        semestre_curricular: number;
        cohorte_anio: number | null;
        carrera_referencia_nombre: string | null;
        facultad_referencia_nombre: string | null;
    }>(
        `SELECT
            al.id,
            al.numero_documento,
            al.nombres,
            al.apellidos,
            al.nombre_apellido,
            al.referencia_carrera_id,
            al.semestre_curricular,
            al.cohorte_anio,
            ref_c.nombre AS carrera_referencia_nombre,
            ref_f.nombre AS facultad_referencia_nombre
         FROM alumnos al
         LEFT JOIN carreras ref_c ON ref_c.id = al.referencia_carrera_id
         LEFT JOIN facultades ref_f ON ref_f.id = ref_c.facultad_id
         WHERE al.id = $1`,
        [alumnoId]
    );

    const alumnoRaw = alumnoRows[0];
    if (!alumnoRaw) {
        throw new Error('Alumno no encontrado');
    }
    const semRaw = Number(alumnoRaw.semestre_curricular);
    const semestre_curricular =
        Number.isFinite(semRaw) && semRaw >= 1 && semRaw <= 10 ? Math.trunc(semRaw) : 1;
    const alumno = { ...alumnoRaw, semestre_curricular };

    const facIds = alcance.tipo === 'facultades' ? alcance.facultadIds.filter((n) => Number.isFinite(n)) : [];
    const carIds = alcance.tipo === 'carreras' ? alcance.carreraIds.filter((n) => Number.isFinite(n)) : [];
    const trayectoriaParams: Array<string | number[]> = [alumnoId];
    let scopeFilterSql = '';
    if (facIds.length > 0) {
        trayectoriaParams.push(facIds);
        scopeFilterSql = ` AND ca.facultad_id = ANY($2::int[])`;
    } else if (carIds.length > 0) {
        trayectoriaParams.push(carIds);
        scopeFilterSql = ` AND p.carrera_id = ANY($2::int[])`;
    }

    const { rows: trayectoriaRows } = await pool.query(
        `SELECT
            mat.id AS matricula_id,
            mat.curso_id,
            mat.estado_academico,
            mat.porcentaje_asistencia,
            mat.faltas_acumuladas,
            mat.justificaciones_aprobadas,
            mat.fecha_inscripcion,
            mo.anio,
            mo.mes,
            m.nombre AS materia,
            p.nombre AS plan,
            ca.nombre AS carrera,
            f.nombre AS facultad,
            COUNT(a.id) AS sesiones_registradas,
            COUNT(*) FILTER (WHERE a.estado = 'presente') AS presentes,
            COUNT(*) FILTER (WHERE a.estado = 'ausente') AS ausentes,
            COUNT(*) FILTER (WHERE a.estado = 'justificada') AS justificadas
         FROM matriculas mat
         JOIN cursos c ON c.id = mat.curso_id
         JOIN modulos_academicos mo ON mo.id = c.modulo_id
         JOIN materias m ON m.id = mo.materia_id
         JOIN planes_estudio p ON p.id = m.plan_id
         JOIN carreras ca ON ca.id = p.carrera_id
         JOIN facultades f ON f.id = ca.facultad_id
         LEFT JOIN asistencias a ON a.matricula_id = mat.id
         WHERE mat.alumno_id = $1${scopeFilterSql}
         GROUP BY
            mat.id, mat.curso_id, mat.estado_academico, mat.porcentaje_asistencia, mat.faltas_acumuladas,
            mat.justificaciones_aprobadas, mat.fecha_inscripcion, mo.anio, mo.mes, m.nombre, p.nombre, ca.nombre, f.nombre
         ORDER BY mo.anio DESC, mo.mes DESC, mat.id DESC`,
        trayectoriaParams
    );

    if ((facIds.length > 0 || carIds.length > 0) && trayectoriaRows.length === 0) {
        const okRef = await alumnoCarreraReferenciaEnAlcance(alumno.referencia_carrera_id, alcance);
        if (!okRef) {
            throw new ForbiddenScopeError();
        }
    }

    // Promedio solo sobre un año (módulo académico); no incluir materias de otros años.
    const anios = trayectoriaRows.map((r) => Number(r.anio)).filter((a) => Number.isFinite(a));
    const anioPromedioAsistencia = anios.length ? Math.max(...anios) : new Date().getUTCFullYear();
    const filasAnioPromedio = trayectoriaRows.filter((r) => Number(r.anio) === anioPromedioAsistencia);
    const filasAnioConAsistencia = filasAnioPromedio.filter((r) => Number(r.sesiones_registradas ?? 0) > 0);
    const materiasPromedioAnio = filasAnioConAsistencia.length;
    const sumaPorcentajesAnio = filasAnioConAsistencia.reduce(
        (acc, item) => acc + Number(item.porcentaje_asistencia ?? 0),
        0
    );
    const promedioPorcentajeAsistenciaMaterias =
        materiasPromedioAnio > 0 ? sumaPorcentajesAnio / materiasPromedioAnio : 0;

    const resumen = {
        totalMatriculas: trayectoriaRows.length,
        activas: trayectoriaRows.filter((item) => String(item.estado_academico ?? '').toLowerCase() !== 'baja').length,
        totalAusencias: trayectoriaRows.reduce((acc, item) => acc + Number(item.ausentes ?? 0), 0),
        totalJustificadas: trayectoriaRows.reduce((acc, item) => acc + Number(item.justificadas ?? 0), 0),
        promedioPorcentajeAsistenciaMaterias,
        anioPromedioAsistencia,
        materiasPromedioAnio,
    };

    return {
        alumno,
        resumen,
        trayectoria: trayectoriaRows
    };
}

export interface AlumnoSemestreCurricularListItem {
    id: string;
    numero_documento: string;
    nombre_completo: string;
    semestre_curricular: number;
    /** Año de cohorte de ingreso (desde importación / lote); null si no se registró. */
    cohorte_anio: number | null;
    /** Fecha de la última promoción de semestre; null si nunca fue promovido. */
    promocionado_en: string | null;
}

export async function listarAlumnosPorSemestreCurricular(
    carreraId: number,
    semestre: number,
    alcance: AlcanceMatriculasFacultad,
    cohorteAnio?: number | null
): Promise<AlumnoSemestreCurricularListItem[]> {
    await assertCarreraIdEnAlcance(carreraId, alcance);
    if (!Number.isFinite(semestre) || semestre < 1 || semestre > 10) {
        throw new Error('El semestre debe estar entre 1 y 10.');
    }
    const params: unknown[] = [carreraId, semestre];
    let cohorteCondicion = '';
    if (cohorteAnio != null && Number.isFinite(cohorteAnio)) {
        params.push(cohorteAnio);
        cohorteCondicion = ` AND al.cohorte_anio = $${params.length}`;
    }
    const { rows } = await pool.query<AlumnoSemestreCurricularListItem>(
        `SELECT
            al.id,
            al.numero_documento,
            COALESCE(al.nombre_apellido, CONCAT(COALESCE(al.apellidos, ''), ', ', COALESCE(al.nombres, ''))) AS nombre_completo,
            al.semestre_curricular,
            al.cohorte_anio,
            al.promocionado_en
         FROM alumnos al
         WHERE al.referencia_carrera_id = $1
           AND al.semestre_curricular = $2${cohorteCondicion}
         ORDER BY al.cohorte_anio DESC NULLS LAST, nombre_completo, al.numero_documento`,
        params
    );
    return rows;
}

function bumpDescripcionLoteSemestre(descripcion: string, origen: number, destino: number): string | null {
    if (extraerNumeroSemestreEnDescripcionLote(descripcion) !== origen) return null;
    const rep1 = descripcion.replace(new RegExp(`(semestre\\s*)${origen}(?!\\d)`, 'i'), `$1${destino}`);
    if (rep1 !== descripcion) return rep1;
    const rep2 = descripcion.replace(new RegExp(`(^|[^\\d])${origen}(\\s*°?\\s*semestre)`, 'i'), `$1${destino}$2`);
    if (rep2 !== descripcion) return rep2;
    return null;
}

/**
 * Si la descripción del lote indica `semestreOrigen` y ya no queda ningún alumno
 * de esa carrera en ese semestre vinculado por CI a un registro del lote,
 * reemplaza el número en el texto por `semestreDestino` (p. ej. Semestre 1 → 2).
 */
async function renombrarLotesAlumnosDescripcionTrasPromocion(
    client: PoolClient,
    params: { semestreOrigen: number; semestreDestino: number; carreraIds: number[] }
): Promise<void> {
    const { semestreOrigen, semestreDestino, carreraIds } = params;
    if (!carreraIds.length) return;

    const { rows: lotes } = await client.query<{
        id: number;
        descripcion: string | null;
        destino_carrera_id: number | null;
    }>(
        `SELECT id, descripcion, destino_carrera_id
         FROM lotes_importacion
         WHERE tipo_lote = 'alumnos'
           AND destino_carrera_id = ANY($1::int[])
           AND descripcion IS NOT NULL`,
        [carreraIds]
    );

    for (const lote of lotes) {
        const desc = lote.descripcion;
        const carreraId = lote.destino_carrera_id;
        if (!desc || carreraId == null) continue;
        if (extraerNumeroSemestreEnDescripcionLote(desc) !== semestreOrigen) continue;

        const { rows: ex } = await client.query<{ still_has: boolean }>(
            `SELECT EXISTS (
                SELECT 1
                FROM registros_importacion ri
                INNER JOIN alumnos al ON al.numero_documento = ${SQL_DOC_REGISTRO_RI}
                    AND al.referencia_carrera_id = $2
                    AND al.semestre_curricular = $3
                WHERE ri.lote_id = $1
                  AND COALESCE(ri.valido, TRUE)
                  AND (${SQL_DOC_REGISTRO_RI}) IS NOT NULL
            ) AS still_has`,
            [lote.id, carreraId, semestreOrigen]
        );
        if (ex[0]?.still_has) continue;

        const nueva = bumpDescripcionLoteSemestre(desc, semestreOrigen, semestreDestino);
        if (!nueva) continue;

        await client.query(`UPDATE lotes_importacion SET descripcion = $1 WHERE id = $2`, [nueva, lote.id]);
    }
}

export async function promocionarSemestreCurricular(params: {
    carreraId: number;
    semestreOrigen: number;
    alumnoIds: string[];
    alcance: AlcanceMatriculasFacultad;
}): Promise<{ actualizados: number }> {
    const { carreraId, semestreOrigen, alumnoIds, alcance } = params;
    await assertCarreraIdEnAlcance(carreraId, alcance);
    if (!Number.isFinite(semestreOrigen) || semestreOrigen < 1 || semestreOrigen > 9) {
        throw new Error('El semestre de origen debe estar entre 1 y 9 para poder ascender al siguiente.');
    }
    const destino = semestreOrigen + 1;
    const ids = [...new Set(alumnoIds.map((id) => String(id).trim()).filter(Boolean))];
    if (!ids.length) {
        throw new Error('Indicá al menos un alumno a promocionar.');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Limpiar promocionado_en de los que ya estaban en el destino
        await client.query(
            `UPDATE alumnos
             SET promocionado_en = NULL
             WHERE referencia_carrera_id = $1
               AND semestre_curricular = $2
               AND NOT (id = ANY($3::uuid[]))`,
            [carreraId, destino, ids]
        );
        const { rowCount } = await client.query(
            `UPDATE alumnos al
             SET semestre_curricular = $1,
                 promocionado_en = NOW()
             WHERE al.id = ANY($2::uuid[])
               AND al.referencia_carrera_id = $3
               AND al.semestre_curricular = $4`,
            [destino, ids, carreraId, semestreOrigen]
        );
        // Limpiar promocionado_en de los que quedaron en el origen (ahora son el grupo existente)
        await client.query(
            `UPDATE alumnos
             SET promocionado_en = NULL
             WHERE referencia_carrera_id = $1
               AND semestre_curricular = $2
               AND NOT (id = ANY($3::uuid[]))`,
            [carreraId, semestreOrigen, ids]
        );
        await renombrarLotesAlumnosDescripcionTrasPromocion(client, {
            semestreOrigen,
            semestreDestino: destino,
            carreraIds: [carreraId],
        });
        await client.query('COMMIT');
        return { actualizados: rowCount ?? 0 };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function listarCarreraIdsEnFacultadAlcance(
    facultadId: number,
    alcance: AlcanceMatriculasFacultad
): Promise<number[]> {
    await assertFacultadIdEnAlcance(facultadId, alcance);
    if (alcance.tipo === 'carreras') {
        const { rows } = await pool.query<{ id: number }>(
            `SELECT id FROM carreras WHERE facultad_id = $1 AND id = ANY($2::int[]) ORDER BY nombre`,
            [facultadId, alcance.carreraIds]
        );
        return rows.map((r) => r.id);
    }
    const { rows } = await pool.query<{ id: number }>(
        `SELECT id FROM carreras WHERE facultad_id = $1 ORDER BY nombre`,
        [facultadId]
    );
    return rows.map((r) => r.id);
}

export interface PreviewPromocionMasivaFacultadFila {
    carreraId: number;
    carreraNombre: string;
    cantidadAlumnos: number;
    promovidos: boolean;
}

export async function previewPromocionSemestreMasivaFacultad(
    facultadId: number,
    semestreOrigen: number,
    alcance: AlcanceMatriculasFacultad,
    cohorteAnio: number | null = null
): Promise<{ filas: PreviewPromocionMasivaFacultadFila[]; totalAlumnos: number }> {
    if (!Number.isFinite(semestreOrigen) || semestreOrigen < 1 || semestreOrigen > 9) {
        throw new Error('El semestre de origen debe estar entre 1 y 9.');
    }
    const carreraIds = await listarCarreraIdsEnFacultadAlcance(facultadId, alcance);
    if (!carreraIds.length) {
        return { filas: [], totalAlumnos: 0 };
    }
    const queryParams: unknown[] = [semestreOrigen, carreraIds];
    let cohorteCondicion = '';
    if (cohorteAnio != null && Number.isFinite(cohorteAnio)) {
        queryParams.push(cohorteAnio);
        cohorteCondicion = ` AND al.cohorte_anio = $${queryParams.length}`;
    }
    const { rows } = await pool.query<{ carrera_id: number; carrera_nombre: string; cantidad: string; promovidos: boolean }>(
        `SELECT ca.id AS carrera_id,
                ca.nombre AS carrera_nombre,
                COUNT(al.id)::text AS cantidad,
                al.promocionado_en IS NOT NULL AS promovidos
         FROM carreras ca
         LEFT JOIN alumnos al ON al.referencia_carrera_id = ca.id
           AND al.semestre_curricular = $1${cohorteCondicion}
         WHERE ca.id = ANY($2::int[])
         GROUP BY ca.id, ca.nombre, al.promocionado_en IS NOT NULL
         ORDER BY ca.nombre, promovidos`,
        queryParams
    );
    const filas: PreviewPromocionMasivaFacultadFila[] = rows
        .map((r) => ({
            carreraId: r.carrera_id,
            carreraNombre: r.carrera_nombre,
            cantidadAlumnos: Number(r.cantidad) || 0,
            promovidos: r.promovidos === true,
        }))
        .filter((f) => f.cantidadAlumnos > 0);
    const totalAlumnos = filas.reduce((acc, f) => acc + f.cantidadAlumnos, 0);
    return { filas, totalAlumnos };
}

export async function ejecutarPromocionSemestreMasivaFacultad(params: {
    facultadId: number;
    semestreOrigen: number;
    excluirCarreraIds: number[];
    alcance: AlcanceMatriculasFacultad;
    cohorteAnio: number | null;
}): Promise<{ actualizados: number; porCarrera: { carreraId: number; actualizados: number }[] }> {
    const { facultadId, semestreOrigen, excluirCarreraIds, alcance, cohorteAnio } = params;
    if (!Number.isFinite(semestreOrigen) || semestreOrigen < 1 || semestreOrigen > 9) {
        throw new Error('El semestre de origen debe estar entre 1 y 9 para poder ascender al siguiente.');
    }
    if (cohorteAnio == null || !Number.isFinite(cohorteAnio)) {
        throw new Error('Debés indicar el año de cohorte para la promoción masiva.');
    }
    const destino = semestreOrigen + 1;
    const excluir = new Set(excluirCarreraIds.filter((n) => Number.isFinite(n) && n > 0));

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await assertFacultadIdEnAlcance(facultadId, alcance);

        let carreraFilter: string;
        const queryParams: unknown[] = [destino, facultadId, semestreOrigen, cohorteAnio];

        if (alcance.tipo === 'carreras') {
            queryParams.push(alcance.carreraIds);
            queryParams.push([...excluir]);
            carreraFilter = `AND c.id = ANY($5::int[]) AND NOT (c.id = ANY($6::int[]))`;
        } else {
            queryParams.push([...excluir]);
            carreraFilter = `AND NOT (c.id = ANY($5::int[]))`;
        }

        // Limpiar promocionado_en de los que ya estaban en el destino
        await client.query(
            `UPDATE alumnos
             SET promocionado_en = NULL
             WHERE semestre_curricular = $1
               AND cohorte_anio = $2
               AND referencia_carrera_id IN (
                 SELECT c.id FROM carreras c WHERE c.facultad_id = $3
               )`,
            [destino, cohorteAnio, facultadId]
        );

        const { rows } = await client.query<{ cid: number; cantidad: string }>(
            `WITH carreras_elegibles AS (
                SELECT c.id FROM carreras c WHERE c.facultad_id = $2 ${carreraFilter}
             ),
             upd AS (
                UPDATE alumnos al
                SET semestre_curricular = $1,
                    promocionado_en = NOW()
                FROM carreras_elegibles ce
                WHERE al.referencia_carrera_id = ce.id
                  AND al.semestre_curricular = $3
                  AND al.cohorte_anio = $4
                RETURNING al.referencia_carrera_id AS cid
             )
             SELECT cid, COUNT(*)::text AS cantidad FROM upd GROUP BY cid`,
            queryParams
        );

        if (!rows.length) {
            await client.query('COMMIT');
            throw new Error('No quedan carreras elegibles tras las exclusiones o no hay alumnos para promover.');
        }

        const porCarrera = rows.map((r) => ({
            carreraId: r.cid,
            actualizados: Number(r.cantidad) || 0
        }));
        const actualizados = porCarrera.reduce((s, r) => s + r.actualizados, 0);
        const carreraIds = porCarrera.map((r) => r.carreraId);

        // Limpiar promocionado_en de los que quedaron en el origen
        if (carreraIds.length > 0) {
            await client.query(
                `UPDATE alumnos
                 SET promocionado_en = NULL
                 WHERE referencia_carrera_id = ANY($1::int[])
                   AND semestre_curricular = $2
                   AND cohorte_anio = $3`,
                [carreraIds, semestreOrigen, cohorteAnio]
            );
        }

        await renombrarLotesAlumnosDescripcionTrasPromocion(client, {
            semestreOrigen,
            semestreDestino: destino,
            carreraIds,
        });
        await client.query('COMMIT');
        return { actualizados, porCarrera };
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_e) { /* already rolled back or committed */ }
        throw e;
    } finally {
        client.release();
    }
}

export async function limpiarMatriculasCurso(cursoId: number): Promise<{ eliminadas: number }> {
    const { rows: [{ count }] } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM asistencias a
         INNER JOIN matriculas m ON m.id = a.matricula_id
         WHERE m.curso_id = $1`,
        [cursoId]
    );
    const totalAsistencias = parseInt(count, 10);
    if (totalAsistencias > 0) {
        throw new Error(
            'Este curso ya tiene asistencias registradas. No se puede vaciar la planilla.'
        );
    }
    const { rowCount } = await pool.query(
        'DELETE FROM matriculas WHERE curso_id = $1',
        [cursoId]
    );
    return { eliminadas: rowCount ?? 0 };
}
