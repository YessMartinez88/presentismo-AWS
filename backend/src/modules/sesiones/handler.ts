import type { Rol } from '../../shared/auth';
import { crearHandler, privada } from '../../shared/http';
import * as svc from './sesiones.service';

// Lambda "sesiones": abrir la sesión y pedir el QR es solo del docente dueño del aula;
// ver, cerrar y eliminar también puede hacerlo administración.
const soloDocente: Rol[] = ['DOCENTE'];
const docenteOAdmin: Rol[] = ['DOCENTE', 'ADMIN'];

export const handler = crearHandler({
  'POST /api/sesiones/abrir-qr': privada(soloDocente, (req) => svc.abrir(req.body, req.user)),
  'GET /api/sesiones/{id}': privada(docenteOAdmin, async (req) => ({ body: await svc.detalle(req.params.id, req.user) })),
  'GET /api/sesiones/{id}/qr': privada(soloDocente, async (req) => ({ body: await svc.qr(req.params.id, req.user) })),
  'POST /api/sesiones/{id}/cerrar': privada(docenteOAdmin, async (req) => ({
    body: await svc.cerrar(req.params.id, req.user),
  })),
  'DELETE /api/sesiones/{id}': privada(docenteOAdmin, async (req) => {
    await svc.eliminar(req.params.id, req.user);
    return { status: 204 };
  }),
});
