import { pool } from '../../config/database';
import type { AlcanceMatriculasFacultad } from '../../utils/alumnos-scope';
import { alumnoCarreraReferenciaEnAlcance, assertCursoEnAlcance, ForbiddenScopeError } from '../../utils/alumnos-scope';
import { generarPlanillaLegalPdf } from './reportes.pdf';
import { generarActaHabilitadosPdf } from './reportes.habilitados.pdf';
import { generarInformeAlumnoPdf } from './reportes.alumno.pdf';
import { generarConsolidadoRiesgoPdf } from './reportes.pdf.consolidado';
import { generarPdfAusentismoFacultadCarrera } from './reportes.pdf.ausentismo';
import { SQL_ALUMNO_APELLIDOS_COMA_NOMBRES, SQL_ORDEN_MATRICULA_PLANILLA } from '../../utils/alumno-nombre-sql';
import { generarNombrePdfElegante } from './reportes.utils';
import {
    obtenerActaGeneradaPorId,
    registrarActaGenerada,
    type ActaGeneradaRow,
} from '../../services/actas-generadas.service';
import { construirExportAuditoriaPdfBuffer, type FiltroEventosAuditoria } from '../auditoria/auditoria.service';
import { construirExportUsuariosPdfBuffer, type UsuarioFiltro } from '../usuarios/usuarios.service';
import { generateCronogramaBody, type CronogramaPdfData } from './reportes.cronograma.pdf';
import { generarNombrePdfElegante as generarNombrePdf } from './reportes.utils';
import { renderPdfDocumentToBuffer } from '../../utils/pdf-buffer';

export interface PdfGeneradoConActa {
    acta: ActaGeneradaRow;
    buffer: Buffer;
    fileName: string;
}

interface PdfBufferResult {
    buffer: Buffer;
    fileName: string;
}

interface AlertasFiltro {
    estado?: string;
    tipo?: string;
    cursoId?: number;
    facultadId?: number;
    carreraId?: number;
    limit?: number;
}

/** Filtro geográfico opcional del panel (facultad / carrera). */
export interface ResumenGeneralFiltro {
    facultadId?: number;
    carreraId?: number;
}

interface ActualizarAlertaInput {
    estado: string;
}

interface ResumenCursosFiltro {
    cursoId?: number;
    anio?: number;
    mes?: number;
    facultadId?: number;
    carreraId?: number;
    limit?: number;
}

interface EstadisticaFiltro {
    cursoId?: number;
    periodo?: string;
    facultadId?: number;
    carreraId?: number;
    limit?: number;
}

interface EstadisticaAusentismoPdfFila {
    facultad: string;
    carrera: string;
    total_cursos: number;
    total_sesiones: number;
    total_faltas: number;
    promedio_ausentismo: number;
    promedio_asistencia: number;
}

interface ConsolidadoFiltro {
    periodo?: string;
    /** Año del módulo académico (`modulos_academicos.anio`). Si se omite, se usa el año del `periodo`. */
    anio?: number;
    /** Semestre del plan (`materias.semestre`, 1–10). */
    semestre?: number;
    facultadId?: number;
    carreraId?: number;
    cursoId?: number;
    /** @deprecated Solo se listan inhabilitados; se ignora si se envía RIESGO. */
    estado?: 'RIESGO' | 'INHABILITADO';
    search?: string;
    orderBy?: 'faltas_desc' | 'asistencia_asc' | 'alumno_asc';
    limit?: number;
}

interface ActaFiltro {
    cursoId?: number;
    tipoActa?: string;
    limit?: number;
    /** Solo actas generadas por este usuario (historial personal en reportes). */
    generadoPorUsuarioId?: string;
}

interface CrearActaInput {
    cursoId: number;
    tipoActa: string;
    urlDocumento?: string;
    periodo?: string;
}

interface TrayectoriaAlumnoReporteItem {
    matricula_id: number;
    curso_id: number;
    estado_academico: string;
    porcentaje_asistencia: number;
    faltas_acumuladas: number;
    justificaciones_aprobadas: number;
    fecha_inscripcion: string;
    anio: number;
    mes: number;
    materia: string;
    plan: string;
    carrera: string;
    facultad: string;
    sesiones_registradas: number;
    presentes: number;
    ausentes: number;
    justificadas: number;
}

interface HistorialAlumnoReporte {
    alumno: {
        id: string;
        numero_documento: string;
        nombres: string;
        apellidos: string;
        nombre_apellido: string | null;
        referencia_carrera_id: number | null;
        facultad_referencia_nombre: string | null;
        carrera_referencia_nombre: string | null;
        /** Semestre curricular institucional (importación / promoción). */
        semestre_curricular: number;
        /** Año de ingreso / cohorte institucional. */
        cohorte_anio: number | null;
    };
    resumen: {
        totalMatriculas: number;
        activas: number;
        totalAusencias: number;
        totalJustificadas: number;
        /** Media aritmética del % por materia solo del año de referencia (`anioPromedioAsistencia`). */
        promedioPorcentajeAsistenciaMaterias: number;
        /** Año calendario del módulo académico usado para el promedio (el más reciente en la trayectoria). */
        anioPromedioAsistencia: number;
        /** Cantidad de matrículas (materias) de ese año incluidas en el promedio. */
        materiasPromedioAnio: number;
    };
    trayectoria: TrayectoriaAlumnoReporteItem[];
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
    estado_consolidado: 'RIESGO' | 'INHABILITADO';
}

interface RecalcularEstadisticaResultado {
    id: number;
    curso_id: number;
    periodo: string;
    total_sesiones: number;
    total_faltas: number;
    porcentaje_ausentismo: number;
    calculado_en: string;
    total_matriculas: number;
}

interface ValidacionCierre {
    id: string;
    titulo: string;
    estado: 'ok' | 'warning' | 'blocked';
    detalle: string;
}

