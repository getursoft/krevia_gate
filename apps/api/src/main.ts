import 'reflect-metadata';
import { createApp, createLogger } from './bootstrap';
import { loadConfig, type AppConfig } from './config';

async function main() {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (err) {
    // Configuration problems are operator errors: print the actionable message, no stack.
    process.stderr.write(`[krevia-api] ${(err as Error).message}\n`);
    process.exit(1);
  }
  const logger = createLogger(config);

  // Anything that escapes request handling is still logged once, structured and redacted.
  process.on('unhandledRejection', (reason) => {
    logger.emit('error', 'Unhandled promise rejection', { context: 'Process', error: reason });
  });
  process.on('uncaughtException', (err) => {
    logger.emit('error', 'Uncaught exception', { context: 'Process', error: err });
    process.exit(1);
  });

  const app = await createApp(config, logger);
  await app.listen(config.port, '0.0.0.0');
  logger.info(`API listening on http://localhost:${config.port}/api/v1`, {
    context: 'Bootstrap',
    port: config.port,
    database: config.databaseTarget,
    logLevel: config.logLevel,
  });
}

void main();
