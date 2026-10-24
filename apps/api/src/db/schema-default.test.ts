import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveDefaultSchema } from './schema-default.js';

const clients: PGlite[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
});

async function database(setup = '') {
  const client = new PGlite();
  clients.push(client);
  if (setup) await client.exec(setup);
  return client;
}

describe('resolveDefaultSchema', () => {
  it('uses public on a fresh database', async () => {
    expect(await resolveDefaultSchema(await database())).toBe('public');
  });

  it('keeps an installation created with the old ordler default where its data is', async () => {
    const client = await database(
      'create schema ordler; create table ordler.__drizzle_migrations (id serial primary key);',
    );
    expect(await resolveDefaultSchema(client)).toBe('ordler');
  });

  it('prefers public once it holds Ordler', async () => {
    const client = await database(`
      create schema ordler; create table ordler.__drizzle_migrations (id serial primary key);
      create table public.__drizzle_migrations (id serial primary key);
    `);
    expect(await resolveDefaultSchema(client)).toBe('public');
  });
});
