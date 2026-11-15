import { createHmac } from 'node:crypto';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { config } from './config';

/**
 * La clave maestra de firma vive en SSM Parameter Store como SecureString (cifrada con la clave KMS
 * administrada por AWS). Es gratis, a diferencia de Secrets Manager. La crea infra/scripts/crear-clave.ts.
 *
 * De ella derivamos dos claves distintas con HMAC: una para el JWT de login y otra para los tokens del QR.
 * Así un token de login nunca sirve como QR (ni al revés).
 *
 * Se lee una vez por "contenedor" de Lambda (cold start) y queda en memoria para los siguientes requests.
 */
export interface Claves {
  jwt: string;
  qr: string;
}

let claves: Promise<Claves> | null = null;

async function cargar(): Promise<Claves> {
  const client = new SSMClient({});
  const { Parameter } = await client.send(new GetParameterCommand({ Name: config.claveParametro, WithDecryption: true }));
  const maestra = Parameter?.Value;
  if (!maestra) throw new Error('La clave de firma está vacía');
  const derivar = (uso: string) => createHmac('sha256', maestra).update(uso).digest('base64');
  return { jwt: derivar('presentismo-jwt'), qr: derivar('presentismo-qr') };
}

export function obtenerClaves(): Promise<Claves> {
  if (!claves) {
    claves = cargar();
    claves.catch(() => (claves = null)); // si falla, el próximo request reintenta
  }
  return claves;
}
