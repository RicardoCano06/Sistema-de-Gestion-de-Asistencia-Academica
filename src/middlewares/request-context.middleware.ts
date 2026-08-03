import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

declare global {
    namespace Express {
        interface Request {
            requestId?: string;
        }
    }
}

function obtenerPrimerValor(value: string | string[] | undefined): string | undefined {
    if (!value) {
        return undefined;
    }

    const texto = Array.isArray(value) ? value[0] : value;
    const [primero] = texto.split(',');
    const limpio = primero?.trim();
    return limpio || undefined;
}

export function adjuntarRequestContext(req: Request, res: Response, next: NextFunction): void {
    const requestId = obtenerPrimerValor(req.headers['x-request-id']) ?? randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
}
