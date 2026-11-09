import { Router } from 'express';
import { config } from '../config';
import { isDuplicateKey, query, withTransaction } from '../db/pool';
import { fechaIso, isoUtc, sesionAbierta } from '../db/sql';
import { HttpError, toId } from '../errors';
import { requireAuth, requireRole, type AuthUser } from '../middleware/auth';
import { firmarTokenQr } from '../services/qr.service';

export const sesionesRouter = Router();
sesionesRouter.use(requireAuth);

// Quién puede qué: abrir la sesión y pedir el QR es solo del docente dueño del aula;
// ver, cerrar y eliminar también puede hacerlo administración.
const soloDocente = requireRole('DOCENTE');
const docenteOAdmin = requireRole('DOCENTE', 'ADMIN');

const MAX_DURACION_MIN = 180;

interface SesionRow {
  id: number;
  comisionId: number;
  materia: string;
  fecha: string;
  abierta: boolean;
  expiraEn: string;
}

/** Carga una sesión; si quien consulta es docente, se asegura de que pertenezca a una de sus aulas. */
async function cargarSesionPropia(id: number, user: AuthUser): Promise<SesionRow> {
  const { recordset } = await query<SesionRow & { docenteId: number }>(
    `SELECT s.id, s.comision_id AS comisionId, c.nombre_materia AS materia, c.docente_id AS docenteId,
            ${fechaIso('s.fecha')} AS fecha, ${sesionAbierta('s')} AS abierta, ${isoUtc('s.expira_en')} AS expiraEn
       FROM dbo.sesiones_clase s
       JOIN dbo.comisiones c ON c.id = s.comision_id
      WHERE s.id = @id`,
    { id },
  );
  const sesion = recordset[0];
  if (!sesion) throw new HttpError(404, 'NO_ENCONTRADA', 'La sesión no existe.');
  // 403 y no 404 distingue "no existe" de "no es tuya"; para un MVP interno está bien.
  if (user.rol !== 'ADMIN' && sesion.docenteId !== user.id) {
    throw new HttpError(403, 'SIN_PERMISO', 'Esa sesión es de otro docente.');
  }
  return sesion;
}

// Abre una sesión QR. Si la comisión ya tiene una abierta, la devuelve (así recargar la página no duplica clases).
sesionesRouter.post('/abrir-qr', soloDocente, async (req, res) => {
  const user = req.user!;
  const comisionId = toId(req.body?.comisionId, 'comisionId');
  const minutos = req.body?.duracionMin === undefined ? config.sessionDefaultMinutes : toId(req.body.duracionMin, 'duracionMin');
  if (minutos > MAX_DURACION_MIN) {
    throw new HttpError(400, 'DATO_INVALIDO', `La duración máxima es de ${MAX_DURACION_MIN} minutos.`);
  }

  const resultado = await withTransaction(async (tx) => {
    const { recordset } = await query<{ docenteId: number; estado: string }>(
      'SELECT docente_id AS docenteId, estado FROM dbo.comisiones WHERE id = @comisionId',
      { comisionId },
      tx,
    );
    const comision = recordset[0];
    if (!comision) throw new HttpError(404, 'NO_ENCONTRADA', 'La comisión no existe.');
    if (comision.docenteId !== user.id) throw new HttpError(403, 'SIN_PERMISO', 'Esa comisión es de otro docente.');
    if (comision.estado !== 'ACTIVA') {
      throw new HttpError(409, 'COMISION_NO_ACTIVA', 'La comisión tiene que estar ACTIVA para tomar asistencia.');
    }

    // Las sesiones vencidas que quedaron "activas" se cierran, para no bloquear una nueva.
    await query(
      'UPDATE dbo.sesiones_clase SET activa = 0 WHERE comision_id = @comisionId AND activa = 1 AND expira_en <= SYSUTCDATETIME()',
      { comisionId },
      tx,
    );
    const abierta = await query<{ id: number }>(
      'SELECT id FROM dbo.sesiones_clase WHERE comision_id = @comisionId AND activa = 1',
      { comisionId },
      tx,
    );
    if (abierta.recordset[0]) return { id: abierta.recordset[0].id, reutilizada: true };

    const nueva = await query<{ id: number }>(
      `INSERT INTO dbo.sesiones_clase (comision_id, fecha, expira_en)
       OUTPUT INSERTED.id
       VALUES (@comisionId, CAST(SYSDATETIMEOFFSET() AT TIME ZONE @tz AS DATE), DATEADD(MINUTE, @minutos, SYSUTCDATETIME()))`,
      { comisionId, minutos, tz: config.timezone },
      tx,
    );
    const id = nueva.recordset[0]!.id;
    // Todos los inscriptos arrancan AUSENTE; al escanear pasan a PRESENTE.
    await query(
      `INSERT INTO dbo.asistencias (sesion_id, alumno_id, estado)
       SELECT @id, alumno_id, 'AUSENTE' FROM dbo.inscripciones WHERE comision_id = @comisionId`,
      { id, comisionId },
      tx,
    );
    return { id, reutilizada: false };
  }).catch((err) => {
    // Índice único "una sesión activa por comisión": dos aperturas simultáneas → la segunda cae acá.
    if (isDuplicateKey(err)) throw new HttpError(409, 'SESION_YA_ABIERTA', 'La comisión ya tiene una sesión abierta.');
    throw err;
  });

  res.status(resultado.reutilizada ? 200 : 201).json(resultado);
});

