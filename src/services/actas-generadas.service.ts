import { pool } from '../config/database';

export interface ActaGeneradaRow {
    id: number;
    curso_id: number | null;
    tipo_acta: string;
    url_documento: string;
    generado_por: string | null;
    generado_en: Date;
    parametros: Record<string, unknown>;
}

export function urlDescargaActaGenerada(actaId: number): string {
    return `/reportes/actas/${actaId}/pdf`;
}

export function esUrlActaRegenerable(url: string | null | undefined): boolean {
    return Boolean(url && /^\/reportes\/actas\/\d+\/pdf$/i.test(url.trim()));
}

export async function registrarActaGenerada(input: {
    cursoId?: number | null;
    tipoActa: string;
    parametros?: Record<string, unknown>;
    generadoPor: string;
}): Promise<ActaGeneradaRow> {
    const { rows } = await pool.query<ActaGeneradaRow>(
        `INSERT INTO actas_generadas (curso_id, tipo_acta, url_documento, generado_por, parametros)
         VALUES ($1, $2, 'pending', $3::uuid, $4::jsonb)
         RETURNING id, curso_id, tipo_acta, url_documento, generado_por, generado_en, parametros`,
        [
            input.cursoId ?? null,
            input.tipoActa,
            input.generadoPor,
            JSON.stringify(input.parametros ?? {}),
        ]
    );

    const acta = rows[0];
    const url = urlDescargaActaGenerada(acta.id);
    await pool.query(`UPDATE actas_generadas SET url_documento = $2 WHERE id = $1`, [acta.id, url]);
    return { ...acta, url_documento: url, parametros: input.parametros ?? {} };
}

export async function obtenerActaGeneradaPorId(actaId: number): Promise<ActaGeneradaRow | null> {
    const { rows } = await pool.query<ActaGeneradaRow>(
        `SELECT id, curso_id, tipo_acta, url_documento, generado_por, generado_en, parametros
         FROM actas_generadas
         WHERE id = $1`,
        [actaId]
    );
    return rows[0] ?? null;
}
