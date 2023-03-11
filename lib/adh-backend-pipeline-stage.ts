import { CfnOutput, Stage, StageProps } from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { AwsDevHourStack } from "./aws_dev_hour-stack";

/**
 * Deployable unit of awsdevhour-backend app
 * */
export class AwsdevhourBackendPipelineStage extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props);
    
    new AwsDevHourStack(this, 'Aws-dev-hour-Backend-Stack-dev');
  }
}