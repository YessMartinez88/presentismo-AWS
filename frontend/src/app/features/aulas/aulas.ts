import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ComisionesApi, SesionesApi, UsuariosApi, mensajeDeError } from '../../core/api';
import { AuthService } from '../../core/auth.service';
import { AlumnoInscripcion, Comision, EstadoComision, SesionResumen, UsuarioGestion } from '../../core/models';

const ESTADO_UI: Record<EstadoComision, { clase: string; texto: string }> = {
  BORRADOR: { clase: 'warn', texto: '✎ Borrador' },
  ACTIVA: { clase: 'ok', texto: '✓ Activa' },
  CERRADA: { clase: 'info', texto: '■ Cerrada' },
};

type Panel = { id: number; tipo: 'alumnos' | 'sesiones' | 'editar' };

/**
 * Una sola pantalla para dos roles: el admin ve y gestiona todas las aulas; el docente, solo las suyas.
 * Lo que cambia entre ambos (elegir docente, abrir el QR) se decide con `esAdmin`, en vez de duplicar el componente.
 * En la interfaz se dice "aula"; en la API y la base sigue siendo "comisión".
 */
@Component({
  selector: 'app-aulas',
  imports: [ReactiveFormsModule, DatePipe, RouterLink],
  template: `
    <div class="stack">
      <div class="hero">
        <div>
          <span class="cap">{{ esAdmin ? 'Gestión académica' : 'Panel docente' }}</span>
          <h1>{{ esAdmin ? 'Aulas registradas' : 'Mis aulas' }}</h1>
          @if (!esAdmin) {
            <p>Creá tus aulas, inscribí alumnos y abrí una sesión con código QR para proyectar en el aula.</p>
          }
        </div>
        <span class="count" aria-label="Cantidad de aulas">{{ aulas().length }}</span>
      </div>

      @if (error()) {
        <div class="alert bad" role="alert">✕ {{ error() }}</div>
      }
      @if (aviso()) {
        <div class="alert ok" role="status">✓ {{ aviso() }}</div>
      }

      <div class="row between">
        <button type="button" class="btn" (click)="alternarFormulario()" [attr.aria-expanded]="mostrarForm()">
          {{ mostrarForm() ? 'Cancelar' : '+ Nueva aula' }}
        </button>
        <button type="button" class="btn secondary" (click)="cargar()">↻ Actualizar</button>
      </div>

      @if (mostrarForm()) {
        <form [formGroup]="formNueva" (ngSubmit)="crear()" class="card white stack" novalidate>
          <span class="cap muted">Nueva aula</span>
          <div class="grid2">
            <div class="field">
              <label for="n-materia">Materia</label>
              <input id="n-materia" formControlName="materia" maxlength="100" />
            </div>
            <div class="field">
              <label for="n-ciclo">Ciclo lectivo</label>
              <input id="n-ciclo" formControlName="cicloLectivo" maxlength="10" />
            </div>
          </div>
          @if (esAdmin) {
            <div class="field">
              <label for="n-docente">Docente a cargo</label>
              <select id="n-docente" formControlName="docenteId">
                <option [ngValue]="0">Elegí un docente…</option>
                @for (d of docentes(); track d.id) {
                  <option [ngValue]="d.id">{{ d.nombre }}</option>
                }
              </select>
            </div>
            <label class="check"><input type="checkbox" formControlName="activar" /> Activar al crear</label>
          } @else {
            <p class="muted small">El aula se crea a tu nombre y queda activa para tomar asistencia.</p>
          }
          <button type="submit" class="btn" [disabled]="formNueva.invalid || guardando()">Crear aula</button>
        </form>
      }

      @if (!esAdmin) {
        <div class="card field">
          <label for="duracion">Duración de cada sesión QR</label>
          <select id="duracion" #duracion (change)="minutos.set(+duracion.value)">
            @for (m of opciones; track m) {
              <option [value]="m" [selected]="m === minutos()">{{ m }} minutos</option>
            }
          </select>
          <p class="muted small">Pasado ese tiempo ya no se aceptan asistencias. Podés cerrarla antes.</p>
        </div>
      }

      @if (cargando()) {
        <p class="muted">Cargando…</p>
      } @else if (aulas().length === 0) {
        <p class="card muted">Todavía no hay aulas. Creá la primera con “Nueva aula”.</p>
      }

      @for (c of aulas(); track c.id) {
        <article class="card stack">
          <div class="row between">
            <div>
              <span class="cap muted">Aula</span>
              <h2>{{ c.materia }}</h2>
              <p class="muted small">
                @if (esAdmin) {
                  Docente: {{ c.docente }} ·
                }
                Ciclo {{ c.cicloLectivo }} · {{ c.inscriptos }} alumno/s · {{ c.sesiones }} sesión/es
              </p>
            </div>
            <span [class]="'badge ' + ui[c.estado].clase">{{ ui[c.estado].texto }}</span>
          </div>

          <div class="row">
            @if (!esAdmin && c.estado === 'ACTIVA') {
              <button type="button" class="btn" [disabled]="abriendo() === c.id" (click)="abrirSesion(c)">
                {{ abriendo() === c.id ? 'Abriendo…' : '▦ Abrir sesión QR' }}
              </button>
            }
            @if (c.estado === 'BORRADOR') {
              <button type="button" class="btn" (click)="cambiarEstado(c, 'ACTIVA')">Activar</button>
            }
            <button type="button" class="btn secondary" (click)="alternarPanel(c, 'alumnos')" [attr.aria-expanded]="panelAbierto(c, 'alumnos')">Alumnos</button>
            <button type="button" class="btn secondary" (click)="alternarPanel(c, 'sesiones')" [attr.aria-expanded]="panelAbierto(c, 'sesiones')">Sesiones</button>
            @if (c.estado !== 'CERRADA') {
              <button type="button" class="btn secondary" (click)="alternarPanel(c, 'editar')" [attr.aria-expanded]="panelAbierto(c, 'editar')">Editar</button>
            }
            @if (c.estado === 'ACTIVA') {
              <button type="button" class="btn secondary" (click)="cambiarEstado(c, 'CERRADA')">Cerrar aula</button>
            }
            <button type="button" class="btn danger" (click)="eliminar(c)">Eliminar</button>
          </div>

          @if (panelAbierto(c, 'alumnos')) {
            <div class="card white">
              <span class="cap muted">Alumnos</span>
              @if (cargandoPanel()) {
                <p class="muted">Cargando…</p>
              } @else if (alumnos().length === 0) {
                <p class="muted small">No hay alumnos activos para inscribir. {{ esAdmin ? 'Creálos en “Usuarios”.' : 'Pedile a administración que los cree.' }}</p>
              }
              <ul class="list">
                @for (a of alumnos(); track a.id) {
                  <li>
                    <span>
                      <strong>{{ a.nombre }}</strong><br /><span class="muted small">{{ a.email }}</span>
                    </span>
                    @if (a.inscripto) {
                      <span class="row">
                        <span class="badge ok">✓ Inscripto</span>
                        <button type="button" class="btn secondary" (click)="quitar(c, a)">Quitar</button>
                      </span>
                    } @else {
                      <button type="button" class="btn" (click)="inscribir(c, a)">Inscribir</button>
                    }
                  </li>
                }
              </ul>
            </div>
          }

          @if (panelAbierto(c, 'sesiones')) {
            <div class="card white">
              <span class="cap muted">Sesiones de asistencia</span>
              @if (cargandoPanel()) {
                <p class="muted">Cargando…</p>
              } @else if (sesiones().length === 0) {
                <p class="muted small">Todavía no se abrió ninguna sesión.{{ esAdmin ? '' : ' Usá “Abrir sesión QR”.' }}</p>
              }
              <ul class="list">
                @for (s of sesiones(); track s.id) {
                  <li>
                    <span>
                      <strong>{{ s.fecha | date: 'dd/MM/yyyy' }}</strong> · {{ s.creadoEn | date: 'HH:mm' }}<br />
                      <span class="muted small">{{ s.presentes }} presentes de {{ s.total }}</span>
                    </span>
                    <span class="row">
                      <span [class]="s.abierta ? 'badge ok' : 'badge info'">{{ s.abierta ? '● Abierta' : '■ Cerrada' }}</span>
                      <a class="btn secondary" [routerLink]="['/sesion', s.id]">Ver</a>
                      <button type="button" class="btn danger" (click)="eliminarSesion(c, s)">Eliminar</button>
                    </span>
                  </li>
                }
              </ul>
            </div>
          }

          @if (panelAbierto(c, 'editar')) {
            <form [formGroup]="formEditar" (ngSubmit)="guardarEdicion(c)" class="card white stack" novalidate>
              <span class="cap muted">Editar aula</span>
              <div class="grid2">
                <div class="field">
                  <label for="e-materia">Materia</label>
                  <input id="e-materia" formControlName="materia" maxlength="100" />
                </div>
                <div class="field">
                  <label for="e-ciclo">Ciclo lectivo</label>
                  <input id="e-ciclo" formControlName="cicloLectivo" maxlength="10" />
                </div>
              </div>
              @if (esAdmin) {
                <div class="field">
                  <label for="e-docente">Docente a cargo</label>
                  <select id="e-docente" formControlName="docenteId">
                    @for (d of docentes(); track d.id) {
                      <option [ngValue]="d.id">{{ d.nombre }}</option>
                    }
                  </select>
                </div>
              }
              <div class="row">
                <button type="submit" class="btn" [disabled]="formEditar.invalid || guardando()">Guardar cambios</button>
                <button type="button" class="btn secondary" (click)="panel.set(null)">Cancelar</button>
              </div>
            </form>
          }
        </article>
      }
    </div>
  `,
})
export class Aulas {
  private readonly api = inject(ComisionesApi);
  private readonly sesionesApi = inject(SesionesApi);
  private readonly usuariosApi = inject(UsuariosApi);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  protected readonly esAdmin = inject(AuthService).usuario()?.rol === 'ADMIN';
  protected readonly ui = ESTADO_UI;
  protected readonly opciones = [5, 10, 15, 30, 60];
  protected readonly minutos = signal(10);

