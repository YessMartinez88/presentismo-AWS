import { config } from './config';

/** Instante actual en ISO-8601 UTC ("2026-11-14T19:05:00.000Z"). Es lo que guardamos en DynamoDB. */
export const ahoraIso = (): string => new Date().toISOString();

/** Fecha del día (YYYY-MM-DD) en la zona horaria del instituto. Las Lambdas corren en UTC. */
export function hoyLocal(): string {
  // 'en-CA' formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
}

export const sumarMinutosIso = (minutos: number): string => new Date(Date.now() + minutos * 60_000).toISOString();
