import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as rds from 'aws-cdk-lib/aws-rds';

export interface AppStackProps extends cdk.StackProps {
  cluster: ecs.Cluster;
  dbInstance: rds.DatabaseInstance;
  appImage: ecs.ContainerImage
  workerImage: ecs.ContainerImage
}

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const dbCredential = props.dbInstance.secret!
    const albService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'AlbService', {
      cluster: props.cluster,
      taskImageOptions: {
        image: props.appImage,
        secrets: {
          DATABASE_CREDENTIALS: ecs.Secret.fromSecretsManager(dbCredential),
        },
      },
      cpu: 256,
      memoryLimitMiB: 512,
    })

    const service = albService.service
    service.connections.allowToDefaultPort(props.dbInstance)

    const scaling = service.autoScaleTaskCount({ maxCapacity: 4 });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 50,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60)
    });

    const targetGroup = albService.targetGroup
    targetGroup.setAttribute('deregistration_delay.timeout_seconds', '10')

    const workerTaskDef = new ecs.FargateTaskDefinition(this, 'WorkerTaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
    })
    workerTaskDef.addContainer('worker', {
      image: props.workerImage,
      command: ["bin/delayed_job", "run"],
      logging: ecs.LogDriver.awsLogs({ streamPrefix: 'worker-' }),
      secrets: {
        DATABASE_CREDENTIALS: ecs.Secret.fromSecretsManager(dbCredential),
      },
    })
    const workerService = new ecs.FargateService(this, 'Worker', {
      cluster: props.cluster,
      taskDefinition: workerTaskDef,
    })
    workerService.connections.allowToDefaultPort(props.dbInstance)
  }
}
