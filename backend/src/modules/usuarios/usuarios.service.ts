import bcrypt from 'bcryptjs';
import type { AuthUser, Rol } from '../../shared/auth';
import { esCondicionFallida, siguienteId } from '../../shared/db';
import { HttpError, toId } from '../../shared/errors';
import { emailValido, opcionBooleana, passwordValida, texto } from '../../shared/validation';
import * as usuariosRepo from '../../repositories/usuarios.repository';

const ROLES: Rol[] = ['ADMIN', 'DOCENTE', 'ALUMNO'];
const ORDEN_ROL: Record<Rol, number> = { ADMIN: 0, DOCENTE: 1, ALUMNO: 2 };
const emailRepetido = () => new HttpError(409, 'EMAIL_REPETIDO', 'Ya existe un usuario con ese email.');

export async function listar(rol: string | undefined) {
  if (rol !== undefined && !ROLES.includes(rol as Rol)) {
    throw new HttpError(400, 'DATO_INVALIDO', 'Rol inválido.');
  }
  const usuarios = await usuariosRepo.listar();
  return usuarios
    .filter((u) => rol === undefined || u.rol === rol)
    .sort((a, b) => ORDEN_ROL[a.rol] - ORDEN_ROL[b.rol] || a.nombre.localeCompare(b.nombre, 'es'))
    .map(usuariosRepo.publico);
}

export async function crear(body: Record<string, unknown>) {
  const nombre = texto(body.nombre, 'El nombre');
  const email = emailValido(body.email);
  const password = passwordValida(body.password);
  const rol = body.rol as Rol;
  if (!ROLES.includes(rol)) throw new HttpError(400, 'DATO_INVALIDO', 'Rol inválido.');

  const usuario: usuariosRepo.Usuario = {
    id: await siguienteId('usuarios'),
    nombre,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    rol,
    activo: true,
  };
  try {
    await usuariosRepo.crear(usuario);
  } catch (err) {
    // La unicidad la garantiza la base (condición en la transacción), no un "consultar y luego insertar".
    if (esCondicionFallida(err)) throw emailRepetido();
    throw err;
  }
  return usuariosRepo.publico(usuario);
}

// El rol no se edita a propósito: cambiarlo dejaría datos incoherentes (un docente con aulas, un alumno inscripto).
export async function actualizar(idParam: unknown, body: Record<string, unknown>, quien: AuthUser) {
  const id = toId(idParam, 'id');
  const cambios: usuariosRepo.CambiosUsuario = {};
  if (body.nombre !== undefined) cambios.nombre = texto(body.nombre, 'El nombre');
  if (body.email !== undefined) cambios.email = emailValido(body.email);
  if (body.password !== undefined && body.password !== '') {
    cambios.passwordHash = await bcrypt.hash(passwordValida(body.password), 10);
  }
  const activo = opcionBooleana(body.activo, 'activo');
  if (activo !== undefined) {
    if (!activo && id === quien.id) {
      throw new HttpError(409, 'AUTO_DESACTIVACION', 'No podés desactivar tu propia cuenta.');
    }
    cambios.activo = activo;
  }
  if (Object.keys(cambios).length === 0) throw new HttpError(400, 'DATO_INVALIDO', 'No hay nada para actualizar.');

  const actual = await usuariosRepo.obtener(id);
  if (!actual) throw new HttpError(404, 'NO_ENCONTRADO', 'El usuario no existe.');
  try {
    await usuariosRepo.actualizar(actual, cambios);
  } catch (err) {
    if (esCondicionFallida(err)) throw emailRepetido();
    throw err;
  }
  return usuariosRepo.publico({ ...actual, ...cambios });
}
