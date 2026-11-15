import type { AuthUser } from '../../shared/auth';
import { esCondicionFallida, siguienteId } from '../../shared/db';
import { HttpError, toId } from '../../shared/errors';
import { opcionBooleana, texto } from '../../shared/validation';
import * as asistenciasRepo from '../../repositories/asistencias.repository';
import * as comisionesRepo from '../../repositories/comisiones.repository';
import type { Comision, EstadoComision } from '../../repositories/comisiones.repository';
import * as inscripcionesRepo from '../../repositories/inscripciones.repository';
import * as sesionesRepo from '../../repositories/sesiones.repository';
import * as usuariosRepo from '../../repositories/usuarios.repository';

// En la interfaz se llama "aula"; en la API y la base sigue siendo "comisión".

// Máquina de estados mínima: Borrador → Activa → Cerrada. Evita saltos raros (p. ej. cerrar un borrador).
const TRANSICIONES: Record<EstadoComision, EstadoComision[]> = {
  BORRADOR: ['ACTIVA'],
  ACTIVA: ['CERRADA'],
  CERRADA: [],
};

/** El admin gestiona cualquier aula; un docente solo las suyas. */
async function cargarAula(idParam: unknown, user: AuthUser): Promise<Comision> {
  const aula = await comisionesRepo.obtener(toId(idParam, 'id'));
  if (!aula) throw new HttpError(404, 'NO_ENCONTRADA', 'El aula no existe.');
  if (user.rol !== 'ADMIN' && aula.docenteId !== user.id) {
    throw new HttpError(403, 'SIN_PERMISO', 'Esa aula es de otro docente.');
  }
  return aula;
}

async function validarDocente(docenteId: number): Promise<void> {
  const d = await usuariosRepo.obtener(docenteId);
  if (!d || d.rol !== 'DOCENTE' || !d.activo) {
    throw new HttpError(400, 'DOCENTE_INVALIDO', 'El docente indicado no existe o está inactivo.');
  }
}

// Admin ve todas; el docente solo las suyas.
export async function listar(user: AuthUser) {
  const aulas = user.rol === 'ADMIN' ? await comisionesRepo.listar() : await comisionesRepo.listarPorDocente(user.id);
  const docentes = new Map((await usuariosRepo.obtenerVariosPorId(aulas.map((a) => a.docenteId))).map((d) => [d.id, d]));

  // DynamoDB no tiene JOIN ni subconsultas COUNT: contamos con consultas en paralelo (son pocas aulas).
  const filas = await Promise.all(
    aulas.map(async (a) => ({
      id: a.id,
      materia: a.materia,
      cicloLectivo: a.cicloLectivo,
      estado: a.estado,
      docenteId: a.docenteId,
      docente: docentes.get(a.docenteId)?.nombre ?? '(sin docente)',
      inscriptos: await inscripcionesRepo.contarPorComision(a.id),
      sesiones: await sesionesRepo.contarPorComision(a.id),
    })),
  );
  return filas.sort((a, b) => a.id - b.id);
}

// Admin: elige docente y nace en BORRADOR salvo que pida activarla (flag `activar`).
// Docente: el aula es suya y nace ACTIVA (así puede empezar a tomar asistencia sin esperar a administración).
export async function crear(body: Record<string, unknown>, user: AuthUser) {
  const materia = texto(body.materia, 'La materia');
  const cicloLectivo = texto(body.cicloLectivo, 'El ciclo lectivo', 10);

  let docenteId: number;
  let activar: boolean;
  if (user.rol === 'DOCENTE') {
    docenteId = user.id;
    activar = opcionBooleana(body.activar, 'activar') ?? true;
  } else {
    docenteId = toId(body.docenteId, 'docenteId');
    activar = opcionBooleana(body.activar, 'activar') ?? false;
    await validarDocente(docenteId);
  }

  const estado: EstadoComision = activar ? 'ACTIVA' : 'BORRADOR';
  const id = await siguienteId('comisiones');
  await comisionesRepo.crear({ id, materia, cicloLectivo, docenteId, estado });
  return { id, materia, cicloLectivo, docenteId, estado };
}

