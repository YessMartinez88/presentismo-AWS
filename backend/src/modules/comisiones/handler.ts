import type { Rol } from '../../shared/auth';
import { crearHandler, privada } from '../../shared/http';
import * as svc from './comisiones.service';

// Lambda "comisiones" (aulas): admin y docente.
const gestion: Rol[] = ['ADMIN', 'DOCENTE'];

export const handler = crearHandler({
  'GET /api/comisiones': privada(gestion, async (req) => ({ body: await svc.listar(req.user) })),
  'POST /api/comisiones': privada(gestion, async (req) => ({ status: 201, body: await svc.crear(req.body, req.user) })),
  'PATCH /api/comisiones/{id}': privada(gestion, async (req) => ({
    body: await svc.actualizar(req.params.id, req.body, req.user),
  })),
  'DELETE /api/comisiones/{id}': privada(gestion, async (req) => {
    await svc.eliminar(req.params.id, req.user);
    return { status: 204 };
  }),
  'PATCH /api/comisiones/{id}/estado': privada(gestion, async (req) => ({
    body: await svc.cambiarEstado(req.params.id, req.body.estado, req.user),
  })),
  'GET /api/comisiones/{id}/sesiones': privada(gestion, async (req) => ({
    body: await svc.sesiones(req.params.id, req.user),
  })),
  'GET /api/comisiones/{id}/inscripciones': privada(gestion, async (req) => ({
    body: await svc.alumnos(req.params.id, req.user),
  })),
  'POST /api/comisiones/{id}/inscripciones': privada(gestion, async (req) => ({
    status: 201,
    body: await svc.inscribir(req.params.id, req.body.alumnoId, req.user),
  })),
  'DELETE /api/comisiones/{id}/inscripciones/{alumnoId}': privada(gestion, async (req) => {
    await svc.quitar(req.params.id, req.params.alumnoId, req.user);
    return { status: 204 };
  }),
});
