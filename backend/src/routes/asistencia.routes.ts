import { Router } from 'express';
import { isDuplicateKey, query, withTransaction } from '../db/pool';
import { fechaIso, isoUtc, sesionAbierta } from '../db/sql';
import { HttpError } from '../errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { verificarTokenQr } from '../services/qr.service';

export const asistenciaRouter = Router();
asistenciaRouter.use(requireAuth, requireRole('ALUMNO'));

// El alumno sale del JWT, NO del body: así nadie puede registrar presente "en nombre de" otro.
asistenciaRouter.post('/registrar-qr', async (req, res) => {
  const alumnoId = req.user!.id;
  const token = req.body?.token;
  if (typeof token !== 'string' || token === '') {
    throw new HttpError(400, 'DATO_INVALIDO', 'Falta el código QR.');
  }
  const sesionId = verificarTokenQr(token);

  const resultado = await withTransaction(async (tx) => {
    const { recordset } = await query<{
      comisionId: number;
      materia: string;
      estado: string;
      fecha: string;
      abierta: boolean;
      inscripto: boolean;
    }>(
      `SELECT s.comision_id AS comisionId, c.nombre_materia AS materia, c.estado, ${fechaIso('s.fecha')} AS fecha,
              ${sesionAbierta('s')} AS abierta,
              CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.inscripciones i
                                      WHERE i.comision_id = s.comision_id AND i.alumno_id = @alumnoId)
                        THEN 1 ELSE 0 END AS BIT) AS inscripto
         FROM dbo.sesiones_clase s
         JOIN dbo.comisiones c ON c.id = s.comision_id
        WHERE s.id = @sesionId`,
      { sesionId, alumnoId },
      tx,
    );
    const sesion = recordset[0];
    if (!sesion) throw new HttpError(400, 'QR_INVALIDO', 'El código QR no es válido.');
    if (!sesion.abierta || sesion.estado !== 'ACTIVA') {
      throw new HttpError(410, 'SESION_CERRADA', 'La toma de asistencia de esta clase ya cerró.');
    }
    if (!sesion.inscripto) {
      throw new HttpError(403, 'NO_INSCRIPTO', 'No estás inscripto en esta comisión.');
    }

    // Camino normal: la fila AUSENTE existe desde que se abrió la sesión. El `AND estado = 'AUSENTE'`
    // hace el cambio atómico: si dos requests llegan juntas, solo una modifica la fila.
    const upd = await query(
      `UPDATE dbo.asistencias SET estado = 'PRESENTE', fecha_registro = SYSUTCDATETIME()
        WHERE sesion_id = @sesionId AND alumno_id = @alumnoId AND estado = 'AUSENTE'`,
      { sesionId, alumnoId },
      tx,
    );
    if (upd.rowsAffected[0] === 0) {
      const existente = await query(
        'SELECT 1 AS existe FROM dbo.asistencias WHERE sesion_id = @sesionId AND alumno_id = @alumnoId',
        { sesionId, alumnoId },
        tx,
      );
      if (existente.recordset.length > 0) {
        throw new HttpError(409, 'YA_REGISTRADO', 'Ya registraste tu presencia en esta clase.');
      }
      // Se inscribió después de abrirse la sesión: no tiene fila todavía, la creamos como presente.
      await query(
        `INSERT INTO dbo.asistencias (sesion_id, alumno_id, estado, fecha_registro)
         VALUES (@sesionId, @alumnoId, 'PRESENTE', SYSUTCDATETIME())`,
        { sesionId, alumnoId },
        tx,
      );
    }
    return { materia: sesion.materia, fecha: sesion.fecha };
  }).catch((err) => {
    if (isDuplicateKey(err)) throw new HttpError(409, 'YA_REGISTRADO', 'Ya registraste tu presencia en esta clase.');
    throw err;
  });

  res.status(201).json({ ...resultado, estado: 'PRESENTE' });
});

interface ClaseRow {
  comisionId: number;
  sesionId: number;
  fecha: string;
  estado: 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADA';
  abierta: boolean;
  registradoEn: string | null;
}

// Materias del alumno con % de asistencia y detalle por clase.
asistenciaRouter.get('/alumno/me', async (req, res) => {
  const alumnoId = req.user!.id;
  const { recordset: materias } = await query<{ id: number; materia: string; docente: string; cicloLectivo: string }>(
    `SELECT c.id, c.nombre_materia AS materia, d.nombre AS docente, c.ciclo_lectivo AS cicloLectivo
       FROM dbo.inscripciones i
       JOIN dbo.comisiones c ON c.id = i.comision_id
       JOIN dbo.usuarios d ON d.id = c.docente_id
      WHERE i.alumno_id = @alumnoId AND c.estado = 'ACTIVA'
      ORDER BY c.nombre_materia`,
    { alumnoId },
  );
  const { recordset: clases } = await query<ClaseRow>(
    `SELECT s.comision_id AS comisionId, s.id AS sesionId, ${fechaIso('s.fecha')} AS fecha, a.estado,
            ${sesionAbierta('s')} AS abierta, ${isoUtc('a.fecha_registro')} AS registradoEn
       FROM dbo.asistencias a
       JOIN dbo.sesiones_clase s ON s.id = a.sesion_id
      WHERE a.alumno_id = @alumnoId
      ORDER BY s.fecha DESC, s.id DESC`,
    { alumnoId },
  );

  res.json(
    materias.map((m) => {
      const propias = clases.filter((c) => c.comisionId === m.id);
      // Una clase todavía abierta no cuenta en el porcentaje: el alumno aún puede marcar presente.
      const cerradas = propias.filter((c) => !c.abierta || c.estado !== 'AUSENTE');
      const asistidas = cerradas.filter((c) => c.estado !== 'AUSENTE').length;
      return {
        ...m,
        totalClases: cerradas.length,
        asistidas,
        porcentaje: cerradas.length === 0 ? null : Math.round((asistidas / cerradas.length) * 100),
        claseAbierta: propias.some((c) => c.abierta && c.estado === 'AUSENTE'),
        clases: propias.map((c) => ({
          sesionId: c.sesionId,
          fecha: c.fecha,
          estado: c.abierta && c.estado === 'AUSENTE' ? 'EN_CURSO' : c.estado,
          registradoEn: c.registradoEn,
        })),
      };
    }),
  );
});
