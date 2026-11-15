import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../shared/config';
import { db, obtenerVarios, queryTodo, scanTodo } from '../shared/db';

/**
 * Tabla `comisiones` (clave: id). Índice secundario `porDocente` (docenteId, id) para que el docente
 * liste solo sus aulas sin recorrer toda la tabla.
 *
 * `sesionActivaId` guarda la sesión QR abierta del aula (si hay). Es lo que garantiza "a lo sumo una
 * sesión activa por comisión": se escribe con una condición dentro de una transacción (ver sesiones.repository).
 */
export type EstadoComision = 'BORRADOR' | 'ACTIVA' | 'CERRADA';

export interface Comision {
  id: number;
  materia: string;
  cicloLectivo: string;
  estado: EstadoComision;
  docenteId: number;
  sesionActivaId?: number;
}

const T = () => config.tablas.comisiones;

export async function obtener(id: number): Promise<Comision | undefined> {
  const r = await db.send(new GetCommand({ TableName: T(), Key: { id } }));
  return r.Item as Comision | undefined;
}

export function obtenerVariosPorId(ids: number[]): Promise<Comision[]> {
  return obtenerVarios<Comision>(T(), ids);
}

export function listar(): Promise<Comision[]> {
  return scanTodo<Comision>({ TableName: T() });
}

export function listarPorDocente(docenteId: number): Promise<Comision[]> {
  return queryTodo<Comision>({
    TableName: T(),
    IndexName: 'porDocente',
    KeyConditionExpression: 'docenteId = :d',
    ExpressionAttributeValues: { ':d': docenteId },
  });
}

export async function crear(c: Comision): Promise<void> {
  await db.send(new PutCommand({ TableName: T(), Item: c, ConditionExpression: 'attribute_not_exists(id)' }));
}

export async function actualizar(
  id: number,
  cambios: Partial<Pick<Comision, 'materia' | 'cicloLectivo' | 'docenteId'>>,
): Promise<void> {
  const entradas = Object.entries(cambios).filter(([, v]) => v !== undefined);
  await db.send(
    new UpdateCommand({
      TableName: T(),
      Key: { id },
      UpdateExpression: `SET ${entradas.map(([k]) => `#${k} = :${k}`).join(', ')}`,
      ConditionExpression: 'attribute_exists(id)',
      ExpressionAttributeNames: Object.fromEntries(entradas.map(([k]) => [`#${k}`, k])),
      ExpressionAttributeValues: Object.fromEntries(entradas.map(([k, v]) => [`:${k}`, v])),
    }),
  );
}

/** Cambia el estado solo si sigue siendo `actual` (si otro request lo cambió antes, falla la condición). */
export async function cambiarEstado(id: number, actual: EstadoComision, nuevo: EstadoComision): Promise<void> {
  await db.send(
    new UpdateCommand({
      TableName: T(),
      Key: { id },
      UpdateExpression: 'SET estado = :nuevo',
      ConditionExpression: 'estado = :actual',
      ExpressionAttributeValues: { ':nuevo': nuevo, ':actual': actual },
    }),
  );
}

export async function eliminar(id: number): Promise<void> {
  await db.send(new DeleteCommand({ TableName: T(), Key: { id } }));
}