  protected readonly aulas = signal<Comision[]>([]);
  protected readonly docentes = signal<UsuarioGestion[]>([]);
  protected readonly cargando = signal(true);
  protected readonly guardando = signal(false);
  protected readonly abriendo = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly mostrarForm = signal(false);
  protected readonly panel = signal<Panel | null>(null);
  protected readonly cargandoPanel = signal(false);
  protected readonly alumnos = signal<AlumnoInscripcion[]>([]);
  protected readonly sesiones = signal<SesionResumen[]>([]);

  protected readonly formNueva = this.fb.nonNullable.group({
    materia: ['', Validators.required],
    cicloLectivo: [String(new Date().getFullYear()), Validators.required],
    docenteId: [0],
    activar: [false],
  });
  protected readonly formEditar = this.fb.nonNullable.group({
    materia: ['', Validators.required],
    cicloLectivo: ['', Validators.required],
    docenteId: [0],
  });

  constructor() {
    this.cargar();
    if (this.esAdmin) {
      this.usuariosApi.listar('DOCENTE').subscribe({
        next: (lista) => this.docentes.set(lista.filter((d) => d.activo)),
        error: (err: unknown) => this.error.set(mensajeDeError(err)),
      });
    }
  }

  protected cargar(): void {
    this.cargando.set(true);
    this.api.listar().subscribe({
      next: (lista) => {
        this.aulas.set(lista);
        this.cargando.set(false);
      },
      error: (err: unknown) => this.fallar(err, () => this.cargando.set(false)),
    });
  }

