import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import pino, { Logger as PinoLogger, Bindings, ChildLoggerOptions } from 'pino';
import { AsyncLocalStorage } from 'async_hooks';
import { CORRELATION_ID_KEY } from '../common/utils/correlation-id.util';

type LogMessage = string | Record<string, unknown>;
type LogMeta = Record<string, unknown> | undefined;
type LogContext = string | undefined;
type ErrorTrace = string | undefined;

// Interface for log entries
interface LogEntry {
  message?: string;
  context?: string;
  correlationId?: string;
  timestamp: string;
  [key: string]: unknown;
}

@Injectable()
export class LoggerService implements NestLoggerService {
  protected logger: PinoLogger;
  protected asyncLocalStorage: AsyncLocalStorage<Map<string, unknown>>;

  constructor() {
    this.asyncLocalStorage = new AsyncLocalStorage<Map<string, unknown>>();
    this.logger = LoggerService.createLogger(this);
  }

  private static createLogger(service: LoggerService): PinoLogger {
    return pino({
      level: process.env.LOG_LEVEL || 'info',
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label: string): Record<string, unknown> => ({ level: label }),
        log: (object: Record<string, unknown>): Record<string, unknown> => {
          const correlationId = service.getCorrelationId();
          if (correlationId) {
            return { ...object, correlationId };
          }
          return object;
        },
      },
    });
  }

  /**
   * Get correlation ID from async local storage
   */
  getCorrelationId(): string | undefined {
    const store = this.asyncLocalStorage.getStore();
    return store?.get(CORRELATION_ID_KEY) as string | undefined;
  }

  /**
   * Format message with correlation ID for methods that bypass Pino's formatters
   */
  private formatMessage(
    message: LogMessage,
    context?: string,
    meta?: LogMeta,
  ): LogEntry {
    const correlationId = this.getCorrelationId();
    const timestamp = new Date().toISOString();

    // If message is an object, merge it with metadata
    if (typeof message === 'object' && message !== null) {
      return {
        ...message,
        ...(meta || {}),
        correlationId,
        context,
        timestamp,
      };
    }

    // String message with metadata
    return {
      message,
      ...(meta || {}),
      correlationId,
      context,
      timestamp,
    };
  }

  /**
   * Log a message with context
   */
  log(message: LogMessage, context?: LogContext, meta?: LogMeta): void {
    const correlationId = this.getCorrelationId();

    if (typeof message === 'object' && message !== null) {
      this.logger.info({ context, correlationId, ...message, ...(meta || {}) });
    } else {
      this.logger.info({ context, correlationId, ...(meta || {}) }, message);
    }
  }

  /**
   * Log an error message
   */
  error(
    message: LogMessage,
    trace?: ErrorTrace,
    context?: LogContext,
    meta?: LogMeta,
  ): void {
    const correlationId = this.getCorrelationId();

    if (typeof message === 'object' && message !== null) {
      this.logger.error({
        context,
        correlationId,
        trace,
        ...message,
        ...(meta || {}),
      });
    } else {
      this.logger.error(
        { context, correlationId, trace, ...(meta || {}) },
        message,
      );
    }
  }

  /**
   * Log a warning message
   */
  warn(message: LogMessage, context?: LogContext, meta?: LogMeta): void {
    const correlationId = this.getCorrelationId();

    if (typeof message === 'object' && message !== null) {
      this.logger.warn({ context, correlationId, ...message, ...(meta || {}) });
    } else {
      this.logger.warn({ context, correlationId, ...(meta || {}) }, message);
    }
  }

  /**
   * Log a debug message
   */
  debug(message: LogMessage, context?: LogContext, meta?: LogMeta): void {
    const correlationId = this.getCorrelationId();

    if (typeof message === 'object' && message !== null) {
      this.logger.debug({
        context,
        correlationId,
        ...message,
        ...(meta || {}),
      });
    } else {
      this.logger.debug({ context, correlationId, ...(meta || {}) }, message);
    }
  }

  /**
   * Log a verbose message
   */
  verbose(message: LogMessage, context?: LogContext, meta?: LogMeta): void {
    const correlationId = this.getCorrelationId();

    if (typeof message === 'object' && message !== null) {
      this.logger.trace({
        context,
        correlationId,
        ...message,
        ...(meta || {}),
      });
    } else {
      this.logger.trace({ context, correlationId, ...(meta || {}) }, message);
    }
  }

  /**
   * Get the underlying Pino logger instance
   */
  getLogger(): PinoLogger {
    return this.logger;
  }

  /**
   * Expose the async local storage for middleware use
   */
  getAsyncLocalStorage(): AsyncLocalStorage<Map<string, unknown>> {
    return this.asyncLocalStorage;
  }

  /**
   * Create a child logger with fixed correlation ID
   */
  child(bindings: Bindings, options?: ChildLoggerOptions): BoundLogger {
    return new BoundLogger(
      this.logger.child(bindings, options),
      this.asyncLocalStorage,
    );
  }
}

export class BoundLogger extends LoggerService {
  constructor(
    logger: PinoLogger,
    asyncLocalStorage: AsyncLocalStorage<Map<string, unknown>>,
  ) {
    super();
    this.logger = logger;
    this.asyncLocalStorage = asyncLocalStorage;
  }
}
