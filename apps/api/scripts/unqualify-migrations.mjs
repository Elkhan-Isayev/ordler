// drizzle-kit writes foreign keys as REFERENCES "public"."table". Ordler creates its tables in
// the schema selected by search_path (DB_SCHEMA), so references must stay unqualified.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = fileURLToPath(new URL('../drizzle', import.meta.url));
for (const file of readdirSync(folder).filter((name) => name.endsWith('.sql'))) {
  const path = join(folder, file);
  const sql = readFileSync(path, 'utf8');
  const fixed = sql.replaceAll('"public".', '');
  if (fixed !== sql) {
    writeFileSync(path, fixed);
    console.log(`unqualified public schema in ${file}`);
  }
}
