import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import path = require('path');
import { Schedule } from 'aws-cdk-lib/aws-events';

export interface AppStackProps extends cdk.StackProps {
    vpc: ec2.Vpc;
    cluster: ecs.Cluster;
    appImage?: ecs.ContainerImage;
    nginxImage?: ecs.ContainerImage;
}

export class AppStack extends cdk.Stack {

    constructor(scope: Construct, id: string, props: AppStackProps) {
        super(scope, id, props);

        // Create a task definition with 2 containers and CloudWatch Logs
        const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
            memoryLimitMiB: 512,            
            cpu: 256
        });
        
        // Add app container
        const appLogging = new ecs.AwsLogDriver({
            streamPrefix: "app"
        });

        const appImage = props.appImage || new ecs.AssetImage(path.join(__dirname, '../..', 'app'));

 
        const appContainer = taskDefinition.addContainer("app", {
            image: appImage,
            logging: appLogging
        });
        appContainer.addPortMappings({ containerPort: 3000 });

        // Add nginx container 
        const nginxLogging = new ecs.AwsLogDriver({
            streamPrefix: "nginx",
        });
        const nginxImage = props.nginxImage || new ecs.AssetImage(path.join(__dirname, '../..', 'nginx'));
        const nginxContainer = taskDefinition.addContainer("nginx", {
            image: nginxImage,
            logging: nginxLogging
        });
        nginxContainer.addPortMappings({ containerPort: 80 });

        // Instantiate Fargate Service with cluster and images
        const service = new ecs.FargateService(this, 'Service', {
            cluster: props.cluster,
            taskDefinition
        });

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
        const lb = new elbv2.ApplicationLoadBalancer(this, 'LB', {
            vpc: props.vpc,
            internetFacing: true
        });

        const listener = lb.addListener('HttpListener', {
            port: 80
        });

        const targetGroup = listener.addTargets('DefaultTarget', {
            port: 80,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targets: [service],
            healthCheck: {
                interval: cdk.Duration.seconds(10),
                healthyThresholdCount: 3,
                unhealthyThresholdCount: 2,
                timeout: cdk.Duration.seconds(5),
            }
        });
        targetGroup.setAttribute('deregistration_delay.timeout_seconds', '10')

        // CfnOutput the DNS where you can access your service
        new cdk.CfnOutput(this, 'LoadBalancerDNS', { value: lb.loadBalancerDnsName });
    }
}
