import type { AuthUser } from '../../shared/auth';
import { config } from '../../shared/config';
import { esCondicionFallida, siguienteId } from '../../shared/db';
import { HttpError, toId } from '../../shared/errors';
import { ahoraIso, hoyLocal, sumarMinutosIso } from '../../shared/fechas';
import { firmarTokenQr } from '../../shared/qr';
import * as asistenciasRepo from '../../repositories/asistencias.repository';
import * as comisionesRepo from '../../repositories/comisiones.repository';
import * as inscripcionesRepo from '../../repositories/inscripciones.repository';
import * as sesionesRepo from '../../repositories/sesiones.repository';
import type { Sesion } from '../../repositories/sesiones.repository';
import * as usuariosRepo from '../../repositories/usuarios.repository';

const MAX_DURACION_MIN = 180;

/** Carga una sesión; si quien consulta es docente, se asegura de que pertenezca a una de sus aulas. */
async function cargarSesionPropia(idParam: unknown, user: AuthUser) {
  const sesion = await sesionesRepo.obtener(toId(idParam, 'id'));
  if (!sesion) throw new HttpError(404, 'NO_ENCONTRADA', 'La sesión no existe.');
  const comision = await comisionesRepo.obtener(sesion.comisionId);
  if (!comision) throw new HttpError(404, 'NO_ENCONTRADA', 'La sesión no existe.');
  if (user.rol !== 'ADMIN' && comision.docenteId !== user.id) {
    throw new HttpError(403, 'SIN_PERMISO', 'Esa sesión es de otro docente.');
  }
  return { sesion, comision };
}

const resumen = (s: Sesion, materia: string, docenteId: number) => ({
  id: s.id,
  comisionId: s.comisionId,
  materia,
  docenteId,
  fecha: s.fecha,
  abierta: sesionesRepo.estaAbierta(s),
  expiraEn: s.expiraEn,
});

// Abre una sesión QR. Si la comisión ya tiene una abierta, la devuelve (así recargar la página no duplica clases).
export async function abrir(body: Record<string, unknown>, user: AuthUser) {
  const comisionId = toId(body.comisionId, 'comisionId');
  const minutos = body.duracionMin === undefined ? config.sessionDefaultMinutes : toId(body.duracionMin, 'duracionMin');
  if (minutos > MAX_DURACION_MIN) {
    throw new HttpError(400, 'DATO_INVALIDO', `La duración máxima es de ${MAX_DURACION_MIN} minutos.`);
  }

  const comision = await comisionesRepo.obtener(comisionId);
  if (!comision) throw new HttpError(404, 'NO_ENCONTRADA', 'La comisión no existe.');
  if (comision.docenteId !== user.id) throw new HttpError(403, 'SIN_PERMISO', 'Esa comisión es de otro docente.');
  if (comision.estado !== 'ACTIVA') {
    throw new HttpError(409, 'COMISION_NO_ACTIVA', 'La comisión tiene que estar ACTIVA para tomar asistencia.');
  }

  // ¿Ya hay una sesión marcada como activa? Si sigue abierta se reutiliza; si venció, se reemplaza.
  if (comision.sesionActivaId !== undefined) {
    const actual = await sesionesRepo.obtener(comision.sesionActivaId);
    if (actual && sesionesRepo.estaAbierta(actual)) return { status: 200, body: { id: actual.id, reutilizada: true } };
  }

  const sesion: Sesion = {
    id: await siguienteId('sesiones'),
    comisionId,
    fecha: hoyLocal(),
    activa: true,
    creadoEn: ahoraIso(),
    expiraEn: sumarMinutosIso(minutos),
  };
  try {
    await sesionesRepo.abrir(sesion, user.id, comision.sesionActivaId);
  } catch (err) {
    // Otra apertura simultánea ganó la transacción.
    if (esCondicionFallida(err)) throw new HttpError(409, 'SESION_YA_ABIERTA', 'La comisión ya tiene una sesión abierta.');
    throw err;
  }

  // Todos los inscriptos arrancan AUSENTE; al escanear pasan a PRESENTE.
  const inscriptos = await inscripcionesRepo.listarPorComision(comisionId);
  await asistenciasRepo.crearAusentes(sesion.id, comisionId, inscriptos.map((i) => i.alumnoId));

  return { status: 201, body: { id: sesion.id, reutilizada: false } };
}

// Estado de la sesión + lista de presentes/ausentes (el frontend la consulta cada pocos segundos).
export async function detalle(idParam: unknown, user: AuthUser) {
  const { sesion, comision } = await cargarSesionPropia(idParam, user);
  const asistencias = await asistenciasRepo.listarPorSesion(sesion.id);
  const nombres = new Map(
    (await usuariosRepo.obtenerVariosPorId(asistencias.map((a) => a.alumnoId))).map((u) => [u.id, u.nombre]),
  );

  const alumnos = asistencias
    .map((a) => ({
      id: a.alumnoId,
      nombre: nombres.get(a.alumnoId) ?? '(usuario eliminado)',
      estado: a.estado,
      registradoEn: a.fechaRegistro ?? null,
    }))
    // Presentes primero (el último en llegar arriba), después el resto por nombre.
    .sort(
      (a, b) =>
        Number(b.estado === 'PRESENTE') - Number(a.estado === 'PRESENTE') ||
        (b.registradoEn ?? '').localeCompare(a.registradoEn ?? '') ||
        a.nombre.localeCompare(b.nombre, 'es'),
    );
  const presentes = alumnos.filter((a) => a.estado === 'PRESENTE').length;
  return {
    ...resumen(sesion, comision.materia, comision.docenteId),
    totales: { inscriptos: alumnos.length, presentes, ausentes: alumnos.length - presentes },
    alumnos,
  };
}

// Token vigente para dibujar el QR. El frontend lo vuelve a pedir cada `refrescarEnSeg`.
export async function qr(idParam: unknown, user: AuthUser) {
  const { sesion } = await cargarSesionPropia(idParam, user);
  if (!sesionesRepo.estaAbierta(sesion)) throw new HttpError(409, 'SESION_CERRADA', 'La sesión ya está cerrada o venció.');
  return {
    token: await firmarTokenQr(sesion.id),
    venceEnSeg: config.qrTokenTtlSeconds,
    refrescarEnSeg: config.qrRefreshSeconds,
  };
}

export async function cerrar(idParam: unknown, user: AuthUser) {
  const { sesion } = await cargarSesionPropia(idParam, user);
  await sesionesRepo.cerrar(sesion);
  return { id: sesion.id, abierta: false };
}

// Elimina la sesión y sus asistencias (útil para limpiar datos de prueba). Es irreversible.
export async function eliminar(idParam: unknown, user: AuthUser) {
  const { sesion } = await cargarSesionPropia(idParam, user);
  await asistenciasRepo.eliminarDeSesion(sesion.id);
  await sesionesRepo.eliminar(sesion);
}
