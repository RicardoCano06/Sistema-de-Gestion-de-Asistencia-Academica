import type { Pool, PoolClient } from 'pg';

type DbClient = Pick<Pool, 'query'> | PoolClient;

/** Recalcula %, faltas y estado de una matrícula (función SQL del período lectivo). */
export async function recalcularMetricasMatricula(
    client: DbClient,
    matriculaId: number
): Promise<void> {
    await client.query('SELECT recalcular_metricas_asistencia($1)', [matriculaId]);
}

/** Recalcula métricas de todas las matrículas de un curso. */
export async function recalcularMetricasCurso(client: DbClient, cursoId: number): Promise<void> {
    const { rows } = await client.query<{ id: number }>(
        `SELECT id FROM matriculas WHERE curso_id = $1`,
        [cursoId]
    );
    for (const row of rows) {
        await recalcularMetricasMatricula(client, row.id);
    }
}
