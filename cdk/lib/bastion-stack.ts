import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export interface BastionStackProps extends cdk.StackProps {
  cluster: ecs.Cluster;
  appImage: ecs.ContainerImage
}

export class BastionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BastionStackProps) {
    super(scope, id, props);

    const activationCode = ssm.StringParameter.fromStringParameterName(this, 'ActivationCode', 'bastion-activation-code')
    const activationId = ssm.StringParameter.fromStringParameterName(this, 'ActivationId', 'bastion-activation-id')
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64
      }
    })
    taskDef.addContainer('bastion', {
      image: props.appImage,
      secrets: {
        SSM_ACTIVATION_CODE: ecs.Secret.fromSsmParameter(activationCode),
        SSM_ACTIVATION_ID: ecs.Secret.fromSsmParameter(activationId),
      }
    })

    new ecs.FargateService(this, 'BastionService', {
      cluster: props.cluster,
      taskDefinition: taskDef,
      desiredCount: 0
    })
  }
}
