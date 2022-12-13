import * as path from 'path';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';

import { githubOwner, repoName, awsSecretsGitHubTokenName, gitDevBranch } from '../config'

export interface DevPipelineStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  dbInstance: rds.DatabaseInstance;
  repository: ecr.IRepository;
  service: ecs.FargateService;
}

export class DevPipelineStack extends cdk.Stack {
  // public readonly appRepository: ecr.Repository;
  // public readonly appBuiltImage: ecs.TagParameterContainerImage;
  // public readonly imageTag: string;

  constructor(scope: Construct, id: string, props: DevPipelineStackProps) {
    super(scope, id, {
      ...props,
      //autoDeploy: false,
    });

    // this.appRepository = new ecr.Repository(this, 'AppEcrRepo');
    // this.appBuiltImage = new ecs.TagParameterContainerImage(this.appRepository);

    const sourceOutput = new codepipeline.Artifact();
    const sourceAction = new codepipeline_actions.GitHubSourceAction({
      actionName: 'GitHub',
      owner: githubOwner,
      repo: repoName,
      oauthToken: cdk.SecretValue.secretsManager(awsSecretsGitHubTokenName),
      output: sourceOutput,
      trigger: codepipeline_actions.GitHubTrigger.POLL,
      branch: gitDevBranch
    });

    const dockerBuild = new codebuild.PipelineProject(this, 'DockerBuild', {
      environment: {
        privileged: true,
      },
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.DOCKER_LAYER),
      buildSpec: codebuild.BuildSpec.fromSourceFilename(path.join(__dirname, './buildspec_image_build.yml')),
      environmentVariables: {
        'APP_REPOSITORY_URI': {
          value: props.repository.repositoryUri,
        },
      },
    });
    props.repository.grantPullPush(dockerBuild);

    const preDeploy = new codebuild.PipelineProject(this, 'PreDeploy', {
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.DOCKER_LAYER),
      buildSpec: codebuild.BuildSpec.fromSourceFilename(path.join(__dirname, './buildspec_predeploy.yml')),
      environmentVariables: {
        APP_REPOSITORY_URI: {
          value: props.repository.repositoryUri,
        },
      },
      vpc: props.vpc
    });
    props.repository.grantPull(preDeploy)
    props.dbInstance.grantConnect(preDeploy)

    const dockerBuildOutput = new codepipeline.Artifact("DockerBuildOutput");
    const dockerBuildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'DockerBuild',
      project: dockerBuild,
      input: sourceOutput,
      outputs: [dockerBuildOutput],
    })

    new codepipeline.Pipeline(this, 'Pipeline', {
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'Build',
          actions: [dockerBuildAction]
        },
        {
          stageName: 'Deploy',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'PreDeploy',
              project: preDeploy,
              input: dockerBuildOutput,
              environmentVariables: {
                IMAGE_TAG: { value: dockerBuildAction.variable('IMAGE_TAG') }
              },
              runOrder: 1,
            }),
            new codepipeline_actions.EcsDeployAction({
              actionName: 'EcsDeploy',
              service: props.service,
              input: dockerBuildOutput,
              runOrder: 2,
            })
          ],
        },
      ],
    });
  }
}
