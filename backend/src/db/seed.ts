import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { closePools, query, withTransaction } from './pool';

/** Credenciales SOLO para desarrollo. En producción los usuarios vienen de otro lado (ver README). */
export const DEMO_PASSWORD = 'Demo1234!';

export const DEMO_USERS = [
  { nombre: 'Martina Costa', email: 'admin@instituto.test', rol: 'ADMIN' },
  { nombre: 'Laura Méndez', email: 'docente@instituto.test', rol: 'DOCENTE' },
  { nombre: 'Sofía Ramírez', email: 'alumno1@instituto.test', rol: 'ALUMNO' },
  { nombre: 'Tomás Herrera', email: 'alumno2@instituto.test', rol: 'ALUMNO' },
] as const;

/** Borra TODOS los datos y deja: 1 admin, 1 docente, 2 alumnos y 1 comisión activa con ambos inscriptos. */
export async function seedDemo(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('El seed de demo no se ejecuta con NODE_ENV=production');
  }
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await withTransaction(async (tx) => {
    // Orden inverso a las claves foráneas.
    for (const table of ['asistencias', 'sesiones_clase', 'inscripciones', 'comisiones', 'usuarios']) {
      await query(`DELETE FROM dbo.${table}`, {}, tx);
    }
    for (const u of DEMO_USERS) {
      await query(
        'INSERT INTO dbo.usuarios (nombre, email, password_hash, rol) VALUES (@nombre, @email, @hash, @rol)',
        { ...u, hash },
        tx,
      );
    }
    await query(
      `INSERT INTO dbo.comisiones (nombre_materia, docente_id, ciclo_lectivo, estado)
       SELECT N'Bases de Datos · 2° A', id, '2026', 'ACTIVA' FROM dbo.usuarios WHERE email = 'docente@instituto.test'`,
      {},
      tx,
    );
    await query(
      `INSERT INTO dbo.inscripciones (comision_id, alumno_id)
       SELECT c.id, u.id FROM dbo.comisiones c CROSS JOIN dbo.usuarios u WHERE u.rol = 'ALUMNO'`,
      {},
      tx,
    );
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedDemo()
    .then(() => console.log(`Datos de demo cargados. Contraseña de todos los usuarios: ${DEMO_PASSWORD}`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(closePools);
}
