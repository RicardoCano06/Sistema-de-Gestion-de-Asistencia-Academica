import  app  from './app';
import { env } from './config/env';
import { iniciarTareasProgramadas } from './jobs/scheduler';
import { logger } from './utils/logger';

const port = env.PORT;

app.listen(port, () => {
    logger.info({ port }, 'Servidor escuchando');
    if (env.corsOrigins.length > 0) {
        logger.info({ origenes: env.corsOrigins }, 'CORS limitado a los orígenes configurados');
    } else {
        logger.info(
            'CORS sin CORS_ORIGINS: se acepta cualquier Origin vía reflexión (para producción definí CORS_ORIGINS separados por coma)'
        );
    }
    if (!env.exposeErrorDetails) {
        logger.info('Respuestas 500 sin detalle al cliente (modo producción o EXPOSE_ERROR_DETAILS=false)');
    }
    iniciarTareasProgramadas();
});
