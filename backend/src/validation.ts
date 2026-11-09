import { HttpError } from './errors';

// Validación de entrada a mano (sin librerías) para mantener el MVP liviano.
// Si crece la cantidad de endpoints conviene migrar a zod: define el esquema una vez y valida + tipa.

export function texto(value: unknown, campo: string, max = 100): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, 'DATO_INVALIDO', `${campo} es obligatorio.`);
  }
  const limpio = value.trim();
  if (limpio.length > max) {
    throw new HttpError(400, 'DATO_INVALIDO', `${campo} admite hasta ${max} caracteres.`);
  }
  return limpio;
}

export function emailValido(value: unknown): string {
  const email = texto(value, 'El email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'DATO_INVALIDO', 'El email no tiene un formato válido.');
  }
  return email;
}

/** bcrypt solo usa los primeros 72 bytes: más largo no suma seguridad, y menos de 8 es débil. */
export function passwordValida(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 72) {
    throw new HttpError(400, 'DATO_INVALIDO', 'La contraseña debe tener entre 8 y 72 caracteres.');
  }
  return value;
}

export function opcionBooleana(value: unknown, campo: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new HttpError(400, 'DATO_INVALIDO', `${campo} inválido.`);
  return value;
}
