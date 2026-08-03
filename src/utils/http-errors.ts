import type { Response } from 'express';

/**
 * Cuerpo JSON estable para errores 4xx/5xx controlados.
 * El front puede seguir usando solo `mensaje`; `codigo` y `detalles` son opcionales.
 */
export type JsonErrorBody = {
    mensaje: string;
    codigo?: string;
    detalles?: unknown;
};

export function sendJsonError(res: Response, status: number, body: JsonErrorBody): Response {
    const payload: Record<string, unknown> = { mensaje: body.mensaje };
    if (body.codigo !== undefined) {
        payload.codigo = body.codigo;
    }
    if (body.detalles !== undefined) {
        payload.detalles = body.detalles;
    }
    return res.status(status).json(payload);
}
