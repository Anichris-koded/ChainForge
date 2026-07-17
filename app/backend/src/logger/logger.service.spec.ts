import { CORRELATION_ID_KEY } from '../common/utils/correlation-id.util';
import { BoundLogger, LoggerService } from './logger.module';

describe('LoggerService.child', () => {
  let logger: LoggerService;
  let childPinoLogger: Record<
    'info' | 'error' | 'warn' | 'debug' | 'trace',
    jest.Mock
  >;

  beforeEach(() => {
    logger = new LoggerService();
    childPinoLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    };

    jest
      .spyOn(logger.getLogger(), 'child')
      .mockReturnValue(childPinoLogger as never);
  });

  it('returns a bound logger instance with the concrete subclass prototype', () => {
    const childLogger = logger.child({ service: 'claims' });

    expect(childLogger).toBeInstanceOf(BoundLogger);
    expect(childLogger).toBeInstanceOf(LoggerService);
    expect(childLogger.constructor).not.toBe(LoggerService);
    expect(Object.getPrototypeOf(childLogger)).toBe(BoundLogger.prototype);
  });

  it('reuses async local storage so correlation ids still flow through child loggers', () => {
    const childLogger = logger.child({ service: 'claims' });
    const store = new Map<string, unknown>([
      [CORRELATION_ID_KEY, 'corr-123'],
    ]);

    logger.getAsyncLocalStorage().run(store, () => {
      childLogger.log('hello', 'LoggerSpec', { requestId: 'req-1' });
      childLogger.error('boom', 'stacktrace', 'LoggerSpec', {
        requestId: 'req-2',
      });
      childLogger.verbose('trace me', 'LoggerSpec', { requestId: 'req-3' });
    });

    expect(childPinoLogger.info).toHaveBeenCalledWith(
      {
        context: 'LoggerSpec',
        correlationId: 'corr-123',
        requestId: 'req-1',
      },
      'hello',
    );

    expect(childPinoLogger.error).toHaveBeenCalledWith(
      {
        context: 'LoggerSpec',
        correlationId: 'corr-123',
        trace: 'stacktrace',
        requestId: 'req-2',
      },
      'boom',
    );

    expect(childPinoLogger.trace).toHaveBeenCalledWith(
      {
        context: 'LoggerSpec',
        correlationId: 'corr-123',
        requestId: 'req-3',
      },
      'trace me',
    );
  });
});