  protected alternarFormulario(): void {
    this.mostrarForm.update((v) => !v);
  }

  protected crear(): void {
    const { materia, cicloLectivo, docenteId, activar } = this.formNueva.getRawValue();
    if (this.esAdmin && !docenteId) {
      this.error.set('Elegí el docente a cargo del aula.');
      return;
    }
    this.guardando.set(true);
    this.limpiarMensajes();
    this.api
      .crear(this.esAdmin ? { materia, cicloLectivo, docenteId, activar } : { materia, cicloLectivo })
      .subscribe({
        next: () => {
          this.guardando.set(false);
          this.mostrarForm.set(false);
          this.formNueva.patchValue({ materia: '', docenteId: 0, activar: false });
          this.aviso.set(`Aula “${materia}” creada.`);
          this.cargar();
        },
        error: (err: unknown) => this.fallar(err, () => this.guardando.set(false)),
      });
  }

  protected cambiarEstado(c: Comision, estado: EstadoComision): void {
    if (estado === 'CERRADA' && !confirm(`¿Cerrar “${c.materia}”? Ya no se podrá tomar asistencia ni editarla.`)) return;
    this.limpiarMensajes();
    this.api.cambiarEstado(c.id, estado).subscribe({
      next: () => this.cargar(),
      error: (err: unknown) => this.fallar(err),
    });
  }

