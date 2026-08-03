import type { PoolClient } from 'pg';
import { pool } from '../../config/database';

function mensajeErrorAlumno(error: unknown, fallback: string): string {
    if (error instanceof Error && 'code' in error) {
        const code = (error as Error & { code: string }).code;
        const msg = (error as Error).message;
        if (code === '23505') {
            const ciMatch = msg.match(/Key \(numero_documento\)=\(([^)]+)\)/);
            if (ciMatch) {
                return `Ya existe un alumno con la cédula ${ciMatch[1]}. El registro fue omitido.`;
            }
            return 'Registro duplicado: ya existe un alumno con ese documento o código único.';
        }
        if (code === '23503') return 'El registro hace referencia a una carrera o facultad que no existe.';
    }
    if (error instanceof Error) return error.message;
    return fallback;
}

/** Sincroniza total_registros con el conteo real en registros_importacion (evita doble conteo al crear + cargar). */
async function sincronizarTotalRegistrosLote(
    cliente: Pick<PoolClient, 'query'>,
    loteId: number
): Promise<void> {
    await cliente.query(
        `UPDATE lotes_importacion
         SET total_registros = (
             SELECT COUNT(*)::int FROM registros_importacion WHERE lote_id = $1
         )
         WHERE id = $1`,
        [loteId]
    );
}

interface CrearLoteInput {
    tipoLote: string;
    descripcion?: string;
    archivoFuente?: string;
    totalRegistros?: number;
    destinoFacultad?: string;
    destinoCarrera?: string;
    destinoFacultadId?: number;
    destinoCarreraId?: number;
    cursoDestinoId?: number;
    /** Año de cohorte de ingreso (p. ej. 2025); se propaga a alumnos al confirmar el lote. */
    cohorteAnio: number;
}

interface LoteFiltro {
    estado?: string;
    tipoLote?: string;
    limit?: number;
    /** Solo lotes creados por este usuario (historial personal). */
    ejecutadoPorUsuarioId?: string;
}

interface RegistroImportacionInput {
    fila?: number;
    datos: Record<string, unknown>;
    valido?: boolean;
    mensajeError?: string;
}

interface ListaRegistrosFiltro {
    valido?: boolean;
    limit?: number;
    offset?: number;
}

interface ActualizarLoteInput {
    estado?: string;
    procesados?: number;
    errores?: number;
    totalRegistros?: number;
    descripcion?: string;
}

interface DestinoAcademicoFila {
    facultad_id: number;
    facultad_nombre: string;
    carrera_id: number | null;
    carrera_nombre: string | null;
}

interface ContextoLoteDestino {
    destinoFacultadId?: number;
    destinoCarreraId?: number;
}

interface LoteDestinoConfig {
    tabla: string;
    campos: string[];
    requeridos?: string[];
    defaults?: Record<string, unknown>;
    conflictTarget?: string;
    alias?: Record<string, string[]>;
}

interface DatosFilaImportacion {
    [key: string]: unknown;
}

const LOTE_DESTINOS: Record<string, LoteDestinoConfig> = {
    facultades: {
        tabla: 'facultades',
        campos: ['nombre', 'estado'],
        requeridos: ['nombre'],
        defaults: { estado: true },
        conflictTarget: '(nombre)'
    },
    carreras: {
        tabla: 'carreras',
        campos: ['facultad_id', 'nombre', 'codigo'],
        requeridos: ['facultad_id', 'nombre'],
        conflictTarget: '(facultad_id, nombre)'
    },
    planes: {
        tabla: 'planes_estudio',
        campos: ['carrera_id', 'nombre', 'resolucion', 'anio_vigencia'],
        requeridos: ['carrera_id', 'nombre'],
        conflictTarget: '(carrera_id, nombre)'
    },
    docentes: {
        tabla: 'docentes',
        campos: ['usuario_id', 'legajo', 'titulo_academico'],
        requeridos: ['usuario_id'],
        conflictTarget: '(usuario_id)'
    },
    alumnos: {
        tabla: 'alumnos',
        campos: ['apellidos', 'nombres', 'nombre_apellido', 'numero_documento'],
        requeridos: ['numero_documento'],
        conflictTarget: '(numero_documento)',
        alias: {
            apellidos: ['apellido', 'apellido/s'],
            nombres: ['nombre', 'nombre/s'],
            nombre_apellido: ['nombre_a', 'nombre_apellido', 'nombre completo', 'apellido_nombre', 'alumno', 'apellido y nombre', 'apellidos y nombres', 'nombre y apellido'],
            numero_documento: [
                'ci',
                'cedula',
                'cedula_identidad',
                'cedula de identidad',
                'cedula de identidad civil',
                'cedula_identidad_civil',
                'documento',
                'num_documento',
                'num doc',
                'numero_doc',
                'documento_numero',
                'numero_c',
                'nro documento',
                'nro. documento',
                'no. documento',
                'no documento'
            ]
        }
    },
    matriculas: {
        tabla: 'matriculas',
        campos: ['curso_id', 'alumno_id', 'estado_academico', 'porcentaje_asistencia', 'faltas_acumuladas', 'justificaciones_aprobadas', 'fecha_inscripcion', 'orden_lista'],
        requeridos: ['curso_id', 'alumno_id'],
        conflictTarget: '(curso_id, alumno_id)',
        alias: {
            alumno_id: ['id_alumno', 'alumnoid', 'id alumno', 'nro alumno', 'codigo alumno'],
            curso_id: ['id_curso', 'cursoid', 'id curso', 'nro curso', 'codigo curso']
        },
        defaults: {
            estado_academico: 'regular',
            porcentaje_asistencia: 100.0,
            faltas_acumuladas: 0,
            justificaciones_aprobadas: 0
        }
    }
};

async function asegurarLoteExiste(loteId: number) {
    const { rows } = await pool.query(
        `SELECT id FROM lotes_importacion WHERE id = $1`,
        [loteId]
    );
    if (!rows[0]) {
        throw new Error('Lote no encontrado');
    }
}

/** Indica si el lote existe y fue creado por el usuario (para aislar historial y operaciones por lote). */
export async function esLoteDelUsuario(loteId: number, usuarioId: string | undefined): Promise<boolean> {
    if (!usuarioId) {
        return false;
    }
    const { rows } = await pool.query(
        `SELECT 1 FROM lotes_importacion WHERE id = $1 AND ejecutado_por = $2::uuid`,
        [loteId, usuarioId]
    );
    return Boolean(rows[0]);
}

async function validarDestinoAcademico(input: CrearLoteInput) {
    if (input.destinoFacultadId === undefined && input.destinoCarreraId === undefined) {
        return;
    }

    if (!input.destinoFacultadId || !input.destinoCarreraId) {
        throw new Error('La facultad y carrera destino son obligatorias cuando se define un destino académico');
    }

    const { rows } = await pool.query<{ id: number; facultad_id: number }>(
        `SELECT id, facultad_id FROM carreras WHERE id = $1`,
        [input.destinoCarreraId]
    );
    const carrera = rows[0];

    if (!carrera) {
        throw new Error('La carrera seleccionada no existe');
    }

    if (carrera.facultad_id !== input.destinoFacultadId) {
        throw new Error('La carrera seleccionada no pertenece a la facultad indicada');
    }
}

