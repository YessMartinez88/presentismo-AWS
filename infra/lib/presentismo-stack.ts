import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { CLAVE_PARAMETRO } from './constantes';

const BACKEND_DIR = path.join(__dirname, '..', '..', 'backend');

/**
 * Todo el sistema en un stack:
 *
 *   Navegador ──► Amplify Hosting (Angular)
 *       │
 *       └──────► API Gateway (HTTP API) ──► 5 Lambdas (una por módulo) ──► DynamoDB (7 tablas)
 *                                                    └──► SSM Parameter Store (clave de firma JWT/QR)
 */
export class PresentismoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Proyecto de estudio: al borrar el stack se borran también los datos. En producción sería RETAIN.
    const removalPolicy = cdk.RemovalPolicy.DESTROY;

    // ─────────────────────────── DynamoDB ───────────────────────────
    // Modo PROVISIONADO a propósito: el tier gratuito permanente de DynamoDB cubre 25 GB y
    // 25 RCU + 25 WCU provisionadas EN TOTAL por cuenta (sumando tablas e índices). El modo on-demand
    // NO entra en ese tier. Las capacidades de abajo suman 17 RCU y 13 WCU: alcanzan para una demo de
    // aula (y DynamoDB acumula "burst" de hasta 5 min de capacidad sin usar para picos cortos).
    // Ojo: si creás otras tablas provisionadas en la cuenta, el total no puede pasar de 25.
    interface Capacidad {
      lectura: number;
      escritura: number;
    }
    const nuevaTabla = (
      nombre: string,
      pk: string,
      sk: string | undefined,
      cap: Capacidad,
      indices: Array<{ nombre: string; pk: string; sk?: string } & Capacidad> = [],
    ) => {
      const tabla = new dynamodb.Table(this, nombre, {
        partitionKey: { name: pk, type: pk === 'email' || pk === 'nombre' ? dynamodb.AttributeType.STRING : dynamodb.AttributeType.NUMBER },
        sortKey: sk ? { name: sk, type: dynamodb.AttributeType.NUMBER } : undefined,
        billingMode: dynamodb.BillingMode.PROVISIONED,
        readCapacity: cap.lectura,
        writeCapacity: cap.escritura,
        removalPolicy,
      });
      for (const i of indices) {
        tabla.addGlobalSecondaryIndex({
          indexName: i.nombre,
          partitionKey: { name: i.pk, type: dynamodb.AttributeType.NUMBER },
          sortKey: i.sk ? { name: i.sk, type: dynamodb.AttributeType.NUMBER } : undefined,
          readCapacity: i.lectura,
          writeCapacity: i.escritura,
        });
      }
      return tabla;
    };

    const tablas = {
      // Usuarios se lee en CADA request (validación del login), por eso tiene más lectura.
      usuarios: nuevaTabla('Usuarios', 'id', undefined, { lectura: 3, escritura: 1 }),
      usuariosEmail: nuevaTabla('UsuariosEmail', 'email', undefined, { lectura: 1, escritura: 1 }),
      comisiones: nuevaTabla('Comisiones', 'id', undefined, { lectura: 2, escritura: 1 }, [
        { nombre: 'porDocente', pk: 'docenteId', sk: 'id', lectura: 1, escritura: 1 },
      ]),
      inscripciones: nuevaTabla('Inscripciones', 'comisionId', 'alumnoId', { lectura: 2, escritura: 1 }, [
        { nombre: 'porAlumno', pk: 'alumnoId', sk: 'comisionId', lectura: 1, escritura: 1 },
      ]),
      sesiones: nuevaTabla('Sesiones', 'id', undefined, { lectura: 2, escritura: 1 }, [
        { nombre: 'porComision', pk: 'comisionId', sk: 'id', lectura: 1, escritura: 1 },
      ]),
      // Al abrir una sesión se escriben todos los inscriptos de golpe: más escritura.
      asistencias: nuevaTabla('Asistencias', 'sesionId', 'alumnoId', { lectura: 2, escritura: 2 }, [
        { nombre: 'porAlumno', pk: 'alumnoId', sk: 'sesionId', lectura: 1, escritura: 2 },
      ]),
      contadores: nuevaTabla('Contadores', 'nombre', undefined, { lectura: 1, escritura: 1 }),
    };

    // ─────────────────────────── Clave de firma ───────────────────────────
    // SecureString de SSM Parameter Store (gratis). La crea scripts/crear-clave.ts antes del deploy,
    // porque CloudFormation no puede crear parámetros SecureString.
    const parametroClaveArn = this.formatArn({
      service: 'ssm',
      resource: 'parameter',
      resourceName: CLAVE_PARAMETRO.slice(1), // el ARN no lleva la "/" inicial
    });
    const leerClave = new iam.PolicyStatement({ actions: ['ssm:GetParameter'], resources: [parametroClaveArn] });

    // ─────────────────────────── Amplify Hosting (frontend) ───────────────────────────
    // App sin repositorio conectado: el build se sube desde la PC (infra/scripts/deploy-frontend.ts).
    const frontend = new amplify.CfnApp(this, 'Frontend', {
      name: 'presentismo',
      platform: 'WEB',
      // SPA: toda ruta que no sea un archivo estático devuelve index.html (lo resuelve el router de Angular).
      customRules: [
        {
          source: '</^[^.]+$|\\.(?!(css|gif|ico|jpg|jpeg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|webmanifest)$)([^.]+$)/>',
          target: '/index.html',
          status: '200',
        },
      ],
    });
    const rama = new amplify.CfnBranch(this, 'FrontendMain', {
      appId: frontend.attrAppId,
      branchName: 'main',
      stage: 'PRODUCTION',
    });
    const frontendUrl = `https://${rama.branchName}.${frontend.attrDefaultDomain}`;

    // ─────────────────────────── API Gateway (HTTP API) ───────────────────────────
    const api = new apigw.HttpApi(this, 'Api', {
      apiName: 'presentismo-api',
      corsPreflight: {
        allowOrigins: [frontendUrl, 'http://localhost:4200'],
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.PATCH,
          apigw.CorsHttpMethod.DELETE,
          apigw.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: cdk.Duration.hours(1),
      },
    });
    // Límite de requests por segundo: protege la cuenta (y la factura) ante abuso.
    const stage = api.defaultStage!.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 50, throttlingBurstLimit: 100 };

    // ─────────────────────────── Lambdas (una por módulo) ───────────────────────────
    const entorno: Record<string, string> = {
      CLAVE_PARAMETRO,
      APP_TIMEZONE: 'America/Argentina/Buenos_Aires',
      QR_TOKEN_TTL_SECONDS: '40',
      QR_REFRESH_SECONDS: '20',
      SESSION_DEFAULT_MINUTES: '10',
      NODE_OPTIONS: '--enable-source-maps',
      TABLA_USUARIOS: tablas.usuarios.tableName,
      TABLA_USUARIOS_EMAIL: tablas.usuariosEmail.tableName,
      TABLA_COMISIONES: tablas.comisiones.tableName,
      TABLA_INSCRIPCIONES: tablas.inscripciones.tableName,
      TABLA_SESIONES: tablas.sesiones.tableName,
      TABLA_ASISTENCIAS: tablas.asistencias.tableName,
      TABLA_CONTADORES: tablas.contadores.tableName,
    };

    type NombreTabla = keyof typeof tablas;
    interface Modulo {
      rutas: string[];
      /** Mínimo privilegio: cada Lambda solo puede tocar las tablas que usa. */
      lectura: NombreTabla[];
      escritura: NombreTabla[];
    }

    const modulos: Record<string, Modulo> = {
      auth: {
        rutas: ['POST /api/auth/login', 'GET /api/auth/me'],
        lectura: ['usuarios', 'usuariosEmail'],
        escritura: [],
      },
      usuarios: {
        rutas: ['GET /api/usuarios', 'POST /api/usuarios', 'PATCH /api/usuarios/{id}'],
        lectura: [],
        escritura: ['usuarios', 'usuariosEmail', 'contadores'],
      },
      comisiones: {
        rutas: [
          'GET /api/comisiones',
          'POST /api/comisiones',
          'PATCH /api/comisiones/{id}',
          'DELETE /api/comisiones/{id}',
          'PATCH /api/comisiones/{id}/estado',
          'GET /api/comisiones/{id}/sesiones',
          'GET /api/comisiones/{id}/inscripciones',
          'POST /api/comisiones/{id}/inscripciones',
          'DELETE /api/comisiones/{id}/inscripciones/{alumnoId}',
        ],
        lectura: ['usuarios', 'sesiones', 'asistencias'],
        escritura: ['comisiones', 'inscripciones', 'contadores'],
      },
      sesiones: {
        rutas: [
          'POST /api/sesiones/abrir-qr',
          'GET /api/sesiones/{id}',
          'GET /api/sesiones/{id}/qr',
          'POST /api/sesiones/{id}/cerrar',
          'DELETE /api/sesiones/{id}',
        ],
        lectura: ['usuarios', 'inscripciones'],
        escritura: ['sesiones', 'comisiones', 'asistencias', 'contadores'],
      },
      asistencia: {
        rutas: ['POST /api/asistencia/registrar-qr', 'GET /api/asistencia/alumno/me'],
        lectura: ['usuarios', 'sesiones', 'comisiones', 'inscripciones'],
        escritura: ['asistencias'],
      },
    };

    for (const [nombre, modulo] of Object.entries(modulos)) {
      const fn = new NodejsFunction(this, `Lambda-${nombre}`, {
        functionName: `presentismo-${nombre}`,
        entry: path.join(BACKEND_DIR, 'src', 'modules', nombre, 'handler.ts'),
        handler: 'handler',
        projectRoot: BACKEND_DIR,
        depsLockFilePath: path.join(BACKEND_DIR, 'package-lock.json'),
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64, // Graviton: ~20% más barato que x86
        memorySize: 512, // bcrypt es CPU intensivo; en Lambda más memoria = más CPU
        timeout: cdk.Duration.seconds(10),
        environment: entorno,
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'node22',
          externalModules: ['@aws-sdk/*'], // ya viene incluido en el runtime de Lambda
        },
        logGroup: new logs.LogGroup(this, `Logs-${nombre}`, {
          logGroupName: `/aws/lambda/presentismo-${nombre}`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy,
        }),
      });

      fn.addToRolePolicy(leerClave);
      for (const t of modulo.lectura) tablas[t].grantReadData(fn);
      for (const t of modulo.escritura) tablas[t].grantReadWriteData(fn);

      const integracion = new HttpLambdaIntegration(`Integracion-${nombre}`, fn);
      for (const ruta of modulo.rutas) {
        const [metodo, ruta_] = ruta.split(' ') as [keyof typeof apigw.HttpMethod, string];
        api.addRoutes({ path: ruta_, methods: [apigw.HttpMethod[metodo]], integration: integracion });
      }
    }

    // ─────────────────────────── Salidas ───────────────────────────
    // Se guardan en infra/cdk-outputs.json y las usan el seed y el deploy del frontend.
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new cdk.CfnOutput(this, 'FrontendUrl', { value: frontendUrl });
    new cdk.CfnOutput(this, 'AmplifyAppId', { value: frontend.attrAppId });
    new cdk.CfnOutput(this, 'AmplifyBranch', { value: rama.branchName });
    new cdk.CfnOutput(this, 'Region', { value: this.region });
    new cdk.CfnOutput(this, 'TablaUsuarios', { value: tablas.usuarios.tableName });
    new cdk.CfnOutput(this, 'TablaUsuariosEmail', { value: tablas.usuariosEmail.tableName });
    new cdk.CfnOutput(this, 'TablaComisiones', { value: tablas.comisiones.tableName });
    new cdk.CfnOutput(this, 'TablaInscripciones', { value: tablas.inscripciones.tableName });
    new cdk.CfnOutput(this, 'TablaSesiones', { value: tablas.sesiones.tableName });
    new cdk.CfnOutput(this, 'TablaAsistencias', { value: tablas.asistencias.tableName });
    new cdk.CfnOutput(this, 'TablaContadores', { value: tablas.contadores.tableName });
  }
}