export interface ChecklistCierreMensual {
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

function obtenerPeriodoActual(): string {
    const ahora = new Date();
    const anio = ahora.getUTCFullYear();
    const mes = String(ahora.getUTCMonth() + 1).padStart(2, '0');
    return `${anio}-${mes}`;
}

/** Restringe `curso_id` a facultades o carreras del alcance (subquery por curso). */
function appendAlcanceCursoId(
    condiciones: string[],
    valores: Array<string | number | number[]>,
    cursoIdExpr: string,
    alcance: AlcanceMatriculasFacultad
): void {
    if (alcance.tipo === 'sin_restriccion') return;
    if (alcance.tipo === 'facultades') {
        if (!alcance.facultadIds.length) {
            condiciones.push('FALSE');
            return;
        }
        valores.push(alcance.facultadIds);
        const i = valores.length;
        condiciones.push(`${cursoIdExpr} IN (
            SELECT c2.id FROM cursos c2
            JOIN modulos_academicos mo2 ON mo2.id = c2.modulo_id
            JOIN materias m2 ON m2.id = mo2.materia_id
            JOIN planes_estudio pe2 ON pe2.id = m2.plan_id
            JOIN carreras car2 ON car2.id = pe2.carrera_id
            WHERE car2.facultad_id = ANY($${i}::int[])
        )`);
        return;
    }
    if (!alcance.carreraIds.length) {
        condiciones.push('FALSE');
        return;
    }
    valores.push(alcance.carreraIds);
    const j = valores.length;
    condiciones.push(`${cursoIdExpr} IN (
        SELECT c2.id FROM cursos c2
        JOIN modulos_academicos mo2 ON mo2.id = c2.modulo_id
        JOIN materias m2 ON m2.id = mo2.materia_id
        JOIN planes_estudio pe2 ON pe2.id = m2.plan_id
        WHERE pe2.carrera_id = ANY($${j}::int[])
    )`);
}

/** Restringe por carrera o facultad (prioridad: carreraId). Requiere alias `pe` y `car` en el FROM. */
function appendFiltroGeoCarreraFacultad(
    condiciones: string[],
    valores: Array<string | number | number[]>,
    filtro: { facultadId?: number; carreraId?: number }
): void {
    if (filtro.carreraId) {
        valores.push(filtro.carreraId);
        condiciones.push(`pe.carrera_id = $${valores.length}`);
    } else if (filtro.facultadId) {
        valores.push(filtro.facultadId);
        condiciones.push(`car.facultad_id = $${valores.length}`);
    }
}

function armarCondicionAlcanceAlerta(
    alcance: AlcanceMatriculasFacultad
): { sql: string; valores: unknown[] } {
    if (alcance.tipo === 'sin_restriccion') {
        return { sql: '', valores: [] };
    }
    if (alcance.tipo === 'facultades') {
        if (!alcance.facultadIds.length) {
            return { sql: 'AND FALSE', valores: [] };
        }
        return {
            sql: `AND car.facultad_id = ANY($3::int[])`,
            valores: [alcance.facultadIds]
        };
    }
    if (alcance.tipo === 'carreras') {
        if (!alcance.carreraIds.length) {
            return { sql: 'AND FALSE', valores: [] };
        }
        return {
            sql: `AND pe.carrera_id = ANY($3::int[])`,
            valores: [alcance.carreraIds]
        };
    }
    return { sql: '', valores: [] };
}

function armarCondicionesCursosAlcanceCte(
    alcance: AlcanceMatriculasFacultad,
    filtro: ResumenGeneralFiltro
): {
    condiciones: string[];
    valores: unknown[];
    alcanceVisual: 'institucional' | 'facultad' | 'carrera';
    sinDatos: boolean;
} {
    const condiciones: string[] = [];
    const valores: unknown[] = [];

    if (alcance.tipo === 'facultades') {
        if (!alcance.facultadIds.length) {
            return { condiciones: ['FALSE'], valores: [], alcanceVisual: 'facultad', sinDatos: true };
        }
        valores.push(alcance.facultadIds);
        condiciones.push(`car2.facultad_id = ANY($${valores.length}::int[])`);
    } else if (alcance.tipo === 'carreras') {
        if (!alcance.carreraIds.length) {
            return { condiciones: ['FALSE'], valores: [], alcanceVisual: 'carrera', sinDatos: true };
        }
        valores.push(alcance.carreraIds);
        condiciones.push(`pe2.carrera_id = ANY($${valores.length}::int[])`);
    }

    if (filtro.carreraId) {
        valores.push(filtro.carreraId);
        condiciones.push(`pe2.carrera_id = $${valores.length}`);
    } else if (filtro.facultadId) {
        valores.push(filtro.facultadId);
        condiciones.push(`car2.facultad_id = $${valores.length}`);
    }

    const alcanceVisual: 'institucional' | 'facultad' | 'carrera' =
        filtro.carreraId != null
            ? 'carrera'
            : filtro.facultadId != null
              ? 'facultad'
              : alcance.tipo === 'facultades'
                ? 'facultad'
                : alcance.tipo === 'carreras'
                  ? 'carrera'
                  : 'institucional';

    return { condiciones, valores, alcanceVisual, sinDatos: false };
}

async function consultarResumenGeneralAcotado(
    condiciones: string[],
    valores: unknown[],
    alcanceVisual: 'institucional' | 'facultad' | 'carrera'
): Promise<Record<string, unknown>> {
    const whereCte = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const { rows } = await pool.query(
        `WITH cursos_alc AS (
            SELECT DISTINCT c2.id
            FROM cursos c2
            JOIN modulos_academicos mo2 ON mo2.id = c2.modulo_id
            JOIN materias mat2 ON mat2.id = mo2.materia_id
            JOIN planes_estudio pe2 ON pe2.id = mat2.plan_id
            JOIN carreras car2 ON car2.id = pe2.carrera_id
            ${whereCte}
        )
        SELECT
            (SELECT COUNT(DISTINCT d.id) FROM docentes d
             INNER JOIN cursos c ON c.docente_id = d.id
             WHERE c.id IN (SELECT id FROM cursos_alc))::int AS total_docentes,
            (SELECT COUNT(DISTINCT mat.alumno_id) FROM matriculas mat
             WHERE mat.curso_id IN (SELECT id FROM cursos_alc))::int AS total_alumnos,
            (SELECT COUNT(DISTINCT f.id) FROM cursos c
             JOIN modulos_academicos mo ON mo.id = c.modulo_id
             JOIN materias m ON m.id = mo.materia_id
             JOIN planes_estudio pe ON pe.id = m.plan_id
             JOIN carreras ca ON ca.id = pe.carrera_id
             JOIN facultades f ON f.id = ca.facultad_id
             WHERE c.id IN (SELECT id FROM cursos_alc))::int AS total_facultades,
            (SELECT COUNT(DISTINCT ca.id) FROM cursos c
             JOIN modulos_academicos mo ON mo.id = c.modulo_id
             JOIN materias m ON m.id = mo.materia_id
             JOIN planes_estudio pe ON pe.id = m.plan_id
             JOIN carreras ca ON ca.id = pe.carrera_id
             WHERE c.id IN (SELECT id FROM cursos_alc))::int AS total_carreras,
            (SELECT COUNT(DISTINCT m.id) FROM cursos c
             JOIN modulos_academicos mo ON mo.id = c.modulo_id
             JOIN materias m ON m.id = mo.materia_id
             WHERE c.id IN (SELECT id FROM cursos_alc))::int AS total_materias,
            (SELECT COUNT(*) FROM cursos_alc)::int AS total_cursos,
            (SELECT COUNT(*) FROM matriculas mat WHERE mat.curso_id IN (SELECT id FROM cursos_alc))::int AS total_matriculas,
            0::int AS total_usuarios_activos,
            0::int AS total_usuarios,
            0::int AS total_roles,
            '${alcanceVisual}'::text AS alcance_visual`,
        valores
    );
    return (rows[0] ?? {}) as Record<string, unknown>;
}

export async function validarCarreraEnAlcanceFacultades(carreraId: number, alcance: AlcanceMatriculasFacultad): Promise<void> {
    if (alcance.tipo !== 'facultades') return;
    const { rowCount } = await pool.query(
        `SELECT 1 FROM carreras WHERE id = $1 AND facultad_id = ANY($2::int[])`,
        [carreraId, alcance.facultadIds]
    );
    if (!rowCount) {
        throw new ForbiddenScopeError('La carrera solicitada no pertenece a tu alcance de facultad.');
    }
}

function nombreMesUpper(periodo: string): string {
    const [anio, mes] = periodo.split('-').map(Number);
    return new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' })
        .format(new Date(Date.UTC(anio, mes - 1, 1)))
        .toUpperCase();
}

function markerForHeader(_fecha: string) {
    return 'P';
}

function asistenciaToCell(estado: string | null | undefined): string {
    if (!estado) return '-';
    const normalized = estado.trim().toLowerCase();
    if (normalized === 'presente') return 'P';
    if (normalized === 'ausente') return '-';
    if (normalized === 'justificada') return 'J';
    return '-';
}

function normalizarPeriodo(periodo?: string) {
    const etiqueta = (periodo ?? obtenerPeriodoActual()).trim();
    const match = etiqueta.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
        throw new Error('Periodo inválido. Usa el formato YYYY-MM');
    }

    const anio = Number(match[1]);
    const mes = Number(match[2]);
    if (mes < 1 || mes > 12) {
        throw new Error('El mes del periodo debe estar entre 01 y 12');
    }

    const mesPad = String(mes).padStart(2, '0');
    const periodoLabel = `${anio}-${mesPad}`;

    const siguienteMes = mes === 12 ? 1 : mes + 1;
    const siguienteAnio = mes === 12 ? anio + 1 : anio;
    const siguienteMesPad = String(siguienteMes).padStart(2, '0');

    return {
        periodo: periodoLabel,
        inicio: `${anio}-${mesPad}-01`,
        fin: `${siguienteAnio}-${siguienteMesPad}-01`
    };
}

async function asegurarCursoExiste(cursoId: number) {
    const { rowCount } = await pool.query(`SELECT 1 FROM cursos WHERE id = $1`, [cursoId]);
    if (!rowCount) {
        throw new Error('Curso no encontrado');
    }
}

export async function listarAlertas(
    filtro: AlertasFiltro = {},
    alcance: AlcanceMatriculasFacultad = { tipo: 'sin_restriccion' }
) {
    const condiciones: string[] = [];
    const valores: Array<string | number | number[]> = [];

    if (filtro.estado) {
        valores.push(filtro.estado);
        condiciones.push(`a.estado = $${valores.length}`);
    }

    if (filtro.tipo) {
        valores.push(filtro.tipo);
        condiciones.push(`a.tipo_alerta = $${valores.length}`);
    }

    if (filtro.cursoId) {
        valores.push(filtro.cursoId);
        condiciones.push(`c.id = $${valores.length}`);
    }

    appendFiltroGeoCarreraFacultad(condiciones, valores, filtro);
    appendAlcanceCursoId(condiciones, valores, 'c.id', alcance);

    const limit = Math.min(Math.max(filtro.limit ?? 100, 1), 500);
    valores.push(limit);

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const { rows } = await pool.query(
        `SELECT
            a.id,
            a.tipo_alerta,
            a.faltas_acumuladas,
            a.umbral_porcentaje,
            a.estado,
            a.generado_en,
            a.matricula_id,
            c.id AS curso_id,
            m.nombre AS materia,
            mo.anio,
            mo.mes,
            ${SQL_ALUMNO_APELLIDOS_COMA_NOMBRES} AS alumno,
            al.numero_orden,
            al.numero_documento
         FROM alertas_asistencia a
         JOIN matriculas mat ON mat.id = a.matricula_id
         JOIN cursos c ON c.id = mat.curso_id
         JOIN modulos_academicos mo ON mo.id = c.modulo_id
         JOIN materias m ON m.id = mo.materia_id
         JOIN planes_estudio pe ON pe.id = m.plan_id
         JOIN carreras car ON car.id = pe.carrera_id
         JOIN alumnos al ON al.id = mat.alumno_id
         ${where}
         ORDER BY a.generado_en DESC
         LIMIT $${valores.length}`,
        valores
    );

    return rows;
}

export async function actualizarEstadoAlerta(
    alertaId: number,
    input: ActualizarAlertaInput,
    alcance: AlcanceMatriculasFacultad = { tipo: 'sin_restriccion' }
) {
    const alcanceCondicion = armarCondicionAlcanceAlerta(alcance);
    const parametros: unknown[] = [alertaId, input.estado];
    const { rows } = await pool.query(
        `UPDATE alertas_asistencia a
         SET estado = $2
         FROM matriculas mat
         JOIN cursos c ON c.id = mat.curso_id
         JOIN modulos_academicos mo ON mo.id = c.modulo_id
         JOIN materias m ON m.id = mo.materia_id
         JOIN planes_estudio pe ON pe.id = m.plan_id
         JOIN carreras car ON car.id = pe.carrera_id
         WHERE a.id = $1
           AND a.matricula_id = mat.id
           ${alcanceCondicion.sql}
         RETURNING a.id, a.matricula_id, a.tipo_alerta, a.estado, a.faltas_acumuladas, a.umbral_porcentaje`,
        parametros.concat(alcanceCondicion.valores)
    );

    if (!rows[0]) {
        throw new ForbiddenScopeError('Alerta no encontrada o fuera de tu alcance asignado.');
    }

    return rows[0];
}

export async function listarResumenCursos(
    filtro: ResumenCursosFiltro = {},
    alcance: AlcanceMatriculasFacultad = { tipo: 'sin_restriccion' }
) {
    const condiciones: string[] = [];
    const valores: Array<string | number> = [];

    if (filtro.cursoId) {
        valores.push(filtro.cursoId);
        condiciones.push(`v.curso_id = $${valores.length}`);
    }

    if (typeof filtro.anio === 'number') {
        valores.push(filtro.anio);
        condiciones.push(`v.anio = $${valores.length}`);
    }

    if (typeof filtro.mes === 'number') {
        valores.push(filtro.mes);
        condiciones.push(`v.mes = $${valores.length}`);
    }

    if (filtro.carreraId) {
        valores.push(filtro.carreraId);
        condiciones.push(`v.curso_id IN (
            SELECT c2.id FROM cursos c2
            JOIN modulos_academicos mo2 ON mo2.id = c2.modulo_id
            JOIN materias mat2 ON mat2.id = mo2.materia_id
            JOIN planes_estudio pe2 ON pe2.id = mat2.plan_id
            WHERE pe2.carrera_id = $${valores.length})`);
    } else if (filtro.facultadId) {
        valores.push(filtro.facultadId);
        condiciones.push(`v.curso_id IN (
            SELECT c2.id FROM cursos c2
            JOIN modulos_academicos mo2 ON mo2.id = c2.modulo_id
            JOIN materias mat2 ON mat2.id = mo2.materia_id
            JOIN planes_estudio pe2 ON pe2.id = mat2.plan_id
            JOIN carreras car2 ON car2.id = pe2.carrera_id
            WHERE car2.facultad_id = $${valores.length})`);
    }

    appendAlcanceCursoId(condiciones, valores, 'v.curso_id', alcance);

    const limit = Math.min(Math.max(filtro.limit ?? 100, 1), 500);
    valores.push(limit);
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const { rows } = await pool.query(
        `SELECT
            v.curso_id,
            v.materia,
            v.anio,
            v.mes,
            v.total_matriculas,
            v.alumnos_regulares,
            v.alumnos_riesgo,
            v.alumnos_irregulares,
            v.promedio_asistencia,
            v.faltas_totales
         FROM vw_resumen_asistencia_curso v
         ${where}
         ORDER BY v.anio DESC, v.mes DESC, v.curso_id
         LIMIT $${valores.length}`,
        valores
    );

    return rows;
}