async function validarCursoDestinoMatriculas(input: CrearLoteInput) {
    if (input.tipoLote !== 'matriculas') {
        return;
    }

    if (!input.cursoDestinoId) {
        return;
    }

    const { rows } = await pool.query<{ carrera_id: number; facultad_id: number }>(
        `SELECT crr.id AS carrera_id, f.id AS facultad_id
         FROM cursos c
         JOIN modulos_academicos ma ON ma.id = c.modulo_id
         JOIN materias m ON m.id = ma.materia_id
         JOIN planes_estudio p ON p.id = m.plan_id
         JOIN carreras crr ON crr.id = p.carrera_id
         JOIN facultades f ON f.id = crr.facultad_id
         WHERE c.id = $1`,
        [input.cursoDestinoId]
    );

    const curso = rows[0];
    if (!curso) {
        throw new Error('El curso destino no existe');
    }

    if (input.destinoCarreraId && curso.carrera_id !== input.destinoCarreraId) {
        throw new Error('El curso destino no corresponde a la carrera seleccionada');
    }

    if (input.destinoFacultadId && curso.facultad_id !== input.destinoFacultadId) {
        throw new Error('El curso destino no corresponde a la facultad seleccionada');
    }
}

/** Evita cargas duplicadas del mismo archivo (pendiente o ya confirmado para la misma carrera/semestre). */
async function assertLoteImportacionNoDuplicado(input: CrearLoteInput, usuarioId: string): Promise<void> {
    const archivo = (input.archivoFuente ?? '').trim();
    if (!archivo) {
        return;
    }

    const { rows: pendientesMismoArchivo } = await pool.query<{ id: number }>(
        `SELECT id
         FROM lotes_importacion
         WHERE ejecutado_por = $1::uuid
           AND LOWER(TRIM(tipo_lote)) = LOWER(TRIM($2))
           AND LOWER(TRIM(archivo_fuente)) = LOWER(TRIM($3))
           AND LOWER(TRIM(estado)) = 'pendiente'
         ORDER BY id DESC
         LIMIT 1`,
        [usuarioId, input.tipoLote, archivo]
    );
    if (pendientesMismoArchivo.length) {
        throw new Error(
            `Ya hay una carga pendiente de «${archivo}» (lote #${pendientesMismoArchivo[0].id}). Descartala en el historial o confirmala.`
        );
    }

    if (!input.destinoCarreraId) {
        return;
    }

    const cohorteSql = Math.trunc(input.cohorteAnio);

    const { rows } = await pool.query<{ id: number; estado: string; descripcion: string | null }>(
        `SELECT id, estado, descripcion
         FROM lotes_importacion
         WHERE ejecutado_por = $1::uuid
           AND LOWER(TRIM(tipo_lote)) = LOWER(TRIM($2))
           AND LOWER(TRIM(archivo_fuente)) = LOWER(TRIM($3))
           AND destino_carrera_id = $4
           AND destino_facultad_id IS NOT DISTINCT FROM $5::int
           AND cohorte_anio IS NOT DISTINCT FROM $6::smallint
           AND LOWER(TRIM(estado)) = 'completado'`,
        [usuarioId, input.tipoLote, archivo, input.destinoCarreraId, input.destinoFacultadId ?? null, cohorteSql]
    );
    if (rows.length > 0) {
        throw new Error(`«${archivo}» ya fue importado y confirmado (lote #${rows[0].id}).`);
    }
}

/** Valida coherencia y duplicado antes de crear el lote (no persiste nada). */
export async function validarCargaAlumnosPrevia(
    input: CrearLoteInput & { registros: RegistroImportacionInput[] },
    usuarioId: string
): Promise<{ ok: true }> {
    if (input.tipoLote !== 'alumnos') {
        throw new Error('La validación previa solo aplica a lotes de alumnos');
    }
    if (!input.registros?.length) {
        throw new Error('No se proporcionaron registros para validar');
    }

    await validarDestinoAcademico(input);
    await assertLoteImportacionNoDuplicado(input, usuarioId);

    const cliente = await pool.connect();
    try {
        await validarCoherenciaRegistrosAlumnosImportacion(
            cliente,
            {
                tipo_lote: 'alumnos',
                destino_carrera: input.destinoCarrera ?? null,
                destino_facultad: input.destinoFacultad ?? null,
                destino_carrera_id: input.destinoCarreraId ?? null,
                descripcion: input.descripcion ?? null
            },
            input.registros
        );
    } finally {
        cliente.release();
    }

    return { ok: true };
}

export async function crearLote(input: CrearLoteInput, usuarioId: string) {
    await validarDestinoAcademico(input);
    await validarCursoDestinoMatriculas(input);
    await assertLoteImportacionNoDuplicado(input, usuarioId);

    const cohorteSql = Math.trunc(input.cohorteAnio);

    const { rows } = await pool.query(
        `INSERT INTO lotes_importacion (
            tipo_lote,
            descripcion,
            archivo_fuente,
            total_registros,
            destino_facultad,
            destino_carrera,
            destino_facultad_id,
            destino_carrera_id,
            cohorte_anio,
            ejecutado_por
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, tipo_lote, descripcion, archivo_fuente, total_registros, estado, destino_facultad, destino_carrera, destino_facultad_id, destino_carrera_id, cohorte_anio, ejecutado_por, ejecutado_en`,
        [
            input.tipoLote,
            input.descripcion ?? null,
            input.archivoFuente ?? null,
            0,
            input.destinoFacultad ?? null,
            input.destinoCarrera ?? null,
            input.destinoFacultadId ?? null,
            input.destinoCarreraId ?? null,
            cohorteSql,
            usuarioId
        ]
    );

    return rows[0];
}

export async function listarLotes(filtro: LoteFiltro = {}) {
    const condiciones: string[] = [];
    const valores: Array<string | number> = [];

    if (filtro.estado) {
        valores.push(filtro.estado);
        condiciones.push(`l.estado = $${valores.length}`);
    }

    if (filtro.tipoLote) {
        valores.push(filtro.tipoLote);
        condiciones.push(`l.tipo_lote = $${valores.length}`);
    }

    if (filtro.ejecutadoPorUsuarioId) {
        valores.push(filtro.ejecutadoPorUsuarioId);
        condiciones.push(`l.ejecutado_por = $${valores.length}::uuid`);
    }

    const limit = Math.min(Math.max(filtro.limit ?? 50, 1), 200);
    valores.push(limit);
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const { rows } = await pool.query(
        `SELECT
            l.id,
            l.tipo_lote,
            l.descripcion,
            l.archivo_fuente,
            l.destino_facultad,
            l.destino_carrera,
            l.destino_facultad_id,
            l.destino_carrera_id,
            l.total_registros,
            l.procesados,
            l.errores,
            l.estado,
            l.ejecutado_en,
            l.ejecutado_por,
            CONCAT(u.nombres, ' ', u.apellidos) AS ejecutado_por_nombre
         FROM lotes_importacion l
         LEFT JOIN usuarios u ON u.id = l.ejecutado_por
         ${where}
         ORDER BY l.id DESC
         LIMIT $${valores.length}`,
        valores
    );

    return rows;
}

