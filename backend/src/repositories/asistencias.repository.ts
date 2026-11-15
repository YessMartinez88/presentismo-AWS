import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../shared/config';
import { db, escribirVarios, queryTodo } from '../shared/db';

/**
 * Tabla `asistencias`: clave compuesta (sesionId, alumnoId), así no puede haber dos registros
 * del mismo alumno en la misma clase. Índice `porAlumno` (alumnoId, sesionId) para el panel del alumno.
 * `comisionId` va repetido en cada ítem (desnormalizado) para agrupar por materia sin otra consulta.
 */
export type EstadoAsistencia = 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADA';

export interface Asistencia {
  sesionId: number;
  alumnoId: number;
  comisionId: number;
  estado: EstadoAsistencia;
  fechaRegistro?: string;
}

const T = () => config.tablas.asistencias;

/** Al abrir la sesión, todos los inscriptos arrancan AUSENTE; al escanear pasan a PRESENTE. */
export async function crearAusentes(sesionId: number, comisionId: number, alumnoIds: number[]): Promise<void> {
  await escribirVarios(
    T(),
    alumnoIds.map((alumnoId) => ({
      PutRequest: { Item: { sesionId, alumnoId, comisionId, estado: 'AUSENTE' } satisfies Asistencia },
    })),
  );
}

export function listarPorSesion(sesionId: number): Promise<Asistencia[]> {
  return queryTodo<Asistencia>({
    TableName: T(),
    KeyConditionExpression: 'sesionId = :s',
    ExpressionAttributeValues: { ':s': sesionId },
  });
}

export function listarPorAlumno(alumnoId: number): Promise<Asistencia[]> {
  return queryTodo<Asistencia>({
    TableName: T(),
    IndexName: 'porAlumno',
    KeyConditionExpression: 'alumnoId = :a',
    ExpressionAttributeValues: { ':a': alumnoId },
  });
}

/**
 * Marca PRESENTE de forma atómica. La condición hace que solo funcione si el registro no existe
 * (alumno inscripto después de abrir la sesión) o si está AUSENTE. Si dos requests llegan juntas,
 * solo una pasa; la otra falla con ConditionalCheckFailed (= "ya registrado").
 */
export async function marcarPresente(sesionId: number, alumnoId: number, comisionId: number, ahora: string): Promise<void> {
  await db.send(
    new UpdateCommand({
      TableName: T(),
      Key: { sesionId, alumnoId },
      UpdateExpression: 'SET estado = :presente, fechaRegistro = :ahora, comisionId = :c',
      ConditionExpression: 'attribute_not_exists(sesionId) OR estado = :ausente',
      ExpressionAttributeValues: { ':presente': 'PRESENTE', ':ausente': 'AUSENTE', ':ahora': ahora, ':c': comisionId },
    }),
  );
}

export async function eliminarDeSesion(sesionId: number): Promise<void> {
  const todas = await listarPorSesion(sesionId);
  await escribirVarios(
    T(),
    todas.map((a) => ({ DeleteRequest: { Key: { sesionId: a.sesionId, alumnoId: a.alumnoId } } })),
  );
}