// Editar datos del aula. Solo el admin puede reasignar el docente.
export async function actualizar(idParam: unknown, body: Record<string, unknown>, user: AuthUser) {
  const aula = await cargarAula(idParam, user);
  if (aula.estado === 'CERRADA') throw new HttpError(409, 'AULA_CERRADA', 'Un aula cerrada no se puede editar.');

  const cambios: Partial<Pick<Comision, 'materia' | 'cicloLectivo' | 'docenteId'>> = {};
  if (body.materia !== undefined) cambios.materia = texto(body.materia, 'La materia');
  if (body.cicloLectivo !== undefined) cambios.cicloLectivo = texto(body.cicloLectivo, 'El ciclo lectivo', 10);
  if (body.docenteId !== undefined) {
    if (user.rol !== 'ADMIN') throw new HttpError(403, 'SIN_PERMISO', 'Solo administración puede reasignar el docente.');
    const docenteId = toId(body.docenteId, 'docenteId');
    await validarDocente(docenteId);
    cambios.docenteId = docenteId;
  }
  if (Object.keys(cambios).length === 0) throw new HttpError(400, 'DATO_INVALIDO', 'No hay nada para actualizar.');

  await comisionesRepo.actualizar(aula.id, cambios);
  return { id: aula.id };
}

// Solo se puede borrar un aula sin sesiones (con historial de asistencia se cierra, no se borra).
export async function eliminar(idParam: unknown, user: AuthUser) {
  const aula = await cargarAula(idParam, user);
  if (await sesionesRepo.tieneSesiones(aula.id)) {
    throw new HttpError(409, 'TIENE_SESIONES', 'El aula tiene sesiones registradas: eliminá primero las sesiones o cerrá el aula.');
  }
  await inscripcionesRepo.eliminarDeComision(aula.id);
  await comisionesRepo.eliminar(aula.id);
}

export async function cambiarEstado(idParam: unknown, nuevo: unknown, user: AuthUser) {
  const aula = await cargarAula(idParam, user);
  if (typeof nuevo !== 'string' || !(nuevo in TRANSICIONES)) throw new HttpError(400, 'DATO_INVALIDO', 'Estado inválido.');
  const estado = nuevo as EstadoComision;
  if (!TRANSICIONES[aula.estado].includes(estado)) {
    throw new HttpError(409, 'TRANSICION_INVALIDA', `No se puede pasar de ${aula.estado} a ${estado}.`);
  }
  try {
    await comisionesRepo.cambiarEstado(aula.id, aula.estado, estado);
  } catch (err) {
    if (esCondicionFallida(err)) throw new HttpError(409, 'TRANSICION_INVALIDA', 'El aula cambió de estado mientras tanto. Recargá.');
    throw err;
  }
  return { id: aula.id, estado };
}

// Historial de sesiones (clases con QR) del aula, la más reciente primero.
export async function sesiones(idParam: unknown, user: AuthUser) {
  const aula = await cargarAula(idParam, user);
  const lista = await sesionesRepo.listarPorComision(aula.id);
  return Promise.all(
    lista.map(async (s) => {
      const asistencias = await asistenciasRepo.listarPorSesion(s.id);
      return {
        id: s.id,
        fecha: s.fecha,
        abierta: sesionesRepo.estaAbierta(s),
        creadoEn: s.creadoEn,
        presentes: asistencias.filter((a) => a.estado === 'PRESENTE').length,
        total: asistencias.length,
      };
    }),
  );
}

// Alumnos activos del instituto con la marca de si están inscriptos en esta aula.
export async function alumnos(idParam: unknown, user: AuthUser) {
  const aula = await cargarAula(idParam, user);
  const [usuarios, inscripciones] = await Promise.all([
    usuariosRepo.listar(),
    inscripcionesRepo.listarPorComision(aula.id),
  ]);
  const inscriptos = new Set(inscripciones.map((i) => i.alumnoId));
  return usuarios
    .filter((u) => u.rol === 'ALUMNO' && u.activo)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .map((u) => ({ id: u.id, nombre: u.nombre, email: u.email, inscripto: inscriptos.has(u.id) }));
}

export async function inscribir(idParam: unknown, alumnoIdBody: unknown, user: AuthUser) {
  const aula = await cargarAula(idParam, user);
  const alumnoId = toId(alumnoIdBody, 'alumnoId');
  const alumno = await usuariosRepo.obtener(alumnoId);
  if (!alumno || alumno.rol !== 'ALUMNO' || !alumno.activo) {
    throw new HttpError(404, 'NO_ENCONTRADO', 'El alumno no existe o está inactivo.');
  }
  try {
    await inscripcionesRepo.crear({ comisionId: aula.id, alumnoId });
  } catch (err) {
    if (esCondicionFallida(err)) throw new HttpError(409, 'YA_INSCRIPTO', 'El alumno ya está inscripto.');
    throw err;
  }
  return { comisionId: aula.id, alumnoId };
}

export async function quitar(idParam: unknown, alumnoIdParam: unknown, user: AuthUser) {
  const aula = await cargarAula(idParam, user);
  await inscripcionesRepo.eliminar(aula.id, toId(alumnoIdParam, 'alumnoId'));
}
