import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  BatchWriteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  type BatchWriteCommandOutput,
  type QueryCommandInput,
  type ScanCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { config } from './config';

/** Cliente "Document": convierte solo entre objetos JS y el formato de atributos de DynamoDB. */
export const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

type Item = Record<string, unknown>;

/** Query que sigue la paginación de DynamoDB (1 MB por página) hasta traer todo. */
export async function queryTodo<T = Item>(input: QueryCommandInput): Promise<T[]> {
  const items: T[] = [];
  let ExclusiveStartKey: Item | undefined;
  do {
    const r = await db.send(new QueryCommand({ ...input, ExclusiveStartKey }));
    items.push(...((r.Items ?? []) as T[]));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/** Cantidad de ítems de una Query, sin traerlos (Select: COUNT). */
export async function contar(input: QueryCommandInput): Promise<number> {
  let total = 0;
  let ExclusiveStartKey: Item | undefined;
  do {
    const r = await db.send(new QueryCommand({ ...input, Select: 'COUNT', ExclusiveStartKey }));
    total += r.Count ?? 0;
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return total;
}

/** Scan completo. Solo para tablas chicas (usuarios, comisiones): recorre toda la tabla. */
export async function scanTodo<T = Item>(input: ScanCommandInput): Promise<T[]> {
  const items: T[] = [];
  let ExclusiveStartKey: Item | undefined;
  do {
    const r = await db.send(new ScanCommand({ ...input, ExclusiveStartKey }));
    items.push(...((r.Items ?? []) as T[]));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/** BatchGet por clave `id` (de a 100, reintentando las claves que DynamoDB devuelve sin procesar). */
export async function obtenerVarios<T = Item>(tabla: string, ids: number[]): Promise<T[]> {
  const unicos = [...new Set(ids)];
  const items: T[] = [];
  for (let i = 0; i < unicos.length; i += 100) {
    let pendientes: Item[] | undefined = unicos.slice(i, i + 100).map((id) => ({ id }));
    while (pendientes && pendientes.length > 0) {
      const r = await db.send(new BatchGetCommand({ RequestItems: { [tabla]: { Keys: pendientes } } }));
      items.push(...((r.Responses?.[tabla] ?? []) as T[]));
      pendientes = r.UnprocessedKeys?.[tabla]?.Keys as Item[] | undefined;
    }
  }
  return items;
}

/** BatchWrite (puts o deletes) de a 25, reintentando lo que DynamoDB devuelve sin procesar. */
export async function escribirVarios(
  tabla: string,
  operaciones: Array<{ PutRequest: { Item: Item } } | { DeleteRequest: { Key: Item } }>,
): Promise<void> {
  for (let i = 0; i < operaciones.length; i += 25) {
    let pendientes: unknown[] | undefined = operaciones.slice(i, i + 25);
    for (let intento = 0; pendientes && pendientes.length > 0; intento++) {
      if (intento > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** Math.min(intento, 6)));
      const r: BatchWriteCommandOutput = await db.send(
        new BatchWriteCommand({ RequestItems: { [tabla]: pendientes as never } }),
      );
      pendientes = r.UnprocessedItems?.[tabla];
    }
  }
}

/**
 * DynamoDB no tiene IDENTITY/autoincremental. Usamos una tabla "contadores" con un ítem por entidad
 * y le sumamos 1 de forma atómica (ADD): dos requests simultáneos nunca reciben el mismo id.
 * Mantener ids numéricos nos deja URLs cortas (/sesion/12) y el frontend no cambia.
 */
export async function siguienteId(entidad: 'usuarios' | 'comisiones' | 'sesiones'): Promise<number> {
  const r = await db.send(
    new UpdateCommand({
      TableName: config.tablas.contadores,
      Key: { nombre: entidad },
      UpdateExpression: 'ADD valor :uno',
      ExpressionAttributeValues: { ':uno': 1 },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  return r.Attributes!.valor as number;
}

/** ¿Falló una condición (ConditionExpression) o una transacción por una condición? */
export function esCondicionFallida(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  if (name === 'ConditionalCheckFailedException') return true;
  if (name === 'TransactionCanceledException') {
    const razones = (err as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons ?? [];
    return razones.some((r) => r.Code === 'ConditionalCheckFailed');
  }
  return false;
}
