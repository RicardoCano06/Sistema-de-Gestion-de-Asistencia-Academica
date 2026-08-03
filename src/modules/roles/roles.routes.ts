import { Router } from 'express';
import { pool } from '../../config/database';
import { autenticar, autorizarRoles } from '../../middlewares/auth.middleware';
import { RBAC, ROLES_ADMIN_O_ACADEMICOS } from '../../utils/rbac';
import { sendJsonError } from '../../utils/http-errors';

const router = Router();

router.get('/roles', autenticar, autorizarRoles(...ROLES_ADMIN_O_ACADEMICOS), async (_req, res, next) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, nombre, descripcion, creado_en FROM roles ORDER BY creado_en DESC LIMIT 100;'
        );
        res.json(rows);
    } catch (error) {
        next(error);
    }
});

router.post('/roles', autenticar, autorizarRoles(...RBAC.admin), async (req, res, next) => {
    try {
        const { nombre, descripcion } = req.body ?? {};

        if (!nombre || typeof nombre !== 'string') {
            return sendJsonError(res, 400, {
                mensaje: 'El campo nombre es obligatorio.',
                codigo: 'rol_nombre_obligatorio'
            });
        }

        const valores = [nombre.trim(), descripcion ?? null];
        const { rows } = await pool.query(
            'INSERT INTO roles (nombre, descripcion) VALUES ($1, $2) RETURNING id, nombre, descripcion, creado_en;',
            valores
        );
        res.status(201).json(rows[0]);
    } catch (error: any) {
        if (error?.code === '23505') {
            return sendJsonError(res, 409, {
                mensaje: 'Ya existe un rol con ese nombre',
                codigo: 'rol_duplicado'
            });
        }
        next(error);
    }
});

export default router;
