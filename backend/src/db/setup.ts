import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from '../config';
import { closePools, getPool } from './pool';

const schemaPath = fileURLToPath(new URL('../../../infra/database-schema.sql', import.meta.url));

/** Crea la base (si no existe) y aplica el esquema. Es idempotente. */
export async function setupDatabase(): Promise<void> {
  const name = config.db.name;
  // El nombre va dentro de un identificador SQL (no se puede parametrizar): lo validamos.
  if (!/^\w+$/.test(name)) throw new Error(`DB_NAME inválido: ${name}`);

  const master = await getPool('master');
  await master
    .request()
    .input('db', name)
    .query(`IF DB_ID(@db) IS NULL EXEC('CREATE DATABASE [${name}]')`);

  const pool = await getPool(name);
  await pool.request().batch(await readFile(schemaPath, 'utf8'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  setupDatabase()
    .then(() => console.log(`Base "${config.db.name}" lista.`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(closePools);
}
