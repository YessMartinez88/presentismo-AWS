import { crearHandler, privada, publica } from '../../shared/http';
import * as authService from './auth.service';

// Lambda "auth": login y datos del usuario logueado.
export const handler = crearHandler({
  'POST /api/auth/login': publica(async (req) => ({
    body: await authService.login(req.body.email, req.body.password),
  })),
  'GET /api/auth/me': privada([], async (req) => ({ body: req.user })),
});
