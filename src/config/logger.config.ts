import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Params } from 'nestjs-pino';
import { ApplicationConstants } from '../common/constants/app.constants';
import { Env } from './env.schema';

/** Paths kept out of the request log so probes do not drown real traffic. */
const AUTO_LOGGING_IGNORED_PATHS = ['/health', '/health/ready', '/favicon.ico'];

/**
 * Anything that could carry a credential. Redaction is opt-out-proof: add the
 * path here rather than remembering not to log the value.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.body.password',
  'req.body.otp',
  'req.body.token',
  'res.headers["set-cookie"]',
];

const isIgnoredPath = (url: string | undefined): boolean =>
  AUTO_LOGGING_IGNORED_PATHS.some((ignored) => url?.endsWith(ignored) === true);

/**
 * Assigns (or honours) a correlation id per request and echoes it back on the
 * response, so a client can quote the id from an error body in a bug report.
 */
const generateRequestId = (request: IncomingMessage, response: ServerResponse): string => {
  const incoming = request.headers[ApplicationConstants.RequestIdHeader];
  const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
  response.setHeader(ApplicationConstants.RequestIdHeader, requestId);
  return requestId;
};

/** Only the fields the logger needs, so callers can pass a ConfigService read. */
export type LoggerEnv = Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>;

export const buildLoggerParams = (env: LoggerEnv): Params => ({
  pinoHttp: {
    level: env.LOG_LEVEL,
    genReqId: generateRequestId,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    autoLogging: { ignore: (request) => isIgnoredPath(request.url) },
    // Pretty output locally; newline-delimited JSON everywhere else so the
    // hosting platform can parse it.
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss.l' } }
        : undefined,
  },
});
