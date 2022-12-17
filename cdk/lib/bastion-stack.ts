import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface BastionStackProps extends cdk.StackProps {
  cluster: ecs.Cluster;
  dbInstance: rds.DatabaseInstance;
  appImage: ecs.ContainerImage;
}

export class BastionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BastionStackProps) {
    super(scope, id, props);

    const dbCredential = props.dbInstance.secret!
    const activationCode = ssm.StringParameter.fromStringParameterName(this, 'ActivationCode', 'bastion-activation-code')
    const activationId = ssm.StringParameter.fromStringParameterName(this, 'ActivationId', 'bastion-activation-id')

    // const taskRole = new iam.Role(this, 'TaskRole', {
    //   assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    //   inlinePolicies: {
    //     'PassRole': new iam.PolicyDocument({
    //       statements: [
    //         new iam.PolicyStatement({
    //           actions: ['iam:PassRole'],
    //           resources: ['*'],
    //           conditions: {
    //             StringEquals: { "iam:PassedToService": "ssm.amazonaws.com" }
    //           }
    //         })
    //       ],
    //     })
    //   }
    // })
    // const executionRole = new iam.Role(this, 'ExecRole', {
    //   assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    //   inlinePolicies: {
    //     'AssumeRole': new iam.PolicyDocument({
    //       statements: [
    //         new iam.PolicyStatement({
    //           actions: ['sts:AssumeRole'],
    //           resources: ['*'],
    //           principals: [new iam.ServicePrincipal('ssm.amazonaws.com')]
    //         })
    //       ]
    //     })
    //   }
    // })

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      // taskRole,
      // executionRole
    })

    taskDef.addContainer('bastion', {
      image: props.appImage,
      command: ['sleep', '3600'],
      secrets: {
        SSM_ACTIVATION_CODE: ecs.Secret.fromSsmParameter(activationCode),
        SSM_ACTIVATION_ID: ecs.Secret.fromSsmParameter(activationId),
        DATABASE_CREDENTIALS: ecs.Secret.fromSecretsManager(dbCredential),
      },
    })
  }
}
