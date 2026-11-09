// Módulos de gestión: usuarios, aulas (comisiones) y sesiones. Base aparte, igual que flow.test.ts.
process.env.DB_NAME = 'presentismo_test';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

const { createApp } = await import('../src/app');
const { closePools } = await import('../src/db/pool');
const { setupDatabase } = await import('../src/db/setup');
const { DEMO_PASSWORD, seedDemo } = await import('../src/db/seed');

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function login(email: string, password = DEMO_PASSWORD): Promise<string> {
  const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(r.status, 200, `login ${email}`);
  return r.body.token;
}

// Hooks a nivel de archivo: el servidor y la base se preparan una vez y los dos bloques lo comparten
// (el segundo reutiliza usuarios que creó el primero).
before(async () => {
  await setupDatabase();
  await seedDemo();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  await closePools();
});

describe('gestión de usuarios', () => {
  let admin: string;

  before(async () => {
    admin = await login('admin@instituto.test');
  });

  it('el admin crea usuarios y el nuevo usuario puede iniciar sesión', async () => {
    const r = await api('/api/usuarios', {
      method: 'POST',
      token: admin,
      body: { nombre: 'Nora Gil', email: 'Nora@Instituto.test', password: 'clave-segura-1', rol: 'DOCENTE' },
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.email, 'nora@instituto.test'); // se normaliza a minúsculas
    await login('nora@instituto.test', 'clave-segura-1');
  });

  it('valida los datos de entrada y rechaza emails repetidos', async () => {
    const mal = (body: object) => api('/api/usuarios', { method: 'POST', token: admin, body });
    const ok = { nombre: 'Pepe', email: 'pepe@instituto.test', password: 'clave-segura-1', rol: 'ALUMNO' };

    assert.equal((await mal({ ...ok, password: 'corta' })).status, 400);
    assert.equal((await mal({ ...ok, email: 'no-es-un-email' })).status, 400);
    assert.equal((await mal({ ...ok, rol: 'SUPERADMIN' })).status, 400);
    assert.equal((await mal({ ...ok, nombre: '   ' })).status, 400);
    assert.equal((await mal(ok)).status, 201);
    const dup = await mal(ok);
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'EMAIL_REPETIDO');
  });

  it('solo el admin gestiona usuarios', async () => {
    const alumno = await login('alumno1@instituto.test');
    const docente = await login('docente@instituto.test');
    assert.equal((await api('/api/usuarios', { token: alumno })).status, 403);
    assert.equal((await api('/api/usuarios', { method: 'POST', token: docente, body: {} })).status, 403);
    assert.equal((await api('/api/usuarios')).status, 401);
  });

  it('lista con filtro por rol y edita nombre y contraseña', async () => {
    const alumnos = await api('/api/usuarios?rol=ALUMNO', { token: admin });
    assert.equal(alumnos.status, 200);
    assert.ok(alumnos.body.length >= 3);
    assert.ok(alumnos.body.every((u: { rol: string }) => u.rol === 'ALUMNO'));
    assert.equal((await api('/api/usuarios?rol=XX', { token: admin })).status, 400);

    const pepe = alumnos.body.find((u: { email: string }) => u.email === 'pepe@instituto.test');
    const upd = await api(`/api/usuarios/${pepe.id}`, {
      method: 'PATCH',
      token: admin,
      body: { nombre: 'Pepe Pérez', password: 'otra-clave-2' },
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.nombre, 'Pepe Pérez');
    await login('pepe@instituto.test', 'otra-clave-2');
    assert.equal((await api('/api/usuarios/99999', { method: 'PATCH', token: admin, body: { nombre: 'X' } })).status, 404);
  });

  it('desactivar un usuario le corta el acceso al instante, y no podés desactivarte a vos mismo', async () => {
    const tokenPepe = await login('pepe@instituto.test', 'otra-clave-2');
    const pepe = (await api('/api/auth/me', { token: tokenPepe })).body;

    const off = await api(`/api/usuarios/${pepe.id}`, { method: 'PATCH', token: admin, body: { activo: false } });
    assert.equal(off.status, 200);
    assert.equal(off.body.activo, false);

    // El token que ya tenía deja de servir (no hace falta esperar a que venza)...
    assert.equal((await api('/api/auth/me', { token: tokenPepe })).status, 401);
    // ...y tampoco puede volver a entrar.
    const again = await api('/api/auth/login', { method: 'POST', body: { email: 'pepe@instituto.test', password: 'otra-clave-2' } });
    assert.equal(again.status, 403);
    assert.equal(again.body.code, 'USUARIO_INACTIVO');

    const yoMismo = (await api('/api/auth/me', { token: admin })).body;
    const auto = await api(`/api/usuarios/${yoMismo.id}`, { method: 'PATCH', token: admin, body: { activo: false } });
    assert.equal(auto.status, 409);
  });
});

describe('gestión de aulas y sesiones', () => {
  let admin: string, docente: string, alumno1: string, otroDocente: string;
  let docenteId: number;
  let aulaId: number;

  before(async () => {
    admin = await login('admin@instituto.test');
    docente = await login('docente@instituto.test');
    alumno1 = await login('alumno1@instituto.test');
    docenteId = (await api('/api/auth/me', { token: docente })).body.id;
    await api('/api/usuarios', {
      method: 'POST',
      token: admin,
      body: { nombre: 'Otro Docente', email: 'otro@instituto.test', password: 'clave-segura-1', rol: 'DOCENTE' },
    });
    otroDocente = await login('otro@instituto.test', 'clave-segura-1');
  });

  it('el docente crea su propia aula, que nace activa', async () => {
    const r = await api('/api/comisiones', {
      method: 'POST',
      token: docente,
      body: { materia: 'Programación I', cicloLectivo: '2026', docenteId: 99999 }, // el docenteId se ignora
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.estado, 'ACTIVA');
    assert.equal(r.body.docenteId, docenteId);
    aulaId = r.body.id;

    assert.equal((await api('/api/comisiones', { method: 'POST', token: docente, body: { materia: '', cicloLectivo: '2026' } })).status, 400);
    assert.equal((await api('/api/comisiones', { method: 'POST', token: alumno1, body: { materia: 'X', cicloLectivo: '2026' } })).status, 403);
  });

  it('el admin crea aulas para un docente (borrador) y puede activarlas; valida el docente', async () => {
    const sinDocente = await api('/api/comisiones', { method: 'POST', token: admin, body: { materia: 'Redes', cicloLectivo: '2026' } });
    assert.equal(sinDocente.status, 400);
    const alumnoComoDocente = await api('/api/usuarios?rol=ALUMNO', { token: admin });
    const malDocente = await api('/api/comisiones', {
      method: 'POST',
      token: admin,
      body: { materia: 'Redes', cicloLectivo: '2026', docenteId: alumnoComoDocente.body[0].id },
    });
    assert.equal(malDocente.status, 400);
    assert.equal(malDocente.body.code, 'DOCENTE_INVALIDO');

    const r = await api('/api/comisiones', { method: 'POST', token: admin, body: { materia: 'Redes', cicloLectivo: '2026', docenteId } });
    assert.equal(r.status, 201);
    assert.equal(r.body.estado, 'BORRADOR');
    assert.equal((await api(`/api/comisiones/${r.body.id}/estado`, { method: 'PATCH', token: admin, body: { estado: 'ACTIVA' } })).status, 200);
  });

  it('un docente no toca las aulas de otro; el admin sí', async () => {
    assert.equal((await api(`/api/comisiones/${aulaId}`, { method: 'PATCH', token: otroDocente, body: { materia: 'Hack' } })).status, 403);
    assert.equal((await api(`/api/comisiones/${aulaId}/sesiones`, { token: otroDocente })).status, 403);
    assert.equal((await api(`/api/comisiones/${aulaId}`, { method: 'DELETE', token: otroDocente })).status, 403);

    const lista = await api('/api/comisiones', { token: otroDocente });
    assert.deepEqual(lista.body, []); // solo ve las suyas (ninguna)

    const edit = await api(`/api/comisiones/${aulaId}`, { method: 'PATCH', token: admin, body: { materia: 'Programación I (A)' } });
    assert.equal(edit.status, 200);
    // Solo el admin reasigna docente.
    assert.equal((await api(`/api/comisiones/${aulaId}`, { method: 'PATCH', token: docente, body: { docenteId } })).status, 403);
  });

  it('el docente inscribe alumnos en su aula, abre una sesión y ve el historial', async () => {
    const alumnos = (await api(`/api/comisiones/${aulaId}/inscripciones`, { token: docente })).body;
    assert.ok(alumnos.length >= 2);
    for (const a of alumnos.slice(0, 2)) {
      assert.equal((await api(`/api/comisiones/${aulaId}/inscripciones`, { method: 'POST', token: docente, body: { alumnoId: a.id } })).status, 201);
    }
    const dup = await api(`/api/comisiones/${aulaId}/inscripciones`, { method: 'POST', token: docente, body: { alumnoId: alumnos[0].id } });
    assert.equal(dup.status, 409);
    // Un alumno desactivado (Pepe, de la suite anterior) ya no aparece como inscribible.
    assert.ok(!alumnos.some((a: { email: string }) => a.email === 'pepe@instituto.test'));

    const abrir = await api('/api/sesiones/abrir-qr', { method: 'POST', token: docente, body: { comisionId: aulaId } });
    assert.equal(abrir.status, 201);

    const historial = await api(`/api/comisiones/${aulaId}/sesiones`, { token: docente });
    assert.equal(historial.status, 200);
    assert.equal(historial.body.length, 1);
    assert.equal(historial.body[0].abierta, true);
    assert.equal(historial.body[0].total, 2);
    assert.equal(historial.body[0].presentes, 0);
  });

  it('el admin ve y cierra la sesión pero no puede pedir el QR; otro docente no ve nada', async () => {
    const sesionId = (await api(`/api/comisiones/${aulaId}/sesiones`, { token: admin })).body[0].id;
    assert.equal((await api(`/api/sesiones/${sesionId}`, { token: admin })).status, 200);
    assert.equal((await api(`/api/sesiones/${sesionId}/qr`, { token: admin })).status, 403);
    assert.equal((await api(`/api/sesiones/${sesionId}`, { token: otroDocente })).status, 403);

    assert.equal((await api(`/api/sesiones/${sesionId}/cerrar`, { method: 'POST', token: admin })).status, 200);
    assert.equal((await api(`/api/sesiones/${sesionId}`, { token: docente })).body.abierta, false);
  });

  it('un aula con sesiones no se borra hasta eliminar sus sesiones; después sí', async () => {
    const del = await api(`/api/comisiones/${aulaId}`, { method: 'DELETE', token: docente });
    assert.equal(del.status, 409);
    assert.equal(del.body.code, 'TIENE_SESIONES');

    const sesionId = (await api(`/api/comisiones/${aulaId}/sesiones`, { token: docente })).body[0].id;
    assert.equal((await api(`/api/sesiones/${sesionId}`, { method: 'DELETE', token: otroDocente })).status, 403);
    assert.equal((await api(`/api/sesiones/${sesionId}`, { method: 'DELETE', token: docente })).status, 204);
    assert.equal((await api(`/api/sesiones/${sesionId}`, { token: docente })).status, 404);

    assert.equal((await api(`/api/comisiones/${aulaId}`, { method: 'DELETE', token: docente })).status, 204);
    const restantes = (await api('/api/comisiones', { token: docente })).body;
    assert.ok(!restantes.some((a: { id: number }) => a.id === aulaId));
  });

  it('un aula cerrada no se puede editar', async () => {
    const aula = (await api('/api/comisiones', { method: 'POST', token: docente, body: { materia: 'Temporal', cicloLectivo: '2026' } })).body;
    assert.equal((await api(`/api/comisiones/${aula.id}/estado`, { method: 'PATCH', token: docente, body: { estado: 'CERRADA' } })).status, 200);
    const edit = await api(`/api/comisiones/${aula.id}`, { method: 'PATCH', token: docente, body: { materia: 'Otra' } });
    assert.equal(edit.status, 409);
    assert.equal(edit.body.code, 'AULA_CERRADA');
  });
});
