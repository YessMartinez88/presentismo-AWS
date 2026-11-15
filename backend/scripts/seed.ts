/**
 * Carga los datos de demo en las tablas de DynamoDB ya desplegadas.
 * BORRA todo lo que haya. Uso (después de `npm run deploy` en infra/):
 *
 *   cd backend && npm run seed
 *
 * Toma los nombres de las tablas de infra/cdk-outputs.json (lo genera el deploy) y usa
 * tus credenciales de AWS CLI.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEMO_PASSWORD = 'Demo1234!';
const DEMO_USERS = [
  { nombre: 'Martina Costa', email: 'admin@instituto.test', rol: 'ADMIN' },
  { nombre: 'Laura Méndez', email: 'docente@instituto.test', rol: 'DOCENTE' },
  { nombre: 'Sofía Ramírez', email: 'alumno1@instituto.test', rol: 'ALUMNO' },
  { nombre: 'Tomás Herrera', email: 'alumno2@instituto.test', rol: 'ALUMNO' },
] as const;

const outputsPath = fileURLToPath(new URL('../../infra/cdk-outputs.json', import.meta.url));
let outputs: Record<string, string>;
try {
  outputs = Object.values(JSON.parse(readFileSync(outputsPath, 'utf8')) as Record<string, Record<string, string>>)[0]!;
} catch {
  console.error(`No encontré ${outputsPath}. Primero desplegá con "npm run deploy" en infra/.`);
  process.exit(1);
}

// Las variables tienen que existir ANTES de importar el código que las usa.
const tablas = {
  TABLA_USUARIOS: outputs.TablaUsuarios,
  TABLA_USUARIOS_EMAIL: outputs.TablaUsuariosEmail,
  TABLA_COMISIONES: outputs.TablaComisiones,
  TABLA_INSCRIPCIONES: outputs.TablaInscripciones,
  TABLA_SESIONES: outputs.TablaSesiones,
  TABLA_ASISTENCIAS: outputs.TablaAsistencias,
  TABLA_CONTADORES: outputs.TablaContadores,
};
Object.assign(process.env, tablas);
process.env.AWS_REGION ??= outputs.Region;

const { default: bcrypt } = await import('bcryptjs');
const { escribirVarios, scanTodo, siguienteId } = await import('../src/shared/db');
const usuariosRepo = await import('../src/repositories/usuarios.repository');
const comisionesRepo = await import('../src/repositories/comisiones.repository');
const inscripcionesRepo = await import('../src/repositories/inscripciones.repository');

// Clave primaria de cada tabla, para poder borrar ítem por ítem.
const claves: Record<string, string[]> = {
  TABLA_USUARIOS: ['id'],
  TABLA_USUARIOS_EMAIL: ['email'],
  TABLA_COMISIONES: ['id'],
  TABLA_INSCRIPCIONES: ['comisionId', 'alumnoId'],
  TABLA_SESIONES: ['id'],
  TABLA_ASISTENCIAS: ['sesionId', 'alumnoId'],
  TABLA_CONTADORES: ['nombre'],
};

for (const [variable, tabla] of Object.entries(tablas)) {
  if (!tabla) throw new Error(`Falta ${variable} en cdk-outputs.json`);
  const campos = claves[variable]!;
  const items = await scanTodo<Record<string, unknown>>({ TableName: tabla, ProjectionExpression: campos.join(', ') });
  await escribirVarios(
    tabla,
    items.map((it) => ({ DeleteRequest: { Key: Object.fromEntries(campos.map((c) => [c, it[c]])) } })),
  );
  console.log(`Vaciada ${tabla} (${items.length} ítems)`);
}

const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
const ids: Record<string, number> = {};
for (const u of DEMO_USERS) {
  const id = await siguienteId('usuarios');
  await usuariosRepo.crear({ id, ...u, passwordHash, activo: true });
  ids[u.email] = id;
}

const comisionId = await siguienteId('comisiones');
await comisionesRepo.crear({
  id: comisionId,
  materia: 'Bases de Datos · 2° A',
  cicloLectivo: '2026',
  estado: 'ACTIVA',
  docenteId: ids['docente@instituto.test']!,
});
for (const u of DEMO_USERS.filter((u) => u.rol === 'ALUMNO')) {
  await inscripcionesRepo.crear({ comisionId, alumnoId: ids[u.email]! });
}

console.log(`\nDatos de demo cargados. Contraseña de todos los usuarios: ${DEMO_PASSWORD}`);
for (const u of DEMO_USERS) console.log(`  ${u.rol.padEnd(8)} ${u.email}`);