export async function obtenerDetalleLote(loteId: number) {
    const { rows } = await pool.query(
        `SELECT
            l.id,
            l.tipo_lote,
            l.descripcion,
            l.archivo_fuente,
            l.destino_facultad,
            l.destino_carrera,
            l.destino_facultad_id,
            l.destino_carrera_id,
            l.total_registros,
            l.procesados,
            l.errores,
            l.estado,
            l.ejecutado_en,
            l.ejecutado_por,
            CONCAT(u.nombres, ' ', u.apellidos) AS ejecutado_por_nombre,
            COALESCE(stats.registros_cargados, 0) AS registros_cargados,
            COALESCE(stats.registros_validos, 0) AS registros_validos,
            COALESCE(stats.registros_invalidos, 0) AS registros_invalidos
         FROM lotes_importacion l
         LEFT JOIN usuarios u ON u.id = l.ejecutado_por
         LEFT JOIN LATERAL (
            SELECT
                COUNT(*) AS registros_cargados,
                COUNT(*) FILTER (WHERE valido IS DISTINCT FROM FALSE) AS registros_validos,
                COUNT(*) FILTER (WHERE valido = FALSE) AS registros_invalidos
            FROM registros_importacion r
            WHERE r.lote_id = l.id
         ) stats ON TRUE
         WHERE l.id = $1`,
        [loteId]
    );

    return rows[0] ?? null;
}

export async function agregarRegistrosLote(
    loteId: number,
    registros: RegistroImportacionInput[]
) {
    if (!registros.length) {
        throw new Error('No se proporcionaron registros');
    }

    await asegurarLoteExiste(loteId);

    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');

        const { rows: loteRows } = await cliente.query<{
            tipo_lote: string;
            destino_carrera: string | null;
            destino_facultad: string | null;
            destino_carrera_id: number | null;
            descripcion: string | null;
        }>(
            `SELECT tipo_lote, destino_carrera, destino_facultad, destino_carrera_id, descripcion
             FROM lotes_importacion WHERE id = $1`,
            [loteId]
        );
        const loteMeta = loteRows[0];
        if (!loteMeta) {
            throw new Error('Lote no encontrado');
        }
        await validarCoherenciaRegistrosAlumnosImportacion(cliente, loteMeta, registros);

        const filasArr = registros.map((r) => r.fila ?? null);
        const datosArr = registros.map((r) => JSON.stringify(r.datos));
        const validoArr = registros.map((r) => r.valido ?? true);
        const msgArr = registros.map((r) => r.mensajeError ?? null);

        const { rows: insertedRows } = await cliente.query<{ id: number; fila: number | null }>(
            `INSERT INTO registros_importacion (lote_id, fila, datos, valido, mensaje_error)
             SELECT $1, u.f, u.d::jsonb, u.v, u.m
             FROM unnest($2::int[], $3::jsonb[], $4::boolean[], $5::text[]) AS u(f, d, v, m)
             RETURNING id, fila`,
            [loteId, filasArr, datosArr, validoArr, msgArr]
        );

        await sincronizarTotalRegistrosLote(cliente, loteId);

        await cliente.query('COMMIT');
        return insertedRows;
    } catch (error) {
        await cliente.query('ROLLBACK');
        throw error;
    } finally {
        cliente.release();
    }
}

export async function listarRegistrosLote(
    loteId: number,
    filtro: ListaRegistrosFiltro = {}
) {
    await asegurarLoteExiste(loteId);

    const condiciones = ['lote_id = $1'];
    const valores: Array<string | number | boolean> = [loteId];

    if (typeof filtro.valido === 'boolean') {
        valores.push(filtro.valido);
        condiciones.push(`valido = $${valores.length}`);
    }

    const limit = Math.min(Math.max(filtro.limit ?? 100, 1), 500);
    const offset = Math.max(filtro.offset ?? 0, 0);
    valores.push(limit);
    valores.push(offset);

    const { rows } = await pool.query(
        `SELECT id, fila, datos, valido, mensaje_error
         FROM registros_importacion
         WHERE ${condiciones.join(' AND ')}
         ORDER BY COALESCE(fila, 0), id
         LIMIT $${valores.length - 1}
         OFFSET $${valores.length}`,
        valores
    );

    return rows;
}

export async function actualizarEstadoLote(
    loteId: number,
    input: ActualizarLoteInput
) {
    await asegurarLoteExiste(loteId);

    const setFragments: string[] = [];
    const valores: Array<string | number> = [];

    if (input.estado) {
        valores.push(input.estado);
        setFragments.push(`estado = $${valores.length}`);
    }

    if (typeof input.procesados === 'number') {
        valores.push(input.procesados);
        setFragments.push(`procesados = $${valores.length}`);
    }

    if (typeof input.errores === 'number') {
        valores.push(input.errores);
        setFragments.push(`errores = $${valores.length}`);
    }

    if (typeof input.totalRegistros === 'number') {
        valores.push(input.totalRegistros);
        setFragments.push(`total_registros = $${valores.length}`);
    }

    if (input.descripcion !== undefined) {
        valores.push(input.descripcion);
        setFragments.push(`descripcion = $${valores.length}`);
    }

    if (!setFragments.length) {
        throw new Error('No hay campos para actualizar');
    }

    valores.push(loteId);

    const { rows } = await pool.query(
        `UPDATE lotes_importacion
         SET ${setFragments.join(', ')}
         WHERE id = $${valores.length}
         RETURNING id, tipo_lote, descripcion, archivo_fuente, total_registros, procesados, errores, estado`,
        valores
    );

    return rows[0];
}

/** Descarta un lote pendiente sin filas cargadas (p. ej. falló la validación tras crear el lote). */
export async function descartarLotePendienteSinRegistros(loteId: number): Promise<boolean> {
    const { rowCount } = await pool.query(
        `DELETE FROM lotes_importacion l
         WHERE l.id = $1
           AND LOWER(TRIM(l.estado)) = 'pendiente'
           AND NOT EXISTS (
               SELECT 1 FROM registros_importacion r WHERE r.lote_id = l.id
           )`,
        [loteId]
    );
    return (rowCount ?? 0) > 0;
}

/** Elimina un lote y sus registros (CASCADE) si está pendiente o falló al confirmar. */
export async function eliminarLotePendiente(loteId: number): Promise<{ eliminado: true }> {
    const { rowCount } = await pool.query(
        `DELETE FROM lotes_importacion
         WHERE id = $1 AND LOWER(TRIM(estado)) IN ('pendiente', 'error')`,
        [loteId]
    );
    if (!rowCount) {
        throw new Error('No se encontró un lote descartable (solo pendientes o con errores; quizá ya fue confirmado o no existe).');
    }
    return { eliminado: true };
}

