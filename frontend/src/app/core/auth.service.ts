import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { LoginResponse, Rol, Usuario } from './models';

const STORAGE_KEY = 'presentismo.sesion';

interface Sesion {
  token: string;
  usuario: Usuario;
}

/**
 * La sesión vive en sessionStorage (una por pestaña) y no en localStorage a propósito:
 * así podés tener el docente en una pestaña y un alumno en otra, del mismo navegador, sin que
 * un login pise al otro. Es la forma más cómoda de probar el QR en una sola PC.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly sesion = signal<Sesion | null>(this.leer());

  readonly usuario = computed(() => this.sesion()?.usuario ?? null);
  readonly token = computed(() => this.sesion()?.token ?? null);

  login(email: string, password: string) {
    return this.http.post<LoginResponse>('/api/auth/login', { email, password }).pipe(
      tap((res) => {
        this.sesion.set(res);
        this.guardar(res);
      }),
    );
  }

  logout(): void {
    this.sesion.set(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // sessionStorage puede no estar disponible (modo privado estricto): la sesión en memoria alcanza.
    }
    void this.router.navigate(['/login']);
  }

  /** Pantalla de inicio de cada rol. */
  homeFor(rol: Rol): string {
    return { ADMIN: '/admin', DOCENTE: '/docente', ALUMNO: '/alumno' }[rol];
  }

  private leer(): Sesion | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Sesion) : null;
    } catch {
      return null;
    }
  }

  private guardar(sesion: Sesion): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sesion));
    } catch {
      // ver comentario en logout()
    }
  }
}
