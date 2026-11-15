import { esCondicionFallida } from '../../shared/db';
import { HttpError } from '../../shared/errors';
import { ahoraIso } from '../../shared/fechas';
import { verificarTokenQr } from '../../shared/qr';
import * as asistenciasRepo from '../../repositories/asistencias.repository';
import * as comisionesRepo from '../../repositories/comisiones.repository';
import * as inscripcionesRepo from '../../repositories/inscripciones.repository';
import * as sesionesRepo from '../../repositories/sesiones.repository';
import * as usuariosRepo from '../../repositories/usuarios.repository';

// El alumno sale del JWT, NO del body: así nadie puede registrar presente "en nombre de" otro.
export async function registrarQr(token: unknown, alumnoId: number) {
  if (typeof token !== 'string' || token === '') {
    throw new HttpError(400, 'DATO_INVALIDO', 'Falta el código QR.');
  }
  const sesionId = await verificarTokenQr(token);

  const sesion = await sesionesRepo.obtener(sesionId);
  const comision = sesion && (await comisionesRepo.obtener(sesion.comisionId));
  if (!sesion || !comision) throw new HttpError(400, 'QR_INVALIDO', 'El código QR no es válido.');
  if (!sesionesRepo.estaAbierta(sesion) || comision.estado !== 'ACTIVA') {
    throw new HttpError(410, 'SESION_CERRADA', 'La toma de asistencia de esta clase ya cerró.');
  }
  if (!(await inscripcionesRepo.existe(comision.id, alumnoId))) {
    throw new HttpError(403, 'NO_INSCRIPTO', 'No estás inscripto en esta comisión.');
  }

  try {
    await asistenciasRepo.marcarPresente(sesion.id, alumnoId, comision.id, ahoraIso());
  } catch (err) {
    if (esCondicionFallida(err)) throw new HttpError(409, 'YA_REGISTRADO', 'Ya registraste tu presencia en esta clase.');
    throw err;
  }
  return { materia: comision.materia, fecha: sesion.fecha, estado: 'PRESENTE' };
}

// Materias del alumno con % de asistencia y detalle por clase.
export async function misMaterias(alumnoId: number) {
  const [inscripciones, asistencias] = await Promise.all([
    inscripcionesRepo.listarPorAlumno(alumnoId),
    asistenciasRepo.listarPorAlumno(alumnoId),
  ]);
  const [comisiones, sesiones] = await Promise.all([
    comisionesRepo.obtenerVariosPorId(inscripciones.map((i) => i.comisionId)),
    sesionesRepo.obtenerVariosPorId(asistencias.map((a) => a.sesionId)),
  ]);
  const activas = comisiones.filter((c) => c.estado === 'ACTIVA');
  const docentes = new Map(
    (await usuariosRepo.obtenerVariosPorId(activas.map((c) => c.docenteId))).map((d) => [d.id, d.nombre]),
  );
  const sesionPorId = new Map(sesiones.map((s) => [s.id, s]));

  const clases = asistencias
    .flatMap((a) => {
      const s = sesionPorId.get(a.sesionId);
      if (!s) return [];
      return [{
        comisionId: a.comisionId,
        sesionId: a.sesionId,
        fecha: s.fecha,
        estado: a.estado,
        abierta: sesionesRepo.estaAbierta(s),
        registradoEn: a.fechaRegistro ?? null,
      }];
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.sesionId - a.sesionId);

  return activas
    .sort((a, b) => a.materia.localeCompare(b.materia, 'es'))
    .map((m) => {
      const propias = clases.filter((c) => c.comisionId === m.id);
      // Una clase todavía abierta no cuenta en el porcentaje: el alumno aún puede marcar presente.
      const cerradas = propias.filter((c) => !c.abierta || c.estado !== 'AUSENTE');
      const asistidas = cerradas.filter((c) => c.estado !== 'AUSENTE').length;
      return {
        id: m.id,
        materia: m.materia,
        docente: docentes.get(m.docenteId) ?? '',
        cicloLectivo: m.cicloLectivo,
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
    });
}