function normalizarClaveCampo(valor: string): string {
    return valor
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

function extraerValorDesdeFila(datos: DatosFilaImportacion, aliases: string[]): string | null {
    const normalizadas = aliases.map(normalizarClaveCampo);
    for (const [clave, valor] of Object.entries(datos ?? {})) {
        const claveNorm = normalizarClaveCampo(clave);
        if (!normalizadas.includes(claveNorm)) {
            continue;
        }

        if (valor === undefined || valor === null) {
            return null;
        }

        const texto = String(valor).trim();
        if (!texto) {
            return null;
        }

        return texto;
    }
    return null;
}

function resolverCampoDestino(claveOriginal: string, config: LoteDestinoConfig): string | null {
    if (config.campos.includes(claveOriginal)) {
        return claveOriginal;
    }
    const normalizada = normalizarClaveCampo(claveOriginal);
    if (config.campos.includes(normalizada)) {
        return normalizada;
    }

    for (const [campoDestino, aliases] of Object.entries(config.alias ?? {})) {
        if (!config.campos.includes(campoDestino)) {
            continue;
        }
        const coincidencia = aliases.some((alias) => normalizarClaveCampo(alias) === normalizada);
        if (coincidencia) {
            return campoDestino;
        }
    }

    return null;
}

/** Semestre curricular indicado en la descripción del lote (misma regla que listar lotes / académico). */
function extraerSemestreDesdeDescripcionLoteImport(descripcion: string | null | undefined): number | null {
    if (!descripcion) return null;
    const m1 = descripcion.match(/semestre\s*(\d{1,2})/i);
    if (m1) return Number(m1[1]);
    const m2 = descripcion.match(/(\d{1,2})\s*°?\s*semestre/i);
    if (m2) return Number(m2[1]);
    return null;
}

function normalizarEtiquetaComparacion(valor: string): string {
    return valor
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/** Coincidencia laxa entre texto de planilla y nombre oficial (facultad/carrera). */
function textoCompatiblePlanillaVsDestino(planilla: string, oficial: string): boolean {
    const p = normalizarEtiquetaComparacion(planilla);
    const o = normalizarEtiquetaComparacion(oficial);
    if (!p || !o) return true;
    if (p === o) return true;
    if (p.length >= 3 && (o.includes(p) || p.includes(o))) return true;
    const palabrasO = o.split(' ').filter((w) => w.length > 2);
    const palabrasP = new Set(p.split(' ').filter((w) => w.length > 2));
    const hits = palabrasO.filter((w) => palabrasP.has(w)).length;
    if (hits >= 2) return true;
    if (hits === 1 && palabrasO.length <= 3) return true;
    return false;
}

function parsearSemestreDesdeTextoPlanilla(valor: unknown): number | null {
    if (valor === undefined || valor === null) return null;
    const s = String(valor).trim();
    if (!s) return null;
    const m = s.match(/(\d{1,2})/);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > 10) return null;
    return Math.trunc(n);
}

function extraerDeclaracionPlanilla(
    datos: Record<string, unknown>,
    campo: 'carrera' | 'facultad' | 'semestre'
): string | null {
    const clave =
        campo === 'carrera' ? '_planilla_carrera' : campo === 'facultad' ? '_planilla_facultad' : '_planilla_semestre';
    const v = datos[clave];
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s || null;
}

const ALIASES_DOCUMENTO_IMPORT = [
    'numero_documento',
    'ci',
    'cedula',
    'cedula_identidad',
    'cedula de identidad',
    'cedula de identidad civil',
    'cedula_identidad_civil',
    'documento',
    'num_documento',
    'num doc',
    'numero_doc',
    'documento_numero',
    'numero_c'
];

/**
 * Evita cargar una planilla incoherente con el destino (carrera/facultad/semestre declarados en el Excel)
 * o con alumnos ya registrados en otra carrera. No impide promoción: al cambiar de semestre o carrera destino
 * las comprobaciones se aplican al nuevo destino.
 */
async function validarCoherenciaRegistrosAlumnosImportacion(
    cliente: PoolClient,
    lote: {
        tipo_lote: string;
        destino_carrera: string | null;
        destino_facultad: string | null;
        destino_carrera_id: number | null;
        descripcion: string | null;
    },
    registros: RegistroImportacionInput[]
) {
    if (lote.tipo_lote !== 'alumnos') {
        return;
    }

    const semDestino = extraerSemestreDesdeDescripcionLoteImport(lote.descripcion);
    const declaracionesCarrera = new Set<string>();

    for (const reg of registros) {
        const datos = reg.datos ?? {};
        const car = extraerDeclaracionPlanilla(datos, 'carrera');
        const fac = extraerDeclaracionPlanilla(datos, 'facultad');
        const semPla = extraerDeclaracionPlanilla(datos, 'semestre');

        if (car) {
            declaracionesCarrera.add(normalizarEtiquetaComparacion(car));
            if (lote.destino_carrera && !textoCompatiblePlanillaVsDestino(car, lote.destino_carrera)) {
                throw new Error(
                    `Fila ${reg.fila ?? '?'}: la planilla indica la carrera "${car}" y no coincide con la carrera destino seleccionada "${lote.destino_carrera}".`
                );
            }
        }
        if (fac && lote.destino_facultad && !textoCompatiblePlanillaVsDestino(fac, lote.destino_facultad)) {
            throw new Error(
                `Fila ${reg.fila ?? '?'}: la planilla indica la facultad "${fac}" y no coincide con la facultad destino seleccionada "${lote.destino_facultad}".`
            );
        }
        if (semPla && semDestino != null) {
            const sParsed = parsearSemestreDesdeTextoPlanilla(semPla);
            if (sParsed != null && sParsed !== semDestino) {
                throw new Error(
                    `Fila ${reg.fila ?? '?'}: la planilla indica semestre "${semPla}" y el destino elegido es el ${semDestino}° semestre.`
                );
            }
        }
    }

    if (declaracionesCarrera.size > 1) {
        throw new Error(
            'La planilla declara más de una carrera distinta en las filas. Revisá el archivo o el destino académico seleccionado.'
        );
    }

    const carreraIdDest = lote.destino_carrera_id;
    if (!carreraIdDest || carreraIdDest <= 0) {
        return;
    }

    const docs: string[] = [];
    for (const reg of registros) {
        const doc = extraerValorDesdeFila(reg.datos ?? {}, ALIASES_DOCUMENTO_IMPORT);
        if (doc) {
            docs.push(doc.trim());
        }
    }
    const uniqueDocs = [...new Set(docs)];
    if (!uniqueDocs.length) {
        return;
    }

    const { rows: malAsignados } = await cliente.query<{ doc: string; carrera: string; nombre: string | null }>(
        `SELECT TRIM(BOTH FROM a.numero_documento) AS doc, c.nombre AS carrera,
                a.nombre_apellido AS nombre
         FROM alumnos a
         INNER JOIN carreras c ON c.id = a.referencia_carrera_id
         WHERE TRIM(BOTH FROM a.numero_documento) = ANY($1::text[])
           AND a.referencia_carrera_id IS NOT NULL`,
        [uniqueDocs]
    );

    if (malAsignados.length) {
        throw new Error(formatearErrorAlumnosOtraCarrera(malAsignados, lote.destino_carrera));
    }
}

/** Mensaje: alumnos del Excel ya registrados en el sistema. */
function formatearErrorAlumnosOtraCarrera(
    conflictos: Array<{ doc: string; carrera: string; nombre: string | null }>,
    _carreraDestino: string | null
): string {
    const n = conflictos.length;
    if (n === 1) {
        const unico = conflictos[0];
        return `El alumno «${unico.nombre || 'Sin nombre'}» (CI ${unico.doc}) ya está registrado en ${unico.carrera}.`;
    }
    if (n <= 5) {
        const lista = conflictos.map((c) => `${c.nombre || 'Sin nombre'} (CI ${c.doc})`).join(' · ');
        return `${n} alumnos ya están registrados en ${conflictos[0].carrera}: ${lista}`;
    }
    return `${n} alumnos ya están registrados en ${conflictos[0].carrera}.`;
}

function prepararPayloadRegistro(
    datos: Record<string, unknown> | null,
    config: LoteDestinoConfig,
    tipoLote?: string
): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    const origen = datos ?? {};

    for (const [clave, valor] of Object.entries(origen)) {
        const campoDestino = resolverCampoDestino(clave, config);
        if (!campoDestino) {
            continue;
        }
        payload[campoDestino] = valor;
    }

    for (const [campo, valorDefault] of Object.entries(config.defaults ?? {})) {
        const valorActual = payload[campo];
        if (valorActual === undefined || valorActual === null || valorActual === '') {
            payload[campo] = valorDefault;
        }
    }

    if (tipoLote === 'alumnos') {
        const nombreCompleto = String(payload.nombre_apellido ?? '').trim();

        if (nombreCompleto && (!payload.apellidos || !payload.nombres)) {
            if (nombreCompleto.includes(',')) {
                const partes = nombreCompleto.split(',');
                payload.apellidos = partes[0].trim();
                payload.nombres = partes.slice(1).join(',').trim();
            } else {
                const partes = nombreCompleto.split(/\s+/);
                payload.nombres = partes[0];
                payload.apellidos = partes.slice(1).join(' ') || partes[0];
            }
        }

        if (!payload.nombre_apellido && (payload.apellidos || payload.nombres)) {
            payload.nombre_apellido = [payload.apellidos, payload.nombres].filter(Boolean).join(', ');
        }

        if (!payload.apellidos) payload.apellidos = payload.nombre_apellido || 'S/A';
        if (!payload.nombres) payload.nombres = payload.nombre_apellido || 'S/N';

        delete payload.numero_orden;

        const doc = String(payload.numero_documento ?? '').trim();
        const nombreFinal = String(payload.nombre_apellido ?? '').trim();
        if (!doc) {
            throw new Error('Falta el campo obligatorio "numero_documento" (CI)');
        }
        if (!nombreFinal) {
            throw new Error('Falta el campo obligatorio "nombre_apellido" (o apellidos + nombres)');
        }
    }

    for (const requerido of config.requeridos ?? []) {
        // In matriculas, alumno_id can be resolved later from CI/nombre-apellido.
        if (tipoLote === 'matriculas' && requerido === 'alumno_id') {
            continue;
        }
        const valor = payload[requerido];
        if (valor === undefined || valor === null || (typeof valor === 'string' && !valor.trim())) {
            throw new Error(`Falta el campo obligatorio "${requerido}"`);
        }
    }

    return payload;
}

