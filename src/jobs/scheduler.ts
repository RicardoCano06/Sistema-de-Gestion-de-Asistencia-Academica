import cron from 'node-cron';
import { pool } from '../config/database';
import { recalcularEstadisticaCurso } from '../modules/reportes/reportes.service';
import { logger } from '../utils/logger';

const TIMEZONE = process.env.TZ || 'America/Argentina/Buenos_Aires';

async function obtenerCursosIds(): Promise<number[]> {
    const { rows } = await pool.query('SELECT id FROM cursos');
    return rows.map((row) => row.id as number);
}

async function recalcularEstadisticasMasivas() {
    const cursos = await obtenerCursosIds();
    if (!cursos.length) {
        logger.info('[cron] No hay cursos para recalcular estadísticas');
        return;
    }

    logger.info({ cantidad: cursos.length }, '[cron] Recalculando estadísticas');
    for (const cursoId of cursos) {
        try {
            await recalcularEstadisticaCurso(cursoId);
        } catch (error) {
            logger.error({ cursoId, error }, '[cron] Error recalculando curso');
        }
    }
}

async function limpiarTokensExpirados() {
    const { rowCount } = await pool.query(
        `DELETE FROM tokens_refresco WHERE expiracion < NOW() OR (revocado = TRUE AND expiracion < NOW() - INTERVAL '15 days')`
    );
    if (rowCount) {
        logger.info({ rowCount }, '[cron] Limpieza de tokens completada');
    }
}

export function iniciarTareasProgramadas() {
    cron.schedule('0 2 * * *', () => {
        recalcularEstadisticasMasivas().catch((error) => {
            logger.error({ error }, '[cron] Error general en recalculo masivo');
        });
    }, { timezone: TIMEZONE });

    cron.schedule('0 3 * * *', () => {
        limpiarTokensExpirados().catch((error) => {
            logger.error({ error }, '[cron] Error limpiando tokens expirados');
        });
    }, { timezone: TIMEZONE });

    logger.info({ timezone: TIMEZONE }, '[cron] Tareas programadas activadas');
}
