/**
 * Crea (una sola vez) la clave maestra de firma en SSM Parameter Store como SecureString.
 *
 * CloudFormation/CDK no puede crear parámetros SecureString, por eso es un script aparte que corre
 * antes del deploy. Si el parámetro ya existe no lo toca (cambiarlo invalidaría todas las sesiones).
 * El valor se genera acá y nunca se imprime.
 */
import { randomBytes } from 'node:crypto';
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { CLAVE_PARAMETRO } from '../lib/constantes';

async function main() {
  const ssm = new SSMClient({});
  try {
    await ssm.send(new GetParameterCommand({ Name: CLAVE_PARAMETRO }));
    console.log(`✔ La clave de firma ${CLAVE_PARAMETRO} ya existe (no se modifica).`);
    return;
  } catch (err) {
    if ((err as { name?: string }).name !== 'ParameterNotFound') throw err;
  }
  await ssm.send(
    new PutParameterCommand({
      Name: CLAVE_PARAMETRO,
      Type: 'SecureString', // cifrado con la clave KMS administrada por AWS (aws/ssm): gratis
      Tier: 'Standard', // los parámetros estándar no tienen costo
      Value: randomBytes(48).toString('base64'),
      Description: 'Clave maestra para firmar los JWT de login y los tokens del QR (presentismo)',
    }),
  );
  console.log(`✔ Clave de firma creada en ${CLAVE_PARAMETRO}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