/** Tras procesar filas, fija referencia_carrera_id por CI en JSON para todo alumno del lote (importación). */
async function aplicarReferenciaCarreraDesdeLoteAlumnos(
    cliente: PoolClient,
    loteId: number,
    carreraId: number
): Promise<void> {
    await cliente.query(
        `
        UPDATE alumnos al
        SET referencia_carrera_id = $2
        FROM (
            SELECT DISTINCT TRIM(BOTH FROM NULLIF(
                COALESCE(
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
                    ri.datos->>'num doc',
                    ri.datos->>'numero_doc',
                    ri.datos->>'documento_numero',
                    ri.datos->>'numero_c'
                ),
                ''
            )) AS doc
            FROM registros_importacion ri
            WHERE ri.lote_id = $1 AND ri.valido = TRUE
        ) docs
        WHERE TRIM(al.numero_documento) = docs.doc
          AND docs.doc IS NOT NULL
          AND docs.doc <> ''
        `,
        [loteId, carreraId]
    );
}

interface FilaProcesada {
    registroId: number;
    payload: Record<string, unknown>;
    datosOriginales: Record<string, unknown> | null;
}

interface FilaError {
    registroId: number;
    mensaje: string;
}

function prepararPayloadsRegistros(
    rows: Array<{ id: number; datos: Record<string, unknown> | null }>,
    config: LoteDestinoConfig,
    tipoLote: string
): { validas: FilaProcesada[]; errores: FilaError[] } {
    const validas: FilaProcesada[] = [];
    const errores: FilaError[] = [];

    for (const registro of rows) {
        try {
            const payload = prepararPayloadRegistro(registro.datos, config, tipoLote);
            validas.push({ registroId: registro.id, payload, datosOriginales: registro.datos });
        } catch (e) {
            errores.push({
                registroId: registro.id,
                mensaje: e instanceof Error ? e.message : 'Error preparando el registro'
            });
        }
    }

    return { validas, errores };
}

async function batchInsertarRegistros(
    cliente: PoolClient,
    config: LoteDestinoConfig,
    filas: FilaProcesada[]
): Promise<{ insertados: number; errores: FilaError[] }> {
    if (!filas.length) return { insertados: 0, errores: [] };

    const columnasSet = new Set<string>();
    for (const f of filas) for (const col of Object.keys(f.payload)) columnasSet.add(col);
    const columnas = Array.from(columnasSet);
    if (!columnas.length) {
        return {
            insertados: 0,
            errores: filas.map((f) => ({ registroId: f.registroId, mensaje: 'No se encontraron columnas válidas' }))
        };
    }

    for (const f of filas) {
        for (const col of columnas) {
            if (!(col in f.payload)) f.payload[col] = null;
        }
    }

    const arrays: unknown[][] = columnas.map((col) => filas.map((f) => f.payload[col]));
    const unnestParts = columnas.map((col, i) => `$${i + 1}::${tipoSqlColumna(col)}`);
    const conflicto = config.conflictTarget ? `ON CONFLICT ${config.conflictTarget} DO NOTHING` : '';

    const sql = `
        INSERT INTO ${config.tabla} (${columnas.join(', ')})
        SELECT * FROM unnest(${unnestParts.join(', ')})
        ${conflicto}
    `;

    try {
        await cliente.query('SAVEPOINT antes_del_batch');
        const result = await cliente.query(sql, arrays);
        await cliente.query('RELEASE SAVEPOINT antes_del_batch');
        return { insertados: result.rowCount ?? filas.length, errores: [] };
    } catch {
        await cliente.query('ROLLBACK TO SAVEPOINT antes_del_batch');
        return await insertarRegistrosFilaPorFila(cliente, config, filas, columnas);
    }
}

async function insertarRegistrosFilaPorFila(
    cliente: PoolClient,
    config: LoteDestinoConfig,
    filas: FilaProcesada[],
    columnas: string[]
): Promise<{ insertados: number; errores: FilaError[] }> {
    let insertados = 0;
    const errores: FilaError[] = [];
    const conflicto = config.conflictTarget ? `ON CONFLICT ${config.conflictTarget} DO NOTHING` : '';

    for (const f of filas) {
        const valores = columnas.map((col) => f.payload[col]);
        const placeholders = columnas.map((_, i) => `$${i + 1}`);
        const sql = `INSERT INTO ${config.tabla} (${columnas.join(', ')}) VALUES (${placeholders.join(', ')}) ${conflicto}`.trim();
        try {
            const result = await cliente.query(sql, valores);
            if ((result.rowCount ?? 0) > 0) insertados++;
        } catch (e) {
            errores.push({
                registroId: f.registroId,
                mensaje: e instanceof Error ? e.message : 'Error insertando el registro'
            });
        }
    }

    return { insertados, errores };
}

