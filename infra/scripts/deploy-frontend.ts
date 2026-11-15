/**
 * Compila el Angular y lo sube a Amplify Hosting (deploy manual, sin repositorio conectado).
 *
 *   cd infra && npm run deploy:frontend
 *
 * Pasos: ng build → escribe config.js con la URL de la API → zip → Amplify CreateDeployment →
 * sube el zip a la URL firmada → StartDeployment → espera a que termine.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { AmplifyClient, CreateDeploymentCommand, GetJobCommand, StartDeploymentCommand } from '@aws-sdk/client-amplify';
import AdmZip from 'adm-zip';

const infraDir = path.join(__dirname, '..');
const frontendDir = path.join(infraDir, '..', 'frontend');
const distDir = path.join(frontendDir, 'dist', 'frontend', 'browser');

const outputs = Object.values(
  JSON.parse(readFileSync(path.join(infraDir, 'cdk-outputs.json'), 'utf8')) as Record<string, Record<string, string>>,
)[0]!;
const { ApiUrl, AmplifyAppId, AmplifyBranch, FrontendUrl, Region } = outputs;
if (!ApiUrl || !AmplifyAppId || !AmplifyBranch) throw new Error('cdk-outputs.json incompleto: corré "npm run deploy" primero.');

async function main() {
  console.log('▶ Compilando el frontend (ng build)...');
  execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });

  // La URL de la API se inyecta en tiempo de deploy: el mismo build sirve para cualquier entorno.
  writeFileSync(path.join(distDir, 'config.js'), `window.__API_URL__ = ${JSON.stringify(ApiUrl)};\n`);

  const zip = new AdmZip();
  zip.addLocalFolder(distDir);
  const cuerpo = zip.toBuffer();
  console.log(`▶ Zip listo (${(cuerpo.length / 1024).toFixed(0)} KB). Subiendo a Amplify...`);

  const amplify = new AmplifyClient({ region: Region });
  const { jobId, zipUploadUrl } = await amplify.send(
    new CreateDeploymentCommand({ appId: AmplifyAppId, branchName: AmplifyBranch }),
  );
  const subida = await fetch(zipUploadUrl!, { method: 'PUT', body: cuerpo, headers: { 'Content-Type': 'application/zip' } });
  if (!subida.ok) throw new Error(`Falló la subida del zip: ${subida.status} ${await subida.text()}`);
  await amplify.send(new StartDeploymentCommand({ appId: AmplifyAppId, branchName: AmplifyBranch, jobId }));

  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const { job } = await amplify.send(new GetJobCommand({ appId: AmplifyAppId, branchName: AmplifyBranch, jobId }));
    const estado = job?.summary?.status;
    process.stdout.write(`  estado: ${estado}\n`);
    if (estado === 'SUCCEED') break;
    if (estado === 'FAILED' || estado === 'CANCELLED') throw new Error(`El deploy de Amplify terminó en ${estado}`);
  }
  console.log(`\n✔ Frontend publicado en ${FrontendUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
