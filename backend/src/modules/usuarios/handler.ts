import { crearHandler, privada } from '../../shared/http';
import * as usuariosService from './usuarios.service';

// Lambda "usuarios": ABM de usuarios, solo administración.
const admin = ['ADMIN'] as const;

export const handler = crearHandler({
  'GET /api/usuarios': privada([...admin], async (req) => ({ body: await usuariosService.listar(req.query.rol) })),
  'POST /api/usuarios': privada([...admin], async (req) => ({
    status: 201,
    body: await usuariosService.crear(req.body),
  })),
  'PATCH /api/usuarios/{id}': privada([...admin], async (req) => ({
    body: await usuariosService.actualizar(req.params.id, req.body, req.user),
  })),
});
