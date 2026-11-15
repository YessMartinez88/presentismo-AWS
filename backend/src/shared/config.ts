/**
 * Configuración de las Lambdas. Todo llega por variables de entorno que define el stack de CDK (infra/).
 * Los nombres de las tablas los genera CloudFormation, por eso no están fijos en el código.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
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
  /** Nombre del parámetro SecureString de SSM con la clave maestra de firma (JWT de login y tokens QR). */
  get claveParametro() {
    return required('CLAVE_PARAMETRO');
  },
  jwtExpiresIn: '8h' as const,
  qrTokenTtlSeconds: int('QR_TOKEN_TTL_SECONDS', 40),
  qrRefreshSeconds: int('QR_REFRESH_SECONDS', 20),
  sessionDefaultMinutes: int('SESSION_DEFAULT_MINUTES', 10),
  /** Zona horaria IANA para calcular la "fecha" de la clase (las Lambdas corren en UTC). */
  timezone: process.env.APP_TIMEZONE ?? 'America/Argentina/Buenos_Aires',
  tablas: {
    get usuarios() {
      return required('TABLA_USUARIOS');
    },
    get usuariosEmail() {
      return required('TABLA_USUARIOS_EMAIL');
    },
    get comisiones() {
      return required('TABLA_COMISIONES');
    },
    get inscripciones() {
      return required('TABLA_INSCRIPCIONES');
    },
    get sesiones() {
      return required('TABLA_SESIONES');
    },
    get asistencias() {
      return required('TABLA_ASISTENCIAS');
    },
    get contadores() {
      return required('TABLA_CONTADORES');
    },
  },
};
