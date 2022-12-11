import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';

export interface ClusterStackProps extends cdk.StackProps {
  ipAddresses: string;
  maxAZs: number;
}

export class ClusterStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: ClusterStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: props.maxAZs,
      ipAddresses: ec2.IpAddresses.cidr(props.ipAddresses)
    })

    this.cluster = new ecs.Cluster(this, 'FargateCluster', {
      vpc: this.vpc
    })
  }
}
