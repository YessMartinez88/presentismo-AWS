import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../shared/config';
import { contar, db, escribirVarios, queryTodo } from '../shared/db';

/**
 * Tabla `inscripciones`: clave compuesta (comisionId, alumnoId). Que la clave sea el par
 * hace que un alumno no pueda quedar inscripto dos veces en la misma comisión (lo garantiza DynamoDB).
 * Índice `porAlumno` (alumnoId, comisionId) para "¿en qué materias está este alumno?".
 */
export interface Inscripcion {
  comisionId: number;
  alumnoId: number;
}

const T = () => config.tablas.inscripciones;

export async function existe(comisionId: number, alumnoId: number): Promise<boolean> {
  const r = await db.send(new GetCommand({ TableName: T(), Key: { comisionId, alumnoId } }));
  return r.Item !== undefined;
}

export function listarPorComision(comisionId: number): Promise<Inscripcion[]> {
  return queryTodo<Inscripcion>({
    TableName: T(),
    KeyConditionExpression: 'comisionId = :c',
    ExpressionAttributeValues: { ':c': comisionId },
  });
}

export function listarPorAlumno(alumnoId: number): Promise<Inscripcion[]> {
  return queryTodo<Inscripcion>({
    TableName: T(),
    IndexName: 'porAlumno',
    KeyConditionExpression: 'alumnoId = :a',
    ExpressionAttributeValues: { ':a': alumnoId },
  });
}

export function contarPorComision(comisionId: number): Promise<number> {
  return contar({ TableName: T(), KeyConditionExpression: 'comisionId = :c', ExpressionAttributeValues: { ':c': comisionId } });
}

/** Falla con ConditionalCheckFailed si ya estaba inscripto. */
export async function crear(i: Inscripcion): Promise<void> {
  await db.send(new PutCommand({ TableName: T(), Item: i, ConditionExpression: 'attribute_not_exists(comisionId)' }));
}

export async function eliminar(comisionId: number, alumnoId: number): Promise<void> {
  await db.send(new DeleteCommand({ TableName: T(), Key: { comisionId, alumnoId } }));
}

export async function eliminarDeComision(comisionId: number): Promise<void> {
  const todas = await listarPorComision(comisionId);
  await escribirVarios(
    T(),
    todas.map((i) => ({ DeleteRequest: { Key: { comisionId: i.comisionId, alumnoId: i.alumnoId } } })),
  );
}
