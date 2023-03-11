import * as _codePipeline from 'aws-cdk-lib/aws-codepipeline';
import * as _codePipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import { SecretValue, Stack, StackProps } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, ManualApprovalStep, ShellStep } from 'aws-cdk-lib/pipelines';
import { AwsdevhourBackendPipelineStage } from './adh-backend-pipeline-stage';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

export class AwsDevHourBackendPipelineStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const githubOwner = StringParameter.fromStringParameterAttributes(this, 'gitOwner',{
            parameterName: 'github-owner'
        }).stringValue;
        
        const githubRepo = StringParameter.fromStringParameterAttributes(this, 'gitRepo',{
            parameterName: 'dev-hour-backend-git-repo'
        }).stringValue;
        
        const githubBranch = StringParameter.fromStringParameterAttributes(this, 'gitBranch',{
            parameterName: 'branch-name'
        }).stringValue;

        const pipeline = new CodePipeline(this, 'Pipeline', {
            pipelineName: 'AWS Dev Hour Pipeline',
            // Synth
            synth: new ShellStep('Synth', {
                // Define application source
                input: CodePipelineSource.gitHub(
                    githubOwner + '/' + githubRepo,
                    githubBranch, {
                        authentication: SecretValue.secretsManager('my-github-access-token')
                    }
                ),
                // Define build and synth commands
                commands: [
                    'rm -rf ./reklayer/* && wget https://awsdevhour.s3-accelerate.amazonaws.com/pillow.zip && unzip pillow.zip && mv ./python ./reklayer && rm pillow.zip && npm run build',
                    'npm run build & cdk synth'
                ]
            })
          });

        //Define application stage
        const stage = pipeline.addStage(new AwsdevhourBackendPipelineStage(this, 'dev'));

        stage.addPost(new ManualApprovalStep('ManualApproval'));
    }
}