import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
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

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
    })
    taskDef.addToExecutionRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: ['*'],
      conditions: {
        StringEquals: { 'iam:PassedToService': 'ssm.amazonaws.com' }
      }
    }))

    const dbCredential = props.dbInstance.secret!
    const ssmServiceRole = new iam.Role(this, 'SsmServiceRole', {
      assumedBy: new iam.ServicePrincipal('ssm.amazonaws.com')
    })

    taskDef.addContainer('bastion', {
      image: props.appImage,
      command: ['amazon-ssm-agent'],
      environment: {
        SSM_SERVICE_ROLE: ssmServiceRole.roleName
      },
      secrets: {
        DATABASE_CREDENTIALS: ecs.Secret.fromSecretsManager(dbCredential),
      },
    })
  }
}
