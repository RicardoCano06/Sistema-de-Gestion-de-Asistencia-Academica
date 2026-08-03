import { Router } from 'express';
import { comprobarConexion } from '../../config/database';

const router = Router();

router.get('/health', async (_req, res, next) => {
    try {
        await comprobarConexion();
        res.json({ estado: 'ok', baseDatos: 'operativa' });
    } catch (error) {
        next(error);
    }
});

export default router;
