import sql from 'mssql';
import { config } from '../config';

export type Params = Record<string, unknown>;
export type Tx = sql.Transaction;

const pools = new Map<string, Promise<sql.ConnectionPool>>();

/**
 * Local: autenticación de Windows con el driver ODBC (msnodesqlv8), porque SQL Express
 * trae TCP/IP deshabilitado. AWS RDS: usuario/clave por TCP (tedious, el driver por defecto).
 * El resto del código no se entera de cuál se usa: ambos exponen la misma API de `mssql`.
 */
async function connect(database: string): Promise<sql.ConnectionPool> {
  const { server, port, user, password } = config.db;

  if (user) {
    const pool = new sql.ConnectionPool({
      server,
      port,
      database,
      user,
      password,
      options: { encrypt: true, trustServerCertificate: true },
    });
    return pool.connect();
  }

  // Import dinámico: en la nube (sin Windows) el módulo nativo ni se carga.
  const { default: sqlWin } = await import('mssql/msnodesqlv8.js');
  // `connectionString` es propio de msnodesqlv8 y @types/mssql no lo declara: de ahí el cast.
  const pool = new sqlWin.ConnectionPool({
    connectionString:
      `Driver={ODBC Driver 17 for SQL Server};Server=${server};Database=${database};` +
      'Trusted_Connection=yes;TrustServerCertificate=yes;',
  } as unknown as sql.config);
  return pool.connect();
}

/** Un pool por base, reutilizado entre requests (abrir una conexión por request sería lento). */
export function getPool(database: string = config.db.name): Promise<sql.ConnectionPool> {
  let pool = pools.get(database);
  if (!pool) {
    pool = connect(database);
    pools.set(database, pool);
    // Si falla la conexión, no dejamos la promesa rechazada cacheada para siempre.
    pool.catch(() => pools.delete(database));
  }
  return pool;
}

export async function closePools(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map(async (p) => (await p).close()));
}

function bind(request: sql.Request, params: Params): sql.Request {
  for (const [name, value] of Object.entries(params)) request.input(name, value);
  return request;
}

/** Consulta parametrizada (los valores viajan como parámetros, nunca concatenados al SQL). */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: Params = {},
  tx?: Tx,
): Promise<sql.IResult<T>> {
  const request = tx ? tx.request() : (await getPool()).request();
  return bind(request, params).query<T>(text);
}

export async function withTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = (await getPool()).transaction();
  await tx.begin();
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  }
}

/** Violación de UNIQUE en SQL Server (2627 = constraint, 2601 = índice único). */
export function isDuplicateKey(err: unknown): boolean {
  const number = (err as { number?: number })?.number;
  return number === 2627 || number === 2601;
}
