import { Router } from 'express';
import { logger } from '../../utils/logger';

const router = Router();

router.post('/errores-frontend', (req, res) => {
  const { mensaje, stack, componente, userAgent, timestamp, url } = req.body ?? {};
  logger.error(
    {
      mensaje,
      stack: (stack ?? '').slice(0, 1500),
      componente: (componente ?? '').slice(0, 500),
      url: url ?? req.headers.referer ?? '',
      userAgent: (userAgent ?? '').slice(0, 300),
      timestamp,
    },
    '[ErrorBoundary] Error en frontend'
  );
  res.status(204).send();
});

export default router;
