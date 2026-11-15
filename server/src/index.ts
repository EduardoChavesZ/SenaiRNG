import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';

const server = app.listen(config.PORT, () => {
  console.log(`RNG API listening on port ${config.PORT}`);
});

async function shutdown(): Promise<void> {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
