import { Pool } from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';

export const pool = new Pool({
    connectionString: env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: env.dbStatementTimeoutMs,
});

pool.on('connect', (client) => {
    client.query(`SET statement_timeout = ${env.dbStatementTimeoutMs}; SET idle_in_transaction_session_timeout = ${env.dbStatementTimeoutMs * 2}`).catch((err) => {
        logger.warn({ err }, 'No se pudo configurar timeouts en conexión nueva');
    });
});

pool.on('error', (err) => {
    logger.error({ err }, 'Error inesperado en pool de conexiones');
});

export async function comprobarConexion(): Promise<void> {
    const cliente = await pool.connect();
    try {
        const { rows } = await cliente.query('SELECT NOW() AS fecha_servidor');
        logger.info({ fecha: rows[0].fecha_servidor }, 'Base de datos disponible');
    } finally {
        cliente.release();
    }
}
