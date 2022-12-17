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
}

export class DevPipelineStack extends cdk.Stack {
  public readonly appBuiltImage: ecs.TagParameterContainerImage;

  constructor(scope: Construct, id: string, props: DevPipelineStackProps) {
    super(scope, id, props)

    const appRepository = new ecr.Repository(this, 'AppEcrRepo');
    this.appBuiltImage = new ecs.TagParameterContainerImage(appRepository);

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
      buildSpec: codebuild.BuildSpec.fromSourceFilename('./cdk/lib/buildspec_image_build.yml'),
      environmentVariables: {
        'APP_REPOSITORY_URI': {
          value: appRepository.repositoryUri,
        },
      },
    });
    appRepository.grantPullPush(dockerBuild);

    const cdkBuild = new codebuild.PipelineProject(this, 'CdkBuild', {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_6_0
      },
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.CUSTOM),
      buildSpec: codebuild.BuildSpec.fromSourceFilename('./cdk/lib/buildspec_cdk_build.yml'),
    })
    cdkBuild.addToRolePolicy(new iam.PolicyStatement(
      {
        effect: iam.Effect.ALLOW,
        actions: ['ec2:DescribeAvailabilityZones'],
        resources: ['*']
      }))

    const dbCredential = props.dbInstance.secret!
    const preDeploy = new codebuild.PipelineProject(this, 'PreDeploy', {
      environment: {
        privileged: true,
      },
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.DOCKER_LAYER),
      buildSpec: codebuild.BuildSpec.fromSourceFilename('./cdk/lib/buildspec_predeploy.yml'),
      environmentVariables: {
        APP_REPOSITORY_URI: {
          value: appRepository.repositoryUri,
        },
        DATABASE_CREDENTIALS: {
          type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
          value: dbCredential.secretArn
        },
      },
      vpc: props.vpc
    });
    appRepository.grantPull(preDeploy)
    props.dbInstance.grantConnect(preDeploy)
    dbCredential.grantRead(preDeploy)

    const dockerBuildOutput = new codepipeline.Artifact("DockerBuildOutput");
    const cdkBuildOutput = new codepipeline.Artifact("CdkBuildOutput");
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
          actions: [
            dockerBuildAction,
            new codepipeline_actions.CodeBuildAction({
              actionName: 'CdkBuild',
              project: cdkBuild,
              input: sourceOutput,
              outputs: [cdkBuildOutput],
            })
          ]
        },
        {
          stageName: 'Deploy',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'PreDeploy',
              project: preDeploy,
              input: sourceOutput,
              environmentVariables: {
                IMAGE_TAG: { value: dockerBuildAction.variable('IMAGE_TAG') }
              },
              runOrder: 1,
            }),
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: 'CFN_Deploy_App',
              stackName: 'DevAppStack',
              templatePath: cdkBuildOutput.atPath('DevAppStack.template.json'),
              adminPermissions: true,
              parameterOverrides: {
                [this.appBuiltImage.tagParameterName]: dockerBuildAction.variable('IMAGE_TAG'),
              },
              runOrder: 2,
            }),
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: 'CFN_Deploy_Bastion',
              stackName: 'DevBastionStack',
              templatePath: cdkBuildOutput.atPath('DevBastionStack.template.json'),
              adminPermissions: true,
              parameterOverrides: {
                [this.appBuiltImage.tagParameterName]: dockerBuildAction.variable('IMAGE_TAG'),
              },
              runOrder: 3,
            })
          ],
        },
      ],
    });
  }
}