export async function listarEstadisticasAusentismo(
    filtro: EstadisticaFiltro = {},
    alcance: AlcanceMatriculasFacultad = { tipo: 'sin_restriccion' }
) {
    const condiciones: string[] = [];
    const valores: Array<string | number> = [];

    if (filtro.cursoId) {
        valores.push(filtro.cursoId);
        condiciones.push(`e.curso_id = $${valores.length}`);
    }

    if (filtro.periodo) {
        valores.push(filtro.periodo);
        condiciones.push(`e.periodo = $${valores.length}`);
    }

    if (filtro.carreraId) {
        valores.push(filtro.carreraId);
        condiciones.push(`e.curso_id IN (
            SELECT c2.id FROM cursos c2
            JOIN modulos_academicos mo2 ON mo2.id = c2.modulo_id
            JOIN materias mat2 ON mat2.id = mo2.materia_id
            JOIN planes_estudio pe2 ON pe2.id = mat2.plan_id
            WHERE pe2.carrera_id = $${valores.length})`);
    } else if (filtro.facultadId) {
        valores.push(filtro.facultadId);
        condiciones.push(`e.curso_id IN (
            SELECT c2.id FROM cursos c2
            JOIN modulos_academicos mo2 ON mo2.id = c2.modulo_id
            JOIN materias mat2 ON mat2.id = mo2.materia_id
            JOIN planes_estudio pe2 ON pe2.id = mat2.plan_id
            JOIN carreras car2 ON car2.id = pe2.carrera_id
            WHERE car2.facultad_id = $${valores.length})`);
    }

    appendAlcanceCursoId(condiciones, valores, 'e.curso_id', alcance);

    const limit = Math.min(Math.max(filtro.limit ?? 50, 1), 200);
    valores.push(limit);
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const { rows } = await pool.query(
        `SELECT
            e.id,
            e.curso_id,
            e.periodo,
            e.total_sesiones,
            e.total_faltas,
            e.porcentaje_ausentismo,
            e.calculado_en,
            m.nombre AS materia,
            mo.anio,
            mo.mes
         FROM estadisticas_ausentismo e
         JOIN cursos c ON c.id = e.curso_id
         JOIN modulos_academicos mo ON mo.id = c.modulo_id
         JOIN materias m ON m.id = mo.materia_id
         ${where}
         ORDER BY e.calculado_en DESC
         LIMIT $${valores.length}`,
        valores
    );

    return rows;
}

export async function listarConsolidadoRiesgoInhabilitados(
    filtro: ConsolidadoFiltro = {},
    alcance: AlcanceMatriculasFacultad = { tipo: 'sin_restriccion' }
) {
    const { periodo: periodoLabel } = normalizarPeriodo(filtro.periodo);
    const [anioPeriodo, mesPeriodo] = periodoLabel.split('-').map(Number);
    const anioModulo =
        filtro.anio != null && Number.isFinite(Number(filtro.anio)) ? Number(filtro.anio) : anioPeriodo;

    const condiciones: string[] = ['mo.anio = $1', 'mo.mes = $2'];
    const valores: Array<number | string | number[]> = [anioModulo, mesPeriodo];

    if (filtro.semestre != null && Number.isFinite(Number(filtro.semestre))) {
        const sem = Number(filtro.semestre);
        if (sem >= 1 && sem <= 10) {
            valores.push(sem);
            condiciones.push(`m.semestre = $${valores.length}`);
        }
    }

    if (filtro.cursoId) {
        valores.push(filtro.cursoId);
        condiciones.push(`c.id = $${valores.length}`);
    }

    if (filtro.carreraId) {
        valores.push(filtro.carreraId);
        condiciones.push(`ca.id = $${valores.length}`);
    } else if (filtro.facultadId) {
        valores.push(filtro.facultadId);
        condiciones.push(`f.id = $${valores.length}`);
    }

    const term = String(filtro.search ?? '').trim();
    if (term) {
        valores.push(`%${term}%`);
        condiciones.push(
            `((${SQL_ALUMNO_APELLIDOS_COMA_NOMBRES}) ILIKE $${valores.length}
              OR al.numero_documento ILIKE $${valores.length}
              OR m.nombre ILIKE $${valores.length}
              OR ca.nombre ILIKE $${valores.length}
              OR f.nombre ILIKE $${valores.length})`
        );
    }

    appendAlcanceCursoId(condiciones, valores, 'c.id', alcance);

    const limit = Math.min(Math.max(filtro.limit ?? 500, 1), 5000);
    valores.push(limit);
    const where = `WHERE ${condiciones.join(' AND ')}`;
    const orderByPlanilla = `ca.nombre ASC, m.nombre ASC, c.id ASC, ${SQL_ORDEN_MATRICULA_PLANILLA}`;
    const orderBy = filtro.orderBy === 'asistencia_asc'
        ? `COALESCE(mat.porcentaje_asistencia, 0) ASC, COALESCE(mat.faltas_acumuladas, 0) DESC, ${orderByPlanilla}`
        : filtro.orderBy === 'alumno_asc'
            ? orderByPlanilla
            : `COALESCE(mat.faltas_acumuladas, 0) DESC, COALESCE(mat.porcentaje_asistencia, 0) ASC, ${orderByPlanilla}`;

    const { rows } = await pool.query<ConsolidadoRiesgoItem>(
        `SELECT
            TO_CHAR(make_date(mo.anio, mo.mes, 1), 'MM/YYYY') AS periodo,
            c.id AS curso_id,
            f.nombre AS facultad,
            ca.nombre AS carrera,
            m.semestre AS semestre,
            m.nombre AS materia,
            ${SQL_ALUMNO_APELLIDOS_COMA_NOMBRES} AS alumno,
            al.numero_documento,
            COALESCE(mat.porcentaje_asistencia, 0)::numeric AS porcentaje_asistencia,
            COALESCE(mat.faltas_acumuladas, 0)::int AS faltas_acumuladas,
            'INHABILITADO' AS estado_consolidado
         FROM matriculas mat
         JOIN alumnos al ON al.id = mat.alumno_id
         JOIN cursos c ON c.id = mat.curso_id
         JOIN modulos_academicos mo ON mo.id = c.modulo_id
         JOIN materias m ON m.id = mo.materia_id
         JOIN planes_estudio pe ON pe.id = m.plan_id
         JOIN carreras ca ON ca.id = pe.carrera_id
         JOIN facultades f ON f.id = ca.facultad_id
         JOIN LATERAL (
            SELECT
                total_clases_planificadas_curso(c.id) AS total_planificado,
                (
                    SELECT COUNT(*)::int
                    FROM sesiones_clase sc
                    WHERE sc.curso_id = c.id
                      AND LOWER(sc.estado::text) = 'cerrada'
                ) AS sesiones_cerradas
         ) AS curso_met ON TRUE
         ${where}
           AND curso_met.total_planificado > 0
           AND curso_met.sesiones_cerradas >= CEIL(curso_met.total_planificado::numeric * 0.75)::int
           AND COALESCE(mat.porcentaje_asistencia, 0) < 75
         ORDER BY ${orderBy}
         LIMIT $${valores.length}`,
        valores
    );

    return rows;
}

export async function obtenerResumenGeneral(
    alcance: AlcanceMatriculasFacultad = { tipo: 'sin_restriccion' },
    filtro: ResumenGeneralFiltro = {}
): Promise<Record<string, unknown>> {
    const requiereCte =
        alcance.tipo !== 'sin_restriccion' || filtro.carreraId != null || filtro.facultadId != null;

    if (!requiereCte) {
        const { rows } = await pool.query(`
        SELECT
            (SELECT COUNT(*) FROM usuarios WHERE estado = 'activo')::int AS total_usuarios_activos,
            (SELECT COUNT(*) FROM usuarios)::int AS total_usuarios,
            (SELECT COUNT(*) FROM docentes)::int AS total_docentes,
            (SELECT COUNT(*) FROM alumnos)::int AS total_alumnos,
            (SELECT COUNT(*) FROM facultades WHERE estado = TRUE)::int AS total_facultades,
            (SELECT COUNT(*) FROM carreras car
                JOIN facultades f ON f.id = car.facultad_id
                WHERE f.estado = TRUE)::int AS total_carreras,
            (SELECT COUNT(*) FROM materias)::int AS total_materias,
            (SELECT COUNT(*) FROM cursos)::int AS total_cursos,
            (SELECT COUNT(*) FROM matriculas)::int AS total_matriculas,
            (SELECT COUNT(*) FROM roles)::int AS total_roles,
            'institucional'::text AS alcance_visual
    `);
        return (rows[0] ?? {}) as Record<string, unknown>;
    }

    const { condiciones, valores, alcanceVisual, sinDatos } = armarCondicionesCursosAlcanceCte(alcance, filtro);
    if (sinDatos || condiciones.includes('FALSE')) {
        return {
            total_usuarios_activos: 0,
            total_usuarios: 0,
            total_docentes: 0,
            total_alumnos: 0,
            total_facultades: 0,
            total_carreras: 0,
            total_materias: 0,
            total_cursos: 0,
            total_matriculas: 0,
            total_roles: 0,
            alcance_visual: alcanceVisual,
            alcance_sin_datos: true
        };
    }

    return consultarResumenGeneralAcotado(condiciones, valores, alcanceVisual);
}

