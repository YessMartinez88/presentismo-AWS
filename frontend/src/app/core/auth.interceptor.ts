import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** Agrega el JWT a cada llamada a la API y, si el servidor responde 401, cierra la sesión local. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

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
