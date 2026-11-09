// Prueba de integración del flujo completo. Corre contra una base APARTE (presentismo_test)
// para no pisar los datos de demo: se crea sola y se re-siembra en cada ejecución.
process.env.DB_NAME = 'presentismo_test';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

const { createApp } = await import('../src/app');
const { closePools } = await import('../src/db/pool');
const { setupDatabase } = await import('../src/db/setup');
const { DEMO_PASSWORD, seedDemo } = await import('../src/db/seed');
const { firmarTokenQr } = await import('../src/services/qr.service');

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

async function login(email: string): Promise<string> {
  const r = await api('/api/auth/login', { method: 'POST', body: { email, password: DEMO_PASSWORD } });
  assert.equal(r.status, 200);
  return r.body.token;
}

describe('flujo de asistencia por QR', () => {
  let admin: string, docente: string, alumno1: string, alumno2: string;
  let comisionId: number;
  let sesionId: number;

  before(async () => {
    await setupDatabase();
    await seedDemo();
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    admin = await login('admin@instituto.test');
    docente = await login('docente@instituto.test');
    alumno1 = await login('alumno1@instituto.test');
    alumno2 = await login('alumno2@instituto.test');
    comisionId = (await api('/api/comisiones', { token: docente })).body[0].id;
  });

  after(async () => {
    server.close();
    await closePools();
  });

  it('rechaza credenciales incorrectas y rutas sin token', async () => {
    const bad = await api('/api/auth/login', { method: 'POST', body: { email: 'alumno1@instituto.test', password: 'x' } });
    assert.equal(bad.status, 401);
    assert.equal((await api('/api/comisiones')).status, 401);
  });

  it('cada rol solo accede a lo suyo', async () => {
    assert.equal((await api('/api/sesiones/abrir-qr', { method: 'POST', token: alumno1, body: { comisionId } })).status, 403);
    assert.equal((await api(`/api/comisiones/${comisionId}/inscripciones`, { token: alumno1 })).status, 403);
    assert.equal((await api('/api/usuarios', { token: docente })).status, 403);
    assert.equal((await api('/api/asistencia/alumno/me', { token: docente })).status, 403);
  });

  it('el docente abre la sesión y los inscriptos arrancan ausentes', async () => {
    const r = await api('/api/sesiones/abrir-qr', { method: 'POST', token: docente, body: { comisionId, duracionMin: 5 } });
    assert.equal(r.status, 201);
    sesionId = r.body.id;

    const estado = await api(`/api/sesiones/${sesionId}`, { token: docente });
    assert.equal(estado.body.abierta, true);
    assert.deepEqual(estado.body.totales, { inscriptos: 2, presentes: 0, ausentes: 2 });

    // Abrir de nuevo no duplica: devuelve la misma sesión.
    const otra = await api('/api/sesiones/abrir-qr', { method: 'POST', token: docente, body: { comisionId } });
    assert.equal(otra.status, 200);
    assert.equal(otra.body.id, sesionId);
  });

  it('el alumno registra presente con el QR y no puede duplicarlo', async () => {
    const { token } = (await api(`/api/sesiones/${sesionId}/qr`, { token: docente })).body;
    const ok = await api('/api/asistencia/registrar-qr', { method: 'POST', token: alumno1, body: { token } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.estado, 'PRESENTE');

    const dup = await api('/api/asistencia/registrar-qr', { method: 'POST', token: alumno1, body: { token } });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'YA_REGISTRADO');

    const estado = await api(`/api/sesiones/${sesionId}`, { token: docente });
    assert.deepEqual(estado.body.totales, { inscriptos: 2, presentes: 1, ausentes: 1 });
  });

  it('rechaza QR inválidos o vencidos', async () => {
    const basura = await api('/api/asistencia/registrar-qr', { method: 'POST', token: alumno2, body: { token: 'abc' } });
    assert.equal(basura.status, 400);
    assert.equal(basura.body.code, 'QR_INVALIDO');

    const vencido = await api('/api/asistencia/registrar-qr', {
      method: 'POST',
      token: alumno2,
      body: { token: firmarTokenQr(sesionId, -10) },
    });
    assert.equal(vencido.status, 410);
    assert.equal(vencido.body.code, 'QR_VENCIDO');
  });

  it('rechaza a un alumno que no está inscripto', async () => {
    await api(`/api/comisiones/${comisionId}/inscripciones/${(await api('/api/auth/me', { token: alumno2 })).body.id}`, {
      method: 'DELETE',
      token: admin,
    });
    const { token } = (await api(`/api/sesiones/${sesionId}/qr`, { token: docente })).body;
    const r = await api('/api/asistencia/registrar-qr', { method: 'POST', token: alumno2, body: { token } });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'NO_INSCRIPTO');
  });

  it('un alumno inscripto después de abrir la sesión también puede marcar presente', async () => {
    const alumnoId = (await api('/api/auth/me', { token: alumno2 })).body.id;
    const ins = await api(`/api/comisiones/${comisionId}/inscripciones`, { method: 'POST', token: admin, body: { alumnoId } });
    assert.equal(ins.status, 201);
    const { token } = (await api(`/api/sesiones/${sesionId}/qr`, { token: docente })).body;
    const r = await api('/api/asistencia/registrar-qr', { method: 'POST', token: alumno2, body: { token } });
    assert.equal(r.status, 201);
  });

  it('al cerrar la sesión ya no se acepta asistencia y el alumno ve su porcentaje', async () => {
    const { token } = (await api(`/api/sesiones/${sesionId}/qr`, { token: docente })).body;
    assert.equal((await api(`/api/sesiones/${sesionId}/cerrar`, { method: 'POST', token: docente })).status, 200);

    assert.equal((await api(`/api/sesiones/${sesionId}/qr`, { token: docente })).status, 409);
    const tarde = await api('/api/asistencia/registrar-qr', { method: 'POST', token: alumno1, body: { token } });
    assert.equal(tarde.status, 410);
    assert.equal(tarde.body.code, 'SESION_CERRADA');

    const mias = await api('/api/asistencia/alumno/me', { token: alumno1 });
    assert.equal(mias.status, 200);
    assert.equal(mias.body[0].porcentaje, 100);
    assert.equal(mias.body[0].clases[0].estado, 'PRESENTE');
  });

  it('el admin administra el estado de la comisión con transiciones válidas', async () => {
    assert.equal((await api(`/api/comisiones/${comisionId}/estado`, { method: 'PATCH', token: admin, body: { estado: 'BORRADOR' } })).status, 409);
    const cerrar = await api(`/api/comisiones/${comisionId}/estado`, { method: 'PATCH', token: admin, body: { estado: 'CERRADA' } });
    assert.equal(cerrar.status, 200);
    const abrir = await api('/api/sesiones/abrir-qr', { method: 'POST', token: docente, body: { comisionId } });
    assert.equal(abrir.status, 409);
    assert.equal(abrir.body.code, 'COMISION_NO_ACTIVA');
  });
});
