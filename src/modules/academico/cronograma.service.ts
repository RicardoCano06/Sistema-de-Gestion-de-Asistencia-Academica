import { pool } from '../../config/database';
import type { PoolClient } from 'pg';
import type {
    CronogramaPayload,
    CronogramaResponse,
    CronogramaEvaluacionInput,
} from './cronograma.schema';

export async function obtenerCronogramaCurso(cursoId: number): Promise<CronogramaResponse> {
    const { rows: cursoRows } = await pool.query(
        `SELECT id FROM cursos WHERE id = $1`,
        [cursoId]
    );
    if (!cursoRows[0]) {
        throw new Error('Curso no encontrado');
    }

    const { rows: semanas } = await pool.query(
        `SELECT s.id, s.curso_id, s.semana_numero, s.fecha_inicio, s.fecha_fin, s.contenidos, s.actividades, s.horas,
                s.firmado_en, COALESCE(u.nombres || ' ' || u.apellidos, NULL) AS firmado_por
         FROM curso_cronograma_semanas s
         LEFT JOIN docentes d ON d.id = s.firmado_por
         LEFT JOIN usuarios u ON u.id = d.usuario_id
         WHERE s.curso_id = $1
         ORDER BY s.semana_numero ASC`,
        [cursoId]
    );

    const { rows: evaluaciones } = await pool.query(
        `SELECT e.id, e.curso_id, e.tipo, e.fecha, e.alcance_prueba,
                e.firmado_en, COALESCE(u.nombres || ' ' || u.apellidos, NULL) AS firmado_por
         FROM curso_evaluaciones e
         LEFT JOIN docentes d ON d.id = e.firmado_por
         LEFT JOIN usuarios u ON u.id = d.usuario_id
         WHERE e.curso_id = $1
         ORDER BY CASE e.tipo WHEN 'parcial' THEN 1 WHEN 'final' THEN 2 ELSE 3 END`,
        [cursoId]
    );

    return {
        semanas: semanas.map((s) => ({
            id: s.id,
            curso_id: s.curso_id,
            semana_numero: s.semana_numero,
            fecha_inicio: s.fecha_inicio instanceof Date
                ? s.fecha_inicio.toISOString().slice(0, 10)
                : String(s.fecha_inicio).slice(0, 10),
            fecha_fin: s.fecha_fin instanceof Date
                ? s.fecha_fin.toISOString().slice(0, 10)
                : String(s.fecha_fin).slice(0, 10),
            contenidos: s.contenidos ?? [],
            actividades: s.actividades ?? [],
            horas: Number(s.horas) || 0,
            firmado: Boolean(s.firmado_en),
            firmado_en: s.firmado_en instanceof Date
                ? s.firmado_en.toISOString()
                : (s.firmado_en ? String(s.firmado_en) : null),
            firmado_por: s.firmado_por ?? null,
        })),
        evaluaciones: evaluaciones.map((e) => ({
            id: e.id,
            curso_id: e.curso_id,
            tipo: e.tipo,
            fecha: e.fecha instanceof Date
                ? e.fecha.toISOString().slice(0, 10)
                : (e.fecha ? String(e.fecha).slice(0, 10) : null),
            alcance_prueba: e.alcance_prueba ?? null,
            firmado: Boolean(e.firmado_en),
            firmado_en: e.firmado_en instanceof Date
                ? e.firmado_en.toISOString()
                : (e.firmado_en ? String(e.firmado_en) : null),
            firmado_por: e.firmado_por ?? null,
        })),
    };
}

export async function guardarCronogramaCurso(
    cursoId: number,
    payload: CronogramaPayload
): Promise<CronogramaResponse> {
    const { rows: cursoRows } = await pool.query(
        `SELECT c.id, ma.fecha_inicio, ma.fecha_fin
         FROM cursos c
         JOIN modulos_academicos ma ON ma.id = c.modulo_id
         WHERE c.id = $1`,
        [cursoId]
    );
    if (!cursoRows[0]) {
        throw new Error('Curso no encontrado');
    }

    const modInicio = cursoRows[0].fecha_inicio instanceof Date
        ? cursoRows[0].fecha_inicio.toISOString().slice(0, 10)
        : String(cursoRows[0].fecha_inicio).slice(0, 10);
    const modFin = cursoRows[0].fecha_fin instanceof Date
        ? cursoRows[0].fecha_fin.toISOString().slice(0, 10)
        : String(cursoRows[0].fecha_fin).slice(0, 10);

    const validarFechaEnRango = (fecha: string | null | undefined, nombre: string) => {
        if (!fecha) return;
        if (fecha < modInicio || fecha > modFin) {
            throw new Error(
                `La fecha de ${nombre} (${fecha}) debe estar dentro del rango del módulo (${modInicio} a ${modFin})`
            );
        }
    };

    for (const s of payload.semanas) {
        validarFechaEnRango(s.fecha_inicio, `inicio de la semana ${s.semana_numero}`);
        validarFechaEnRango(s.fecha_fin, `fin de la semana ${s.semana_numero}`);
        if (s.fecha_fin < s.fecha_inicio) {
            throw new Error(
                `En la semana ${s.semana_numero}: la fecha de fin (${s.fecha_fin}) no puede ser anterior a la de inicio (${s.fecha_inicio})`
            );
        }
    }

    validarFechaEnRango(payload.evaluacion_parcial?.fecha, 'evaluación parcial');
    validarFechaEnRango(payload.evaluacion_final?.fecha, 'evaluación final');

    const cliente: PoolClient = await pool.connect();
    try {
        await cliente.query('BEGIN');

        await cliente.query(
            `DELETE FROM curso_cronograma_semanas WHERE curso_id = $1`,
            [cursoId]
        );

        for (const s of payload.semanas) {
            await cliente.query(
                `INSERT INTO curso_cronograma_semanas (curso_id, semana_numero, fecha_inicio, fecha_fin, contenidos, actividades, horas)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    cursoId,
                    s.semana_numero,
                    s.fecha_inicio,
                    s.fecha_fin,
                    s.contenidos,
                    s.actividades,
                    s.horas,
                ]
            );
        }

        const upsertEvaluacion = async (
            tipo: string,
            evalData: CronogramaEvaluacionInput | undefined
        ) => {
            if (!evalData) return;
            await cliente.query(
                `INSERT INTO curso_evaluaciones (curso_id, tipo, fecha, alcance_prueba)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (curso_id, tipo)
                 DO UPDATE SET fecha = EXCLUDED.fecha, alcance_prueba = EXCLUDED.alcance_prueba, actualizado_en = NOW()`,
                [cursoId, tipo, evalData.fecha ?? null, evalData.alcance_prueba ?? null]
            );
        };

        await upsertEvaluacion('parcial', payload.evaluacion_parcial);
        await upsertEvaluacion('final', payload.evaluacion_final);

        await cliente.query('COMMIT');

        return obtenerCronogramaCurso(cursoId);
    } catch (error) {
        await cliente.query('ROLLBACK');
        throw error;
    } finally {
        cliente.release();
    }
}
