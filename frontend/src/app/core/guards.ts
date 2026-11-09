import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Rol } from './models';

/** Exige sesión iniciada; si no, manda a /login recordando a dónde quería ir (p. ej. un link de QR). */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.usuario()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** Exige que el usuario tenga uno de los roles indicados; si no, lo manda a SU pantalla de inicio. */
export const roleGuard =
  (...roles: Rol[]): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    const usuario = auth.usuario();
    if (usuario && roles.includes(usuario.rol)) return true;
    return inject(Router).parseUrl(usuario ? auth.homeFor(usuario.rol) : '/login');
  };

/** Ruta raíz: redirige según el rol. */
export const homeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const usuario = auth.usuario();
  return inject(Router).parseUrl(usuario ? auth.homeFor(usuario.rol) : '/login');
};
