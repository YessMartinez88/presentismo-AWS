import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config';
import { HttpError } from './errors';
import { asistenciaRouter } from './routes/asistencia.routes';
import { authRouter } from './routes/auth.routes';
import { comisionesRouter } from './routes/comisiones.routes';
import { sesionesRouter } from './routes/sesiones.routes';
import { usuariosRouter } from './routes/usuarios.routes';

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/usuarios', usuariosRouter);
  app.use('/api/comisiones', comisionesRouter);
  app.use('/api/sesiones', sesionesRouter);
  app.use('/api/asistencia', asistenciaRouter);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'RUTA_INEXISTENTE', 'Ruta inexistente.')));

  // Manejador central de errores. Express 5 le pasa acá también los rechazos de handlers async.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ code: err.code, message: err.message });
      return;
    }
    // JSON mal formado en el body, etc.
    const status = (err as { status?: number })?.status;
    if (status && status >= 400 && status < 500) {
      res.status(status).json({ code: 'PETICION_INVALIDA', message: 'La petición no es válida.' });
      return;
    }
    console.error(err);
    res.status(500).json({ code: 'ERROR_INTERNO', message: 'Ocurrió un error inesperado.' });
  });

  return app;
}
