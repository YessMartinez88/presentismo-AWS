import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { query } from '../db/pool';
import { HttpError } from '../errors';
import { firmarSesion, requireAuth, type Rol } from '../middleware/auth';

export const authRouter = Router();

interface UsuarioRow {
  id: number;
  nombre: string;
  email: string;
  password_hash: string;
  rol: Rol;
  activo: boolean;
}

// Hash "de relleno": si el email no existe igual hacemos un bcrypt.compare, así el tiempo de
// respuesta no revela qué emails están registrados.
const DUMMY_HASH = bcrypt.hashSync('relleno-para-igualar-tiempos', 10);

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new HttpError(400, 'DATO_INVALIDO', 'Email y contraseña son obligatorios.');
  }

  const { recordset } = await query<UsuarioRow>(
    'SELECT id, nombre, email, password_hash, rol, activo FROM dbo.usuarios WHERE email = @email',
    { email: email.trim().toLowerCase() },
  );
  const usuario = recordset[0];
  const ok = await bcrypt.compare(password, usuario?.password_hash ?? DUMMY_HASH);
  if (!usuario || !ok) {
    throw new HttpError(401, 'CREDENCIALES_INVALIDAS', 'Email o contraseña incorrectos.');
  }
  // Recién después de validar la contraseña revelamos que la cuenta está desactivada.
  if (!usuario.activo) {
    throw new HttpError(403, 'USUARIO_INACTIVO', 'Tu usuario está desactivado. Consultá con administración.');
  }

  const user = { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol };
  res.json({ token: firmarSesion(user), usuario: { ...user, email: usuario.email } });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});
