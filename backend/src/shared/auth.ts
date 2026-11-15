import jwt from 'jsonwebtoken';
import { config } from './config';
import { HttpError } from './errors';
import { obtenerClaves } from './secrets';
import * as usuariosRepo from '../repositories/usuarios.repository';

export type Rol = 'ADMIN' | 'DOCENTE' | 'ALUMNO';
export interface AuthUser {
  id: number;
  nombre: string;
  rol: Rol;
}

export async function firmarSesion(user: AuthUser): Promise<string> {
  const { jwt: clave } = await obtenerClaves();
  return jwt.sign({ nombre: user.nombre, rol: user.rol }, clave, {
    algorithm: 'HS256',
    subject: String(user.id),
    expiresIn: config.jwtExpiresIn,
  });
}

/**
 * Valida el header `Authorization: Bearer <jwt>` y devuelve el usuario.
 *
 * Además del JWT consulta la base: así un usuario desactivado pierde el acceso de inmediato en vez de
 * seguir entrando hasta que venza su token, y el rol que vale es el de la base, no el "congelado" en el token.
 */
export async function autenticar(header: string | undefined): Promise<AuthUser> {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    const { jwt: clave } = await obtenerClaves();
    const p = jwt.verify(token, clave, { algorithms: ['HS256'] });
    if (typeof p === 'object' && typeof p.sub === 'string') {
      const id = Number(p.sub);
      const u = await usuariosRepo.obtener(id);
      if (u?.activo) return { id, nombre: u.nombre, rol: u.rol };
    }
  } catch (err) {
    // Un error de firma/vencimiento es "no autenticado"; un error de AWS (DynamoDB, Secrets) es un 500.
    if (!(err instanceof jwt.JsonWebTokenError)) throw err;
  }
  throw new HttpError(401, 'NO_AUTENTICADO', 'Iniciá sesión para continuar.');
}
