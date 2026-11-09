import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toDataURL } from 'qrcode';
import { firstValueFrom } from 'rxjs';
import { SesionesApi, codigoDeError, mensajeDeError } from '../../core/api';
import { AuthService } from '../../core/auth.service';
import { Sesion } from '../../core/models';

const POLL_MS = 3000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Detalle de una sesión de asistencia. El docente dueño ve además el QR (que se renueva solo);
 * administración ve la lista de presentes y puede cerrarla, pero no genera códigos.
 */
@Component({
  selector: 'app-sesion',
  imports: [DatePipe, RouterLink],
  template: `
    <div class="stack">
      <a [routerLink]="esAdmin ? '/admin' : '/docente'" class="muted">← {{ esAdmin ? 'Aulas' : 'Mis aulas' }}</a>

      @if (sesion(); as s) {
        <div class="hero">
          <div>
            <span class="cap">Sesión de asistencia · {{ s.fecha | date: 'dd/MM/yyyy' }}</span>
            <h1>{{ s.materia }}</h1>
          </div>
          <span class="count" [attr.aria-label]="s.totales.presentes + ' presentes'">{{ s.totales.presentes }}</span>
        </div>
        <div>
          @if (s.abierta) {
            <span class="badge ok">● Sesión abierta · quedan {{ restante() }}</span>
          } @else {
            <span class="badge info">■ Sesión cerrada</span>
          }
        </div>

        <div class="layout">
          <section class="card white qr stack">
            @if (s.abierta) {
              @if (esAdmin) {
                <p class="muted center">El código QR solo lo muestra el docente a cargo del aula.</p>
              } @else if (qrImg(); as img) {
                <img [src]="img" width="320" height="320" alt="Código QR de la sesión de asistencia" />
                <p class="muted small center">
                  El código se renueva cada pocos segundos. Los alumnos lo escanean con la cámara de la app
                  o con la cámara del celular.
                </p>
                <div class="row center">
                  <button type="button" class="btn secondary" (click)="copiar()">{{ copiado() ? '✓ Copiado' : 'Copiar enlace' }}</button>
                </div>
              } @else {
                <p class="muted center">Generando código…</p>
              }
              <button type="button" class="btn danger block" (click)="cerrar()">Cerrar sesión</button>
            } @else {
              <p class="center">La toma de asistencia finalizó. Los alumnos que no escanearon quedaron como ausentes.</p>
            }
          </section>

          <section class="card stack">
            <h2>Presentes: {{ s.totales.presentes }} de {{ s.totales.inscriptos }}</h2>
            <div class="progress" role="progressbar" [attr.aria-valuenow]="porcentaje()" aria-valuemin="0" aria-valuemax="100" aria-label="Alumnos presentes">
              <span [style.width.%]="porcentaje()"></span>
            </div>
            <ul class="list">
              @for (a of s.alumnos; track a.id) {
                <li>
                  <span>{{ a.nombre }}</span>
                  @if (a.estado === 'PRESENTE') {
                    <span class="badge ok">✓ Presente {{ a.registradoEn | date: 'HH:mm' }}</span>
                  } @else {
                    <span class="badge warn">… {{ s.abierta ? 'Pendiente' : 'Ausente' }}</span>
                  }
                </li>
              }
            </ul>
          </section>
        </div>
      } @else if (!error()) {
        <p class="muted">Cargando…</p>
      }

      @if (error()) {
        <div class="alert bad" role="alert">✕ {{ error() }}</div>
      }
    </div>
  `,
  styles: `
    .layout { display: grid; gap: 1rem; grid-template-columns: 1fr; }
    @media (min-width: 800px) { .layout { grid-template-columns: 380px 1fr; align-items: start; } }
    .qr img { width: 100%; max-width: 320px; height: auto; margin: 0 auto; display: block; background: #fff; border-radius: 12px; }
    .row.center { justify-content: center; }
  `,
})
export class SesionPage {
  private readonly api = inject(SesionesApi);
  private readonly id = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
  protected readonly esAdmin = inject(AuthService).usuario()?.rol === 'ADMIN';

  protected readonly sesion = signal<Sesion | null>(null);
  protected readonly qrImg = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly copiado = signal(false);
  private readonly ahora = signal(Date.now());
  private qrUrl = '';
  private destruido = false;

  protected readonly porcentaje = computed(() => {
    const t = this.sesion()?.totales;
    return t && t.inscriptos > 0 ? Math.round((t.presentes / t.inscriptos) * 100) : 0;
  });

  protected readonly restante = computed(() => {
    const s = this.sesion();
    if (!s) return '';
    const seg = Math.max(0, Math.floor((new Date(s.expiraEn).getTime() - this.ahora()) / 1000));
    return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
  });

  constructor() {
    const reloj = setInterval(() => this.ahora.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => {
      this.destruido = true;
      clearInterval(reloj);
    });
    void this.consultarSesion();
    if (!this.esAdmin) void this.renovarQr();
  }

  /** Lista de presentes "en vivo": se consulta cada 3 s (más simple que WebSockets para un MVP). */
  private async consultarSesion(): Promise<void> {
    while (!this.destruido) {
      try {
        const actual = await firstValueFrom(this.api.obtener(this.id));
        this.sesion.set(actual);
        this.error.set(null);
        if (!actual.abierta) return; // cerrada o vencida: el estado ya es definitivo
      } catch (err) {
        this.error.set(mensajeDeError(err));
        const codigo = codigoDeError(err);
        if (codigo === 'SIN_PERMISO' || codigo === 'NO_ENCONTRADA') return;
      }
      await sleep(POLL_MS);
    }
  }

  /** Pide un token nuevo antes de que venza el anterior y redibuja el QR. */
  private async renovarQr(): Promise<void> {
    while (!this.destruido) {
      let espera = POLL_MS;
      try {
        const qr = await firstValueFrom(this.api.qr(this.id));
        // El QR contiene un enlace: con la cámara nativa del celular abre la app y registra directo.
        this.qrUrl = `${location.origin}/alumno/escanear?t=${encodeURIComponent(qr.token)}`;
        this.qrImg.set(await toDataURL(this.qrUrl, { width: 640, margin: 2, errorCorrectionLevel: 'M' }));
        espera = qr.refrescarEnSeg * 1000;
      } catch (err) {
        const codigo = codigoDeError(err);
        if (codigo === 'SESION_CERRADA') {
          // Se cerró (o venció): refrescamos el estado una última vez y dejamos de pedir QR.
          this.qrImg.set(null);
          try {
            this.sesion.set(await firstValueFrom(this.api.obtener(this.id)));
          } catch {
            /* se mostrará el error del polling */
          }
          return;
        }
        if (codigo === 'SIN_PERMISO' || codigo === 'NO_ENCONTRADA') return;
      }
      await sleep(espera);
    }
  }

  protected async copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.qrUrl);
      this.copiado.set(true);
      setTimeout(() => this.copiado.set(false), 2000);
    } catch {
      this.error.set('No se pudo copiar. Seleccioná y copiá el enlace manualmente.');
    }
  }

  protected async cerrar(): Promise<void> {
    if (!confirm('¿Cerrar la sesión? Los alumnos que no escanearon quedarán como ausentes.')) return;
    try {
      await firstValueFrom(this.api.cerrar(this.id));
      this.qrImg.set(null);
      this.sesion.set(await firstValueFrom(this.api.obtener(this.id)));
    } catch (err) {
      this.error.set(mensajeDeError(err));
    }
  }
}