function asignarOrdenListaImportacionMatriculas(filas: FilaProcesada[]): void {
    const contadorPorCurso = new Map<number, number>();
    for (const fila of filas) {
        const cursoId = Number(fila.payload.curso_id);
        if (!Number.isFinite(cursoId) || cursoId <= 0) {
            continue;
        }
        const siguiente = (contadorPorCurso.get(cursoId) ?? 0) + 1;
        contadorPorCurso.set(cursoId, siguiente);
        fila.payload.orden_lista = siguiente;
    }
}

function tipoSqlColumna(col: string): string {
    const mapa: Record<string, string> = {
        facultad_id: 'integer',
        carrera_id: 'integer',
        alumno_id: 'integer',
        curso_id: 'integer',
        plan_id: 'integer',
        usuario_id: 'uuid',
        anio_vigencia: 'integer',
        estado: 'boolean',
        porcentaje_asistencia: 'numeric',
        faltas_acumuladas: 'integer',
        justificaciones_aprobadas: 'integer',
        referencia_carrera_id: 'integer',
        semestre_curricular: 'integer',
        cohorte_anio: 'integer',
        fecha_inscripcion: 'date',
        orden_lista: 'integer'
    };
    return mapa[col] ?? 'text';
}

function prepararColumnasAlumnos(filas: FilaProcesada[]): string[] {
    const columnasSet = new Set<string>();
    for (const f of filas) for (const col of Object.keys(f.payload)) columnasSet.add(col);
    const columnas = Array.from(columnasSet);
    for (const f of filas) {
        for (const col of columnas) {
            if (!(col in f.payload)) f.payload[col] = null;
        }
    }
    return columnas;
}

async function batchInsertarAlumnos(
    cliente: PoolClient,
    filas: FilaProcesada[],
    incluyeCohorte: boolean
): Promise<{ insertados: number; errores: FilaError[] }> {
    if (!filas.length) return { insertados: 0, errores: [] };

    const columnas = prepararColumnasAlumnos(filas);
    if (!columnas.length) {
        return {
            insertados: 0,
            errores: filas.map((f) => ({ registroId: f.registroId, mensaje: 'No se encontraron columnas válidas' }))
        };
    }

    const arrays = columnas.map((col) => filas.map((f) => f.payload[col]));
    const unnestParts = columnas.map((col, i) => `$${i + 1}::${tipoSqlColumna(col)}`);
    const setCohorte = incluyeCohorte
        ? `referencia_carrera_id = COALESCE(EXCLUDED.referencia_carrera_id, alumnos.referencia_carrera_id),
            cohorte_anio = COALESCE(EXCLUDED.cohorte_anio, alumnos.cohorte_anio)`
        : `referencia_carrera_id = COALESCE(EXCLUDED.referencia_carrera_id, alumnos.referencia_carrera_id)`;

    const sql = `
        INSERT INTO alumnos (${columnas.join(', ')})
        SELECT * FROM unnest(${unnestParts.join(', ')})
        ON CONFLICT (numero_documento) DO UPDATE SET ${setCohorte}
    `;

    try {
        await cliente.query('SAVEPOINT antes_batch_alumnos');
        const result = await cliente.query(sql, arrays);
        await cliente.query('RELEASE SAVEPOINT antes_batch_alumnos');
        return { insertados: result.rowCount ?? filas.length, errores: [] };
    } catch {
        await cliente.query('ROLLBACK TO SAVEPOINT antes_batch_alumnos');
        return await insertarAlumnosFilaPorFila(cliente, filas, columnas, incluyeCohorte);
    }
}

/** Batch de alumnos con SAVEPOINT integrado: si el UNNEST falla, fallback fila por fila. */
async function insertarAlumnosConSavepoint(
    cliente: PoolClient,
    validas: FilaProcesada[],
    incluyeCohorte: boolean
): Promise<{ insertados: number; errores: FilaError[] }> {
    return await batchInsertarAlumnos(cliente, validas, incluyeCohorte);
}

async function insertarAlumnosFilaPorFila(
    cliente: PoolClient,
    filas: FilaProcesada[],
    columnas: string[],
    incluyeCohorte: boolean
): Promise<{ insertados: number; errores: FilaError[] }> {
    let insertados = 0;
    const errores: FilaError[] = [];
    const setCohorte = incluyeCohorte
        ? `referencia_carrera_id = COALESCE(EXCLUDED.referencia_carrera_id, alumnos.referencia_carrera_id),
            cohorte_anio = COALESCE(EXCLUDED.cohorte_anio, alumnos.cohorte_anio)`
        : `referencia_carrera_id = COALESCE(EXCLUDED.referencia_carrera_id, alumnos.referencia_carrera_id)`;

    for (const f of filas) {
        const valores = columnas.map((col) => f.payload[col]);
        const placeholders = columnas.map((_, i) => `$${i + 1}`);
        const sql = `INSERT INTO alumnos (${columnas.join(', ')}) VALUES (${placeholders.join(', ')})
            ON CONFLICT (numero_documento) DO UPDATE SET ${setCohorte}`.trim();
        try {
            await cliente.query('SAVEPOINT fila_alumno');
            const result = await cliente.query(sql, valores);
            await cliente.query('RELEASE SAVEPOINT fila_alumno');
            if ((result.rowCount ?? 0) > 0) insertados++;
        } catch (e) {
            try {
                await cliente.query('ROLLBACK TO SAVEPOINT fila_alumno');
            } catch {
                /* savepoint inexistente si falló antes de crearlo */
            }
            errores.push({
                registroId: f.registroId,
                mensaje: mensajeErrorAlumno(e, 'Error insertando alumno')
            });
        }
    }

    return { insertados, errores };
}

