import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import _s3 = require('aws-cdk-lib/aws-s3');
import _lambda = require('aws-cdk-lib/aws-lambda');
import _dynamodb = require('aws-cdk-lib/aws-dynamodb');
import _iam = require('aws-cdk-lib/aws-iam');
import _event_sources = require('aws-cdk-lib/aws-lambda-event-sources');

// Bucket Name Declaration
const _imageBucketName = 'sai-cdk-rekn-image-bucket'


export class AwsDevHourStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    
    //Image Bucket to store Images
    const imageBucket = new _s3.Bucket(this, _imageBucketName);
    new cdk.CfnOutput(this, "rekn-image-bucket", {value: imageBucket.bucketName});

    // Dynamo DB Table to Store image labels
    const table = new _dynamodb.Table(this, 'imagelables', {
      partitionKey: {name: 'image', type: _dynamodb.AttributeType.STRING}
    });
    new cdk.CfnOutput(this, 'ddbTable', {value: table.tableName})

    // Build Lambda to read from Image Bucket and Write to Image table
    const rekFn = new _lambda.Function(this, 'rekFun', {
      code: _lambda.Code.fromAsset('rekLambdaFun'),
      runtime: _lambda.Runtime.PYTHON_3_7,
      handler: 'index.handler',
      timeout: Duration.seconds(15),
      memorySize: 1024,
      environment: {
        "TABLE": table.tableName,
        "BUCKET": imageBucket.bucketName
      },
    });

    // Add Object Creation event source of image bucket to trigger rekFun lambda
    rekFn.addEventSource(new _event_sources.S3EventSource(imageBucket, {
      events: [_s3.EventType.OBJECT_CREATED],
    }));

    // Allow rekFun lambda To read image Bucket and write to Image Table
    imageBucket.grantRead(rekFn);
    table.grantWriteData(rekFn);

    // Allow rekFun to Detect Lables form ReKognition
    rekFn.addToRolePolicy(new _iam.PolicyStatement({
      effect: _iam.Effect.ALLOW,
      actions: ['rekognition:DetectLables'],
      resources: ['*']
    }));

  }
}
