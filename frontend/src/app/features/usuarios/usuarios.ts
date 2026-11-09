import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { UsuariosApi, mensajeDeError } from '../../core/api';
import { Rol, UsuarioGestion } from '../../core/models';

const ROL_UI: Record<Rol, string> = { ADMIN: 'Administración', DOCENTE: 'Docente', ALUMNO: 'Alumno' };

@Component({
  selector: 'app-usuarios',
  imports: [ReactiveFormsModule],
  template: `
    <div class="stack">
      <div class="hero">
        <div>
          <span class="cap">Gestión institucional</span>
          <h1>Usuarios</h1>
          <p>Creá cuentas de docentes y alumnos. Un usuario desactivado no puede entrar, pero conserva su historial.</p>
        </div>
        <span class="count" aria-label="Cantidad de usuarios">{{ visibles().length }}</span>
      </div>

      @if (error()) {
        <div class="alert bad" role="alert">✕ {{ error() }}</div>
      }
      @if (aviso()) {
        <div class="alert ok" role="status">✓ {{ aviso() }}</div>
      }

      <div class="row between">
        <button type="button" class="btn" (click)="alternarFormulario()" [attr.aria-expanded]="mostrarForm()">
          {{ mostrarForm() ? 'Cancelar' : '+ Nuevo usuario' }}
        </button>
        <div class="filtro">
          <label for="filtro">Mostrar</label>
          <select id="filtro" #filtro (change)="filtroRol.set($any(filtro.value))">
            <option value="">Todos</option>
            <option value="ADMIN">Administración</option>
            <option value="DOCENTE">Docentes</option>
            <option value="ALUMNO">Alumnos</option>
          </select>
        </div>
      </div>

      @if (mostrarForm()) {
        <form [formGroup]="formNuevo" (ngSubmit)="crear()" class="card white stack" novalidate>
          <span class="cap muted">Nuevo usuario</span>
          <div class="grid2">
            <div class="field">
              <label for="u-nombre">Nombre y apellido</label>
              <input id="u-nombre" formControlName="nombre" maxlength="100" autocomplete="off" />
            </div>
            <div class="field">
              <label for="u-rol">Rol</label>
              <select id="u-rol" formControlName="rol">
                <option value="ALUMNO">Alumno</option>
                <option value="DOCENTE">Docente</option>
                <option value="ADMIN">Administración</option>
              </select>
            </div>
          </div>
          <div class="grid2">
            <div class="field">
              <label for="u-email">Email</label>
              <input id="u-email" type="email" formControlName="email" maxlength="100" autocomplete="off" />
            </div>
            <div class="field">
              <label for="u-pass">Contraseña inicial</label>
              <input id="u-pass" type="password" formControlName="password" autocomplete="new-password" />
              <p class="muted small">Mínimo 8 caracteres.</p>
            </div>
          </div>
          <button type="submit" class="btn" [disabled]="formNuevo.invalid || guardando()">Crear usuario</button>
        </form>
      }

      @if (cargando()) {
        <p class="muted">Cargando…</p>
      } @else if (visibles().length === 0) {
        <p class="card muted">No hay usuarios para mostrar.</p>
      }

      @for (u of visibles(); track u.id) {
        <article class="card stack">
          <div class="row between">
            <div>
              <h2>{{ u.nombre }}</h2>
              <p class="muted small">{{ u.email }}</p>
            </div>
            <span class="row">
              <span class="badge info">{{ rolUi[u.rol] }}</span>
              <span [class]="u.activo ? 'badge ok' : 'badge bad'">{{ u.activo ? '✓ Activo' : '✕ Inactivo' }}</span>
            </span>
          </div>

          <div class="row">
            <button type="button" class="btn secondary" (click)="editar(u)" [attr.aria-expanded]="editando() === u.id">
              {{ editando() === u.id ? 'Cancelar edición' : 'Editar' }}
            </button>
            <button type="button" class="btn" [class.danger]="u.activo" [class.secondary]="!u.activo" (click)="alternarActivo(u)">
              {{ u.activo ? 'Desactivar' : 'Activar' }}
            </button>
          </div>

          @if (editando() === u.id) {
            <form [formGroup]="formEditar" (ngSubmit)="guardarEdicion(u)" class="card white stack" novalidate>
              <span class="cap muted">Editar usuario</span>
              <div class="grid2">
                <div class="field">
                  <label for="x-nombre">Nombre y apellido</label>
                  <input id="x-nombre" formControlName="nombre" maxlength="100" />
                </div>
                <div class="field">
                  <label for="x-email">Email</label>
                  <input id="x-email" type="email" formControlName="email" maxlength="100" />
                </div>
              </div>
              <div class="field">
                <label for="x-pass">Nueva contraseña (opcional)</label>
                <input id="x-pass" type="password" formControlName="password" autocomplete="new-password" placeholder="Dejala vacía para no cambiarla" />
              </div>
              <button type="submit" class="btn" [disabled]="formEditar.invalid || guardando()">Guardar cambios</button>
            </form>
          }
        </article>
      }
    </div>
  `,
  styles: `
    .filtro { min-width: 12rem; }
    .filtro label { margin-bottom: 0.15rem; }
  `,
})
export class Usuarios {
  private readonly api = inject(UsuariosApi);
  private readonly fb = inject(FormBuilder);

