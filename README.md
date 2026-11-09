# Asistencia Instituto — MVP de asistencia por QR

Alcance de este MVP: **un docente abre una sesión con QR, los alumnos lo escanean y quedan como presentes**,
más la gestión básica para cargar datos desde la propia app:

- **Usuarios** (admin): crear, editar, cambiar contraseña y desactivar docentes, alumnos y administradores.
- **Aulas** (admin y docente): crear, editar, activar/cerrar, eliminar e inscribir alumnos. El docente crea sus propias aulas (nacen activas); el admin crea aulas para cualquier docente.
- **Sesiones** de cada aula: historial con presentes/total, ver detalle, cerrar y eliminar.

Los datos de demo traen 1 admin, 1 docente, 2 alumnos y 1 aula. Tareas, justificaciones, agenda y OAuth quedan para fases siguientes.
En la interfaz se dice **aula**; en la API y la base de datos sigue siendo **comisión**.

| Capa | Tecnología |
|---|---|
| Frontend | Angular 21 (standalone + signals), `qrcode` para dibujar el QR, `jsQR` para leerlo con la cámara |
| Backend | Node.js + Express 5 + TypeScript, JWT, bcrypt |
| Base de datos | SQL Server (local: SQL Express con autenticación de Windows; AWS: RDS for SQL Server) |

## Requisitos
- Node.js 24.x (Angular 21 funciona con 24.14; Angular 22 pide ≥ 24.15)
- SQL Server Express en `.\SQLEXPRESS` y el *ODBC Driver 17 for SQL Server* (ya instalados en esta PC)

## Puesta en marcha

```bash
cd backend
npm install
copy .env.example .env    # para desarrollo sirve tal cual (cambiá JWT_SECRET y QR_SECRET si lo exponés)
npm run db:setup          # crea la base "presentismo" y las tablas (idempotente)
npm run db:seed           # carga los usuarios y la comisión de demo (BORRA los datos existentes)
npm run dev               # API en http://localhost:3000
```

```bash
cd frontend
npm install
npm start                 # app en http://localhost:4200 (el proxy reenvía /api al backend)
```

> `frontend/.npmrc` activa `legacy-peer-deps` porque npm 11.4 tiene un bug de resolución de dependencias
> con el árbol de Angular 21 (`Cannot read properties of null (reading 'edgesOut')`).

## Problemas comunes al levantarlo
No hace falta Docker ni XAMPP (XAMPP es MySQL; esta app usa SQL Server). Si algo falla:

| Síntoma | Solución |
|---|---|
| `db:setup` no conecta / "instance not found" | Tu SQL Server no se llama `.\SQLEXPRESS`. En `backend/.env` cambiá `DB_SERVER` (instancia por defecto: `localhost`). |
| "Data source name not found" / driver ODBC | Instalá *ODBC Driver 17 for SQL Server*. Se verifica con `Get-OdbcDriver \| Where Name -like '*SQL Server*'` en PowerShell. |
| No tengo SQL Server | Instalá SQL Server Express (gratis), o usá un contenedor Docker de SQL Server y definí en `backend/.env`: `DB_USER=sa`, `DB_PASSWORD=...`, `DB_SERVER=localhost`, `DB_PORT=1433` (al definir `DB_USER` se conecta por TCP en vez de autenticación de Windows). |
| `npm install` del frontend falla con `edgesOut` | Ya está resuelto con `frontend/.npmrc` (`legacy-peer-deps`); verificá que el archivo exista. |
| `Falta la variable de entorno JWT_SECRET` | Falta crear `backend/.env` (`copy .env.example .env`). |
| El navegador pide la cámara y no la abre | Solo funciona en `localhost` o `https`. Usá la opción de pegar el enlace. |
| `npm install` deja paquetes incompletos y `ng build` dice "Cannot find module '@angular/core'" | La ruta de la carpeta es demasiado larga (Windows corta en 260 caracteres dentro de `node_modules`). Descomprimí el proyecto en una ruta corta, por ejemplo `C:\proyectos\presentismo`, y reinstalá. También ocurre si el disco se llena durante `npm install`: borrá `node_modules`, liberá espacio y volvé a instalar. |
| Puerto 3000 o 4200 ocupado | Cambiá `PORT` en `backend/.env` (y el `target` de `frontend/proxy.conf.json`) o `npm start -- --port 4300`. |

