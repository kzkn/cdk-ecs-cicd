import * as path from 'path';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Schedule } from 'aws-cdk-lib/aws-events';

export interface AppStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  cluster: ecs.Cluster;
}

export class AppStack extends cdk.Stack {
  public readonly dbInstance: rds.DatabaseInstance
  public readonly repository: ecr.IRepository
  public readonly service: ecs.FargateService

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const dbCreds = new rds.DatabaseSecret(this, 'DatabaseCredentials', {
      secretName: 'rds-credentials',
      username: 'postgres',
    })
    const dbInstance = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_14_4 }),
      credentials: rds.Credentials.fromSecret(dbCreds),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO),
      vpc: props.vpc,
    })
    this.dbInstance = dbInstance

    // TODO: move to ecs-patterns
    // Create a task definition with 2 containers and CloudWatch Logs
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 512,
      cpu: 256
    });

    const asset = new ecr_assets.DockerImageAsset(this, 'AppImageAsset', {
      directory: path.join(__dirname, '../../app')
    })
    this.repository = asset.repository

    const albService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'AlbService', {
      cluster: props.cluster,
      taskImageOptions: {
        image: ecs.ContainerImage.fromDockerImageAsset(asset),
        environment: {
          DATABASE_HOST: dbInstance.dbInstanceEndpointAddress
        },
        secrets: {
          DATABASE_USERNAME: ecs.Secret.fromSecretsManager(dbCreds, 'username'),
          DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbCreds, 'password'),
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

    // Add app container
    // const appLogging = new ecs.AwsLogDriver({
    //   streamPrefix: "app"
    // });

    // const appContainer = taskDefinition.addContainer("app", {
    //   image: ecs.ContainerImage.fromDockerImageAsset(asset),
    //   logging: appLogging,
    //   environment: {
    //     DATABASE_HOST: dbInstance.dbInstanceEndpointAddress,
    //   },
    //   secrets: {
    //     DATABASE_USERNAME: ecs.Secret.fromSecretsManager(dbCreds, 'username'),
    //     DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbCreds, 'password'),
    //   }
    // });
    // appcontainer.addPortMappings({ containerPort: 80 });

    // // Instantiate Fargate Service with cluster and images
    // const service = new ecs.FargateService(this, 'Service', {
    //   cluster: props.cluster,
    //   taskDefinition
    // });
    dbInstance.connections.allowDefaultPortFrom(service)
    this.service = service

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
