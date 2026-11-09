/** Error "esperado" de la API: lleva status HTTP y un código estable que el frontend puede interpretar. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Convierte un valor de entrada (body/params) en entero positivo o responde 400. */
export function toId(value: unknown, field: string): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
    throw new HttpError(400, 'DATO_INVALIDO', `${field} inválido`);
  }
  return n;
}
