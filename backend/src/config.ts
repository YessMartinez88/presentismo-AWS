import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (revisá backend/.env)`);
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} debe ser un entero positivo`);
  return n;
}

export const config = {
  port: int('PORT', 3000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:4200',
  jwtSecret: required('JWT_SECRET'),
  qrSecret: required('QR_SECRET'),
  jwtExpiresIn: '8h',
  qrTokenTtlSeconds: int('QR_TOKEN_TTL_SECONDS', 40),
  qrRefreshSeconds: int('QR_REFRESH_SECONDS', 20),
  sessionDefaultMinutes: int('SESSION_DEFAULT_MINUTES', 10),
  timezone: process.env.APP_TIMEZONE ?? 'Argentina Standard Time',
  db: {
    name: process.env.DB_NAME ?? 'presentismo',
    server: process.env.DB_SERVER ?? '.\\SQLEXPRESS',
    port: int('DB_PORT', 1433),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
} as const;
