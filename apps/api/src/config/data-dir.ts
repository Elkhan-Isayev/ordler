import { randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSettingsInput, DbSslMode } from '@ordler/shared';
import type { SecretBox } from '../crypto/secret-box.js';
import { ConfigError, parseEncryptionKey, type DatabaseConfig } from './env.js';

const KEY_FILE = 'encryption.key';
const DATABASE_FILE = 'database.json';
const PASSWORD_AAD = 'database:password';

/** Installer-saved connection; the password is sealed with the encryption key. */
interface StoredDatabase {
  version: 1;
  host: string;
  port: number;
  database: string;
  user: string;
  passwordEncrypted: string | null;
  ssl: DbSslMode;
  sslCa: string | null;
  schema: string;
  savedAt: string;
}

export type FileSystem = Pick<
  typeof nodeFs,
  'existsSync' | 'mkdirSync' | 'readFileSync' | 'writeFileSync' | 'renameSync'
>;

/**
 * The persistent volume (ORDLER_DATA_DIR, `/data` in the image). It holds what Ordler needs
 * before it can reach PostgreSQL: the database connection saved by the installer and, when
 * ENCRYPTION_KEY is not set, the generated encryption key.
 */
export class DataDir {
  constructor(
    readonly path: string,
    private readonly fs: FileSystem = nodeFs,
  ) {}

  /** Reads the key file, creating it on first start. Losing it means re-entering secrets. */
  encryptionKey(): { key: Buffer; created: boolean } {
    const file = join(this.path, KEY_FILE);
    if (this.fs.existsSync(file)) {
      return { key: parseEncryptionKey(this.fs.readFileSync(file, 'utf8')), created: false };
    }
    const key = randomBytes(32);
    this.write(KEY_FILE, `${key.toString('base64')}\n`);
    return { key, created: true };
  }

  hasDatabase(): boolean {
    return this.fs.existsSync(join(this.path, DATABASE_FILE));
  }

  /** Settings saved by the installer, or undefined before the first save. */
  readDatabase(box: SecretBox, poolMax: number): DatabaseConfig | undefined {
    const stored = this.readStored();
    if (!stored) return undefined;
    const password = stored.passwordEncrypted
      ? box.decrypt(stored.passwordEncrypted, PASSWORD_AAD)
      : undefined;
    if (stored.passwordEncrypted && password === undefined) {
      throw new ConfigError(
        `Cannot decrypt the database password in ${join(this.path, DATABASE_FILE)}: ` +
          'the encryption key changed. Restore the previous key or delete the file to rerun the installer.',
      );
    }
    return {
      host: stored.host,
      port: stored.port,
      database: stored.database,
      user: stored.user,
      ...(password ? { password } : {}),
      schema: stored.schema,
      ssl: stored.ssl,
      ...(stored.sslCa ? { sslCa: stored.sslCa } : {}),
      poolMax,
    };
  }

  writeDatabase(box: SecretBox, input: DatabaseSettingsInput, now = new Date()): void {
    const stored: StoredDatabase = {
      version: 1,
      host: input.host,
      port: input.port,
      database: input.database,
      user: input.user,
      passwordEncrypted: input.password ? box.encrypt(input.password, PASSWORD_AAD) : null,
      ssl: input.ssl,
      sslCa: input.sslCa || null,
      schema: input.schema,
      savedAt: now.toISOString(),
    };
    this.write(DATABASE_FILE, `${JSON.stringify(stored, null, 2)}\n`);
  }

  private readStored(): StoredDatabase | undefined {
    const file = join(this.path, DATABASE_FILE);
    if (!this.fs.existsSync(file)) return undefined;
    const stored = JSON.parse(this.fs.readFileSync(file, 'utf8')) as StoredDatabase;
    if (stored.version !== 1) throw new ConfigError(`Unsupported ${file} version`);
    return stored;
  }

  /** Atomic replace, owner-only permissions: a crash never leaves a half-written file. */
  private write(name: string, content: string): void {
    try {
      this.fs.mkdirSync(this.path, { recursive: true, mode: 0o700 });
      const target = join(this.path, name);
      const temporary = `${target}.tmp`;
      this.fs.writeFileSync(temporary, content, { mode: 0o600 });
      this.fs.renameSync(temporary, target);
    } catch (error) {
      throw new ConfigError(
        `Cannot write ${name} to ORDLER_DATA_DIR=${this.path}: ${(error as Error).message}. ` +
          'Mount a writable volume there, or set the database and ENCRYPTION_KEY through environment variables.',
      );
    }
  }
}
