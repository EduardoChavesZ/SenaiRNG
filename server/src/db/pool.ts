import pg from 'pg';
import { config } from '../config.js';
import { normalizeDatabaseConnectionString } from './connection-string.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: normalizeDatabaseConnectionString(config.DATABASE_URL),
  max: 10,
  idleTimeoutMillis: 30_000
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error', error);
});
