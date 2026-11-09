import { Router } from 'express';
import { isDuplicateKey, query, withTransaction } from '../db/pool';
import { fechaIso, isoUtc, sesionAbierta } from '../db/sql';
import { HttpError, toId } from '../errors';
import { requireAuth, requireRole, type AuthUser } from '../middleware/auth';
import { opcionBooleana, texto } from '../validation';

// En la interfaz se llama "aula"; en la API y la base sigue siendo "comisión".
export const comisionesRouter = Router();
comisionesRouter.use(requireAuth, requireRole('ADMIN', 'DOCENTE'));

type Estado = 'BORRADOR' | 'ACTIVA' | 'CERRADA';
// Máquina de estados mínima: Borrador → Activa → Cerrada. Evita saltos raros (p. ej. cerrar un borrador).
const TRANSICIONES: Record<Estado, Estado[]> = {
  BORRADOR: ['ACTIVA'],
  ACTIVA: ['CERRADA'],
  CERRADA: [],
};

interface AulaRow {
  id: number;
  docenteId: number;
  estado: Estado;
}

/** El admin gestiona cualquier aula; un docente solo las suyas. */
async function cargarAula(id: number, user: AuthUser): Promise<AulaRow> {
  const { recordset } = await query<AulaRow>(
    'SELECT id, docente_id AS docenteId, estado FROM dbo.comisiones WHERE id = @id',
    { id },
  );
  const aula = recordset[0];
  if (!aula) throw new HttpError(404, 'NO_ENCONTRADA', 'El aula no existe.');
  if (user.rol !== 'ADMIN' && aula.docenteId !== user.id) {
    throw new HttpError(403, 'SIN_PERMISO', 'Esa aula es de otro docente.');
  }
  return aula;
}

async function validarDocente(docenteId: number): Promise<void> {
  const { recordset } = await query(
    "SELECT 1 AS ok FROM dbo.usuarios WHERE id = @docenteId AND rol = 'DOCENTE' AND activo = 1",
    { docenteId },
  );
  if (recordset.length === 0) throw new HttpError(400, 'DOCENTE_INVALIDO', 'El docente indicado no existe o está inactivo.');
}

// Admin ve todas; el docente solo las suyas.
comisionesRouter.get('/', async (req, res) => {
  const user = req.user!;
  const { recordset } = await query(
    `SELECT c.id, c.nombre_materia AS materia, c.ciclo_lectivo AS cicloLectivo, c.estado,
            c.docente_id AS docenteId, d.nombre AS docente,
            (SELECT COUNT(*) FROM dbo.inscripciones i WHERE i.comision_id = c.id) AS inscriptos,
            (SELECT COUNT(*) FROM dbo.sesiones_clase s WHERE s.comision_id = c.id) AS sesiones
       FROM dbo.comisiones c
       JOIN dbo.usuarios d ON d.id = c.docente_id
      WHERE (@rol = 'ADMIN' OR c.docente_id = @userId)
      ORDER BY c.id`,
    { rol: user.rol, userId: user.id },
  );
  res.json(recordset);
});

// Crear un aula. Admin: elige docente y nace en BORRADOR salvo que pida activarla (flag `activar`).
// Docente: el aula es suya y nace ACTIVA (así puede empezar a tomar asistencia sin esperar a administración).
comisionesRouter.post('/', async (req, res) => {
  const user = req.user!;
  const materia = texto(req.body?.materia, 'La materia');
  const cicloLectivo = texto(req.body?.cicloLectivo, 'El ciclo lectivo', 10);

  let docenteId: number;
  let activar: boolean;
  if (user.rol === 'DOCENTE') {
    docenteId = user.id;
    activar = opcionBooleana(req.body?.activar, 'activar') ?? true;
  } else {
    docenteId = toId(req.body?.docenteId, 'docenteId');
    activar = opcionBooleana(req.body?.activar, 'activar') ?? false;
    await validarDocente(docenteId);
  }

  const estado: Estado = activar ? 'ACTIVA' : 'BORRADOR';
  const { recordset } = await query<{ id: number }>(
    `INSERT INTO dbo.comisiones (nombre_materia, docente_id, ciclo_lectivo, estado)
     OUTPUT INSERTED.id
     VALUES (@materia, @docenteId, @cicloLectivo, @estado)`,
    { materia, docenteId, cicloLectivo, estado },
  );
  res.status(201).json({ id: recordset[0]!.id, materia, cicloLectivo, docenteId, estado });
});

// Editar datos del aula. Solo el admin puede reasignar el docente.
comisionesRouter.patch('/:id', async (req, res) => {
  const user = req.user!;
  const aula = await cargarAula(toId(req.params.id, 'id'), user);
  if (aula.estado === 'CERRADA') throw new HttpError(409, 'AULA_CERRADA', 'Un aula cerrada no se puede editar.');

  const body = req.body ?? {};
  const sets: string[] = [];
  const params: Record<string, unknown> = { id: aula.id };
  if (body.materia !== undefined) {
    sets.push('nombre_materia = @materia');
    params.materia = texto(body.materia, 'La materia');
  }
  if (body.cicloLectivo !== undefined) {
    sets.push('ciclo_lectivo = @ciclo');
    params.ciclo = texto(body.cicloLectivo, 'El ciclo lectivo', 10);
  }
  if (body.docenteId !== undefined) {
    if (user.rol !== 'ADMIN') throw new HttpError(403, 'SIN_PERMISO', 'Solo administración puede reasignar el docente.');
    const docenteId = toId(body.docenteId, 'docenteId');
    await validarDocente(docenteId);
    sets.push('docente_id = @docenteId');
    params.docenteId = docenteId;
  }
  if (sets.length === 0) throw new HttpError(400, 'DATO_INVALIDO', 'No hay nada para actualizar.');

  await query(`UPDATE dbo.comisiones SET ${sets.join(', ')} WHERE id = @id`, params);
  res.json({ id: aula.id });
});

