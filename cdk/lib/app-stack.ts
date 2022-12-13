import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Schedule } from 'aws-cdk-lib/aws-events';

export interface AppStackProps extends cdk.StackProps {
  cluster: ecs.Cluster;
  dbInstance: rds.DatabaseInstance;
  appImage: ecs.ContainerImage
}

export class AppStack extends cdk.Stack {
  // public readonly repository: ecr.IRepository
  // public readonly service: ecs.FargateService

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const dbCredential = props.dbInstance.secret!
    const albService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'AlbService', {
      cluster: props.cluster,
      taskImageOptions: {
        image: props.appImage,
        environment: {
          DATABASE_HOST: props.dbInstance.dbInstanceEndpointAddress
        },
        secrets: {
          DATABASE_USERNAME: ecs.Secret.fromSecretsManager(dbCredential, 'username'),
          DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbCredential, 'password'),
        },
      },
      cpu: 256,
      memoryLimitMiB: 512,
      // TODO:
      //   healthCheck: {
      //     interval: cdk.Duration.seconds(10),
      //     healthyThresholdCount: 3,
      //     unhealthyThresholdCount: 2,
      //     timeout: cdk.Duration.seconds(5),
      //   }
    })

    const service = albService.service
    service.connections.allowToDefaultPort(props.dbInstance)
    // props.dbInstance.connections.allowDefaultPortFrom(service)

    // Setup autoscaling
    const scaling = service.autoScaleTaskCount({ maxCapacity: 4 });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 50,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60)
    });

    scaling.scaleOnSchedule('ScheduleScalingUp', {
      minCapacity: 2,
      schedule: Schedule.expression("cron(0 0 0/2 ? * *)")
    })

    scaling.scaleOnSchedule('ScheduleScalingDown', {
      minCapacity: 1,
      schedule: Schedule.expression("cron(0 0 1/2 ? * *)")
    })

    // Add public ALB loadbalancer targetting service
    // const lb = new elbv2.ApplicationLoadBalancer(this, 'LB', {
    //   vpc: props.vpc,
    //   internetFacing: true
    // });

    // const listener = lb.addListener('HttpListener', {
    //   port: 80
    // });

    // const targetGroup = listener.addTargets('DefaultTarget', {
    //   port: 80,
    //   protocol: elbv2.ApplicationProtocol.HTTP,
    //   targets: [service],
    //   healthCheck: {
    //     interval: cdk.Duration.seconds(10),
    //     healthyThresholdCount: 3,
    //     unhealthyThresholdCount: 2,
    //     timeout: cdk.Duration.seconds(5),
    //   }
    // });
    const targetGroup = albService.targetGroup
    targetGroup.setAttribute('deregistration_delay.timeout_seconds', '10')

    // CfnOutput the DNS where you can access your service
    // new cdk.CfnOutput(this, 'LoadBalancerDNS', { value: lb.loadBalancerDnsName });
  }
}
