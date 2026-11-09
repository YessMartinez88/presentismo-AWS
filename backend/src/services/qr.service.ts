import jwt from 'jsonwebtoken';
import { config } from '../config';
import { HttpError } from '../errors';

/**
 * El QR no contiene un id fijo: contiene un token firmado (JWT/HS256) que vence a los pocos segundos.
 * Si un alumno le saca captura al QR y se la manda a un compañero que no está en el aula,
 * el token ya venció cuando lo use. El docente va pidiendo tokens nuevos (ver GET /sesiones/:id/qr).
 *
 * Usa un secreto distinto al del login (QR_SECRET) y un claim `typ` para que un token de sesión
 * de usuario jamás sirva como QR (ni al revés).
 */
export function firmarTokenQr(sesionId: number, ttlSeconds: number = config.qrTokenTtlSeconds): string {
  return jwt.sign({ sid: sesionId, typ: 'qr' }, config.qrSecret, {
    algorithm: 'HS256',
    expiresIn: ttlSeconds,
  });
}

/** Devuelve el id de sesión si el token es auténtico y vigente; si no, lanza un HttpError claro. */
export function verificarTokenQr(token: string): number {
  try {
    // Fijar `algorithms` evita ataques de confusión de algoritmo (p. ej. alg "none").
    const payload = jwt.verify(token, config.qrSecret, { algorithms: ['HS256'] });
    if (typeof payload === 'object' && payload.typ === 'qr' && Number.isInteger(payload.sid)) {
      return payload.sid as number;
    }
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new HttpError(410, 'QR_VENCIDO', 'El código QR venció. Escaneá el que se muestra ahora en pantalla.');
    }
  }
  throw new HttpError(400, 'QR_INVALIDO', 'El código QR no es válido.');
}
