import type { PoolConfig } from 'pg';
import type { DatabaseConfig } from '../config/env.js';

/** Maps Ordler database settings to node-postgres pool options. */
export function toPoolConfig(db: DatabaseConfig): PoolConfig {
  const base: PoolConfig = db.connectionString
    ? { connectionString: db.connectionString }
    : { host: db.host, port: db.port, database: db.database, user: db.user, password: db.password };

  return {
    ...base,
    max: db.poolMax,
    // Every connection works inside the Ordler schema, so the DB can be shared with other apps.
    options: `-c search_path=${db.schema},public`,
    ssl: toSsl(db),
  };
}

function toSsl(db: DatabaseConfig): PoolConfig['ssl'] {
  switch (db.ssl) {
    case 'disable':
      return false;
    case 'require':
      // Encrypted but unauthenticated, matching libpq sslmode=require.
      return { rejectUnauthorized: false };
    case 'verify-full':
      return { rejectUnauthorized: true, ca: db.sslCa };
  }
}
