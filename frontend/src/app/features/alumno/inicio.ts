import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AsistenciaApi, mensajeDeError } from '../../core/api';
import { ClaseAlumno, MateriaAsistencia } from '../../core/models';

const ESTADO_UI: Record<ClaseAlumno['estado'], { clase: string; texto: string }> = {
  PRESENTE: { clase: 'ok', texto: '✓ Presente' },
  JUSTIFICADA: { clase: 'info', texto: '✎ Justificada' },
  AUSENTE: { clase: 'bad', texto: '✕ Ausente' },
  EN_CURSO: { clase: 'warn', texto: '… En curso' },
};

@Component({
  selector: 'app-alumno-inicio',
  imports: [DatePipe, RouterLink],
  template: `
    <div class="stack">
      <a routerLink="/alumno/escanear" class="btn block big">▦ Escanear QR de asistencia</a>

      <div class="row between">
        <p class="muted small grow">Tu asistencia por materia.</p>
        <button type="button" class="btn secondary" (click)="cargar()">↻ Actualizar</button>
      </div>

      @if (error()) {
        <div class="alert bad" role="alert">✕ {{ error() }}</div>
      }
      @if (cargando()) {
        <p class="muted">Cargando…</p>
      } @else if (materias().length === 0 && !error()) {
        <p class="card muted">No estás inscripto en ninguna comisión activa.</p>
      }

      @for (m of materias(); track m.id) {
        <article class="stack">
          <div class="hero">
            <div>
              <span class="cap">Mi clase</span>
              <h2>{{ m.materia }}</h2>
              <p>{{ m.docente }} · Ciclo {{ m.cicloLectivo }}</p>
            </div>
          </div>

          <div class="tiles">
            <div class="tile silver">
              <span class="cap">Asistencia</span>
              <span class="val">{{ m.porcentaje === null ? '—' : m.porcentaje + '%' }}</span>
            </div>
            <div class="tile mint">
              <span class="cap">Presentes</span>
              <span class="val">{{ m.asistidas }}</span>
            </div>
            <div class="tile yellow">
              <span class="cap">Ausentes</span>
              <span class="val">{{ m.totalClases - m.asistidas }}</span>
            </div>
          </div>

          <div class="progress" [class.low]="(m.porcentaje ?? 100) < 75" role="progressbar" aria-label="Asistencia" [attr.aria-valuenow]="m.porcentaje ?? 0" aria-valuemin="0" aria-valuemax="100">
            <span [style.width.%]="m.porcentaje ?? 0"></span>
          </div>

          @if (m.claseAbierta) {
            <div class="alert warn">… Hay una clase en curso: escaneá el QR para registrar tu presencia.</div>
          }

          @if (m.clases.length > 0) {
            <details class="card dark">
              <summary>
                <span>
                  <strong>Registro de asistencia</strong><br />
                  <span class="small muted">Detalle por clase · {{ m.totalClases }} clase/s</span>
                </span>
                <span aria-hidden="true">▾</span>
              </summary>
              <div class="card white lista">
                <ul class="list">
                  @for (c of m.clases; track c.sesionId) {
                    <li>
                      <span>{{ c.fecha | date: 'dd/MM/yyyy' }}</span>
                      <span [class]="'badge ' + ui[c.estado].clase">{{ ui[c.estado].texto }}</span>
                    </li>
                  }
                </ul>
              </div>
            </details>
          }
        </article>
      }
    </div>
  `,
  styles: `
    summary { cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 44px; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    details[open] summary [aria-hidden] { transform: rotate(180deg); }
    .lista { margin-top: 0.75rem; color: var(--text); }
  `,
})
export class AlumnoInicio {
  private readonly api = inject(AsistenciaApi);

  protected readonly ui = ESTADO_UI;
  protected readonly materias = signal<MateriaAsistencia[]>([]);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.cargar();
  }

  protected cargar(): void {
    this.cargando.set(true);
    this.api.misMaterias().subscribe({
      next: (lista) => {
        this.materias.set(lista);
        this.error.set(null);
        this.cargando.set(false);
      },
      error: (err: unknown) => {
        this.error.set(mensajeDeError(err));
        this.cargando.set(false);
      },
    });
  }
}
