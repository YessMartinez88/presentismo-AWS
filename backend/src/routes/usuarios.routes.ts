import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { isDuplicateKey, query } from '../db/pool';
import { HttpError, toId } from '../errors';
import { requireAuth, requireRole, type Rol } from '../middleware/auth';
import { emailValido, opcionBooleana, passwordValida, texto } from '../validation';

export const usuariosRouter = Router();
usuariosRouter.use(requireAuth, requireRole('ADMIN'));

const ROLES: Rol[] = ['ADMIN', 'DOCENTE', 'ALUMNO'];
const emailRepetido = () => new HttpError(409, 'EMAIL_REPETIDO', 'Ya existe un usuario con ese email.');

usuariosRouter.get('/', async (req, res) => {
  const rol = req.query.rol;
  if (rol !== undefined && !ROLES.includes(rol as Rol)) {
    throw new HttpError(400, 'DATO_INVALIDO', 'Rol inválido.');
  }
  const { recordset } = await query(
    `SELECT id, nombre, email, rol, activo
       FROM dbo.usuarios
      WHERE (@rol IS NULL OR rol = @rol)
      ORDER BY CASE rol WHEN 'ADMIN' THEN 0 WHEN 'DOCENTE' THEN 1 ELSE 2 END, nombre`,
    { rol: rol ?? null },
  );
  res.json(recordset);
});

usuariosRouter.post('/', async (req, res) => {
  const nombre = texto(req.body?.nombre, 'El nombre');
  const email = emailValido(req.body?.email);
  const password = passwordValida(req.body?.password);
  const rol = req.body?.rol as Rol;
  if (!ROLES.includes(rol)) throw new HttpError(400, 'DATO_INVALIDO', 'Rol inválido.');

  try {
    const { recordset } = await query<{ id: number }>(
      `INSERT INTO dbo.usuarios (nombre, email, password_hash, rol)
       OUTPUT INSERTED.id
       VALUES (@nombre, @email, @hash, @rol)`,
      { nombre, email, hash: await bcrypt.hash(password, 10), rol },
    );
    res.status(201).json({ id: recordset[0]!.id, nombre, email, rol, activo: true });
  } catch (err) {
    // La base es la que garantiza la unicidad (UNIQUE en email): evita la carrera "consultar y luego insertar".
    if (isDuplicateKey(err)) throw emailRepetido();
    throw err;
  }
});

// El rol no se edita a propósito: cambiarlo dejaría datos incoherentes (un docente con aulas, un alumno inscripto).
usuariosRouter.patch('/:id', async (req, res) => {
  const id = toId(req.params.id, 'id');
  const body = req.body ?? {};

  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  if (body.nombre !== undefined) {
    sets.push('nombre = @nombre');
    params.nombre = texto(body.nombre, 'El nombre');
  }
  if (body.email !== undefined) {
    sets.push('email = @email');
    params.email = emailValido(body.email);
  }
  if (body.password !== undefined && body.password !== '') {
    sets.push('password_hash = @hash');
    params.hash = await bcrypt.hash(passwordValida(body.password), 10);
  }
  const activo = opcionBooleana(body.activo, 'activo');
  if (activo !== undefined) {
    if (!activo && id === req.user!.id) {
      throw new HttpError(409, 'AUTO_DESACTIVACION', 'No podés desactivar tu propia cuenta.');
    }
    sets.push('activo = @activo');
    params.activo = activo;
  }
  if (sets.length === 0) throw new HttpError(400, 'DATO_INVALIDO', 'No hay nada para actualizar.');

  try {
    const r = await query(`UPDATE dbo.usuarios SET ${sets.join(', ')} WHERE id = @id`, params);
    if (r.rowsAffected[0] === 0) throw new HttpError(404, 'NO_ENCONTRADO', 'El usuario no existe.');
  } catch (err) {
    if (isDuplicateKey(err)) throw emailRepetido();
    throw err;
  }

  const { recordset } = await query('SELECT id, nombre, email, rol, activo FROM dbo.usuarios WHERE id = @id', { id });
  res.json(recordset[0]);
});
