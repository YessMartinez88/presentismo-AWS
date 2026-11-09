// Contratos de la API del backend (mantener alineados con backend/src/routes/*).

export type Rol = 'ADMIN' | 'DOCENTE' | 'ALUMNO';

export interface Usuario {
  id: number;
  nombre: string;
  rol: Rol;
}

/** Usuario tal como lo ve el módulo de gestión (el admin). */
export interface UsuarioGestion extends Usuario {
  email: string;
  activo: boolean;
}

export interface SesionResumen {
  id: number;
  fecha: string;
  abierta: boolean;
  creadoEn: string;
  presentes: number;
  total: number;
}

export interface LoginResponse {
  token: string;
  usuario: Usuario;
}

export type EstadoComision = 'BORRADOR' | 'ACTIVA' | 'CERRADA';

export interface Comision {
  id: number;
  materia: string;
  cicloLectivo: string;
  estado: EstadoComision;
  docenteId: number;
  docente: string;
  inscriptos: number;
  sesiones: number;
}

export interface AlumnoInscripcion {
  id: number;
  nombre: string;
  email: string;
  inscripto: boolean;
}

export type EstadoAsistencia = 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADA';

export interface AlumnoEnSesion {
  id: number;
  nombre: string;
  estado: EstadoAsistencia;
  registradoEn: string | null;
}

export interface Sesion {
  id: number;
  comisionId: number;
  materia: string;
  fecha: string;
  abierta: boolean;
  expiraEn: string;
  totales: { inscriptos: number; presentes: number; ausentes: number };
  alumnos: AlumnoEnSesion[];
}

export interface QrToken {
  token: string;
  venceEnSeg: number;
  refrescarEnSeg: number;
}

export interface ClaseAlumno {
  sesionId: number;
  fecha: string;
  estado: EstadoAsistencia | 'EN_CURSO';
  registradoEn: string | null;
}

export interface MateriaAsistencia {
  id: number;
  materia: string;
  docente: string;
  cicloLectivo: string;
  totalClases: number;
  asistidas: number;
  porcentaje: number | null;
  claseAbierta: boolean;
  clases: ClaseAlumno[];
}

export interface RegistroAsistencia {
  materia: string;
  fecha: string;
  estado: 'PRESENTE';
}
