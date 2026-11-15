import type { Rol } from '../../shared/auth';
import { crearHandler, privada } from '../../shared/http';
import * as svc from './asistencia.service';

// Lambda "asistencia": lo que hace el alumno (escanear el QR y ver sus materias).
const alumno: Rol[] = ['ALUMNO'];

export const handler = crearHandler({
  'POST /api/asistencia/registrar-qr': privada(alumno, async (req) => ({
    status: 201,
    body: await svc.registrarQr(req.body.token, req.user.id),
  })),
  'GET /api/asistencia/alumno/me': privada(alumno, async (req) => ({ body: await svc.misMaterias(req.user.id) })),
});
