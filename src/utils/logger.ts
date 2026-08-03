import pino from 'pino';
import { env } from '../config/env';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
});