// Estado de la sesión + lista de presentes/ausentes (el frontend la consulta cada pocos segundos).
sesionesRouter.get('/:id', docenteOAdmin, async (req, res) => {
  const sesion = await cargarSesionPropia(toId(req.params.id, 'id'), req.user!);
  const { recordset: alumnos } = await query<{ id: number; nombre: string; estado: string; registradoEn: string | null }>(
    `SELECT u.id, u.nombre, a.estado, ${isoUtc('a.fecha_registro')} AS registradoEn
       FROM dbo.asistencias a
       JOIN dbo.usuarios u ON u.id = a.alumno_id
      WHERE a.sesion_id = @id
      ORDER BY CASE WHEN a.estado = 'PRESENTE' THEN 0 ELSE 1 END, a.fecha_registro DESC, u.nombre`,
    { id: sesion.id },
  );
  const presentes = alumnos.filter((a) => a.estado === 'PRESENTE').length;
  res.json({
    ...sesion,
    totales: { inscriptos: alumnos.length, presentes, ausentes: alumnos.length - presentes },
    alumnos,
  });
});

// Token vigente para dibujar el QR. El frontend lo vuelve a pedir cada `refrescarEnSeg`.
sesionesRouter.get('/:id/qr', soloDocente, async (req, res) => {
  const sesion = await cargarSesionPropia(toId(req.params.id, 'id'), req.user!);
  if (!sesion.abierta) throw new HttpError(409, 'SESION_CERRADA', 'La sesión ya está cerrada o venció.');
  res.json({
    token: firmarTokenQr(sesion.id),
    venceEnSeg: config.qrTokenTtlSeconds,
    refrescarEnSeg: config.qrRefreshSeconds,
  });
});

sesionesRouter.post('/:id/cerrar', docenteOAdmin, async (req, res) => {
  const sesion = await cargarSesionPropia(toId(req.params.id, 'id'), req.user!);
  await query('UPDATE dbo.sesiones_clase SET activa = 0 WHERE id = @id', { id: sesion.id });
  res.json({ id: sesion.id, abierta: false });
});

// Elimina la sesión y sus asistencias (útil para limpiar datos de prueba). Es irreversible.
sesionesRouter.delete('/:id', docenteOAdmin, async (req, res) => {
  const sesion = await cargarSesionPropia(toId(req.params.id, 'id'), req.user!);
  await withTransaction(async (tx) => {
    await query('DELETE FROM dbo.asistencias WHERE sesion_id = @id', { id: sesion.id }, tx);
    await query('DELETE FROM dbo.sesiones_clase WHERE id = @id', { id: sesion.id }, tx);
  });
  res.status(204).end();
});
