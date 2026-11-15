import { GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Rol } from '../shared/auth';
import { config } from '../shared/config';
import { db, obtenerVarios, scanTodo } from '../shared/db';

/**
 * Tabla `usuarios` (clave: id) + tabla `usuarios-email` (clave: email → usuarioId).
 *
 * DynamoDB no tiene UNIQUE sobre columnas que no son clave. Para que el email sea único guardamos
 * un segundo ítem cuya CLAVE es el email, y lo escribimos en la misma transacción que el usuario
 * con la condición "que no exista". Además sirve para el login: buscar por email es un GetItem directo.
 */
export interface Usuario {
  id: number;
  nombre: string;
  email: string;
  passwordHash: string;
  rol: Rol;
  activo: boolean;
}

export type UsuarioPublico = Omit<Usuario, 'passwordHash'>;

const T = () => config.tablas.usuarios;
const TE = () => config.tablas.usuariosEmail;

export const publico = ({ passwordHash: _, ...u }: Usuario): UsuarioPublico => u;

export async function obtener(id: number): Promise<Usuario | undefined> {
  const r = await db.send(new GetCommand({ TableName: T(), Key: { id } }));
  return r.Item as Usuario | undefined;
}

export async function obtenerPorEmail(email: string): Promise<Usuario | undefined> {
  const r = await db.send(new GetCommand({ TableName: TE(), Key: { email } }));
  const usuarioId = r.Item?.usuarioId as number | undefined;
  return usuarioId === undefined ? undefined : obtener(usuarioId);
}

export function obtenerVariosPorId(ids: number[]): Promise<Usuario[]> {
  return obtenerVarios<Usuario>(T(), ids);
}

/** La tabla de usuarios es chica (un instituto), así que un Scan es razonable. */
export function listar(): Promise<Usuario[]> {
  return scanTodo<Usuario>({ TableName: T() });
}

/** Crea el usuario y reserva su email en una sola transacción. Falla con condición si el email ya existe. */
export async function crear(u: Usuario): Promise<void> {
  await db.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TE(),
            Item: { email: u.email, usuarioId: u.id },
            ConditionExpression: 'attribute_not_exists(email)',
          },
        },
        { Put: { TableName: T(), Item: u, ConditionExpression: 'attribute_not_exists(id)' } },
      ],
    }),
  );
}

export interface CambiosUsuario {
  nombre?: string;
  email?: string;
  passwordHash?: string;
  activo?: boolean;
}

function armarUpdate(id: number, cambios: CambiosUsuario) {
  const sets: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(cambios)) {
    if (valor === undefined) continue;
    sets.push(`#${campo} = :${campo}`);
    names[`#${campo}`] = campo;
    values[`:${campo}`] = valor;
  }
  return {
    TableName: T(),
    Key: { id },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ConditionExpression: 'attribute_exists(id)',
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

/**
 * Actualiza el usuario. Si cambia el email, en la misma transacción libera el email viejo y reserva el nuevo
 * (con condición: si otro usuario ya lo tiene, se cancela todo).
 */
export async function actualizar(actual: Usuario, cambios: CambiosUsuario): Promise<void> {
  const update = armarUpdate(actual.id, cambios);
  if (cambios.email === undefined || cambios.email === actual.email) {
    await db.send(new UpdateCommand(update));
    return;
  }
  await db.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: TE(),
            Key: { email: actual.email },
            ConditionExpression: 'usuarioId = :id',
            ExpressionAttributeValues: { ':id': actual.id },
          },
        },
        {
          Put: {
            TableName: TE(),
            Item: { email: cambios.email, usuarioId: actual.id },
            ConditionExpression: 'attribute_not_exists(email)',
          },
        },
        { Update: update },
      ],
    }),
  );
}
