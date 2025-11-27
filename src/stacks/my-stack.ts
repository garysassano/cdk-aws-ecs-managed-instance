import type { StackProps } from "aws-cdk-lib";
import { Size, Stack } from "aws-cdk-lib";
import { CpuManufacturer, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import {
  CfnExpressGatewayService,
  Cluster,
  ManagedInstancesCapacityProvider,
  PropagateManagedInstancesTags,
} from "aws-cdk-lib/aws-ecs";
import { InstanceProfile, ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    //==============================================================================
    // VPC
    //==============================================================================
    const vpc = new Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: SubnetType.PUBLIC,
          cidrMask: 18,
        },
        {
          name: "Private",
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 18,
        },
      ],
    });

    //==============================================================================
    // ECS CLUSTER
    //==============================================================================
    const cluster = new Cluster(this, "ManagedInstancesCluster", {
      vpc,
    });

    //==============================================================================
    // IAM ROLES
    //==============================================================================
    // Infrastructure Role for ECS to manage the capacity provider
    const infrastructureRole = new Role(this, "InfrastructureRole", {
      assumedBy: new ServicePrincipal("ecs.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonECSInfrastructureRolePolicyForManagedInstances",
        ),
      ],
    });

    // Instance Role for EC2 instances
    const instanceRole = new Role(this, "InstanceRole", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonECSInstanceRolePolicyForManagedInstances"),
      ],
    });

    const instanceProfile = new InstanceProfile(this, "InstanceProfile", {
      role: instanceRole,
    });

    //==============================================================================
    // SECURITY GROUP
    //==============================================================================
    const managedInstancesSecurityGroup = new SecurityGroup(this, "ManagedInstancesSecurityGroup", {
      vpc,
      description: "Security group for ManagedInstances capacity provider instances",
    });

    //==============================================================================
    // MANAGED INSTANCES CAPACITY PROVIDER
    //==============================================================================
    const miCapacityProvider = new ManagedInstancesCapacityProvider(this, "MICapacityProvider", {
      infrastructureRole,
      ec2InstanceProfile: instanceProfile,
      subnets: vpc.privateSubnets,
      securityGroups: [managedInstancesSecurityGroup],
      propagateTags: PropagateManagedInstancesTags.CAPACITY_PROVIDER,
      instanceRequirements: {
        vCpuCountMin: 1,
        memoryMin: Size.gibibytes(2),
        cpuManufacturers: [CpuManufacturer.AMD],
        // acceleratorManufacturers: [AcceleratorManufacturer.NVIDIA],
      },
    });

    // Add capacity provider to cluster
    cluster.addManagedInstancesCapacityProvider(miCapacityProvider);

    //==============================================================================
    // IAM ROLES FOR EXPRESS GATEWAY SERVICES
    //==============================================================================
    // Execution role for Express Gateway Service with managed policy
    const executionRole = new Role(this, "ExecutionRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"),
      ],
    });

    // Infrastructure Role for Express Gateway Services with managed policy
    const expressGatewayInfrastructureRole = new Role(this, "ExpressGatewayInfrastructureRole", {
      assumedBy: new ServicePrincipal("ecs.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSInfrastructureRoleforExpressGatewayServices",
        ),
      ],
    });

    //==============================================================================
    // EXPRESS GATEWAY SERVICES
    //==============================================================================
    // Service 1 - httpd using Express Gateway Service
    const expressService1 = new CfnExpressGatewayService(this, "ExpressGatewayService1", {
      cluster: cluster.clusterArn,
      infrastructureRoleArn: expressGatewayInfrastructureRole.roleArn,
      executionRoleArn: executionRole.roleArn,
      cpu: "1024",
      memory: "9500",
      primaryContainer: {
        image: "public.ecr.aws/docker/library/httpd:2.4",
        containerPort: 80,
      },
      networkConfiguration: {
        subnets: vpc.privateSubnets.map((subnet) => subnet.subnetId),
        securityGroups: [managedInstancesSecurityGroup.securityGroupId],
      },
      healthCheckPath: "/",
    });

    // Service 2 - nginx using Express Gateway Service
    const expressService2 = new CfnExpressGatewayService(this, "ExpressGatewayService2", {
      cluster: cluster.clusterArn,
      infrastructureRoleArn: expressGatewayInfrastructureRole.roleArn,
      executionRoleArn: executionRole.roleArn,
      cpu: "1024",
      memory: "5500",
      primaryContainer: {
        image: "public.ecr.aws/docker/library/nginx:latest",
        containerPort: 80,
      },
      networkConfiguration: {
        subnets: vpc.privateSubnets.map((subnet) => subnet.subnetId),
        securityGroups: [managedInstancesSecurityGroup.securityGroupId],
      },
      healthCheckPath: "/",
    }); // Ensure Service 2 is created after Service 1
    expressService2.addDependency(expressService1);
  }
}
