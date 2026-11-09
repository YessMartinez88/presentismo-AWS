/**
 * Fechas/horas: la base guarda DATETIME2 en UTC. En vez de dejar que el driver las convierta a `Date`
 * (los dos drivers lo hacen distinto), las devolvemos ya como texto ISO-8601 con "Z".
 * El frontend hace `new Date(texto)` y lo muestra en la hora local del navegador.
 */
export const isoUtc = (column: string): string => `CONVERT(VARCHAR(33), ${column}, 127) + 'Z'`;

/** Fecha (sin hora) de la clase, en formato YYYY-MM-DD. */
export const fechaIso = (column: string): string => `CONVERT(CHAR(10), ${column}, 23)`;

/** ¿La sesión sigue aceptando asistencias? (activa y sin vencer). Calculado en la base: un solo reloj. */
export const sesionAbierta = (alias: string): string =>
  `CAST(CASE WHEN ${alias}.activa = 1 AND ${alias}.expira_en > SYSUTCDATETIME() THEN 1 ELSE 0 END AS BIT)`;
