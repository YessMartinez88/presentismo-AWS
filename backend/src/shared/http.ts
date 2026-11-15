import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { HttpError } from './errors';
import { autenticar, type AuthUser, type Rol } from './auth';

/**
 * Mini-router para Lambdas detrás de un HTTP API de API Gateway.
 *
 * API Gateway ya resolvió la ruta y nos manda `event.routeKey` (por ejemplo "GET /api/comisiones/{id}"),
 * así que cada Lambda solo necesita un mapa routeKey → función. No hace falta Express.
 */
export interface Req {
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body: Record<string, unknown>;
  /** Solo presente en rutas que piden autenticación. */
  user: AuthUser;
}

export interface Res {
  status?: number;
  body?: unknown;
}

type Handler = (req: Req) => Promise<Res>;

interface Ruta {
  handler: Handler;
  /** undefined = ruta pública; [] = cualquier usuario logueado; [...] = solo esos roles. */
  roles?: Rol[];
}

export type Rutas = Record<string, Ruta>;

export const publica = (handler: Handler): Ruta => ({ handler });
export const privada = (roles: Rol[], handler: Handler): Ruta => ({ handler, roles });

function respuesta(status: number, body?: unknown): APIGatewayProxyResultV2 {
  if (body === undefined) return { statusCode: status };
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function leerBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (raw.length > 100_000) throw new HttpError(413, 'PETICION_INVALIDA', 'La petición es demasiado grande.');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // cae al error de abajo
  }
  throw new HttpError(400, 'PETICION_INVALIDA', 'La petición no es válida.');
}

/** Arma el handler de una Lambda a partir de sus rutas, con autenticación y manejo central de errores. */
export function crearHandler(rutas: Rutas) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    try {
      const ruta = rutas[event.routeKey];
      if (!ruta) throw new HttpError(404, 'RUTA_INEXISTENTE', 'Ruta inexistente.');

      const req: Req = {
        params: event.pathParameters ?? {},
        query: event.queryStringParameters ?? {},
        body: leerBody(event),
        user: undefined as unknown as AuthUser,
      };

      if (ruta.roles) {
        req.user = await autenticar(event.headers.authorization);
        if (ruta.roles.length > 0 && !ruta.roles.includes(req.user.rol)) {
          throw new HttpError(403, 'SIN_PERMISO', 'No tenés permiso para esta acción.');
        }
      }

      const res = await ruta.handler(req);
      return respuesta(res.status ?? 200, res.body);
    } catch (err) {
      if (err instanceof HttpError) return respuesta(err.status, { code: err.code, message: err.message });
      console.error(err);
      return respuesta(500, { code: 'ERROR_INTERNO', message: 'Ocurrió un error inesperado.' });
    }
  };
}
