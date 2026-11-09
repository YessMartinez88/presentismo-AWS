-- Esquema MVP "Asistencia Instituto" (SQL Server / Amazon RDS for SQL Server)
-- Se ejecuta con `npm run db:setup` desde /backend (crea la base si no existe).
-- Es idempotente: se puede correr varias veces sin romper nada.

IF OBJECT_ID('dbo.usuarios', 'U') IS NULL
CREATE TABLE dbo.usuarios (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    nombre        NVARCHAR(100) NOT NULL,
    email         NVARCHAR(100) NOT NULL UNIQUE,
    password_hash NVARCHAR(100) NOT NULL,
    rol           VARCHAR(20)   NOT NULL
        CONSTRAINT ck_usuarios_rol CHECK (rol IN ('ADMIN', 'DOCENTE', 'ALUMNO')),
    activo        BIT           NOT NULL CONSTRAINT df_usuarios_activo DEFAULT 1
);

-- Bases creadas antes de que existiera `activo` (desactivar usuarios en vez de borrarlos conserva su historial).
IF COL_LENGTH('dbo.usuarios', 'activo') IS NULL
ALTER TABLE dbo.usuarios ADD activo BIT NOT NULL CONSTRAINT df_usuarios_activo DEFAULT 1;

IF OBJECT_ID('dbo.comisiones', 'U') IS NULL
CREATE TABLE dbo.comisiones (
    id             INT IDENTITY(1,1) PRIMARY KEY,
    nombre_materia NVARCHAR(100) NOT NULL,
    docente_id     INT NOT NULL REFERENCES dbo.usuarios(id),
    ciclo_lectivo  VARCHAR(10)   NOT NULL,
    estado         VARCHAR(20)   NOT NULL DEFAULT 'BORRADOR'
        CONSTRAINT ck_comisiones_estado CHECK (estado IN ('BORRADOR', 'ACTIVA', 'CERRADA'))
);

IF OBJECT_ID('dbo.inscripciones', 'U') IS NULL
CREATE TABLE dbo.inscripciones (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    comision_id INT NOT NULL REFERENCES dbo.comisiones(id),
    alumno_id   INT NOT NULL REFERENCES dbo.usuarios(id),
    CONSTRAINT uq_inscripcion UNIQUE (comision_id, alumno_id)
);

-- Una sesión = una clase con QR abierto por el docente.
-- `expira_en` es el vencimiento de la sesión; el token del QR rota por su cuenta (ver qr.service.ts).
IF OBJECT_ID('dbo.sesiones_clase', 'U') IS NULL
CREATE TABLE dbo.sesiones_clase (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    comision_id INT NOT NULL REFERENCES dbo.comisiones(id),
    fecha       DATE NOT NULL,
    activa      BIT  NOT NULL DEFAULT 1,
    creado_en   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    expira_en   DATETIME2 NOT NULL
);

-- Índice único filtrado: a lo sumo UNA sesión activa por comisión, garantizado por la base.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_sesion_activa' AND object_id = OBJECT_ID('dbo.sesiones_clase'))
CREATE UNIQUE INDEX uq_sesion_activa ON dbo.sesiones_clase (comision_id) WHERE activa = 1;

-- UNIQUE (sesion_id, alumno_id): la base garantiza que no haya presentes duplicados,
-- aunque dos requests lleguen al mismo tiempo.
IF OBJECT_ID('dbo.asistencias', 'U') IS NULL
CREATE TABLE dbo.asistencias (
    id             INT IDENTITY(1,1) PRIMARY KEY,
    sesion_id      INT NOT NULL REFERENCES dbo.sesiones_clase(id),
    alumno_id      INT NOT NULL REFERENCES dbo.usuarios(id),
    estado         VARCHAR(20) NOT NULL
        CONSTRAINT ck_asistencias_estado CHECK (estado IN ('PRESENTE', 'AUSENTE', 'JUSTIFICADA')),
    fecha_registro DATETIME2 NULL,
    CONSTRAINT uq_asistencia UNIQUE (sesion_id, alumno_id)
);
