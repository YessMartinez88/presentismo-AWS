import * as cdk from 'aws-cdk-lib';
import { PresentismoStack } from '../lib/presentismo-stack';

const app = new cdk.App();

new PresentismoStack(app, 'PresentismoStack', {
  // Cuenta y región salen de tu perfil de AWS CLI (aws configure).
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  description: 'Presentismo por QR: Amplify Hosting + API Gateway (HTTP API) + Lambda + DynamoDB',
});

cdk.Tags.of(app).add('proyecto', 'presentismo');
