import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';

import { githubOwner, repoName, awsSecretsGitHubTokenName, gitDevBranch } from '../config'

export interface DevPipelineStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}

export class DevPipelineStack extends cdk.Stack {
  public readonly appRepository: ecr.Repository;
  public readonly appBuiltImage: ecs.TagParameterContainerImage;

  public readonly imageTag: string;

  constructor(scope: Construct, id: string, props: DevPipelineStackProps) {
    super(scope, id, {
      ...props,
      //autoDeploy: false,
    });

    this.appRepository = new ecr.Repository(this, 'AppEcrRepo');
    this.appBuiltImage = new ecs.TagParameterContainerImage(this.appRepository);

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

    const dockerBuild = new codebuild.PipelineProject(this, 'DockerCodeBuildProject', {
      environment: {
        privileged: true,
      },
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.DOCKER_LAYER),
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: '$(aws ecr get-login --no-include-email --region $AWS_DEFAULT_REGION)',
          },
          build: {
            commands: [
              'DOCKER_BUILDKIT=1 docker build -t $APP_REPOSITORY_URI:$CODEBUILD_RESOLVED_SOURCE_VERSION app',
            ]
          },
          post_build: {
            commands: [
              'docker push $APP_REPOSITORY_URI:$CODEBUILD_RESOLVED_SOURCE_VERSION',
              `printf '{ "imageTag": "'$CODEBUILD_RESOLVED_SOURCE_VERSION'" }' > imageTag.json`,
              'export IMAGE_TAG=$CODEBUILD_RESOLVED_SOURCE_VERSION',
            ],
          },
        },
        artifacts: {
          files: 'imageTag.json',
        },
        env: {
          ["exported-variables"]: ["IMAGE_TAG"]
        },
      }),
      environmentVariables: {
        'APP_REPOSITORY_URI': {
          value: this.appRepository.repositoryUri,
        },
      },
    });
    this.appRepository.grantPullPush(dockerBuild);

    const cdkBuild = new codebuild.PipelineProject(this, 'CdkBuildProject', {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_6_0
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'cd cdk',
              'npm ci'
            ]
          },
          build: {
            commands: [
              'npx cdk synth -o . DevAppStack'
            ],
          },
        },
        artifacts: {
          'base-directory': 'cdk',
          files: 'DevAppStack.template.json',
        },
      }),
    });
    cdkBuild.addToRolePolicy(new iam.PolicyStatement(
      {
        effect: iam.Effect.ALLOW,
        actions: ['ec2:DescribeAvailabilityZones'],
        resources: ['*']
      })
    );

    const release = new codebuild.PipelineProject(this, 'ReleaseProject', {
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.DOCKER_LAYER),
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              'docker run --rm $APP_REPOSITORY_URI:$IMAGE_TAG bin/rails app:release',
            ]
          }
        },
      }),
      environmentVariables: {
        'APP_REPOSITORY_URI': {
          value: this.appRepository.repositoryUri,
        },
      },
      vpc: props.vpc
    });
    this.appRepository.grantPull(release)

    const dockerBuildOutput = new codepipeline.Artifact("DockerBuildOutput");
    const cdkBuildOutput = new codepipeline.Artifact();
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
          ],
        },
        {
          stageName: 'Deploy',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'PreDeploy',
              project: release,
              input: dockerBuildOutput,
              environmentVariables: {
                IMAGE_TAG: { value: dockerBuildAction.variable('IMAGE_TAG') }
              },
              runOrder: 1,
            }),
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: 'CFN_Deploy',
              stackName: 'DevAppStack',
              templatePath: cdkBuildOutput.atPath('DevAppStack.template.json'),
              adminPermissions: true,
              parameterOverrides: {
                [this.appBuiltImage.tagParameterName]: dockerBuildOutput.getParam('imageTag.json', 'imageTag'),
              },
              extraInputs: [dockerBuildOutput],
              runOrder: 2,
            }),
          ],
        },
      ],
    });

    this.imageTag = dockerBuildOutput.getParam('imageTag.json', 'imageTag');
  }
}
