# Asistencia Instituto: asistencia por QR

Sistema de toma de asistencia: **el docente abre una sesión y proyecta un QR que cambia cada 20 segundos, y los alumnos lo escanean con el celular y quedan presentes.** También incluye la gestión básica para cargar datos desde la propia app:

- **Usuarios** (admin): crear, editar, cambiar contraseña y desactivar docentes, alumnos y administradores.
- **Aulas** (admin y docente): crear, editar, activar o cerrar, eliminar e inscribir alumnos. El docente crea sus propias aulas, que nacen activas. El admin puede crear aulas para cualquier docente.
- **Sesiones** de cada aula: historial con presentes sobre total, detalle, cierre y eliminación.

En la interfaz se dice **aula**, mientras que en la API y en la base sigue siendo **comisión**.

**App desplegada:** https://main.d148i35bp5iviz.amplifyapp.com

| Capa | Tecnología |
|---|---|
| Frontend | Angular 21 (standalone + signals), `qrcode` para dibujar el QR y `jsQR` para leerlo con la cámara. Publicado en **AWS Amplify**. |
| Backend | **AWS Lambda** (Node.js 22, TypeScript), una función por módulo, detrás de **API Gateway**. JWT y bcrypt. |
| Base de datos | **DynamoDB** (7 tablas) |
| Infraestructura | **AWS CDK** (TypeScript), carpeta `infra/` |

La arquitectura completa, el modelo de datos, la seguridad y los costos están en **[docs/DESPLIEGUE_AWS.md](docs/DESPLIEGUE_AWS.md)**.

---

## Estructura

```
backend/
  src/modules/        una carpeta = una Lambda (handler + service): auth, usuarios, comisiones, sesiones, asistencia
  src/repositories/   única capa que habla con DynamoDB
  src/shared/         router HTTP, JWT, tokens QR, claves de SSM, cliente DynamoDB, validaciones
  scripts/seed.ts     carga los datos de demo
frontend/             Angular (core/: servicios, guards, interceptor · features/: pantallas por rol)
infra/                AWS CDK: stack completo y scripts de despliegue
docs/                 documentación del despliegue
```

---

## Desarrollo local del frontend

El backend ya no corre en local: son Lambdas en AWS. `ng serve` reenvía `/api` a la API desplegada mediante `frontend/proxy.conf.json`.

```bash
cd frontend
npm install
npm start                 # http://localhost:4200
```

> `frontend/.npmrc` activa `legacy-peer-deps` porque npm 11.4 tiene un bug de resolución de dependencias con el árbol de Angular 21 (`Cannot read properties of null (reading 'edgesOut')`).

Para el backend, `cd backend && npm install && npm run typecheck` verifica los tipos. Los cambios se prueban desplegando (ver más abajo).

---

## Usuarios de demo

Contraseña de todos: `Demo1234!`

| Rol | Email |
|---|---|
| Admin | admin@instituto.test |
| Docente | docente@instituto.test |
| Alumno 1 | alumno1@instituto.test |
| Alumno 2 | alumno2@instituto.test |

Hay un aula de demo, "Bases de Datos · 2° A", con los dos alumnos inscriptos.

## Cargar datos desde la app

1. **Admin** → pestaña *Usuarios* → *Nuevo usuario*: crear docentes y alumnos. La contraseña tiene que tener al menos 8 caracteres.
2. **Docente** → *Mis aulas* → *Nueva aula* (queda activa a su nombre) → *Alumnos* → *Inscribir*. El admin puede hacer lo mismo desde *Aulas*, eligiendo el docente a cargo.
3. En cada aula, el panel *Sesiones* muestra el historial y permite ver, cerrar o eliminar una sesión. Un aula con sesiones no se puede borrar hasta eliminar sus sesiones. Si se quiere conservar el historial, se puede cerrar.
4. Un usuario **desactivado** pierde el acceso al instante, aunque tenga la sesión abierta, y conserva su historial.

## Probar el flujo en una sola PC

La sesión se guarda **por pestaña** (`sessionStorage`), así que se puede tener un rol distinto en cada pestaña.

1. Pestaña A → entrar como **docente** → *Abrir sesión QR*. Aparece el QR y la lista de presentes en vivo.
2. Pestaña B → entrar como **alumno 1**. Hay tres formas de registrar la presencia:
   - **Cámara**: *Escanear QR* y apuntar a la pantalla del docente.
   - **Enlace**: en la pestaña A, *Copiar enlace* y abrirlo en la pestaña B.
   - **Pegar código**: en *Escanear QR*, sección "¿No podés escanear?".