async function batchResolverAlumnoIds(
    cliente: PoolClient,
    filas: FilaProcesada[]
): Promise<{ resueltas: FilaProcesada[]; errores: FilaError[] }> {
    const resueltas: FilaProcesada[] = [];
    const errores: FilaError[] = [];
    const pendientesCi: { idx: number; ci: string }[] = [];
    const pendientesNombre: { idx: number; nombres: string; apellidos: string }[] = [];

    for (let i = 0; i < filas.length; i++) {
        const f = filas[i];
        const alumnoIdDirecto = Number(f.payload.alumno_id);
        if (!Number.isNaN(alumnoIdDirecto) && alumnoIdDirecto > 0) {
            resueltas.push(f);
            continue;
        }

        const alumnoIdDesdeFila = Number(extraerValorDesdeFila(f.datosOriginales ?? {}, ['alumno_id', 'id_alumno', 'alumnoid']));
        if (!Number.isNaN(alumnoIdDesdeFila) && alumnoIdDesdeFila > 0) {
            f.payload.alumno_id = alumnoIdDesdeFila;
            resueltas.push(f);
            continue;
        }

        const numeroDocumento = extraerValorDesdeFila(f.datosOriginales ?? {}, ALIASES_DOCUMENTO_IMPORT);
        if (numeroDocumento) {
            pendientesCi.push({ idx: i, ci: numeroDocumento.trim() });
        } else {
            const nombres = extraerValorDesdeFila(f.datosOriginales ?? {}, ['nombres', 'nombre']);
            const apellidos = extraerValorDesdeFila(f.datosOriginales ?? {}, ['apellidos', 'apellido']);
            if (nombres && apellidos) {
                pendientesNombre.push({ idx: i, nombres, apellidos });
            } else {
                errores.push({
                    registroId: f.registroId,
                    mensaje: 'Falta el campo obligatorio "alumno_id" (no se pudo resolver por CI/numero_documento ni por nombre/apellido)'
                });
            }
        }
    }

    if (pendientesCi.length) {
        const cis = pendientesCi.map((p) => p.ci);
        const { rows: encontrados } = await cliente.query<{ numero_documento: string; id: number }>(
            `SELECT TRIM(BOTH FROM numero_documento) AS numero_documento, id
             FROM alumnos
             WHERE TRIM(BOTH FROM numero_documento) = ANY($1::text[])`,
            [cis]
        );
        const mapa = new Map(encontrados.map((r) => [r.numero_documento, r.id]));
        for (const p of pendientesCi) {
            const id = mapa.get(p.ci) ?? mapa.get(p.ci.trim());
            if (id) {
                filas[p.idx].payload.alumno_id = id;
                resueltas.push(filas[p.idx]);
            } else {
                const nombres = extraerValorDesdeFila(filas[p.idx].datosOriginales ?? {}, ['nombres', 'nombre']);
                const apellidos = extraerValorDesdeFila(filas[p.idx].datosOriginales ?? {}, ['apellidos', 'apellido']);
                if (nombres && apellidos) {
                    pendientesNombre.push({ idx: p.idx, nombres, apellidos });
                } else {
                    errores.push({
                        registroId: filas[p.idx].registroId,
                        mensaje: 'Falta el campo obligatorio "alumno_id" (no se pudo resolver por CI/numero_documento ni por nombre/apellido)'
                    });
                }
            }
        }
    }

    if (pendientesNombre.length) {
        for (const p of pendientesNombre) {
            const { rows: candidatos } = await cliente.query<{ id: number }>(
                `SELECT id
                 FROM alumnos
                 WHERE LOWER(TRIM(nombres)) = LOWER(TRIM($1))
                   AND LOWER(TRIM(apellidos)) = LOWER(TRIM($2))
                 ORDER BY id
                 LIMIT 2`,
                [p.nombres, p.apellidos]
            );
            if (candidatos.length === 1) {
                filas[p.idx].payload.alumno_id = candidatos[0].id;
                resueltas.push(filas[p.idx]);
            } else if (candidatos.length > 1) {
                errores.push({
                    registroId: filas[p.idx].registroId,
                    mensaje: `Alumno ambiguo para ${p.apellidos}, ${p.nombres}; usa CI (ci/numero_documento) o alumno_id`
                });
            } else {
                errores.push({
                    registroId: filas[p.idx].registroId,
                    mensaje: 'Falta el campo obligatorio "alumno_id" (no se pudo resolver por CI/numero_documento ni por nombre/apellido)'
                });
            }
        }
    }

    return { resueltas, errores };
}

