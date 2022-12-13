#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ClusterStack } from '../lib/cluster-stack';
import { AppStack } from '../lib/app-stack';
import { DatabaseStack } from '../lib/database-stack';
import { DevPipelineStack } from '../lib/dev-pipeline-stack';
import { StagingProdPipelineStack } from '../lib/staging-prod-pipeline-stack';

const app = new cdk.App();

// Cluster Stacks - maxAZs of 3 is best practice, but make sure you have no EIP limitations (5 is default)
const devClusterStack = new ClusterStack(app, 'DevCluster', {
  ipAddresses: '10.1.0.0/20',
  maxAZs: 2
});
cdk.Tags.of(devClusterStack).add('environment', 'dev');

// const prodClusterStack = new ClusterStack(app, 'ProdCluster', {
//   ipAddresses: '10.3.0.0/20',
//   maxAZs: 2
// });
// cdk.Tags.of(prodClusterStack).add('environment', 'prod');

// DevDatabaseStack
const devDatabaseStack = new DatabaseStack(app, 'DevDatabaseStack', {
  vpc: devClusterStack.vpc,
});
cdk.Tags.of(devDatabaseStack).add('environment', 'dev');

// CodePipeline stacks
const devPipelineStack = new DevPipelineStack(app, 'DevPipelineStack', {
  vpc: devClusterStack.vpc,
  dbInstance: devDatabaseStack.dbInstance,
});
cdk.Tags.of(devPipelineStack).add('environment', 'dev');

// DevAppStack
const devAppStack = new AppStack(app, 'DevAppStack', {
  dbInstance: devDatabaseStack.dbInstance,
  cluster: devClusterStack.cluster,
  appImage: devPipelineStack.appBuiltImage
});
cdk.Tags.of(devAppStack).add('environment', 'dev');


// const stagingProdPipelineStack = new StagingProdPipelineStack(app, 'StagingProdPipelineStack', {
//     appRepository: devPipelineStack.appRepository,
//     nginxRepository: devPipelineStack.nginxRepository,
//     imageTag: devPipelineStack.imageTag
// });
// cdk.Tags.of(stagingProdPipelineStack).add('environment', 'prod');

// StagingAppStack
// const stagingAppStack = new AppStack(app, 'StagingAppStack', {
//     vpc: prodClusterStack.vpc,
//     cluster: prodClusterStack.cluster,
//     //autoDeploy: false,
//     appImage: stagingProdPipelineStack.appBuiltImageStaging,
//     nginxImage: stagingProdPipelineStack.nginxBuiltImageStaging,
// });
// cdk.Tags.of(stagingAppStack).add('environment', 'staging');

// ProdAppStack
// const prodAppStack = new AppStack(app, 'ProdAppStack', {
//     vpc: prodClusterStack.vpc,
//     cluster: prodClusterStack.cluster,
//     //autoDeploy: false,
//     appImage: stagingProdPipelineStack.appBuiltImageProd,
//     nginxImage: stagingProdPipelineStack.nginxBuiltImageProd,
// });
// cdk.Tags.of(prodAppStack).add('environment', 'prod');
