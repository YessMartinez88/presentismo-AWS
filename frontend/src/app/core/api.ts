import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  AlumnoInscripcion,
  Comision,
  EstadoComision,
  MateriaAsistencia,
  QrToken,
  RegistroAsistencia,
  Rol,
  Sesion,
  SesionResumen,
  UsuarioGestion,
} from './models';

export interface NuevaAula {
  materia: string;
  cicloLectivo: string;
  docenteId?: number;
  activar?: boolean;
}

export interface NuevoUsuario {
  nombre: string;
  email: string;
  password: string;
  rol: Rol;
}

/** Convierte cualquier error de HTTP en un mensaje mostrable (el backend responde { code, message }). */
export function mensajeDeError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'No se pudo conectar con el servidor. ¿Está corriendo el backend?';
    const message = (err.error as { message?: string } | null)?.message;
    if (message) return message;
  }
  return 'Ocurrió un error inesperado.';
}

export function codigoDeError(err: unknown): string | null {
  return err instanceof HttpErrorResponse ? ((err.error as { code?: string } | null)?.code ?? null) : null;
}

// Un servicio por área, igual que los controladores del backend.

@Injectable({ providedIn: 'root' })
export class ComisionesApi {
  private readonly http = inject(HttpClient);

  listar() {
    return this.http.get<Comision[]>('/api/comisiones');
  }
  crear(aula: NuevaAula) {
    return this.http.post<{ id: number }>('/api/comisiones', aula);
  }
  editar(id: number, cambios: Partial<Omit<NuevaAula, 'activar'>>) {
    return this.http.patch<{ id: number }>(`/api/comisiones/${id}`, cambios);
  }
  eliminar(id: number) {
    return this.http.delete<void>(`/api/comisiones/${id}`);
  }
  sesiones(id: number) {
    return this.http.get<SesionResumen[]>(`/api/comisiones/${id}/sesiones`);
  }
  cambiarEstado(id: number, estado: EstadoComision) {
    return this.http.patch<{ id: number; estado: EstadoComision }>(`/api/comisiones/${id}/estado`, { estado });
  }
  alumnos(id: number) {
    return this.http.get<AlumnoInscripcion[]>(`/api/comisiones/${id}/inscripciones`);
  }
  inscribir(id: number, alumnoId: number) {
    return this.http.post(`/api/comisiones/${id}/inscripciones`, { alumnoId });
  }
  quitar(id: number, alumnoId: number) {
    return this.http.delete(`/api/comisiones/${id}/inscripciones/${alumnoId}`);
  }
}

@Injectable({ providedIn: 'root' })
export class SesionesApi {
  private readonly http = inject(HttpClient);

  abrir(comisionId: number, duracionMin: number) {
    return this.http.post<{ id: number; reutilizada: boolean }>('/api/sesiones/abrir-qr', { comisionId, duracionMin });
  }
  obtener(id: number) {
    return this.http.get<Sesion>(`/api/sesiones/${id}`);
  }
  qr(id: number) {
    return this.http.get<QrToken>(`/api/sesiones/${id}/qr`);
  }
  cerrar(id: number) {
    return this.http.post<{ id: number; abierta: boolean }>(`/api/sesiones/${id}/cerrar`, {});
  }
  eliminar(id: number) {
    return this.http.delete<void>(`/api/sesiones/${id}`);
  }
}

@Injectable({ providedIn: 'root' })
export class UsuariosApi {
  private readonly http = inject(HttpClient);

  listar(rol?: Rol) {
    return this.http.get<UsuarioGestion[]>('/api/usuarios', { params: rol ? { rol } : {} });
  }
  crear(usuario: NuevoUsuario) {
    return this.http.post<UsuarioGestion>('/api/usuarios', usuario);
  }
  actualizar(id: number, cambios: Partial<Pick<NuevoUsuario, 'nombre' | 'email' | 'password'>> & { activo?: boolean }) {
    return this.http.patch<UsuarioGestion>(`/api/usuarios/${id}`, cambios);
  }
}

@Injectable({ providedIn: 'root' })
export class AsistenciaApi {
  private readonly http = inject(HttpClient);

  registrarQr(token: string) {
    return this.http.post<RegistroAsistencia>('/api/asistencia/registrar-qr', { token });
  }
  misMaterias() {
    return this.http.get<MateriaAsistencia[]>('/api/asistencia/alumno/me');
  }
}
