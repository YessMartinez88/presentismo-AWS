import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** URL de API Gateway que inyecta public/config.js al desplegar ('' en desarrollo: se usa el proxy de ng serve). */
const API_URL = ((window as { __API_URL__?: string }).__API_URL__ ?? '').replace(/\/$/, '');

/**
 * Agrega la URL base y el JWT a cada llamada a la API y, si el servidor responde 401, cierra la sesión local.
 * Los servicios siguen pidiendo rutas relativas ('/api/...'): acá se decide a qué servidor van.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const url = API_URL && req.url.startsWith('/api/') ? API_URL + req.url : req.url;
  const authed = req.clone({ url, setHeaders: token ? { Authorization: `Bearer ${token}` } : {} });

  return next(authed).pipe(
    catchError((err: unknown) => {
      // El 401 del propio login ("contraseña incorrecta") no debe expulsar a nadie.
      const esLogin = req.url.endsWith('/auth/login');
      if (err instanceof HttpErrorResponse && err.status === 401 && !esLogin && token) {
        auth.logout();
      }
      return throwError(() => err);
    }),
  );
};
