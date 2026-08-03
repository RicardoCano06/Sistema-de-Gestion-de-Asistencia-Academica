import { Router } from 'express';
import { autenticarUsuario, refrescarSesion, cerrarSesion } from './auth.service';
import { autenticar } from '../../middlewares/auth.middleware';
import { construirContextoAuditoria } from '../auditoria/auditoria.service';
import { sendJsonError } from '../../utils/http-errors';
import { logger } from '../../utils/logger';

const router = Router();

router.post('/auth/login', async (req, res, next) => {
    try {
        const { identificador, email, usuario, password } = req.body ?? {};
        const credential = identificador ?? usuario ?? email;
        if (!credential || !password) {
            return sendJsonError(res, 400, {
                mensaje: 'Usuario y contraseña son obligatorios',
                codigo: 'auth_credenciales_obligatorias'
            });
        }

        const resultado = await autenticarUsuario(String(credential), String(password), construirContextoAuditoria(req));
        res.json(resultado);
    } catch (error: unknown) {
        logger.warn({ err: error }, 'Login rechazado o fallido');
        if (error instanceof Error) {
            return sendJsonError(res, 401, {
                mensaje: error.message,
                codigo: 'auth_login_rechazado'
            });
        }
        return sendJsonError(res, 500, {
            mensaje: 'Error interno',
            codigo: 'auth_login_error'
        });
    }
});

router.get('/auth/me', autenticar, (req, res) => {
    res.json({ usuario: req.usuario });
});

router.post('/auth/refresh', async (req, res, next) => {
    try {
        const { refreshToken } = req.body ?? {};
        if (!refreshToken) {
            return sendJsonError(res, 400, {
                mensaje: 'refreshToken es obligatorio',
                codigo: 'auth_refresh_token_obligatorio'
            });
        }

        const resultado = await refrescarSesion(String(refreshToken), construirContextoAuditoria(req));
        res.json(resultado);
    } catch (error) {
        if (error instanceof Error) {
            return sendJsonError(res, 401, {
                mensaje: error.message,
                codigo: 'auth_refresh_rechazado'
            });
        }
        next(error);
    }
});

router.post('/auth/logout', autenticar, async (req, res, next) => {
    try {
        const { refreshToken } = req.body ?? {};
        if (!refreshToken) {
            return sendJsonError(res, 400, {
                mensaje: 'refreshToken es obligatorio',
                codigo: 'auth_logout_refresh_obligatorio'
            });
        }

        await cerrarSesion(String(refreshToken), construirContextoAuditoria(req));
        res.json({ mensaje: 'Sesión finalizada' });
    } catch (error) {
        if (error instanceof Error) {
            return sendJsonError(res, 400, {
                mensaje: error.message,
                codigo: 'auth_logout_error'
            });
        }
        next(error);
    }
});

export default router;
