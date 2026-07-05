import type { LoggerOptions } from 'pino';
import { config } from '../config/env.js';

export const loggerOptions: LoggerOptions = {
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
};
