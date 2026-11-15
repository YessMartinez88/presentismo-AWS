import {
  DeleteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { config } from '../shared/config';
import { contar, db, esCondicionFallida, obtenerVarios, queryTodo } from '../shared/db';

/**
 * Tabla `sesiones` (clave: id). Una sesión = una clase con QR abierto por el docente.
 * Índice `porComision` (comisionId, id) para el historial de un aula, ordenado por id.
 */
export interface Sesion {
  id: number;
  comisionId: number;
  /** Fecha de la clase (YYYY-MM-DD, hora de Argentina). */
  fecha: string;
  activa: boolean;
  creadoEn: string;
  expiraEn: string;
}

const T = () => config.tablas.sesiones;
const TC = () => config.tablas.comisiones;

/** ¿La sesión sigue aceptando asistencias? (activa y sin vencer) */
export const estaAbierta = (s: Pick<Sesion, 'activa' | 'expiraEn'>): boolean =>
  s.activa && new Date(s.expiraEn).getTime() > Date.now();

export async function obtener(id: number): Promise<Sesion | undefined> {
  const r = await db.send(new GetCommand({ TableName: T(), Key: { id } }));
  return r.Item as Sesion | undefined;
}

export function obtenerVariosPorId(ids: number[]): Promise<Sesion[]> {
  return obtenerVarios<Sesion>(T(), ids);
}

/** Historial del aula, la más reciente primero. */
export function listarPorComision(comisionId: number): Promise<Sesion[]> {
  return queryTodo<Sesion>({
    TableName: T(),
    IndexName: 'porComision',
    KeyConditionExpression: 'comisionId = :c',
    ExpressionAttributeValues: { ':c': comisionId },
    ScanIndexForward: false,
  });
}

export function contarPorComision(comisionId: number): Promise<number> {
  return contar({
    TableName: T(),
    IndexName: 'porComision',
    KeyConditionExpression: 'comisionId = :c',
    ExpressionAttributeValues: { ':c': comisionId },
  });
}

export async function tieneSesiones(comisionId: number): Promise<boolean> {
  const r = await db.send(
    new QueryCommand({
      TableName: T(),
      IndexName: 'porComision',
      KeyConditionExpression: 'comisionId = :c',
      ExpressionAttributeValues: { ':c': comisionId },
      Limit: 1,
    }),
  );
  return (r.Items?.length ?? 0) > 0;
}

/**
 * Crea la sesión y la marca como "la activa" de la comisión, todo en UNA transacción.
 * La condición sobre la comisión es la que evita dos sesiones abiertas a la vez: si dos docentes
 * (o dos pestañas) abren al mismo tiempo, una transacción gana y la otra se cancela.
 * Si había una sesión anterior ya vencida, se desactiva en la misma transacción.
 */
export async function abrir(sesion: Sesion, docenteId: number, anteriorId?: number): Promise<void> {
  const items: NonNullable<TransactWriteCommandInput['TransactItems']> = [
    {
      Update: {
        TableName: TC(),
        Key: { id: sesion.comisionId },
        UpdateExpression: 'SET sesionActivaId = :nueva',
        ConditionExpression:
          anteriorId === undefined
            ? 'estado = :activa AND docenteId = :doc AND attribute_not_exists(sesionActivaId)'
            : 'estado = :activa AND docenteId = :doc AND sesionActivaId = :anterior',
        ExpressionAttributeValues: {
          ':nueva': sesion.id,
          ':activa': 'ACTIVA',
          ':doc': docenteId,
          ...(anteriorId === undefined ? {} : { ':anterior': anteriorId }),
        },
      },
    },
    { Put: { TableName: T(), Item: sesion, ConditionExpression: 'attribute_not_exists(id)' } },
  ];
  if (anteriorId !== undefined) {
    items.push({
      Update: {
        TableName: T(),
        Key: { id: anteriorId },
        UpdateExpression: 'SET activa = :f',
        ExpressionAttributeValues: { ':f': false },
      },
    });
  }
  await db.send(new TransactWriteCommand({ TransactItems: items }));
}

/** Si la comisión todavía apunta a esta sesión como activa, deja de apuntarla. */
async function liberarDeComision(sesion: Sesion): Promise<void> {
  try {
    await db.send(
      new UpdateCommand({
        TableName: TC(),
        Key: { id: sesion.comisionId },
        UpdateExpression: 'REMOVE sesionActivaId',
        ConditionExpression: 'sesionActivaId = :id',
        ExpressionAttributeValues: { ':id': sesion.id },
      }),
    );
  } catch (err) {
    if (!esCondicionFallida(err)) throw err; // ya apuntaba a otra (o a ninguna): nada que hacer
  }
}

export async function cerrar(sesion: Sesion): Promise<void> {
  await db.send(
    new UpdateCommand({
      TableName: T(),
      Key: { id: sesion.id },
      UpdateExpression: 'SET activa = :f',
      ExpressionAttributeValues: { ':f': false },
    }),
  );
  await liberarDeComision(sesion);
}

/** Borra la sesión (las asistencias las borra el servicio antes, con asistencias.repository). */
export async function eliminar(sesion: Sesion): Promise<void> {
  await db.send(new DeleteCommand({ TableName: T(), Key: { id: sesion.id } }));
  await liberarDeComision(sesion);
}