## Usuarios de demo
Contraseña de todos: `Demo1234!`

| Rol | Email |
|---|---|
| Admin | admin@instituto.test |
| Docente | docente@instituto.test |
| Alumno 1 | alumno1@instituto.test |
| Alumno 2 | alumno2@instituto.test |

## Cargar datos desde la app
1. **Admin** → pestaña *Usuarios* → *Nuevo usuario*: creá docentes y alumnos (contraseña de al menos 8 caracteres).
2. **Docente** → *Mis aulas* → *Nueva aula* (queda activa a su nombre) → *Alumnos* → *Inscribir*.
   El admin puede hacer lo mismo desde *Aulas*, eligiendo el docente a cargo.
3. En cada aula, el panel *Sesiones* muestra el historial y permite ver, cerrar o eliminar una sesión.
   Un aula con sesiones no se puede borrar hasta eliminar sus sesiones (o se cierra para conservar el historial).
4. Un usuario **desactivado** pierde el acceso al instante (aunque tenga la sesión abierta) y conserva su historial.

## Probar el flujo en una sola PC
La sesión se guarda **por pestaña** (`sessionStorage`), así que podés tener un rol en cada pestaña.

1. Pestaña A → entrá como **docente** → *Abrir sesión QR*. Aparece el QR y la lista de presentes en vivo.
2. Pestaña B → entrá como **alumno 1**. Hay tres formas de registrar la presencia:
   - **Cámara**: *Escanear QR* y apuntar a la pantalla del docente (con otro dispositivo, o la webcam apuntando al monitor).
   - **Enlace**: en la pestaña A, *Copiar enlace* y abrirlo en la pestaña B. Si el alumno no está logueado, entra, y vuelve solo al enlace.
   - **Pegar código**: en *Escanear QR*, sección "¿No podés escanear?".
3. Mirá cómo el alumno aparece como **Presente** en la pestaña del docente (se actualiza cada 3 s).
4. Casos de error que podés probar: escanear dos veces (409), esperar ~40 s con un enlace viejo (QR vencido),
   *Cerrar sesión* y volver a escanear, o entrar como **admin** → *Aulas* → *Alumnos* → *Quitar* a un alumno (no inscripto → 403).

**Cámara desde un celular:** el navegador solo habilita la cámara en `https` o `localhost`. Con `http://<ip-de-la-pc>:4200`
la cámara no funciona (el enlace sí: abrilo con la cámara nativa del celu). En AWS, CloudFront/Amplify ya sirven HTTPS.

## Tests
```bash
cd backend && npm test    # 21 tests de integración: flujo del QR + gestión de usuarios, aulas y sesiones
```
Usan una base aparte (`presentismo_test`, se crea sola) para no pisar los datos de demo.
El frontend todavía no tiene tests.

## Cómo funciona el QR (decisión de seguridad principal)
El QR **no** contiene un id fijo, sino un **token firmado (JWT HS256) que vence a los 40 s**. El docente lo renueva cada 20 s.
Una captura de pantalla reenviada a un compañero que no está en el aula deja de servir enseguida (RNF-03).
Además:
- La identidad del alumno sale de su sesión (JWT), **nunca** del body: nadie puede marcar presente por otro.
- `UNIQUE(sesion_id, alumno_id)` + `UPDATE ... WHERE estado = 'AUSENTE'` evitan duplicados aun con requests simultáneas.
- Un índice único filtrado garantiza **una sola sesión activa por comisión**.
- Las horas se calculan con el reloj de la base (un solo reloj) y se devuelven en UTC; el navegador las muestra en hora local.

