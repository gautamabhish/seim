export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogTransport {
  write(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
}

export interface LoggerConfig {
  level: LogLevel;
  json?: boolean;
  transports?: LogTransport[];
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

class ConsoleTransport implements LogTransport {
  constructor(private json: boolean) {}

  write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (this.json) {
      const entry = { ts: new Date().toISOString(), level, msg: message, ...meta };
      process.stderr.write(JSON.stringify(entry) + '\n');
    } else {
      const prefix = `[SEIM ${level.toUpperCase()}]`;
      const suffix = meta && Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
      process.stderr.write(`${prefix} ${message}${suffix}\n`);
    }
  }
}

export class Logger {
  private level: number;
  private transports: LogTransport[];

  constructor(config: Partial<LoggerConfig> = {}) {
    this.level = LEVEL_PRIORITY[config.level ?? 'info'];
    this.transports = config.transports ?? [new ConsoleTransport(config.json ?? false)];
  }

  public debug(msg: string, meta?: Record<string, unknown>): void {
    this.log('debug', msg, meta);
  }

  public info(msg: string, meta?: Record<string, unknown>): void {
    this.log('info', msg, meta);
  }

  public warn(msg: string, meta?: Record<string, unknown>): void {
    this.log('warn', msg, meta);
  }

  public error(msg: string, meta?: Record<string, unknown>): void {
    this.log('error', msg, meta);
  }

  private log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < this.level) return;
    for (const transport of this.transports) {
      try {
        transport.write(level, msg, meta);
      } catch {
        // never let logging crash the app
      }
    }
  }
}
