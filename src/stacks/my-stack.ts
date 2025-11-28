import type { StackProps } from "aws-cdk-lib";
import { CfnOutput, Stack, Token } from "aws-cdk-lib";
import { CfnExpressGatewayService } from "aws-cdk-lib/aws-ecs";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const serviceName = "default";
    const containerPort = 80;

    //==============================================================================
    // IAM ROLES
    //==============================================================================
    // Task Execution Role
    const taskExecutionRole = new Role(this, "TaskExecutionRole", {
      roleName: `${serviceName}-execution-role`,
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"),
      ],
    });

    // Infrastructure Role
    const infrastructureRole = new Role(this, "InfrastructureRole", {
      roleName: `${serviceName}-infrastructure-role`,
      assumedBy: new ServicePrincipal("ecs.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSInfrastructureRoleforExpressGatewayServices",
        ),
      ],
    });

    //==============================================================================
    // ECS EXPRESS GATEWAY SERVICE
    //==============================================================================
    const expressGatewayService = new CfnExpressGatewayService(this, "ExpressGatewayService", {
      executionRoleArn: taskExecutionRole.roleArn,
      infrastructureRoleArn: infrastructureRole.roleArn,
      primaryContainer: {
        image: "public.ecr.aws/docker/library/httpd:2.4",
        containerPort: containerPort,
      },
    });

    expressGatewayService.attrActiveConfigurations;

    //==============================================================================
    // OUTPUTS
    //==============================================================================
    new CfnOutput(this, "ServiceArn", {
      description: "ECS Express Gateway Service ARN",
      value: expressGatewayService.attrServiceArn,
    });

    new CfnOutput(this, "TaskExecutionRoleArn", {
      description: "Task Execution Role ARN",
      value: taskExecutionRole.roleArn,
    });

    new CfnOutput(this, "InfrastructureRoleArn", {
      description: "Infrastructure Role ARN",
      value: infrastructureRole.roleArn,
    });

    new CfnOutput(this, "ActiveConfigurations", {
      description: "ECS Express Gateway Service Active Configurations",
      value: Token.asString(expressGatewayService.attrActiveConfigurations),
    });
  }
}