// Solo se puede borrar un aula sin sesiones (con historial de asistencia se cierra, no se borra).
comisionesRouter.delete('/:id', async (req, res) => {
  const aula = await cargarAula(toId(req.params.id, 'id'), req.user!);
  await withTransaction(async (tx) => {
    const { recordset } = await query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM dbo.sesiones_clase WHERE comision_id = @id',
      { id: aula.id },
      tx,
    );
    if (recordset[0]!.n > 0) {
      throw new HttpError(409, 'TIENE_SESIONES', 'El aula tiene sesiones registradas: eliminá primero las sesiones o cerrá el aula.');
    }
    await query('DELETE FROM dbo.inscripciones WHERE comision_id = @id', { id: aula.id }, tx);
    await query('DELETE FROM dbo.comisiones WHERE id = @id', { id: aula.id }, tx);
  });
  res.status(204).end();
});

comisionesRouter.patch('/:id/estado', async (req, res) => {
  const aula = await cargarAula(toId(req.params.id, 'id'), req.user!);
  const nuevo = req.body?.estado as Estado;
  if (!(nuevo in TRANSICIONES)) throw new HttpError(400, 'DATO_INVALIDO', 'Estado inválido.');
  if (!TRANSICIONES[aula.estado].includes(nuevo)) {
    throw new HttpError(409, 'TRANSICION_INVALIDA', `No se puede pasar de ${aula.estado} a ${nuevo}.`);
  }
  await query('UPDATE dbo.comisiones SET estado = @nuevo WHERE id = @id', { id: aula.id, nuevo });
  res.json({ id: aula.id, estado: nuevo });
});

// Historial de sesiones (clases con QR) del aula, la más reciente primero.
comisionesRouter.get('/:id/sesiones', async (req, res) => {
  const aula = await cargarAula(toId(req.params.id, 'id'), req.user!);
  const { recordset } = await query(
    `SELECT s.id, ${fechaIso('s.fecha')} AS fecha, ${sesionAbierta('s')} AS abierta,
            ${isoUtc('s.creado_en')} AS creadoEn,
            (SELECT COUNT(*) FROM dbo.asistencias a WHERE a.sesion_id = s.id AND a.estado = 'PRESENTE') AS presentes,
            (SELECT COUNT(*) FROM dbo.asistencias a WHERE a.sesion_id = s.id) AS total
       FROM dbo.sesiones_clase s
      WHERE s.comision_id = @id
      ORDER BY s.id DESC`,
    { id: aula.id },
  );
  res.json(recordset);
});

// Alumnos del instituto con la marca de si están inscriptos en esta aula.
comisionesRouter.get('/:id/inscripciones', async (req, res) => {
  const aula = await cargarAula(toId(req.params.id, 'id'), req.user!);
  const { recordset } = await query(
    `SELECT u.id, u.nombre, u.email,
            CAST(CASE WHEN i.id IS NULL THEN 0 ELSE 1 END AS BIT) AS inscripto
       FROM dbo.usuarios u
       LEFT JOIN dbo.inscripciones i ON i.alumno_id = u.id AND i.comision_id = @id
      WHERE u.rol = 'ALUMNO' AND u.activo = 1
      ORDER BY u.nombre`,
    { id: aula.id },
  );
  res.json(recordset);
});

comisionesRouter.post('/:id/inscripciones', async (req, res) => {
  const aula = await cargarAula(toId(req.params.id, 'id'), req.user!);
  const alumnoId = toId(req.body?.alumnoId, 'alumnoId');

  const { recordset } = await query(
    "SELECT 1 AS ok FROM dbo.usuarios WHERE id = @alumnoId AND rol = 'ALUMNO' AND activo = 1",
    { alumnoId },
  );
  if (recordset.length === 0) throw new HttpError(404, 'NO_ENCONTRADO', 'El alumno no existe o está inactivo.');

  try {
    await query('INSERT INTO dbo.inscripciones (comision_id, alumno_id) VALUES (@comisionId, @alumnoId)', {
      comisionId: aula.id,
      alumnoId,
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw new HttpError(409, 'YA_INSCRIPTO', 'El alumno ya está inscripto.');
    throw err;
  }
  res.status(201).json({ comisionId: aula.id, alumnoId });
});

comisionesRouter.delete('/:id/inscripciones/:alumnoId', async (req, res) => {
  const aula = await cargarAula(toId(req.params.id, 'id'), req.user!);
  const alumnoId = toId(req.params.alumnoId, 'alumnoId');
  await query('DELETE FROM dbo.inscripciones WHERE comision_id = @comisionId AND alumno_id = @alumnoId', {
    comisionId: aula.id,
    alumnoId,
  });
  res.status(204).end();
});