  protected readonly rolUi = ROL_UI;
  protected readonly usuarios = signal<UsuarioGestion[]>([]);
  protected readonly filtroRol = signal<Rol | ''>('');
  protected readonly visibles = computed(() => {
    const rol = this.filtroRol();
    return rol ? this.usuarios().filter((u) => u.rol === rol) : this.usuarios();
  });

  protected readonly cargando = signal(true);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly mostrarForm = signal(false);
  protected readonly editando = signal<number | null>(null);

  protected readonly formNuevo = this.fb.nonNullable.group({
    nombre: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    rol: ['ALUMNO' as Rol],
  });
  protected readonly formEditar = this.fb.nonNullable.group({
    nombre: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.minLength(8)],
  });

  constructor() {
    this.cargar();
  }

  protected cargar(): void {
    this.api.listar().subscribe({
      next: (lista) => {
        this.usuarios.set(lista);
        this.cargando.set(false);
      },
      error: (err: unknown) => this.fallar(err, () => this.cargando.set(false)),
    });
  }

  protected alternarFormulario(): void {
    this.mostrarForm.update((v) => !v);
  }

  protected crear(): void {
    this.guardando.set(true);
    this.limpiarMensajes();
    const nuevo = this.formNuevo.getRawValue();
    this.api.crear(nuevo).subscribe({
      next: (u) => {
        this.guardando.set(false);
        this.mostrarForm.set(false);
        this.formNuevo.reset({ nombre: '', email: '', password: '', rol: 'ALUMNO' });
        this.aviso.set(`Usuario “${u.nombre}” creado.`);
        this.cargar();
      },
      error: (err: unknown) => this.fallar(err, () => this.guardando.set(false)),
    });
  }

  protected editar(u: UsuarioGestion): void {
    if (this.editando() === u.id) {
      this.editando.set(null);
      return;
    }
    this.limpiarMensajes();
    this.formEditar.setValue({ nombre: u.nombre, email: u.email, password: '' });
    this.editando.set(u.id);
  }

  protected guardarEdicion(u: UsuarioGestion): void {
    this.guardando.set(true);
    this.limpiarMensajes();
    const { nombre, email, password } = this.formEditar.getRawValue();
    this.api.actualizar(u.id, { nombre, email, ...(password ? { password } : {}) }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.editando.set(null);
        this.aviso.set('Cambios guardados.');
        this.cargar();
      },
      error: (err: unknown) => this.fallar(err, () => this.guardando.set(false)),
    });
  }

  protected alternarActivo(u: UsuarioGestion): void {
    if (u.activo && !confirm(`¿Desactivar a ${u.nombre}? No podrá iniciar sesión.`)) return;
    this.limpiarMensajes();
    this.api.actualizar(u.id, { activo: !u.activo }).subscribe({
      next: () => {
        this.aviso.set(`${u.nombre} ${u.activo ? 'desactivado' : 'activado'}.`);
        this.cargar();
      },
      error: (err: unknown) => this.fallar(err),
    });
  }

  private limpiarMensajes(): void {
    this.error.set(null);
    this.aviso.set(null);
  }

  private fallar(err: unknown, despues?: () => void): void {
    this.aviso.set(null);
    this.error.set(mensajeDeError(err));
    despues?.();
  }
}