export async function listarActas(
    filtro: ActaFiltro = {},
    alcance: AlcanceMatriculasFacultad = { tipo: 'sin_restriccion' }
) {
    const condiciones: string[] = [];
    const valores: Array<string | number | number[]> = [];

    if (filtro.cursoId) {
        valores.push(filtro.cursoId);
        condiciones.push(`a.curso_id = $${valores.length}`);
    }

    if (filtro.tipoActa) {
        valores.push(filtro.tipoActa);
        condiciones.push(`a.tipo_acta = $${valores.length}`);
    }

    if (filtro.generadoPorUsuarioId) {
        valores.push(filtro.generadoPorUsuarioId);
        condiciones.push(`a.generado_por = $${valores.length}::uuid`);
    }

    appendAlcanceCursoId(condiciones, valores, 'c.id', alcance);

    // Informes por alumno se generan desde el perfil del estudiante, no en el listado de actas del curso.
    condiciones.push(`a.tipo_acta <> 'informe_alumno'`);

    const limit = Math.min(Math.max(filtro.limit ?? 50, 1), 200);
    valores.push(limit);
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const { rows } = await pool.query(
        `SELECT
            a.id,
            a.tipo_acta,
            a.url_documento,
            a.generado_en,
            a.curso_id,
            m.nombre AS materia,
            mo.anio,
            mo.mes
         FROM actas_generadas a
         JOIN cursos c ON c.id = a.curso_id
         JOIN modulos_academicos mo ON mo.id = c.modulo_id
         JOIN materias m ON m.id = mo.materia_id
         ${where}
         ORDER BY a.generado_en DESC
         LIMIT $${valores.length}`,
        valores
    );

    return rows;
}

