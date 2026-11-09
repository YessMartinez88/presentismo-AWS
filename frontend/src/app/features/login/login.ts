import { Component, inject, isDevMode, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { mensajeDeError } from '../../core/api';
import { AuthService } from '../../core/auth.service';

// Solo desarrollo: atajos para rellenar el formulario (coinciden con backend/src/db/seed.ts).
const DEMO = [
  { label: 'Admin', email: 'admin@instituto.test' },
  { label: 'Docente', email: 'docente@instituto.test' },
  { label: 'Alumno 1', email: 'alumno1@instituto.test' },
  { label: 'Alumno 2', email: 'alumno2@instituto.test' },
];

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  template: `
    <section class="login stack">
      <div class="hero">
        <div>
          <span class="cap">Asistencia</span>
          <h1>Iniciar sesión</h1>
          <p>Ingresá con tu cuenta del instituto.</p>
        </div>
      </div>

      <form [formGroup]="form" (ngSubmit)="entrar()" class="card white stack" novalidate>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" type="email" formControlName="email" autocomplete="username" />
        </div>
        <div class="field">
          <label for="password">Contraseña</label>
          <input id="password" type="password" formControlName="password" autocomplete="current-password" />
        </div>

        @if (error()) {
          <div class="alert bad" role="alert">✕ {{ error() }}</div>
        }

        <button type="submit" class="btn block big" [disabled]="form.invalid || cargando()">
          {{ cargando() ? 'Ingresando…' : 'Ingresar' }}
        </button>
      </form>

      @if (dev) {
        <details class="card">
          <summary class="small">Usuarios de prueba (solo desarrollo)</summary>
          <div class="row demo">
            @for (d of demo; track d.email) {
              <button type="button" class="btn secondary" (click)="rellenar(d.email)">{{ d.label }}</button>
            }
          </div>
          <p class="muted small">Contraseña: Demo1234!</p>
        </details>
      }
    </section>
  `,
  styles: `
    .login { max-width: 420px; margin: 2rem auto 0; }
    .demo { margin: 0.75rem 0; }
    summary { cursor: pointer; padding: 0.5rem 0; font-weight: 600; }
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly dev = isDevMode();
  protected readonly demo = DEMO;
  protected readonly cargando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected rellenar(email: string): void {
    this.form.setValue({ email, password: 'Demo1234!' });
  }

  protected entrar(): void {
    if (this.form.invalid) return;
    this.cargando.set(true);
    this.error.set(null);
    const { email, password } = this.form.getRawValue();

    this.auth.login(email, password).subscribe({
      next: (res) => {
        // returnUrl: p. ej. el alumno abrió el link de un QR sin estar logueado. Solo aceptamos rutas
        // internas ("/algo", no "//otro-sitio.com") para evitar un "open redirect".
        const destino = this.route.snapshot.queryParamMap.get('returnUrl');
        const seguro = destino && destino.startsWith('/') && !destino.startsWith('//');
        void this.router.navigateByUrl(seguro ? destino : this.auth.homeFor(res.usuario.rol));
      },
      error: (err: unknown) => {
        this.error.set(mensajeDeError(err));
        this.cargando.set(false);
      },
    });
  }
}
