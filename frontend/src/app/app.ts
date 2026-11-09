import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { Rol } from './core/models';

const ROL_LABEL: Record<Rol, string> = { ADMIN: 'Administración', DOCENTE: 'Docente', ALUMNO: 'Alumno' };

// Pestañas persistentes por rol (informe UX: "navegación coherente, pestañas persistentes").
const PESTANAS: Record<Rol, { ruta: string; texto: string }[]> = {
  ADMIN: [
    { ruta: '/admin', texto: 'Aulas' },
    { ruta: '/admin/usuarios', texto: 'Usuarios' },
  ],
  DOCENTE: [{ ruta: '/docente', texto: 'Mis aulas' }],
  ALUMNO: [
    { ruta: '/alumno', texto: 'Mis clases' },
    { ruta: '/alumno/escanear', texto: 'Escanear QR' },
  ],
};

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <div class="inner">
        <span class="brand"><span class="logo" aria-hidden="true">✓</span> Asistencia Instituto</span>
        @if (auth.usuario(); as u) {
          <div class="user">
            <span class="who">
              <strong>{{ u.nombre }}</strong>
              <span class="rol">{{ rolLabel[u.rol] }}</span>
            </span>
            <button type="button" class="btn secondary salir" (click)="auth.logout()">Salir</button>
          </div>
        }
      </div>
      @if (pestanas().length > 1) {
        <nav class="tabs" aria-label="Secciones">
          @for (p of pestanas(); track p.ruta) {
            <a [routerLink]="p.ruta" routerLinkActive="activa" [routerLinkActiveOptions]="{ exact: true }">{{ p.texto }}</a>
          }
        </nav>
      }
    </header>
    <main class="page"><router-outlet /></main>
  `,
  styles: `
    .topbar { background: var(--navy); color: #fff; }
    .inner { max-width: 960px; margin: 0 auto; padding: 0.6rem 1rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .brand { font-weight: 800; letter-spacing: 0.01em; display: inline-flex; align-items: center; gap: 0.5rem; }
    .logo { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--yellow); color: var(--navy); font-weight: 900; }
    .user { display: flex; align-items: center; gap: 0.75rem; }
    .who { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.2; font-size: 0.9rem; }
    .rol { color: var(--silver); font-size: 0.78rem; }
    .btn.salir { color: #fff; border-color: rgb(255 255 255 / 45%); min-height: 44px; padding: 0.4rem 0.9rem; }
    .tabs { max-width: 960px; margin: 0 auto; padding: 0 1rem; display: flex; gap: 0.25rem; }
    .tabs a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 1rem; color: var(--silver); text-decoration: none; font-weight: 700; font-size: 0.85rem; letter-spacing: 0.04em; text-transform: uppercase; border-bottom: 3px solid transparent; }
    .tabs a.activa { color: #fff; border-bottom-color: var(--yellow); }
    .tabs a:focus-visible { outline-color: var(--yellow); }
    .page { max-width: 960px; margin: 0 auto; padding: 1.25rem 1rem 3rem; }
    @media (max-width: 480px) { .who strong { max-width: 9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly rolLabel = ROL_LABEL;
  protected readonly pestanas = computed(() => {
    const u = this.auth.usuario();
    return u ? PESTANAS[u.rol] : [];
  });
}