  protected eliminar(c: Comision): void {
    if (!confirm(`¿Eliminar el aula “${c.materia}”? Se borran también sus inscripciones. No se puede deshacer.`)) return;
    this.limpiarMensajes();
    this.api.eliminar(c.id).subscribe({
      next: () => {
        this.aviso.set(`Aula “${c.materia}” eliminada.`);
        this.cargar();
      },
      error: (err: unknown) => this.fallar(err),
    });
  }

  protected abrirSesion(c: Comision): void {
    this.abriendo.set(c.id);
    this.limpiarMensajes();
    this.sesionesApi.abrir(c.id, this.minutos()).subscribe({
      next: (s) => void this.router.navigate(['/sesion', s.id]),
      error: (err: unknown) => this.fallar(err, () => this.abriendo.set(null)),
    });
  }

  protected panelAbierto(c: Comision, tipo: Panel['tipo']): boolean {
    const p = this.panel();
    return p?.id === c.id && p.tipo === tipo;
  }

  protected alternarPanel(c: Comision, tipo: Panel['tipo']): void {
    if (this.panelAbierto(c, tipo)) {
      this.panel.set(null);
      return;
    }
    this.limpiarMensajes();
    this.panel.set({ id: c.id, tipo });
    if (tipo === 'alumnos') this.cargarAlumnos(c.id);
    if (tipo === 'sesiones') this.cargarSesiones(c.id);
    if (tipo === 'editar') {
      this.formEditar.setValue({ materia: c.materia, cicloLectivo: c.cicloLectivo, docenteId: c.docenteId });
    }
  }

  protected guardarEdicion(c: Comision): void {
    const { materia, cicloLectivo, docenteId } = this.formEditar.getRawValue();
    this.guardando.set(true);
    this.limpiarMensajes();
    this.api.editar(c.id, this.esAdmin ? { materia, cicloLectivo, docenteId } : { materia, cicloLectivo }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.panel.set(null);
        this.aviso.set('Cambios guardados.');
        this.cargar();
      },
      error: (err: unknown) => this.fallar(err, () => this.guardando.set(false)),
    });
  }

  protected inscribir(c: Comision, a: AlumnoInscripcion): void {
    this.api.inscribir(c.id, a.id).subscribe({
      next: () => this.refrescarAlumnos(c.id),
      error: (err: unknown) => this.fallar(err),
    });
  }

  protected quitar(c: Comision, a: AlumnoInscripcion): void {
    if (!confirm(`¿Quitar a ${a.nombre} de “${c.materia}”?`)) return;
    this.api.quitar(c.id, a.id).subscribe({
      next: () => this.refrescarAlumnos(c.id),
      error: (err: unknown) => this.fallar(err),
    });
  }

  protected eliminarSesion(c: Comision, s: SesionResumen): void {
    if (!confirm('¿Eliminar esta sesión y todas sus asistencias? No se puede deshacer.')) return;
    this.sesionesApi.eliminar(s.id).subscribe({
      next: () => {
        this.cargarSesiones(c.id);
        this.cargar();
      },
      error: (err: unknown) => this.fallar(err),
    });
  }

  private refrescarAlumnos(aulaId: number): void {
    this.cargarAlumnos(aulaId);
    this.cargar();
  }

  private cargarAlumnos(aulaId: number): void {
    this.cargandoPanel.set(true);
    this.api.alumnos(aulaId).subscribe({
      next: (lista) => {
        this.alumnos.set(lista);
        this.cargandoPanel.set(false);
      },
      error: (err: unknown) => this.fallar(err, () => this.cargandoPanel.set(false)),
    });
  }

  private cargarSesiones(aulaId: number): void {
    this.cargandoPanel.set(true);
    this.api.sesiones(aulaId).subscribe({
      next: (lista) => {
        this.sesiones.set(lista);
        this.cargandoPanel.set(false);
      },
      error: (err: unknown) => this.fallar(err, () => this.cargandoPanel.set(false)),
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