async function procesarLoteDestino(loteId: number, config: LoteDestinoConfig, tipoLote: string) {
    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');
        const { rows: loteRows } = await cliente.query<{
            destino_facultad_id: number | null;
            destino_carrera_id: number | null;
            descripcion: string | null;
            cohorte_anio: number | null;
        }>(
            `SELECT destino_facultad_id, destino_carrera_id, descripcion, cohorte_anio
             FROM lotes_importacion
             WHERE id = $1`,
            [loteId]
        );

        const contextoLote: ContextoLoteDestino = {
            destinoFacultadId: loteRows[0]?.destino_facultad_id ?? undefined,
            destinoCarreraId: loteRows[0]?.destino_carrera_id ?? undefined
        };

        const loteCohorteAnioRaw = loteRows[0]?.cohorte_anio;
        const loteCohorteAnio =
            loteCohorteAnioRaw != null &&
            Number.isFinite(Number(loteCohorteAnioRaw)) &&
            Number(loteCohorteAnioRaw) >= 1990 &&
            Number(loteCohorteAnioRaw) <= 2100
                ? Math.trunc(Number(loteCohorteAnioRaw))
                : null;

        const semParsed = extraerSemestreDesdeDescripcionLoteImport(loteRows[0]?.descripcion ?? null);
        const semestreCurricularDesdeLote =
            semParsed != null && Number.isFinite(semParsed) && semParsed >= 1 && semParsed <= 10
                ? Math.trunc(semParsed)
                : null;

        const { rows } = await cliente.query<{
            id: number;
            datos: Record<string, unknown> | null;
        }>(
            `SELECT id, datos FROM registros_importacion WHERE lote_id = $1 ORDER BY COALESCE(fila, 0), id`,
            [loteId]
        );

        if (!rows.length) {
            throw new Error('El lote no contiene registros para procesar');
        }

        let procesados = 0;
        let errores = 0;
        const todosErrores: FilaError[] = [];

        const { validas, errores: erroresPrep } = prepararPayloadsRegistros(rows, config, tipoLote);
        todosErrores.push(...erroresPrep);

        if (tipoLote === 'alumnos' && validas.length) {
            if (contextoLote.destinoCarreraId) {
                const params: number[] = [contextoLote.destinoCarreraId];
                let sql = `SELECT 1 FROM carreras WHERE id = $1`;
                if (contextoLote.destinoFacultadId) {
                    sql += ` AND facultad_id = $2`;
                    params.push(contextoLote.destinoFacultadId);
                }
                const { rowCount } = await cliente.query(sql, params);
                if (!rowCount) {
                    for (const f of validas) {
                        todosErrores.push({ registroId: f.registroId, mensaje: 'La carrera destino del lote no coincide con la facultad indicada' });
                    }
                } else {
                    for (const f of validas) {
                        f.payload.referencia_carrera_id = contextoLote.destinoCarreraId;
                    }
                    if (semestreCurricularDesdeLote != null) {
                        for (const f of validas) f.payload.semestre_curricular = semestreCurricularDesdeLote;
                    }
                    if (loteCohorteAnio != null) {
                        for (const f of validas) f.payload.cohorte_anio = loteCohorteAnio;
                    }
                    const incluyeCohorte = validas.some((f) => 'cohorte_anio' in f.payload);
                    const result = await insertarAlumnosConSavepoint(cliente, validas, incluyeCohorte);
                    procesados += result.insertados;
                    todosErrores.push(...result.errores);
                }
            } else {
                if (semestreCurricularDesdeLote != null) {
                    for (const f of validas) f.payload.semestre_curricular = semestreCurricularDesdeLote;
                }
                if (loteCohorteAnio != null) {
                    for (const f of validas) f.payload.cohorte_anio = loteCohorteAnio;
                }
                const incluyeCohorte = validas.some((f) => 'cohorte_anio' in f.payload);
                const result = await insertarAlumnosConSavepoint(cliente, validas, incluyeCohorte);
                procesados += result.insertados;
                todosErrores.push(...result.errores);
            }
        } else if (tipoLote === 'matriculas' && validas.length) {
            const { resueltas, errores: erroresResolucion } = await batchResolverAlumnoIds(cliente, validas);
            todosErrores.push(...erroresResolucion);

            let cursoMap = new Map<number, { carrera_id: number; facultad_id: number }>();
            if (contextoLote.destinoCarreraId || contextoLote.destinoFacultadId) {
                const cursoIdsUnicos = [...new Set(
                    resueltas
                        .map((f) => Number(f.payload.curso_id))
                        .filter((id) => Number.isFinite(id) && id > 0)
                )];
                if (cursoIdsUnicos.length) {
                    const { rows: cursoRows } = await cliente.query<{ id: number; carrera_id: number; facultad_id: number }>(
                        `SELECT c.id, crr.id AS carrera_id, f.id AS facultad_id
                         FROM cursos c
                         JOIN modulos_academicos ma ON ma.id = c.modulo_id
                         JOIN materias m ON m.id = ma.materia_id
                         JOIN planes_estudio p ON p.id = m.plan_id
                         JOIN carreras crr ON crr.id = p.carrera_id
                         JOIN facultades f ON f.id = crr.facultad_id
                         WHERE c.id = ANY($1::int[])`,
                        [cursoIdsUnicos]
                    );
                    for (const r of cursoRows) {
                        cursoMap.set(r.id, { carrera_id: r.carrera_id, facultad_id: r.facultad_id });
                    }
                }
            }

            const validasConCurso: FilaProcesada[] = [];
            for (const f of resueltas) {
                const cursoId = Number(f.payload.curso_id);
                if (Number.isNaN(cursoId) || cursoId <= 0) {
                    todosErrores.push({ registroId: f.registroId, mensaje: 'Falta el campo obligatorio "curso_id" para matrícula' });
                    continue;
                }

                if (contextoLote.destinoCarreraId || contextoLote.destinoFacultadId) {
                    const curso = cursoMap.get(cursoId);
                    if (!curso) {
                        todosErrores.push({ registroId: f.registroId, mensaje: 'El curso_id indicado no existe' });
                        continue;
                    }
                    if (contextoLote.destinoCarreraId && curso.carrera_id !== contextoLote.destinoCarreraId) {
                        todosErrores.push({ registroId: f.registroId, mensaje: 'El curso_id no corresponde a la carrera destino seleccionada' });
                        continue;
                    }
                    if (contextoLote.destinoFacultadId && curso.facultad_id !== contextoLote.destinoFacultadId) {
                        todosErrores.push({ registroId: f.registroId, mensaje: 'El curso_id no corresponde a la facultad destino seleccionada' });
                        continue;
                    }
                }

                validasConCurso.push(f);
            }

            if (validasConCurso.length) {
                asignarOrdenListaImportacionMatriculas(validasConCurso);
                const result = await batchInsertarRegistros(cliente, config, validasConCurso);
                procesados += result.insertados;
                todosErrores.push(...result.errores);
            }
        } else if (validas.length) {
            const result = await batchInsertarRegistros(cliente, config, validas);
            procesados += result.insertados;
            todosErrores.push(...result.errores);
        }

        errores = todosErrores.length;

        const idsValidos = validas
            .map((f) => f.registroId)
            .filter((id) => !todosErrores.some((e) => e.registroId === id));
        const idsInvalidos = todosErrores.map((e) => e.registroId);

        if (idsValidos.length) {
            await cliente.query(
                `UPDATE registros_importacion SET valido = TRUE, mensaje_error = NULL WHERE id = ANY($1::int[])`,
                [idsValidos]
            );
        }

        if (todosErrores.length) {
            const errIds = todosErrores.map((e) => e.registroId);
            const errMsgs = todosErrores.map((e) => e.mensaje);
            await cliente.query(
                `UPDATE registros_importacion ri
                 SET valido = FALSE, mensaje_error = u.msg
                 FROM unnest($1::int[], $2::text[]) AS u(id, msg)
                 WHERE ri.id = u.id`,
                [errIds, errMsgs]
            );
        }

        if (tipoLote === 'alumnos' && contextoLote.destinoCarreraId) {
            await aplicarReferenciaCarreraDesdeLoteAlumnos(cliente, loteId, contextoLote.destinoCarreraId);
        }

        const estadoFinal = errores ? 'error' : 'completado';

        await cliente.query(
            `UPDATE lotes_importacion
             SET estado = $2,
                 procesados = $3,
                 errores = $4,
                 ejecutado_en = NOW()
             WHERE id = $1`,
            [loteId, estadoFinal, procesados, errores]
        );

        await cliente.query('COMMIT');

        return { loteId, estado: estadoFinal, procesados, errores };
    } catch (error) {
        await cliente.query('ROLLBACK');
        throw error;
    } finally {
        cliente.release();
    }
}

export async function confirmarLote(loteId: number) {
    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');

        const { rows } = await cliente.query<{ id: number; tipo_lote: string }>(
            `SELECT id, tipo_lote FROM lotes_importacion WHERE id = $1 AND LOWER(TRIM(estado)) = 'pendiente' FOR UPDATE`,
            [loteId]
        );
        const lote = rows[0];
        if (!lote) {
            await cliente.query('ROLLBACK');
            throw new Error('El lote no existe o ya no está pendiente de confirmación');
        }

        const config = LOTE_DESTINOS[lote.tipo_lote];
        if (!config) {
            await cliente.query('ROLLBACK');
            throw new Error(`El tipo de lote "${lote.tipo_lote}" no tiene un destino configurado`);
        }

        await cliente.query('COMMIT');
        return procesarLoteDestino(loteId, config, lote.tipo_lote);
    } catch (error) {
        try { await cliente.query('ROLLBACK'); } catch (_e) { /* already rolled back or committed */ }
        throw error;
    } finally {
        cliente.release();
    }
}

export async function listarDestinosAcademicos() {
    const { rows } = await pool.query<DestinoAcademicoFila>(
        `SELECT
            f.id AS facultad_id,
            f.nombre AS facultad_nombre,
            c.id AS carrera_id,
            c.nombre AS carrera_nombre
         FROM facultades f
         LEFT JOIN carreras c ON c.facultad_id = f.id
         WHERE f.estado = TRUE
         ORDER BY f.nombre ASC, c.nombre ASC`
    );

    const facultadesMap = new Map<number, { id: number; nombre: string }>();
    const carreras: Array<{ id: number; nombre: string; facultadId: number }> = [];

    for (const row of rows) {
        if (!facultadesMap.has(row.facultad_id)) {
            facultadesMap.set(row.facultad_id, {
                id: row.facultad_id,
                nombre: row.facultad_nombre
            });
        }

        if (row.carrera_id) {
            carreras.push({
                id: row.carrera_id,
                nombre: row.carrera_nombre ?? '',
                facultadId: row.facultad_id
            });
        }
    }

    return {
        facultades: Array.from(facultadesMap.values()),
        carreras
    };
}