## API
| Método y ruta | Rol | Descripción |
|---|---|---|
| `POST /api/auth/login` | — | Devuelve JWT (8 h) |
| `GET /api/usuarios?rol=` | Admin | Lista usuarios (filtro opcional por rol) |
| `POST /api/usuarios` | Admin | `{ nombre, email, password, rol }` |
| `PATCH /api/usuarios/:id` | Admin | Editar nombre, email, contraseña o `activo` (el rol no se edita) |
| `GET /api/comisiones` | Admin, Docente | Admin: todas; docente: las suyas |
| `POST /api/comisiones` | Admin, Docente | `{ materia, cicloLectivo, docenteId?, activar? }`. Docente: se asigna a sí mismo y nace activa |
| `PATCH /api/comisiones/:id` | Admin, Docente (dueño) | Editar materia/ciclo; solo el admin reasigna docente |
| `DELETE /api/comisiones/:id` | Admin, Docente (dueño) | Solo si no tiene sesiones |
| `PATCH /api/comisiones/:id/estado` | Admin, Docente (dueño) | `BORRADOR → ACTIVA → CERRADA` |
| `GET /api/comisiones/:id/sesiones` | Admin, Docente (dueño) | Historial de sesiones con presentes/total |
| `GET/POST/DELETE /api/comisiones/:id/inscripciones` | Admin, Docente (dueño) | Inscribir / quitar alumnos |
| `POST /api/sesiones/abrir-qr` | Docente | `{ comisionId, duracionMin }`; si ya hay una abierta, la devuelve |
| `GET /api/sesiones/:id` | Admin, Docente (dueño) | Estado + presentes/ausentes |
| `GET /api/sesiones/:id/qr` | Docente (dueño) | Token vigente para dibujar el QR |
| `POST /api/sesiones/:id/cerrar` | Admin, Docente (dueño) | Cierra la toma de asistencia |
| `DELETE /api/sesiones/:id` | Admin, Docente (dueño) | Elimina la sesión y sus asistencias |
| `POST /api/asistencia/registrar-qr` | Alumno | `{ token }` → marca presente |
| `GET /api/asistencia/alumno/me` | Alumno | Materias, % de asistencia y detalle |

Errores: `{ code, message }` con códigos estables (`QR_VENCIDO`, `QR_INVALIDO`, `SESION_CERRADA`, `NO_INSCRIPTO`, `YA_REGISTRADO`, …).

## Estructura
```
backend/   Express + TS   (routes/ · services/qr.service.ts · middleware/auth.ts · db/)
frontend/  Angular        (core/ servicios, guards, interceptor · features/ por rol)
infra/     database-schema.sql
```

## Camino a AWS (siguientes pasos)
- **Frontend** → `ng build` y publicar `dist/` en S3 + CloudFront (HTTPS ⇒ la cámara funciona en celulares).
  Cambiar el proxy de `/api` por la URL del API Gateway (o servir `/api/*` desde la misma distribución CloudFront).
- **Backend** → la app Express (`createApp()` en `src/app.ts`) se puede envolver con `serverless-http` para Lambda,
  o correr en App Runner/ECS sin cambios. Los secretos (`JWT_SECRET`, `QR_SECRET`, credenciales de DB) van en Secrets Manager/SSM.
- **Base de datos** → RDS for SQL Server (Express edition). Con `DB_USER`/`DB_PASSWORD` definidos, el backend usa
  el driver TCP en lugar de la autenticación de Windows; el resto del código no cambia.
  Ojo: la especificación original menciona PostgreSQL. Si se prefiere, el cambio se limita a `db/pool.ts` y al SQL de
  las rutas (`SYSUTCDATETIME`, `OUTPUT INSERTED`, `AT TIME ZONE`, `TOP` son específicos de T-SQL).
- **Pendiente de producción**: `CORS_ORIGIN` real, rate limiting en `/auth/login`, reemplazar el seed por alta real de usuarios,
  y WebSockets (API Gateway) si se quiere reemplazar el polling de 3 s del docente.
