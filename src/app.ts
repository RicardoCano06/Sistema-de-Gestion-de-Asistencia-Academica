import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import routes from './routes';
import { env, esOrigenViteLanDev } from './config/env';
import { logger } from './utils/logger';
import { adjuntarRequestContext } from './middlewares/request-context.middleware';

const app = express();

if (env.isProduction) {
    app.set('trust proxy', 1);
}

const corsOptions: cors.CorsOptions =
    env.corsOrigins.length > 0
        ? {
              origin(origin, callback) {
                  if (!origin) {
                      callback(null, true);
                      return;
                  }
                  if (env.corsOrigins.includes(origin)) {
                      callback(null, true);
                      return;
                  }
                  if (!env.isProduction && esOrigenViteLanDev(origin)) {
                      callback(null, true);
                      return;
                  }
                  callback(new Error(`Origen no permitido por CORS: ${origin}`));
              },
              exposedHeaders: ['Content-Disposition', 'X-Acta-Id'],
          }
        : { origin: true, exposedHeaders: ['Content-Disposition', 'X-Acta-Id'] };

app.use(helmet());
app.use(cors(corsOptions));
app.use(adjuntarRequestContext);
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
// PDFs en Supabase Storage (buckets `actas` y `justificativos`); no hay archivos locales en disco.
app.use(
    '/assets',
    express.static(path.resolve(process.cwd(), 'generated', 'assets'), {
        setHeaders: (res) => {
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.setHeader('Access-Control-Allow-Origin', '*');
        },
    })
);

app.use('/api', routes);

app.get('/', (_req, res) => {
    res.json({ mensaje: 'API de asistencia operativa', version: '1.0.0' });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, 'Error no controlado');
    if (env.exposeErrorDetails) {
        res.status(500).json({
            mensaje: 'Error interno',
            detalle: err instanceof Error ? err.message : String(err)
        });
        return;
    }
    res.status(500).json({ mensaje: 'Error interno' });
});

export default app;

module.exports = app;