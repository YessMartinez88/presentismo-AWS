import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { query } from '../db/pool';
import { HttpError } from '../errors';

export type Rol = 'ADMIN' | 'DOCENTE' | 'ALUMNO';
export interface AuthUser {
  id: number;
  nombre: string;
  rol: Rol;
}

// Le agrega `req.user` al tipo Request de Express (declaration merging).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function firmarSesion(user: AuthUser): string {
  return jwt.sign({ nombre: user.nombre, rol: user.rol }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: String(user.id),
    expiresIn: config.jwtExpiresIn,
  });
}

/**
 * Exige un `Authorization: Bearer <jwt>` válido y deja el usuario en `req.user`.
 *
 * Además del JWT consulta la base: así un usuario desactivado (o borrado/re-sembrado) pierde el acceso
 * de inmediato en vez de seguir entrando hasta que venza su token, y un cambio de rol se aplica al instante
 * (el rol que vale es el de la base, no el que el token trae "congelado"). Cuesta una consulta por request,
 * razonable a esta escala; si pesara, se resuelve con un caché de pocos segundos.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    const p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (typeof p === 'object' && typeof p.sub === 'string') {
      const id = Number(p.sub);
      const { recordset } = await query<{ nombre: string; rol: Rol; activo: boolean }>(
        'SELECT nombre, rol, activo FROM dbo.usuarios WHERE id = @id',
        { id },
      );
      const u = recordset[0];
      if (u?.activo) {
        req.user = { id, nombre: u.nombre, rol: u.rol };
        return next();
      }
    }
  } catch {
    // cae al error genérico de abajo
  }
  next(new HttpError(401, 'NO_AUTENTICADO', 'Iniciá sesión para continuar.'));
}

/** Autorización por rol: se encadena después de requireAuth. */
export function requireRole(...roles: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.user && roles.includes(req.user.rol)) return next();
    next(new HttpError(403, 'SIN_PERMISO', 'No tenés permiso para esta acción.'));
  };
}