3. El alumno aparece como **Presente** en la pestaña del docente, que se actualiza cada 3 segundos.
4. Casos de error para probar:
   - Escanear dos veces: devuelve 409.
   - Usar un enlace de hace más de ~40 segundos: el QR está vencido.
   - *Cerrar sesión* y volver a escanear.
   - Escanear con un alumno no inscripto: devuelve 403.

**Cámara desde el celular:** el navegador solo habilita la cámara en `https`. La app desplegada en Amplify ya usa HTTPS.

---

## Cómo funciona el QR (decisión de seguridad principal)

El QR **no** contiene un id fijo. Contiene un **token firmado que vence a los 40 segundos**, y el docente lo renueva cada 20. Una captura de pantalla reenviada a un compañero que no está en el aula deja de servir enseguida.

Además:
- La identidad del alumno sale de su sesión (JWT), **nunca** del body: nadie puede marcar presente a otro.
- Las escrituras condicionales de DynamoDB evitan duplicados aunque lleguen requests simultáneos.
- Cada aula tiene **una sola sesión activa** a la vez, y eso se garantiza con una transacción.
- Las claves de firma (login y QR) se derivan de una clave maestra guardada en **SSM Parameter Store**. No están en el código.

## API

| Método y ruta | Rol | Descripción |
|---|---|---|
| `POST /api/auth/login` | — | Devuelve un JWT (8 h) |
| `GET /api/auth/me` | Logueado | Datos del usuario actual |
| `GET /api/usuarios?rol=` | Admin | Lista usuarios, con filtro opcional por rol |
| `POST /api/usuarios` | Admin | `{ nombre, email, password, rol }` |
| `PATCH /api/usuarios/:id` | Admin | Edita nombre, email, contraseña o `activo` (el rol no se edita) |
| `GET /api/comisiones` | Admin, Docente | El admin ve todas, el docente solo las suyas |
| `POST /api/comisiones` | Admin, Docente | `{ materia, cicloLectivo, docenteId?, activar? }` |
| `PATCH /api/comisiones/:id` | Admin, Docente (dueño) | Edita materia y ciclo. Solo el admin reasigna el docente. |
| `DELETE /api/comisiones/:id` | Admin, Docente (dueño) | Solo si no tiene sesiones |
| `PATCH /api/comisiones/:id/estado` | Admin, Docente (dueño) | `BORRADOR → ACTIVA → CERRADA` |
| `GET /api/comisiones/:id/sesiones` | Admin, Docente (dueño) | Historial de sesiones con presentes sobre total |
| `GET/POST/DELETE /api/comisiones/:id/inscripciones` | Admin, Docente (dueño) | Inscribir o quitar alumnos |
| `POST /api/sesiones/abrir-qr` | Docente | `{ comisionId, duracionMin }`. Si ya hay una sesión abierta, la devuelve. |
| `GET /api/sesiones/:id` | Admin, Docente (dueño) | Estado de la sesión, con presentes y ausentes |
| `GET /api/sesiones/:id/qr` | Docente (dueño) | Token vigente para dibujar el QR |
| `POST /api/sesiones/:id/cerrar` | Admin, Docente (dueño) | Cierra la toma de asistencia |
| `DELETE /api/sesiones/:id` | Admin, Docente (dueño) | Elimina la sesión y sus asistencias |
| `POST /api/asistencia/registrar-qr` | Alumno | `{ token }` → marca presente |
| `GET /api/asistencia/alumno/me` | Alumno | Materias, porcentaje de asistencia y detalle |

Los errores tienen la forma `{ code, message }`, con códigos estables (`QR_VENCIDO`, `QR_INVALIDO`, `SESION_CERRADA`, `NO_INSCRIPTO`, `YA_REGISTRADO`, …).

---

## Despliegue

Hacen falta credenciales de la cuenta de AWS donde está desplegado: `aws login --profile <perfil>` y exportar `AWS_PROFILE=<perfil>`.

| Qué | Dónde | Comando |
|---|---|---|
| Desplegar backend e infraestructura | `infra/` | `npm run deploy` |
| Publicar el frontend | `infra/` | `npm run deploy:frontend` |
| Recargar los datos de demo (**borra todo**) | `backend/` | `npm run seed` |
| Ver cambios antes de desplegar | `infra/` | `npm run diff` |
| Borrar todo de AWS (incluye los datos) | `infra/` | `npm run destroy` |

La primera vez en otra PC, correr `npm install` en `infra/`, `backend/` y `frontend/`.
