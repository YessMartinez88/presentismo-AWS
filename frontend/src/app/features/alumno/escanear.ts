import { DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import jsQR from 'jsqr';
import { firstValueFrom } from 'rxjs';
import { AsistenciaApi, codigoDeError, mensajeDeError } from '../../core/api';
import { RegistroAsistencia } from '../../core/models';

type Fase = 'inicial' | 'camara' | 'enviando' | 'listo' | 'error';

/** Intervalo mínimo entre intentos de decodificar (decodificar en cada frame gasta batería sin ganar nada). */
const DECODE_EVERY_MS = 120;
const MAX_WIDTH = 960;

@Component({
  selector: 'app-escanear',
  imports: [DatePipe, RouterLink],
  template: `
    <div class="stack">
      <a routerLink="/alumno" class="muted">← Mis clases</a>
      <div class="hero">
        <div>
          <span class="cap">Asistencia QR</span>
          <h1>Registrar asistencia</h1>
        </div>
      </div>

      @switch (fase()) {
        @case ('enviando') {
          <p class="card" role="status">Registrando tu presencia…</p>
        }
        @case ('listo') {
          @if (resultado(); as r) {
            <div class="card white stack center">
              <div class="icono ok" aria-hidden="true">✓</div>
              <h2>¡Presente registrado!</h2>
              <p>{{ r.materia }} · {{ r.fecha | date: 'dd/MM/yyyy' }}</p>
              <a routerLink="/alumno" class="btn block">Volver a mis clases</a>
            </div>
          }
        }
        @default {
          <!-- El <video> siempre existe en el DOM (oculto) para poder asignarle la cámara sin esperar al render. -->
          <section class="card stack" [hidden]="fase() !== 'camara'">
            <div class="visor">
              <video #video playsinline muted aria-label="Vista de la cámara para escanear el código QR"></video>
              <div class="marco" aria-hidden="true"></div>
            </div>
            <p class="muted center small">Apuntá al código QR que proyecta el docente.</p>
            <button type="button" class="btn secondary block" (click)="detener(); fase.set('inicial')">Cancelar</button>
          </section>

          @if (fase() !== 'camara') {
            @if (error(); as e) {
              <div class="alert" [class.bad]="e.codigo !== 'YA_REGISTRADO'" [class.info]="e.codigo === 'YA_REGISTRADO'" role="alert">
                {{ e.codigo === 'YA_REGISTRADO' ? 'ℹ' : '✕' }} {{ e.mensaje }}
              </div>
            }
            <section class="card stack">
              <button type="button" class="btn block big" (click)="iniciarCamara()">▦ {{ error() ? 'Escanear de nuevo' : 'Activar cámara y escanear' }}</button>
            </section>

            <section class="card stack">
              <h2>¿No podés escanear?</h2>
              <p class="muted small">Pegá el enlace o el código que muestra el docente.</p>
              <div class="field">
                <label for="codigo">Enlace o código</label>
                <input id="codigo" #codigo type="text" autocomplete="off" autocapitalize="off" spellcheck="false" />
              </div>
              <button type="button" class="btn secondary block" (click)="registrar(extraerToken(codigo.value))" [disabled]="!codigo.value.trim()">
                Registrar con este código
              </button>
            </section>
          }
        }
      }
    </div>
  `,
  styles: `
    .icono { width: 72px; height: 72px; border-radius: 50%; display: grid; place-items: center; margin: 0 auto; font-size: 2.4rem; font-weight: 800; }
    .icono.ok { background: var(--ok-bg); color: var(--ok-fg); }
    .visor { position: relative; border-radius: 12px; overflow: hidden; background: #000; aspect-ratio: 1 / 1; max-width: 480px; margin: 0 auto; width: 100%; }
    .visor video { width: 100%; height: 100%; object-fit: cover; display: block; }
    .marco { position: absolute; inset: 15%; border: 3px solid var(--yellow); border-radius: 16px; box-shadow: 0 0 0 999px rgb(0 0 0 / 35%); pointer-events: none; }
  `,
})
export class Escanear {
  private readonly api = inject(AsistenciaApi);
  private readonly router = inject(Router);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  protected readonly fase = signal<Fase>('inicial');
  protected readonly resultado = signal<RegistroAsistencia | null>(null);
  protected readonly error = signal<{ mensaje: string; codigo: string | null } | null>(null);

  private stream: MediaStream | null = null;
  private raf = 0;
  private ultimoIntento = 0;
  private readonly canvas = document.createElement('canvas');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.detener());

    // Si llegaron desde el enlace del QR (/alumno/escanear?t=...) se registra solo.
    const token = inject(ActivatedRoute).snapshot.queryParamMap.get('t');
    if (token) {
      // Limpiamos el token de la URL: si recarga la página no se vuelve a enviar.
      void this.router.navigate([], { queryParams: { t: null }, queryParamsHandling: 'merge', replaceUrl: true });
      void this.registrar(token);
    }
  }

  /** El QR trae un enlace (…?t=TOKEN); aceptamos también el token pelado. */
  protected extraerToken(texto: string): string {
    const limpio = texto.trim();
    try {
      return new URL(limpio).searchParams.get('t') ?? limpio;
    } catch {
      return limpio;
    }
  }

  protected async iniciarCamara(): Promise<void> {
    this.error.set(null);
    // getUserMedia solo existe en contextos seguros: https o localhost.
    if (!navigator.mediaDevices?.getUserMedia) {
      this.fallar('La cámara solo se puede usar con una conexión segura (https) o en localhost. Usá la opción de pegar el enlace.');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch {
      this.fallar('No se pudo acceder a la cámara. Revisá los permisos del navegador o usá la opción de pegar el enlace.');
      return;
    }
    const video = this.video()!.nativeElement;
    video.srcObject = this.stream;
    await video.play();
    this.fase.set('camara');
    this.raf = requestAnimationFrame((t) => this.leerFrame(t));
  }

  protected detener(): void {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private leerFrame(ahora: number): void {
    if (this.fase() !== 'camara') return;
    const video = this.video()!.nativeElement;

    if (ahora - this.ultimoIntento >= DECODE_EVERY_MS && video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      this.ultimoIntento = ahora;
      const escala = Math.min(1, MAX_WIDTH / video.videoWidth);
      const w = Math.round(video.videoWidth * escala);
      const h = Math.round(video.videoHeight * escala);
      this.canvas.width = w;
      this.canvas.height = h;
      const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(video, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      if (code?.data) {
        this.detener();
        void this.registrar(this.extraerToken(code.data));
        return;
      }
    }
    this.raf = requestAnimationFrame((t) => this.leerFrame(t));
  }

  protected async registrar(token: string): Promise<void> {
    this.detener();
    this.error.set(null);
    this.fase.set('enviando');
    try {
      this.resultado.set(await firstValueFrom(this.api.registrarQr(token)));
      this.fase.set('listo');
    } catch (err) {
      this.fallar(mensajeDeError(err), codigoDeError(err));
    }
  }

  private fallar(mensaje: string, codigo: string | null = null): void {
    this.error.set({ mensaje, codigo });
    this.fase.set('error');
  }
}
