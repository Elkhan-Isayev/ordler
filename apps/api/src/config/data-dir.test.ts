import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SecretBox } from '../crypto/secret-box.js';
import { DataDir } from './data-dir.js';

let path: string;

const SETTINGS = {
  host: 'db.push30.test',
  port: 5432,
  database: 'ordler',
  user: 'ordler',
  password: 'db-secret',
  ssl: 'require' as const,
  schema: 'ordler',
};

beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), 'ordler-data-')), 'data');
});
afterEach(() => rmSync(join(path, '..'), { recursive: true, force: true }));

describe('DataDir', () => {
  it('creates the encryption key once and reuses it', () => {
    const first = new DataDir(path).encryptionKey();
    const second = new DataDir(path).encryptionKey();
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.key).toEqual(first.key);
    expect(statSync(join(path, 'encryption.key')).mode & 0o777).toBe(0o600);
  });

  it('round-trips installer settings with the password encrypted on disk', () => {
    const dir = new DataDir(path);
    const box = new SecretBox(dir.encryptionKey().key);
    expect(dir.hasDatabase()).toBe(false);
    dir.writeDatabase(box, SETTINGS);

    expect(dir.hasDatabase()).toBe(true);
    expect(readFileSync(join(path, 'database.json'), 'utf8')).not.toContain('db-secret');
    expect(dir.readDatabase(box, 7)).toEqual({
      host: 'db.push30.test',
      port: 5432,
      database: 'ordler',
      user: 'ordler',
      password: 'db-secret',
      schema: 'ordler',
      ssl: 'require',
      poolMax: 7,
    });
  });

  it('explains a changed encryption key instead of connecting without a password', () => {
    const dir = new DataDir(path);
    dir.writeDatabase(new SecretBox(Buffer.alloc(32, 1)), SETTINGS);
    expect(() => dir.readDatabase(new SecretBox(Buffer.alloc(32, 2)), 20)).toThrow(
      /encryption key changed/,
    );
  });

  it('reports an unwritable volume clearly', () => {
    const blocked = new DataDir('/proc/ordler-cannot-write-here');
    expect(() => blocked.encryptionKey()).toThrow(/Mount a writable volume/);
  });
});
