import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import _s3 = require('aws-cdk-lib/aws-s3');
import _lambda = require('aws-cdk-lib/aws-lambda');
import _dynamodb = require('aws-cdk-lib/aws-dynamodb');
import _iam = require('aws-cdk-lib/aws-iam');
import _event_sources = require('aws-cdk-lib/aws-lambda-event-sources');
import _apigw = require('aws-cdk-lib/aws-apigateway');
import _cognito = require('aws-cdk-lib/aws-cognito');
import { AuthorizationType, PassthroughBehavior } from 'aws-cdk-lib/aws-apigateway';
import _s3Deploy = require('aws-cdk-lib/aws-s3-deployment');
import { HttpMethods } from 'aws-cdk-lib/aws-s3';
import _sqs = require('aws-cdk-lib/aws-sqs');
import _s3n = require('aws-cdk-lib/aws-s3-notifications');

// Bucket Name Declaration
const _imageBucketName = 'sai-cdk-rekn-image-bucket'

// Resize Bucket Name Declaration
const _resizedImageBucketName = _imageBucketName + '-resized'

// Website Bucket Name Declaration
const _websiteBucketName = "sai-cdk-rekn-website-bucket"

export class AwsDevHourStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    
    //Image Bucket to store Images
    const imageBucket = new _s3.Bucket(this, _imageBucketName, {
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    new cdk.CfnOutput(this, "rekn-image-bucket", {value: imageBucket.bucketName});
    const imageBucketArn = imageBucket.bucketArn

    // CORS Allow to resize Bucket
    imageBucket.addCorsRule({
      allowedMethods: [HttpMethods.GET, HttpMethods.PUT],
      allowedOrigins: ['*'],
      allowedHeaders: ['*'],
      maxAge: 3000
    })
    
    //Image Bucket to store resized Images
    const resizedBucket = new _s3.Bucket(this, _resizedImageBucketName, {
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    new cdk.CfnOutput(this, "rekn-resized-image-bucket", {value: resizedBucket.bucketName});
    const resizedBucketArn = resizedBucket.bucketArn

    // CORS Allow to resize Bucket
    resizedBucket.addCorsRule({
      allowedMethods: [HttpMethods.GET, HttpMethods.PUT],
      allowedOrigins: ['*'],
      allowedHeaders: ['*'],
      maxAge: 3000
    })

    const webBucket = new _s3.Bucket(this, _websiteBucketName, {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // publicReadAccess: true
    });

    webBucket.addToResourcePolicy(new _iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [webBucket.arnForObjects('*')],
      principals: [new _iam.AnyPrincipal()],
      conditions: {
        'IpAddress': {
          'aws:SourceIp': [
            '0.0.0.0/0' // Anyone in the Internet
          ]
        }
      }
    }));
    
    new cdk.CfnOutput(this, 'websiteBucketUrl', {value: webBucket.bucketWebsiteDomainName});

    // Deploying website contents to S3 Bucket
    new _s3Deploy.BucketDeployment(this, 'delpoyWebsite', {
      sources: [_s3Deploy.Source.asset('./build')],
      destinationBucket: webBucket
    })

    // Dynamo DB Table to Store image labels
    const table = new _dynamodb.Table(this, 'imagelables', {
      partitionKey: {name: 'image', type: _dynamodb.AttributeType.STRING},
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    new cdk.CfnOutput(this, 'ddbTable', {value: table.tableName})

    // Add PIL Layer to Lambda Rek Function to resize Images
    const layer = new _lambda.LayerVersion(this, 'PIL', {
      code: _lambda.Code.fromAsset('reklayer'),
      compatibleRuntimes: [_lambda.Runtime.PYTHON_3_7],
      license: 'Apache-2.0',
      description: 'A Layer to Enable the PIL Library in our RekFun'
    })

    // Build Lambda to read from Image Bucket and Write to Image table
    const rekFn = new _lambda.Function(this, 'rekFun', {
      code: _lambda.Code.fromAsset('rekLambdaFun'),
      runtime: _lambda.Runtime.PYTHON_3_7,
      handler: 'index.handler',
      timeout: Duration.seconds(15),
      memorySize: 1024,
      layers: [layer],
      environment: {
        "TABLE": table.tableName,
        "BUCKET": imageBucket.bucketName,
        "THUMB_BUCKET": resizedBucket.bucketName
      },
    });

    // Add Object Creation event source of image bucket to trigger rekFun lambda
    // rekFn.addEventSource(new _event_sources.S3EventSource(imageBucket, {
    //   events: [_s3.EventType.OBJECT_CREATED],
    // }));

    // Allow rekFun lambda To read image Bucket and write to Image Table
    imageBucket.grantRead(rekFn);
    table.grantWriteData(rekFn);
    resizedBucket.grantPut(rekFn);

    // Allow rekFun to Detect Lables form ReKognition
    rekFn.addToRolePolicy(new _iam.PolicyStatement({
      effect: _iam.Effect.ALLOW,
      actions: ['rekognition:DetectLabels'],
      resources: ['*']
    }));

    // Lambda For Synchronous Front End
    const serviceFn = new _lambda.Function(this, 'serviceFun', {
      code: _lambda.Code.fromAsset('serviceLambdaFun'),
      runtime: _lambda.Runtime.PYTHON_3_7,
      handler: 'index.handler',
      environment: {
        "TABLE": table.tableName,
        "BUCKET": imageBucket.bucketName,
        "THUMB_BUCKET": resizedBucket.bucketName
      },
    });

    imageBucket.grantDelete(serviceFn)
    resizedBucket.grantDelete(serviceFn)
    table.grantReadWriteData(serviceFn)

    // API-GW Declaration 
    const api = new _apigw.LambdaRestApi(this, 'ImageAPI', {
      defaultCorsPreflightOptions: {
        allowOrigins: _apigw.Cors.ALL_ORIGINS,
        allowMethods: _apigw.Cors.ALL_METHODS
      },
      handler: serviceFn,
      proxy: false
    });

    // IAM and Cognito User Pool 
    const userPool = new _cognito.UserPool(this, 'userPool', {
      selfSignUpEnabled: true,
      autoVerify: {email: true},
      signInAliases: {username: true, email: true}
    });

    // User Pool Client
    const userPoolClient = new _cognito.UserPoolClient(this, 'userPoolClient', {
      userPool,
      generateSecret: false
    });

    // Identity Pool
    const identityPool = new _cognito.CfnIdentityPool(this, 'IdentityPool', {
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: userPoolClient.userPoolClientId,
          providerName: userPool.userPoolProviderName
        }
      ]
    });

    // API-GW Auth
    const auth = new _apigw.CfnAuthorizer(this, 'API-GW-Auth', {
      name: 'Customer-Authorizer',
      identitySource: 'method.request.header.Authorization',
      providerArns: [userPool.userPoolArn],
      restApiId: api.restApiId,
      type: AuthorizationType.COGNITO
    });

    // Customer Authentication Role
    const authenticatedRole = new _iam.Role(this, 'ImageRekAuthorizationRole', {
      assumedBy: new _iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
          {
          StringEquals: {
              "cognito-identity.amazonaws.com:aud": identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    // IAM policy granting users permission to upload, download and delete their own pictures
    authenticatedRole.addToPolicy(
      new _iam.PolicyStatement({
        actions: [
          "s3:GetObject",
          "s3:PutObject"
        ],
        effect: _iam.Effect.ALLOW,
        resources: [
          imageBucketArn + "/private/${cognito-identity.amazonaws.com:sub}/*",
          imageBucketArn + "/private/${cognito-identity.amazonaws.com:sub}",
          resizedBucketArn + "/private/${cognito-identity.amazonaws.com:sub}/*",
          resizedBucketArn + "/private/${cognito-identity.amazonaws.com:sub}"
        ],
      })
    );

    // IAM policy granting users permission to list their pictures
    authenticatedRole.addToPolicy(
      new _iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        effect: _iam.Effect.ALLOW,
        resources: [
          imageBucketArn,
          resizedBucketArn
        ],
        conditions: {"StringLike": {"s3:prefix": ["private/${cognito-identity.amazonaws.com:sub}/*"]}}
      })
    );

    // Attaching the policies to identity pool
    new _cognito.CfnIdentityPoolRoleAttachment(this, "IdentityPoolRoleAttachment", {
      identityPoolId: identityPool.ref,
      roles: { authenticated: authenticatedRole.roleArn },
    });

    // Export values of Cognito
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId, });
    new cdk.CfnOutput(this, "AppClientId", { value: userPoolClient.userPoolClientId, });
    new cdk.CfnOutput(this, "IdentityPoolId", { value: identityPool.ref, });

    // API-GW and Lambda Integration
    const lambdaIntegration = new _apigw.LambdaIntegration(serviceFn, {
      proxy: false,
      requestParameters: {
        'integration.request.querystring.action': 'method.request.querystring.action',
        'integration.request.querystring.key': 'method.request.querystring.key'
      },
      requestTemplates: {
        'application/json': JSON.stringify({ action: "$util.escapeJavaScript($input.params('action'))", key: "$util.escapeJavaScript($input.params('key'))" })
      },
      passthroughBehavior: PassthroughBehavior.WHEN_NO_TEMPLATES,
      integrationResponses: [
        {
          statusCode: "200",
          responseParameters: {
            // We can map response parameters
            // - Destination parameters (the key) are the response parameters (used in mappings)
            // - Source parameters (the value) are the integration response parameters or expressions
            'method.response.header.Access-Control-Allow-Origin': "'*'"
          }
        },
        {
          // For errors, we check if the error message is not empty, get the error data
          selectionPattern: "(\n|.)+",
          statusCode: "500",
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': "'*'"
          }
        }
      ],
    });

    //API-GW Methods Declarations
    const imageAPI = api.root.addResource('images');
    ???
    // GET /images
    imageAPI.addMethod('GET', lambdaIntegration, {
      authorizationType: AuthorizationType.COGNITO,
      authorizer: { authorizerId: auth.ref },
      requestParameters: {
        'method.request.querystring.action': true,
        'method.request.querystring.key': true
      },
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        {
          statusCode: "500",
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        }
      ]
    });
    
    // DELETE /images
    imageAPI.addMethod('DELETE', lambdaIntegration, {
      authorizationType: AuthorizationType.COGNITO,
      authorizer: { authorizerId: auth.ref },
      requestParameters: {
        'method.request.querystring.action': true,
        'method.request.querystring.key': true
      },
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        {
          statusCode: "500",
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        }
      ]
    });

    // Building Queue and Dead letter queue
    const dlqueue = new _sqs.Queue(this, 'ImageDLQueue', {
      queueName: 'DeadLetterImageQueue'
    });

    const imageQueue = new _sqs.Queue(this, 'ImageQueue', {
      queueName: 'ImageQueue',
      visibilityTimeout: cdk.Duration.seconds(30),
      receiveMessageWaitTime: cdk.Duration.seconds(20),
      deadLetterQueue: {
        maxReceiveCount: 2,
        queue: dlqueue
      }
    });

    // S3 Bucket create notification to SQS
    imageBucket.addObjectCreatedNotification(new _s3n.SqsDestination(imageQueue), {
      prefix: 'private/'
    });

    // rekFun to consume messages from SQS
    rekFn.addEventSource(new _event_sources.SqsEventSource(imageQueue));
  }
}
