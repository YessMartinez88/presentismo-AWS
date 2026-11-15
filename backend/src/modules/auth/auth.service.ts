import bcrypt from 'bcryptjs';
import { firmarSesion, type AuthUser } from '../../shared/auth';
import { HttpError } from '../../shared/errors';
import * as usuariosRepo from '../../repositories/usuarios.repository';

// Hash "de relleno": si el email no existe igual hacemos un bcrypt.compare, así el tiempo de
// respuesta no revela qué emails están registrados.
const DUMMY_HASH = bcrypt.hashSync('relleno-para-igualar-tiempos', 10);

export async function login(emailIngresado: unknown, password: unknown) {
  if (typeof emailIngresado !== 'string' || typeof password !== 'string') {
    throw new HttpError(400, 'DATO_INVALIDO', 'Email y contraseña son obligatorios.');
  }
  const email = emailIngresado.trim().toLowerCase();
  const usuario = email === '' ? undefined : await usuariosRepo.obtenerPorEmail(email);

  const ok = await bcrypt.compare(password, usuario?.passwordHash ?? DUMMY_HASH);
  if (!usuario || !ok) {
    throw new HttpError(401, 'CREDENCIALES_INVALIDAS', 'Email o contraseña incorrectos.');
  }
  // Recién después de validar la contraseña revelamos que la cuenta está desactivada.
  if (!usuario.activo) {
    throw new HttpError(403, 'USUARIO_INACTIVO', 'Tu usuario está desactivado. Consultá con administración.');
  }

  const user: AuthUser = { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol };
  return { token: await firmarSesion(user), usuario: { ...user, email: usuario.email } };
}
