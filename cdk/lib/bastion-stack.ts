import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import { LogDriver } from 'aws-cdk-lib/aws-ecs';

export interface BastionStackProps extends cdk.StackProps {
  cluster: ecs.Cluster;
  dbInstance: rds.DatabaseInstance;
  appImage: ecs.ContainerImage;
}

// SEE: https://iselegant.hatenablog.com/entry/2020/09/28/012409
export class BastionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BastionStackProps) {
    super(scope, id, props);

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
    })
    taskDef.addToTaskRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: ['*'],
      conditions: {
        StringEquals: { 'iam:PassedToService': 'ssm.amazonaws.com' }
      }
    }))
    taskDef.taskRole.addManagedPolicy({ managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonSSMFullAccess' })

    const dbCredential = props.dbInstance.secret!
    const ssmServiceRole = new iam.Role(this, 'SsmServiceRole', {
      assumedBy: new iam.ServicePrincipal('ssm.amazonaws.com'),
      managedPolicies: [
        { managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore' },
      ]
    })

    // TODO: bastion タスクに public ip を assign しないと起動しないのを改善したい
    // TODO: タスク起動時に指定する既定の security group などの各種パラメータを前もって設定できないか
    taskDef.addContainer('bastion', {
      image: props.appImage,
      command: ['amazon-ssm-agent'],
      logging: LogDriver.awsLogs({ streamPrefix: 'bastion-' }),
      environment: {
        SSM_SERVICE_ROLE: ssmServiceRole.roleName
      },
      secrets: {
        DATABASE_CREDENTIALS: ecs.Secret.fromSecretsManager(dbCredential),
      },
    })
  }
}
