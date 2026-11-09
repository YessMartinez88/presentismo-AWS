import { Routes } from '@angular/router';
import { authGuard, homeGuard, roleGuard } from './core/guards';

// Cada pantalla se carga "lazy" (loadComponent): el navegador baja su código solo cuando se entra a la ruta.
const aulas = () => import('./features/aulas/aulas').then((m) => m.Aulas);

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/login/login').then((m) => m.Login) },

  // Admin y docente comparten la pantalla de aulas (cada uno ve y puede hacer lo suyo).
  { path: 'admin', canActivate: [authGuard, roleGuard('ADMIN')], loadComponent: aulas },
  {
    path: 'admin/usuarios',
    canActivate: [authGuard, roleGuard('ADMIN')],
    loadComponent: () => import('./features/usuarios/usuarios').then((m) => m.Usuarios),
  },
  { path: 'docente', canActivate: [authGuard, roleGuard('DOCENTE')], loadComponent: aulas },
  {
    path: 'sesion/:id',
    canActivate: [authGuard, roleGuard('ADMIN', 'DOCENTE')],
    loadComponent: () => import('./features/aulas/sesion').then((m) => m.SesionPage),
  },

  {
    path: 'alumno',
    canActivate: [authGuard, roleGuard('ALUMNO')],
    loadComponent: () => import('./features/alumno/inicio').then((m) => m.AlumnoInicio),
  },
  {
    // También es el destino del enlace que contiene el QR: /alumno/escanear?t=<token>
    path: 'alumno/escanear',
    canActivate: [authGuard, roleGuard('ALUMNO')],
    loadComponent: () => import('./features/alumno/escanear').then((m) => m.Escanear),
  },
  { path: '', pathMatch: 'full', canActivate: [homeGuard], children: [] },
  { path: '**', redirectTo: '' },
];