export async function obtenerHistorialAlumnoReporte(
    alumnoId: string,
    alcance: AlcanceMatriculasFacultad = { tipo: 'sin_restriccion' }
): Promise<HistorialAlumnoReporte> {
    const { rows: alumnoRows } = await pool.query(
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

    const alumno = alumnoRows[0];
    if (!alumno) {
        throw new Error('Alumno no encontrado');
    }

    const semRaw = Number((alumno as { semestre_curricular?: unknown }).semestre_curricular);
    const semestre_curricular =
        Number.isFinite(semRaw) && semRaw >= 1 && semRaw <= 10 ? Math.trunc(semRaw) : 1;
    const alumnoOut = { ...alumno, semestre_curricular };
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

    const { rows: trayectoriaRows } = await pool.query<TrayectoriaAlumnoReporteItem>(
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
            COALESCE(agg.sesiones_registradas, 0)::int AS sesiones_registradas,
            COALESCE(agg.presentes, 0)::int AS presentes,
            COALESCE(agg.ausentes, 0)::int AS ausentes,
            COALESCE(agg.justificadas, 0)::int AS justificadas
         FROM matriculas mat
         JOIN cursos c ON c.id = mat.curso_id
         JOIN modulos_academicos mo ON mo.id = c.modulo_id
         JOIN materias m ON m.id = mo.materia_id
         JOIN planes_estudio p ON p.id = m.plan_id
         JOIN carreras ca ON ca.id = p.carrera_id
         JOIN facultades f ON f.id = ca.facultad_id
         LEFT JOIN LATERAL (
            SELECT
                COUNT(*)::int AS sesiones_registradas,
                COUNT(*) FILTER (WHERE estado = 'presente')::int AS presentes,
                COUNT(*) FILTER (WHERE estado = 'ausente')::int AS ausentes,
                COUNT(*) FILTER (WHERE estado = 'justificada')::int AS justificadas
            FROM asistencias
            WHERE matricula_id = mat.id
         ) agg ON TRUE
         WHERE mat.alumno_id = $1${scopeFilterSql}
         GROUP BY
            mat.id, mat.curso_id, mat.estado_academico, mat.porcentaje_asistencia, mat.faltas_acumuladas,
            mat.justificaciones_aprobadas, mat.fecha_inscripcion, mo.anio, mo.mes, m.nombre, p.nombre, ca.nombre, f.nombre,
            agg.sesiones_registradas, agg.presentes, agg.ausentes, agg.justificadas
         ORDER BY mo.anio DESC, mo.mes DESC, mat.id DESC`,
        trayectoriaParams
    );

    if ((facIds.length > 0 || carIds.length > 0) && trayectoriaRows.length === 0) {
        const okRef = await alumnoCarreraReferenciaEnAlcance(alumnoOut.referencia_carrera_id, alcance);
        if (!okRef) {
            throw new ForbiddenScopeError();
        }
    }

    // Promedio solo sobre un año calendario (módulo): no mezclar % de años distintos. Por defecto el año más reciente.
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

    return { alumno: alumnoOut, resumen, trayectoria: trayectoriaRows };
}

/** Fila de justificación para la ficha alumno (secretaría / coordinación). */
export interface JustificacionAlumnoReporteRow {
    id: number;
    motivo: string | null;
    documento_url: string | null;
    estado_revision: string | null;
    revisado_en: string | null;
    comentarios_revision: string | null;
    fecha: string | null;
    curso_id: number | null;
    materia: string | null;
    modulo_anio: number | null;
    modulo_mes: number | null;
}

/**
 * Listado de justificaciones con documento asociado a un alumno, respetando el mismo alcance
 * que `obtenerHistorialAlumnoReporte` (facultad / carrera).
 */
export async function listarJustificacionesAlumnoReporte(
    alumnoId: string,
    alcance: AlcanceMatriculasFacultad = { tipo: 'sin_restriccion' }
): Promise<JustificacionAlumnoReporteRow[]> {
    const { rows: alumnoRows } = await pool.query<{ id: string; referencia_carrera_id: number | null }>(
        `SELECT al.id, al.referencia_carrera_id FROM alumnos al WHERE al.id = $1`,
        [alumnoId]
    );
    if (!alumnoRows[0]) {
        throw new Error('Alumno no encontrado');
    }

    const facIds = alcance.tipo === 'facultades' ? alcance.facultadIds.filter((n) => Number.isFinite(n)) : [];
    const carIds = alcance.tipo === 'carreras' ? alcance.carreraIds.filter((n) => Number.isFinite(n)) : [];
    const scopeParams: Array<string | number[]> = [alumnoId];
    let scopeFilterSql = '';
    if (facIds.length > 0) {
        scopeParams.push(facIds);
        scopeFilterSql = ` AND ca.facultad_id = ANY($2::int[])`;
    } else if (carIds.length > 0) {
        scopeParams.push(carIds);
        scopeFilterSql = ` AND p.carrera_id = ANY($2::int[])`;
    }

    const { rows: accessRows } = await pool.query(
        `SELECT 1 AS ok
         FROM matriculas mat
         JOIN cursos c ON c.id = mat.curso_id
         JOIN modulos_academicos mo ON mo.id = c.modulo_id
         JOIN materias m ON m.id = mo.materia_id
         JOIN planes_estudio p ON p.id = m.plan_id
         JOIN carreras ca ON ca.id = p.carrera_id
         WHERE mat.alumno_id = $1${scopeFilterSql}
         LIMIT 1`,
        scopeParams
    );

    if ((facIds.length > 0 || carIds.length > 0) && !accessRows.length) {
        const okRef = await alumnoCarreraReferenciaEnAlcance(alumnoRows[0].referencia_carrera_id, alcance);
        if (!okRef) {
            throw new ForbiddenScopeError();
        }
    }

    const { rows } = await pool.query<JustificacionAlumnoReporteRow>(
        `SELECT
            j.id,
            j.motivo,
            j.documento_url,
            j.estado_revision,
            j.revisado_en,
            j.comentarios_revision,
            sc.fecha,
            c.id AS curso_id,
            m.nombre AS materia,
            mo.anio AS modulo_anio,
            mo.mes AS modulo_mes
         FROM justificaciones j
         JOIN asistencias a ON a.id = j.asistencia_id
         JOIN sesiones_clase sc ON sc.id = a.sesion_id
         JOIN cursos c ON c.id = sc.curso_id
         JOIN modulos_academicos mo ON mo.id = c.modulo_id
         JOIN materias m ON m.id = mo.materia_id
         JOIN planes_estudio p ON p.id = m.plan_id
         JOIN carreras ca ON ca.id = p.carrera_id
         JOIN matriculas mat ON mat.id = a.matricula_id
         JOIN alumnos al ON al.id = mat.alumno_id
         WHERE al.id = $1${scopeFilterSql}
         ORDER BY sc.fecha DESC NULLS LAST, j.id DESC`,
        scopeParams
    );

    return rows;
}

async function buildInformeAlumnoBuffer(
    alumnoId: string,
    alcance: AlcanceMatriculasFacultad
): Promise<PdfBufferResult> {
    const historial = await obtenerHistorialAlumnoReporte(alumnoId, alcance);
    const ap = historial.alumno.apellidos?.trim() ?? '';
    const nom = historial.alumno.nombres?.trim() ?? '';
    const nombreCompleto =
        ap && nom
            ? `${ap}, ${nom}`
            : ap || nom || historial.alumno.nombre_apellido?.trim() || `CI ${historial.alumno.numero_documento}`;
    const generatedAt = new Date().toISOString();
    const fileName = generarNombrePdfElegante({
        titulo: 'Informe Individual de Alumno',
        facultad: historial.alumno.facultad_referencia_nombre,
        carrera: historial.alumno.carrera_referencia_nombre,
        alumno: nombreCompleto,
        anioLectivo: historial.alumno.cohorte_anio,
    });

    const buffer = await generarInformeAlumnoPdf({
        alumno: {
            id: historial.alumno.id,
            nombreCompleto,
            numeroDocumento: historial.alumno.numero_documento,
            facultadReferenciaNombre: historial.alumno.facultad_referencia_nombre ?? null,
            carreraReferenciaNombre: historial.alumno.carrera_referencia_nombre ?? null,
            semestreCurricular: Number(historial.alumno.semestre_curricular) || 1,
            cohorteAnio: historial.alumno.cohorte_anio ?? null,
        },
        resumen: historial.resumen,
        trayectoria: historial.trayectoria.map((item) => ({
            periodo: `${String(item.mes).padStart(2, '0')}/${item.anio}`,
            facultad: item.facultad,
            carrera: item.carrera,
            materia: item.materia,
            estadoAcademico: item.estado_academico,
            porcentajeAsistencia: Number(item.porcentaje_asistencia ?? 0),
            faltasAcumuladas: Number(item.faltas_acumuladas ?? 0),
            justificacionesAprobadas: Number(item.justificaciones_aprobadas ?? 0),
        })),
        generadoEn: generatedAt,
    });

    return { buffer, fileName };
}

export async function generarPdfInformeAlumno(
    alumnoId: string,
    alcance: AlcanceMatriculasFacultad = { tipo: 'sin_restriccion' },
    usuarioId: string
): Promise<PdfGeneradoConActa> {
    const historial = await obtenerHistorialAlumnoReporte(alumnoId, alcance);
    const { buffer, fileName } = await buildInformeAlumnoBuffer(alumnoId, alcance);
    const cursoId = historial.trayectoria[0]?.curso_id ?? null;
    const acta = await registrarActaGenerada({
        cursoId,
        tipoActa: 'informe_alumno',
        parametros: { alumnoId },
        generadoPor: usuarioId,
    });

    return { acta, buffer, fileName };
}

async function buildConsolidadoInhabilitadosBuffer(
    filtro: ConsolidadoFiltro,
    alcance: AlcanceMatriculasFacultad
): Promise<PdfBufferResult> {
    const { periodo: periodoLabel } = normalizarPeriodo(filtro.periodo);
    const filas = await listarConsolidadoRiesgoInhabilitados(
        { ...filtro, periodo: periodoLabel, limit: 5000 },
        alcance
    );
    if (!filas.length) {
        throw new Error(`No hay alumnos inhabilitados para el periodo ${periodoLabel}`);
    }

    const fileName = generarNombrePdfElegante({
        titulo: 'Consolidado de Inhabilitados',
        periodo: periodoLabel,
    });

    const buffer = await generarConsolidadoRiesgoPdf({
        periodo: periodoLabelToMesAnio(periodoLabel),
        total: filas.length,
        totalInhabilitados: filas.length,
        filas: filas.map((f) => ({
            periodo: f.periodo,
            facultad: f.facultad,
            carrera: f.carrera,
            semestre: Number(f.semestre ?? 0),
            materia: f.materia,
            alumno: f.alumno,
            documento: f.numero_documento,
            porcentajeAsistencia: Number(f.porcentaje_asistencia ?? 0),
            faltasAcumuladas: Number(f.faltas_acumuladas ?? 0),
            estadoConsolidado: 'INHABILITADO',
        })),
    });

    return { buffer, fileName };
}

export async function generarPdfConsolidadoRiesgoInhabilitados(
    filtro: ConsolidadoFiltro = {},
    alcance: AlcanceMatriculasFacultad = { tipo: 'sin_restriccion' },
    usuarioId: string
): Promise<PdfGeneradoConActa> {
    const { periodo: periodoLabel } = normalizarPeriodo(filtro.periodo);
    const { buffer, fileName } = await buildConsolidadoInhabilitadosBuffer(filtro, alcance);
    const acta = await registrarActaGenerada({
        cursoId: filtro.cursoId ?? null,
        tipoActa: 'consolidado_inhabilitados',
        parametros: { ...filtro, periodo: periodoLabel },
        generadoPor: usuarioId,
    });

    return { acta, buffer, fileName };
}

function clasificarNivelAusentismo(porcentajeAusentismo: number): string {
    if (porcentajeAusentismo >= 25) return 'CRITICO';
    if (porcentajeAusentismo >= 15) return 'ALTO';
    if (porcentajeAusentismo >= 8) return 'MEDIO';
    return 'CONTROLADO';
}

function periodoLabelToMesAnio(periodoLabel: string): string {
    const matchMes = periodoLabel.match(/^(\d{4})-(\d{2})$/);
    if (matchMes) return `${matchMes[2]}/${matchMes[1]}`;
    const matchAnio = periodoLabel.match(/^(\d{4})$/);
    if (matchAnio) return `Año ${matchAnio[1]} (todos los meses)`;
    return periodoLabel;
}

/** Periodo mensual (YYYY-MM) o anual (YYYY) para estadísticas agregadas. */
function normalizarPeriodoEstadisticas(periodo?: string): { periodo: string; esAnual: boolean } {
    const etiqueta = (periodo ?? obtenerPeriodoActual()).trim();
    const matchAnio = etiqueta.match(/^(\d{4})$/);
    if (matchAnio) {
        return { periodo: matchAnio[1], esAnual: true };
    }
    const { periodo: periodoLabel } = normalizarPeriodo(etiqueta);
    return { periodo: periodoLabel, esAnual: false };
}

async function describirAlcanceAusentismoPdf(
    filtro: Pick<EstadisticaFiltro, 'facultadId' | 'carreraId'>,
    alcance: AlcanceMatriculasFacultad
): Promise<string> {
    if (filtro.carreraId) {
        const { rows } = await pool.query<{ nombre: string }>(
            `SELECT nombre FROM carreras WHERE id = $1`,
            [filtro.carreraId]
        );
        return `Carrera: ${rows[0]?.nombre ?? filtro.carreraId}`;
    }
    if (filtro.facultadId) {
        const { rows } = await pool.query<{ nombre: string }>(
            `SELECT nombre FROM facultades WHERE id = $1`,
            [filtro.facultadId]
        );
        return `Facultad: ${rows[0]?.nombre ?? filtro.facultadId}`;
    }
    if (alcance.tipo === 'carreras') {
        const n = alcance.carreraIds.length;
        return n === 1
            ? 'Tu carrera asignada (alcance completo)'
            : `Todas tus carreras asignadas (${n})`;
    }
    if (alcance.tipo === 'facultades') {
        const n = alcance.facultadIds.length;
        return n === 1
            ? 'Toda tu facultad asignada'
            : `Todas tus facultades asignadas (${n})`;
    }
    return 'Todas las facultades y carreras (alcance institucional)';
}

export interface AusentismoAgregadoItem {
    facultad: string;
    carrera: string;
    totalCursos: number;
    totalSesiones: number;
    totalFaltas: number;
    promedioAusentismo: number;
    promedioAsistencia: number;
    nivel: string;
}

export async function listarAusentismoAgregadoFacultadCarrera(
    filtro: EstadisticaFiltro = {},
    alcance: AlcanceMatriculasFacultad = { tipo: 'sin_restriccion' }
): Promise<{ periodo: string; filas: AusentismoAgregadoItem[] }> {
    const { periodo: periodoLabel, esAnual } = normalizarPeriodoEstadisticas(filtro.periodo);
    const condiciones: string[] = [];
    const valores: Array<string | number | number[]> = [];
    if (esAnual) {
        valores.push(`${periodoLabel}-%`);
        condiciones.push(`e.periodo LIKE $${valores.length}`);
    } else {
        valores.push(periodoLabel);
        condiciones.push(`e.periodo = $${valores.length}`);
    }

    if (filtro.carreraId) {
        valores.push(filtro.carreraId);
        condiciones.push(`ca.id = $${valores.length}`);
    } else if (filtro.facultadId) {
        valores.push(filtro.facultadId);
        condiciones.push(`f.id = $${valores.length}`);
    }

    appendAlcanceCursoId(condiciones, valores, 'e.curso_id', alcance);

    const where = `WHERE ${condiciones.join(' AND ')}`;

    const { rows } = await pool.query<EstadisticaAusentismoPdfFila>(
        `SELECT
            f.nombre AS facultad,
            ca.nombre AS carrera,
            COUNT(DISTINCT e.curso_id)::int AS total_cursos,
            COALESCE(SUM(e.total_sesiones), 0)::int AS total_sesiones,
            COALESCE(SUM(e.total_faltas), 0)::int AS total_faltas,
            COALESCE(AVG(e.porcentaje_ausentismo), 0)::numeric AS promedio_ausentismo,
            (100 - COALESCE(AVG(e.porcentaje_ausentismo), 0))::numeric AS promedio_asistencia
         FROM estadisticas_ausentismo e
         JOIN cursos c ON c.id = e.curso_id
         JOIN modulos_academicos mo ON mo.id = c.modulo_id
         JOIN materias m ON m.id = mo.materia_id
         JOIN planes_estudio pe ON pe.id = m.plan_id
         JOIN carreras ca ON ca.id = pe.carrera_id
         JOIN facultades f ON f.id = ca.facultad_id
         ${where}
         GROUP BY f.nombre, ca.nombre
         ORDER BY promedio_ausentismo DESC, total_faltas DESC, carrera ASC`,
        valores
    );

    const filas = rows.map((row) => {
        const aus = Number(row.promedio_ausentismo ?? 0);
        const asis = Number(row.promedio_asistencia ?? 0);
        return {
            facultad: row.facultad,
            carrera: row.carrera,
            totalCursos: Number(row.total_cursos ?? 0),
            totalSesiones: Number(row.total_sesiones ?? 0),
            totalFaltas: Number(row.total_faltas ?? 0),
            promedioAusentismo: Number(aus.toFixed(2)),
            promedioAsistencia: Number(asis.toFixed(2)),
            nivel: clasificarNivelAusentismo(aus),
        };
    });

    return { periodo: periodoLabel, filas };
}

async function buildEstadisticasAusentismoBuffer(
    filtro: EstadisticaFiltro,
    alcance: AlcanceMatriculasFacultad
): Promise<PdfBufferResult & { periodoLabel: string }> {
    const { periodo: periodoLabel, filas: filasAgregadas } = await listarAusentismoAgregadoFacultadCarrera(
        filtro,
        alcance
    );

    if (!filasAgregadas.length) {
        throw new Error(`No hay estadísticas de ausentismo para el periodo ${periodoLabel} con los filtros actuales`);
    }

    const resumen = filasAgregadas.reduce((acc, row) => {
        acc.totalCarreras += 1;
        acc.totalCursos += Number(row.totalCursos ?? 0);
        acc.totalSesiones += Number(row.totalSesiones ?? 0);
        acc.totalFaltas += Number(row.totalFaltas ?? 0);
        acc.sumAusentismo += row.promedioAusentismo;
        return acc;
    }, {
        totalCarreras: 0,
        totalCursos: 0,
        totalSesiones: 0,
        totalFaltas: 0,
        sumAusentismo: 0,
    });

    const promedioAusentismo = resumen.totalCarreras > 0 ? Number((resumen.sumAusentismo / resumen.totalCarreras).toFixed(2)) : 0;
    const promedioAsistencia = Number((100 - promedioAusentismo).toFixed(2));
    const alcanceTxt = await describirAlcanceAusentismoPdf(filtro, alcance);
    const fileName = generarNombrePdfElegante({
        titulo: 'Estadísticas de Ausentismo',
        periodo: periodoLabel,
    });
    const buffer = await generarPdfAusentismoFacultadCarrera({
        periodo: periodoLabelToMesAnio(periodoLabel),
        alcance: alcanceTxt,
        resumen: {
            totalCarreras: resumen.totalCarreras,
            totalCursos: resumen.totalCursos,
            totalSesiones: resumen.totalSesiones,
            totalFaltas: resumen.totalFaltas,
            promedioAusentismo,
            promedioAsistencia,
        },
        filas: filasAgregadas,
    });

    return { buffer, fileName, periodoLabel };
}

export async function generarPdfEstadisticasAusentismoFacultadCarrera(
    filtro: EstadisticaFiltro = {},
    alcance: AlcanceMatriculasFacultad = { tipo: 'sin_restriccion' },
    usuarioId: string
): Promise<PdfGeneradoConActa> {
    const { buffer, fileName, periodoLabel } = await buildEstadisticasAusentismoBuffer(filtro, alcance);
    const acta = await registrarActaGenerada({
        cursoId: filtro.cursoId ?? null,
        tipoActa: 'estadisticas_ausentismo',
        parametros: { ...filtro, periodo: periodoLabel },
        generadoPor: usuarioId,
    });

    return { acta, buffer, fileName };
}

export async function crearActa(input: CrearActaInput, usuarioId: string): Promise<PdfGeneradoConActa> {
    await asegurarCursoExiste(input.cursoId);

    const safeTipo = input.tipoActa.trim().toLowerCase().replace(/\s+/g, '_');
    let buffer: Buffer;
    let fileName: string;

    if (safeTipo === 'pdf_legal') {
        ({ buffer, fileName } = await buildPdfLegalBuffer(input.cursoId, input.periodo));
    } else if (safeTipo === 'habilitados_no_habilitados') {
        ({ buffer, fileName } = await buildPdfHabilitadosBuffer(input.cursoId, input.periodo));
    } else {
        throw new Error('Tipo de acta no soportado para generación automática');
    }

    const acta = await registrarActaGenerada({
        cursoId: input.cursoId,
        tipoActa: input.tipoActa,
        parametros: { periodo: input.periodo ?? null },
        generadoPor: usuarioId,
    });

    return { acta, buffer, fileName };
}

async function buildPdfHabilitadosBuffer(cursoId: number, periodo?: string): Promise<PdfBufferResult> {
    const { periodo: periodoLabel } = normalizarPeriodo(periodo);
    const [anioPeriodo, mesPeriodo] = periodoLabel.split('-').map(Number);

const { rows } = await pool.query<{
        curso_id: number;
        materia: string;
        anio: number;
        mes: number;
        alumno: string;
        numero_documento: string | null;
        porcentaje_final: number | string | null;
        habilitado: boolean;
        docente: string;
        carrera: string;
        facultad: string;
        semestre: number;
    }>(
        `SELECT
            v.curso_id,
            v.materia,
            v.anio,
            v.mes,
            ${SQL_ALUMNO_APELLIDOS_COMA_NOMBRES} AS alumno,
            v.numero_documento,
            v.porcentaje_final,
            v.habilitado,
            CONCAT(u.nombres, ' ', u.apellidos) AS docente,
            ca.nombre AS carrera,
            f.nombre AS facultad,
            m.semestre
         FROM vw_habilitados_examen v
         JOIN matriculas mat ON mat.id = v.matricula_id
         JOIN alumnos al ON al.id = mat.alumno_id
         JOIN cursos c ON c.id = v.curso_id
         JOIN docentes d ON d.id = c.docente_id
         JOIN usuarios u ON u.id = d.usuario_id
         JOIN modulos_academicos ma ON ma.id = c.modulo_id
         JOIN materias m ON m.id = ma.materia_id
         JOIN planes_estudio pe ON pe.id = m.plan_id
         JOIN carreras ca ON ca.id = pe.carrera_id
         JOIN facultades f ON f.id = ca.facultad_id
         WHERE v.curso_id = $1
           AND v.anio = $2
           AND v.mes = $3
         ORDER BY ${SQL_ORDEN_MATRICULA_PLANILLA}`,
         [cursoId, anioPeriodo, mesPeriodo]
     );

    if (!rows.length) {
        throw new Error(`No hay datos de habilitación para el curso en el periodo ${periodoLabel}`);
    }

    const first = rows[0];
    const alumnos = rows.map((row, index) => ({
        orden: index + 1,
        alumno: row.alumno.trim(),
        documento: row.numero_documento ?? '-',
        porcentajeFinal: Number(row.porcentaje_final ?? 0),
        estado: (row.habilitado ? 'HABILITADO' : 'NO HABILITADO') as 'HABILITADO' | 'NO HABILITADO',
    }));
    const totalHabilitados = alumnos.filter((a) => a.estado === 'HABILITADO').length;
    const totalNoHabilitados = alumnos.length - totalHabilitados;

    const fileName = generarNombrePdfElegante({
        titulo: 'Acta de Habilitados',
        facultad: first.facultad,
        carrera: first.carrera,
        materia: first.materia,
        periodo: periodoLabel,
    });

    const semestreCurso = Number(first.semestre) || 1;
    const buffer = await generarActaHabilitadosPdf({
        periodo: periodoLabel,
        cursoId,
        materia: first.materia,
        docente: first.docente,
        carrera: first.carrera,
        facultad: first.facultad,
        semestre: semestreCurso,
        alumnos,
        resumen: {
            total: alumnos.length,
            habilitados: totalHabilitados,
            noHabilitados: totalNoHabilitados,
        },
    });
    return { buffer, fileName };
}

async function buildPdfLegalBuffer(cursoId: number, periodo?: string): Promise<PdfBufferResult> {
    const { periodo: periodoLabel, inicio, fin } = normalizarPeriodo(periodo);
    const { rows } = await pool.query<{
        curso_id: number;
        curso_notas: string | null;
        curso_aula: string | null;
        anio: number;
        mes: number;
        materia: string;
        carrera: string;
        facultad: string;
        docente: string;
        alumno: string;
        documento: string;
        matricula_id: number;
        fecha: string | null;
        modalidad: string | null;
        estado_asistencia: string | null;
    }>(
        `SELECT
            c.id AS curso_id,
            c.notas AS curso_notas,
            c.aula AS curso_aula,
            ma.anio,
            ma.mes,
            m.nombre AS materia,
            ca.nombre AS carrera,
            f.nombre AS facultad,
            CONCAT(u.nombres, ' ', u.apellidos) AS docente,
            ${SQL_ALUMNO_APELLIDOS_COMA_NOMBRES} AS alumno,
            al.numero_documento AS documento,
            mat.id AS matricula_id,
            sc.fecha::text AS fecha,
            sc.modalidad AS modalidad,
            a.estado::text AS estado_asistencia
         FROM cursos c
         JOIN modulos_academicos ma ON ma.id = c.modulo_id
         JOIN materias m ON m.id = ma.materia_id
         JOIN planes_estudio pe ON pe.id = m.plan_id
         JOIN carreras ca ON ca.id = pe.carrera_id
         JOIN facultades f ON f.id = ca.facultad_id
         JOIN docentes d ON d.id = c.docente_id
         JOIN usuarios u ON u.id = d.usuario_id
         JOIN matriculas mat ON mat.curso_id = c.id
         JOIN alumnos al ON al.id = mat.alumno_id
         LEFT JOIN sesiones_clase sc ON sc.curso_id = c.id AND sc.fecha >= $2 AND sc.fecha < $3
         LEFT JOIN asistencias a ON a.sesion_id = sc.id AND a.matricula_id = mat.id
         WHERE c.id = $1
         ORDER BY ${SQL_ORDEN_MATRICULA_PLANILLA}, sc.fecha ASC NULLS LAST`,
        [cursoId, inicio, fin]
    );

    if (!rows.length) {
        throw new Error('No hay matriculas cargadas para generar el PDF legal');
    }

    const sesiones = Array.from(
        new Set(rows.map((row) => row.fecha).filter((value): value is string => Boolean(value)))
    ).sort((a, b) => a.localeCompare(b));

    // Mapa fecha → modalidad para el marcador de columna en el PDF
    const modalidadPorFecha = new Map<string, string>();
    for (const row of rows) {
        if (row.fecha && row.modalidad && !modalidadPorFecha.has(row.fecha)) {
            modalidadPorFecha.set(row.fecha, row.modalidad);
        }
    }

    const alumnosMap = new Map<number, { nombre: string; documento: string; asistencias: Map<string, string> }>();
    const matriculaOrdenPlanilla: number[] = [];
    for (const row of rows) {
        if (!alumnosMap.has(row.matricula_id)) {
            matriculaOrdenPlanilla.push(row.matricula_id);
            alumnosMap.set(row.matricula_id, {
                nombre: row.alumno,
                documento: row.documento,
                asistencias: new Map<string, string>(),
            });
        }

        if (row.fecha) {
            alumnosMap.get(row.matricula_id)?.asistencias.set(row.fecha, asistenciaToCell(row.estado_asistencia));
        }
    }

    const first = rows[0];
    const alumnos = matriculaOrdenPlanilla.map((matriculaId, index) => {
        const item = alumnosMap.get(matriculaId)!;
        return {
            orden: index + 1,
            nombre: item.nombre
                .replace(/\s*\(\d+\)\s*$/, '')
                .replace(/\s+/g, ' ')
                .replace(/\s*,\s*/g, ', ')
                .trim(),
            documento: item.documento,
            asistencias: sesiones.map((fecha) => item.asistencias.get(fecha) ?? '-'),
        };
    });

    // Derivar semestre del mes (1-6 = 1er Semestre, 7-12 = 2do Semestre)
    const semestre = first.mes <= 6 ? '1er Semestre' : '2do Semestre';
    const seccion = first.curso_aula?.trim() || `Curso ${cursoId}`;
    const cursoLabel = first.curso_notas?.trim() || `${first.anio}`;

    const fileName = generarNombrePdfElegante({
        titulo: 'Planilla Legal de Asistencias',
        facultad: first.facultad,
        carrera: first.carrera,
        materia: first.materia,
        periodo: periodoLabel,
    });
    const buffer = await generarPlanillaLegalPdf({
        facultad: first.facultad,
        carrera: first.carrera,
        asignatura: first.materia,
        profesor: first.docente,
        cursoLabel,
        semestre,
        seccion,
        anioLectivo: String(first.anio),
        mesTitulo: nombreMesUpper(periodoLabel),
        sesiones: sesiones.map((fecha) => ({
            fecha,
            marcadorSuperior: (modalidadPorFecha.get(fecha) ?? 'presencial') === 'virtual' ? 'V' : 'P',
        })),
        alumnos,
    });
    return { buffer, fileName };
}

export async function obtenerChecklistCierreMensual(
    cursoId: number,
    periodo?: string
): Promise<ChecklistCierreMensual> {
    await asegurarCursoExiste(cursoId);
    const { periodo: periodoLabel } = normalizarPeriodo(periodo);

    const { rows: cursoRows } = await pool.query<{
        curso_id: number;
        modulo_id: number;
        materia: string;
        estado_modulo: string;
    }>(
        `SELECT
            c.id AS curso_id,
            c.modulo_id,
            m.nombre AS materia,
            ma.estado AS estado_modulo
         FROM cursos c
         JOIN modulos_academicos ma ON ma.id = c.modulo_id
         JOIN materias m ON m.id = ma.materia_id
         WHERE c.id = $1`,
        [cursoId]
    );

    const curso = cursoRows[0];
    if (!curso) {
        throw new Error('Curso no encontrado');
    }

    const [estadisticaResp, actasResp, habilitadosResp] = await Promise.all([
        pool.query<{ id: number }>(
            `SELECT id FROM estadisticas_ausentismo WHERE curso_id = $1 AND periodo = $2 LIMIT 1`,
            [cursoId, periodoLabel]
        ),
        pool.query<{ tipo_acta: string }>(
            `SELECT tipo_acta FROM actas_generadas WHERE curso_id = $1`,
            [cursoId]
        ),
        pool.query<{ total: string }>(
            `SELECT COUNT(*) AS total
             FROM vw_habilitados_examen
             WHERE curso_id = $1 AND habilitado = TRUE`,
            [cursoId]
        ),
    ]);

    const estadisticaGenerada = Boolean(estadisticaResp.rows[0]?.id);
    const habilitadosCount = Number(habilitadosResp.rows[0]?.total ?? 0);
    const tiposActa = new Set(actasResp.rows.map((row) => row.tipo_acta.trim().toLowerCase()));
    const actaHabilitadosGenerada = tiposActa.has('habilitados_no_habilitados');
    const pdfLegalGenerado = tiposActa.has('pdf_legal');

    const validaciones: ValidacionCierre[] = [
        {
            id: 'stats',
            titulo: 'Ausentismo recalculado del periodo',
            estado: estadisticaGenerada ? 'ok' : 'blocked',
            detalle: estadisticaGenerada
                ? `Existe una estadística calculada para ${periodoLabel}.`
                : `Falta recalcular estadísticas del periodo ${periodoLabel}.`,
        },
        {
            id: 'acta-habilitados',
            titulo: 'Acta habilitados / no habilitados',
            estado: actaHabilitadosGenerada ? 'ok' : 'blocked',
            detalle: actaHabilitadosGenerada
                ? 'El acta de habilitados/no habilitados ya fue generada.'
                : 'Falta generar el acta de habilitados/no habilitados.',
        },
        {
            id: 'pdf-legal',
            titulo: 'Planilla PDF legal',
            estado: pdfLegalGenerado ? 'ok' : 'blocked',
            detalle: pdfLegalGenerado
                ? 'La planilla PDF legal ya fue generada.'
                : 'Falta generar la planilla PDF legal.',
        },
        {
            id: 'habilitados',
            titulo: 'Habilitados detectados',
            estado: habilitadosCount > 0 ? 'ok' : 'warning',
            detalle: habilitadosCount > 0
                ? `Se detectaron ${habilitadosCount} alumnos habilitados para examen.`
                : 'No hay alumnos habilitados actualmente; revisa si esto es correcto.',
        },
        {
            id: 'modulo',
            titulo: 'Estado del módulo',
            estado: String(curso.estado_modulo).toLowerCase() === 'cerrado' ? 'blocked' : 'ok',
            detalle: String(curso.estado_modulo).toLowerCase() === 'cerrado'
                ? 'El módulo ya se encuentra cerrado.'
                : `El módulo está en estado ${curso.estado_modulo}.`,
        },
    ];

    const puedeCerrar = !validaciones.some((item) => item.estado === 'blocked');

    return {
        cursoId,
        moduloId: curso.modulo_id,
        periodo: periodoLabel,
        materia: curso.materia,
        estadoModulo: curso.estado_modulo,
        habilitadosCount,
        actaHabilitadosGenerada,
        pdfLegalGenerado,
        estadisticaGenerada,
        validaciones,
        puedeCerrar,
    };
}

export async function cerrarModuloMensual(
    cursoId: number,
    periodo: string | undefined,
    usuarioId: string
) {
    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');

        const { rows: cursoRows } = await cliente.query<{
            curso_id: number;
            modulo_id: number;
            materia: string;
            estado_modulo: string;
        }>(
            `SELECT
                c.id AS curso_id,
                c.modulo_id,
                m.nombre AS materia,
                ma.estado AS estado_modulo
             FROM cursos c
             JOIN modulos_academicos ma ON ma.id = c.modulo_id
             JOIN materias m ON m.id = ma.materia_id
             WHERE c.id = $1`,
            [cursoId]
        );

        const curso = cursoRows[0];
        if (!curso) {
            await cliente.query('ROLLBACK');
            throw new Error('Curso no encontrado');
        }

        const { rows: moduloRows } = await cliente.query<{ id: number; estado: string }>(
            `SELECT id, estado FROM modulos_academicos WHERE id = $1 FOR UPDATE`,
            [curso.modulo_id]
        );

        if (!moduloRows[0] || String(moduloRows[0].estado).toLowerCase() === 'cerrado') {
            await cliente.query('ROLLBACK');
            throw new Error('El módulo ya está cerrado o no fue encontrado');
        }

        const { periodo: periodoLabel } = normalizarPeriodo(periodo);

        const [estadisticaResp, actasResp, habilitadosResp] = await Promise.all([
            cliente.query<{ id: number }>(
                `SELECT id FROM estadisticas_ausentismo WHERE curso_id = $1 AND periodo = $2 LIMIT 1`,
                [cursoId, periodoLabel]
            ),
            cliente.query<{ tipo_acta: string }>(
                `SELECT tipo_acta FROM actas_generadas WHERE curso_id = $1`,
                [cursoId]
            ),
            cliente.query<{ total: string }>(
                `SELECT COUNT(*) AS total
                 FROM vw_habilitados_examen
                 WHERE curso_id = $1 AND habilitado = TRUE`,
                [cursoId]
            ),
        ]);

        const estadisticaGenerada = Boolean(estadisticaResp.rows[0]?.id);
        const habilitadosCount = Number(habilitadosResp.rows[0]?.total ?? 0);
        const tiposActa = new Set(actasResp.rows.map((row) => row.tipo_acta.trim().toLowerCase()));
        const actaHabilitadosGenerada = tiposActa.has('habilitados_no_habilitados');
        const pdfLegalGenerado = tiposActa.has('pdf_legal');

        const validaciones: ValidacionCierre[] = [
            {
                id: 'stats',
                titulo: 'Ausentismo recalculado del periodo',
                estado: estadisticaGenerada ? 'ok' : 'blocked',
                detalle: estadisticaGenerada
                    ? `Existe una estadística calculada para ${periodoLabel}.`
                    : `Falta recalcular estadísticas del periodo ${periodoLabel}.`,
            },
            {
                id: 'acta-habilitados',
                titulo: 'Acta habilitados / no habilitados',
                estado: actaHabilitadosGenerada ? 'ok' : 'blocked',
                detalle: actaHabilitadosGenerada
                    ? 'El acta de habilitados/no habilitados ya fue generada.'
                    : 'Falta generar el acta de habilitados/no habilitados.',
            },
            {
                id: 'pdf-legal',
                titulo: 'Planilla PDF legal',
                estado: pdfLegalGenerado ? 'ok' : 'blocked',
                detalle: pdfLegalGenerado
                    ? 'La planilla PDF legal ya fue generada.'
                    : 'Falta generar la planilla PDF legal.',
            },
            {
                id: 'habilitados',
                titulo: 'Habilitados detectados',
                estado: habilitadosCount > 0 ? 'ok' : 'warning',
                detalle: habilitadosCount > 0
                    ? `Se detectaron ${habilitadosCount} alumnos habilitados para examen.`
                    : 'No hay alumnos habilitados actualmente; revisa si esto es correcto.',
            },
            {
                id: 'modulo',
                titulo: 'Estado del módulo',
                estado: 'ok',
                detalle: `El módulo está en estado ${moduloRows[0].estado}.`,
            },
        ];

        const puedeCerrar = !validaciones.some((item) => item.estado === 'blocked');
        if (!puedeCerrar) {
            await cliente.query('ROLLBACK');
            const bloqueos = validaciones
                .filter((item) => item.estado === 'blocked')
                .map((item) => item.titulo)
                .join(', ');
            throw new Error(`No se puede cerrar el módulo. Validaciones pendientes: ${bloqueos}`);
        }

        const { rows } = await cliente.query<{ id: number; estado: string }>(
            `UPDATE modulos_academicos
             SET estado = 'cerrado'
             WHERE id = $1
             RETURNING id, estado`,
            [curso.modulo_id]
        );

        if (!rows[0]) {
            await cliente.query('ROLLBACK');
            throw new Error('No se pudo cerrar el módulo académico');
        }

        await cliente.query('COMMIT');

        return {
            mensaje: 'Módulo mensual cerrado correctamente',
            cursoId,
            moduloId: rows[0].id,
            estado: rows[0].estado,
            cerradoPor: usuarioId,
            periodo: periodoLabel,
        };
    } catch (error) {
        try { await cliente.query('ROLLBACK'); } catch (_e) { /* already rolled back or committed */ }
        throw error;
    } finally {
        cliente.release();
    }
}

export async function recalcularEstadisticaCurso(
    cursoId: number,
    periodo?: string
): Promise<RecalcularEstadisticaResultado> {
    await asegurarCursoExiste(cursoId);
    const { periodo: periodoLabel, inicio, fin } = normalizarPeriodo(periodo);

    const { rows } = await pool.query(
        `WITH sesiones AS (
            SELECT id FROM sesiones_clase
            WHERE curso_id = $1 AND fecha >= $2 AND fecha < $3
        ),
        total_sesiones AS (
            SELECT COUNT(*) AS total FROM sesiones
        ),
        total_matriculas AS (
            SELECT COUNT(*) AS total FROM matriculas WHERE curso_id = $1
        ),
        faltas AS (
            SELECT COUNT(*) AS total
            FROM asistencias a
            WHERE a.sesion_id IN (SELECT id FROM sesiones)
              AND a.estado = 'ausente'
              AND COALESCE(a.justificada, FALSE) = FALSE
        )
        SELECT
            COALESCE((SELECT total FROM total_sesiones), 0) AS total_sesiones,
            COALESCE((SELECT total FROM total_matriculas), 0) AS total_matriculas,
            COALESCE((SELECT total FROM faltas), 0) AS total_faltas`,
        [cursoId, inicio, fin]
    );

    const totales = rows[0];
    const totalSesiones = Number(totales?.total_sesiones ?? 0);
    const totalMatriculas = Number(totales?.total_matriculas ?? 0);
    const totalFaltas = Number(totales?.total_faltas ?? 0);
    const divisor = totalSesiones * totalMatriculas;
    const porcentaje = divisor > 0 ? Number(((totalFaltas / divisor) * 100).toFixed(2)) : 0;

    const { rows: upsertRows } = await pool.query(
        `INSERT INTO estadisticas_ausentismo (curso_id, periodo, total_sesiones, total_faltas, porcentaje_ausentismo)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (curso_id, periodo)
         DO UPDATE SET
            total_sesiones = EXCLUDED.total_sesiones,
            total_faltas = EXCLUDED.total_faltas,
            porcentaje_ausentismo = EXCLUDED.porcentaje_ausentismo,
            calculado_en = NOW()
         RETURNING id, curso_id, periodo, total_sesiones, total_faltas, porcentaje_ausentismo, calculado_en`,
        [cursoId, periodoLabel, totalSesiones, totalFaltas, porcentaje]
    );

    return {
        ...upsertRows[0],
        total_matriculas: totalMatriculas
    };
}

function periodoDesdeParametros(parametros: Record<string, unknown>): string | undefined {
    const raw = parametros.periodo;
    return raw == null || raw === '' ? undefined : String(raw);
}

/** Regenera un PDF registrado en actas_generadas con datos actuales (sin leer Storage). */
export async function regenerarPdfActaGenerada(
    actaId: number,
    alcance: AlcanceMatriculasFacultad = { tipo: 'sin_restriccion' }
): Promise<PdfBufferResult> {
    const acta = await obtenerActaGeneradaPorId(actaId);
    if (!acta) {
        throw new Error('Acta no encontrada');
    }

    if (acta.curso_id != null) {
        await assertCursoEnAlcance(acta.curso_id, alcance);
    }

    const params = acta.parametros ?? {};
    const tipo = acta.tipo_acta.trim().toLowerCase().replace(/\s+/g, '_');

    if (tipo === 'pdf_legal') {
        if (acta.curso_id == null) throw new Error('Acta sin curso asociado');
        return buildPdfLegalBuffer(acta.curso_id, periodoDesdeParametros(params));
    }
    if (tipo === 'habilitados_no_habilitados') {
        if (acta.curso_id == null) throw new Error('Acta sin curso asociado');
        return buildPdfHabilitadosBuffer(acta.curso_id, periodoDesdeParametros(params));
    }
    if (tipo === 'informe_alumno') {
        const alumnoId = String(params.alumnoId ?? '').trim();
        if (!alumnoId) throw new Error('Parámetros de informe incompletos');
        return buildInformeAlumnoBuffer(alumnoId, alcance);
    }
    if (tipo === 'consolidado_inhabilitados') {
        return buildConsolidadoInhabilitadosBuffer(params as ConsolidadoFiltro, alcance);
    }
    if (tipo === 'estadisticas_ausentismo') {
        const { buffer, fileName } = await buildEstadisticasAusentismoBuffer(params as EstadisticaFiltro, alcance);
        return { buffer, fileName };
    }
    if (tipo === 'export_usuarios') {
        return construirExportUsuariosPdfBuffer(params as UsuarioFiltro);
    }
    if (tipo === 'export_auditoria') {
        return construirExportAuditoriaPdfBuffer(params as FiltroEventosAuditoria);
    }

    if (/^https?:\/\//i.test(acta.url_documento)) {
        throw new Error('Este documento legacy está almacenado externamente; abrilo desde la URL histórica');
    }

    throw new Error(`Tipo de acta no regenerable: ${acta.tipo_acta}`);
}

export async function buildCronogramaPdfBuffer(
    cursoId: number,
    alcance: AlcanceMatriculasFacultad,
): Promise<{ buffer: Buffer; fileName: string }> {
    await assertCursoEnAlcance(cursoId, alcance);

    const { rows: metaRows } = await pool.query(
        `SELECT
            f.nombre AS facultad,
            cr.nombre AS carrera,
            cr.id AS carrera_id,
            m.nombre AS materia,
            m.semestre AS semestre_materia,
            ma.anio,
            ma.mes,
            CONCAT(u.nombres, ' ', u.apellidos) AS docente,
            c.aula,
            c.horario_inicio,
            c.horario_fin
         FROM cursos c
         JOIN modulos_academicos ma ON ma.id = c.modulo_id
         JOIN materias m ON m.id = ma.materia_id
         JOIN planes_estudio p ON p.id = m.plan_id
         JOIN carreras cr ON cr.id = p.carrera_id
         JOIN facultades f ON f.id = cr.facultad_id
         JOIN docentes d ON d.id = c.docente_id
         JOIN usuarios u ON u.id = d.usuario_id
         WHERE c.id = $1`,
        [cursoId]
    );
    if (!metaRows[0]) throw new Error('Curso no encontrado');

    const meta = metaRows[0];
    const semestreAcademico = `${meta.semestre_materia}°`;

    const turno = meta.horario_inicio && meta.horario_fin
        ? `${String(meta.horario_inicio).slice(0, 5)} - ${String(meta.horario_fin).slice(0, 5)}`
        : '';

    const { rows: jefeRows } = await pool.query(
        `SELECT CONCAT(u.nombres, ' ', u.apellidos) AS jefe_carrera
         FROM usuarios u
         JOIN usuarios_roles ur ON ur.usuario_id = u.id
         JOIN roles r ON r.id = ur.rol_id
         LEFT JOIN usuario_scopes us ON us.usuario_id = u.id
         WHERE r.nombre = 'Jefe de Carrera'
           AND (us.carrera_id = $1 OR us.carrera_id IS NULL)
           AND u.estado = 'activo'
         ORDER BY us.carrera_id DESC
         LIMIT 1`,
        [meta.carrera_id]
    );
    const jefeCarrera = jefeRows[0]?.jefe_carrera ?? '';

    const { rows: semanas } = await pool.query(
        `SELECT semana_numero, fecha_inicio, fecha_fin, contenidos, actividades, horas
         FROM curso_cronograma_semanas
         WHERE curso_id = $1
         ORDER BY semana_numero ASC`,
        [cursoId]
    );

    const { rows: evalRows } = await pool.query(
        `SELECT tipo, fecha, alcance_prueba FROM curso_evaluaciones WHERE curso_id = $1 ORDER BY CASE tipo WHEN 'parcial' THEN 1 WHEN 'final' THEN 2 ELSE 3 END`,
        [cursoId]
    );
    const parcial = evalRows.find((e) => e.tipo === 'parcial');
    const final = evalRows.find((e) => e.tipo === 'final');

    const data: CronogramaPdfData = {
        facultad: meta.facultad,
        carrera: meta.carrera,
        materia: meta.materia,
        semestreAcademico,
        docente: meta.docente,
        seccion: meta.aula ?? '',
        turno,
        jefatura: jefeCarrera,
        semanas: semanas.map((s) => {
            const contenidos: string[] = s.contenidos ?? [];
            const actividades: string[] = s.actividades ?? [];
            const maxLen = Math.max(contenidos.length, actividades.length, 1);
            const items = Array.from({ length: maxLen }, (_, i) => ({
                contenido: contenidos[i] ?? '',
                actividad: actividades[i] ?? '',
            }));
            const ini = s.fecha_inicio instanceof Date ? s.fecha_inicio.toISOString().slice(0, 10) : String(s.fecha_inicio).slice(0, 10);
            const fin = s.fecha_fin instanceof Date ? s.fecha_fin.toISOString().slice(0, 10) : String(s.fecha_fin).slice(0, 10);
            const [, mi, di] = ini.split('-');
            const [, mf, df] = fin.split('-');
            return {
                nombre: `Semana ${s.semana_numero}\n${parseInt(di)} al ${parseInt(df)}/${mf}/${ini.slice(0, 4)}`,
                horas: Number(s.horas) || 0,
                items,
            };
        }),
        evaluacionParcial: {
            fecha: parcial?.fecha instanceof Date ? parcial.fecha.toISOString().slice(0, 10) : (parcial?.fecha ? String(parcial.fecha).slice(0, 10) : null),
            alcance: parcial?.alcance_prueba ?? null,
        },
        evaluacionFinal: {
            fecha: final?.fecha instanceof Date ? final.fecha.toISOString().slice(0, 10) : (final?.fecha ? String(final.fecha).slice(0, 10) : null),
            alcance: final?.alcance_prueba ?? null,
        },
    };

    const buffer = await renderPdfDocumentToBuffer((doc) => {
        doc.y = 40;
        generateCronogramaBody(doc, data);
    }, {
        size: 'A4',
        layout: 'landscape',
        margin: 0,
        bufferPages: true,
        info: { Title: 'Registro de Catedra', Author: 'Sistema de Gestión de Asistencia Académica' },
    });
    const fileName = generarNombrePdf({
        titulo: 'Registro de Catedra',
        facultad: meta.facultad,
        carrera: meta.carrera,
        materia: meta.materia,
    });

    return { buffer, fileName };
}
