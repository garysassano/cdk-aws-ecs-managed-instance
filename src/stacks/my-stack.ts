import type { StackProps } from "aws-cdk-lib";
import { Stack } from "aws-cdk-lib";
import { SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  Compatibility,
  ContainerImage,
  FargateService,
  ManagedInstancesCapacityProvider,
  NetworkMode,
  PropagateManagedInstancesTags,
  Protocol,
  TaskDefinition,
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
      enableFargateCapacityProviders: false,
    });

    //==============================================================================
    // IAM ROLES
    //==============================================================================
    // Infrastructure Role for ECS to manage the capacity provider
    const infrastructureRole = new Role(this, "InfrastructureRole", {
      roleName: "ecsInfrastructureRoleForManagedInstances",
      assumedBy: new ServicePrincipal("ecs.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonECSInfrastructureRolePolicyForManagedInstances",
        ),
      ],
    });

    // Instance Role for EC2 instances
    const instanceRole = new Role(this, "InstanceRole", {
      roleName: "ecsInstanceRoleForManagedInstances",
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonECSInstanceRolePolicyForManagedInstances"),
      ],
    });

    const instanceProfile = new InstanceProfile(this, "InstanceProfile", {
      instanceProfileName: "ecsInstanceRoleForManagedInstances",
      role: instanceRole,
    });

    //==============================================================================
    // SECURITY GROUP
    //==============================================================================
    const managedInstancesSecurityGroup = new SecurityGroup(this, "ManagedInstancesSecurityGroup", {
      vpc,
      description: "Security group for ManagedInstances capacity provider instances",
      allowAllOutbound: true,
    });

    //==============================================================================
    // MANAGED INSTANCES CAPACITY PROVIDER
    //==============================================================================
    const miCapacityProvider = new ManagedInstancesCapacityProvider(this, "MICapacityProvider", {
      capacityProviderName: "ManagedInstancesCP",
      infrastructureRole,
      ec2InstanceProfile: instanceProfile,
      subnets: vpc.privateSubnets,
      securityGroups: [managedInstancesSecurityGroup],
      propagateTags: PropagateManagedInstancesTags.CAPACITY_PROVIDER,
    });

    // Add capacity provider to cluster
    cluster.addManagedInstancesCapacityProvider(miCapacityProvider);

    //==============================================================================
    // TASK DEFINITIONS
    //==============================================================================
    const taskRole = new Role(this, "TaskDefTaskRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // Task Definition 1 - httpd (compatible with both Fargate and Managed Instances)
    const taskDef1 = new TaskDefinition(this, "TaskDef", {
      compatibility: Compatibility.FARGATE_AND_MANAGED_INSTANCES,
      cpu: "1024",
      memoryMiB: "9500",
      networkMode: NetworkMode.AWS_VPC,
      taskRole,
      family: "managedinstancescapacityproviderTaskDef1",
    });

    taskDef1.addContainer("web1", {
      image: ContainerImage.fromRegistry("public.ecr.aws/docker/library/httpd:2.4"),
      essential: true,
      portMappings: [
        {
          containerPort: 80,
          protocol: Protocol.TCP,
        },
      ],
    });

    // Task Definition 2 - nginx (compatible with both Fargate and Managed Instances)
    const taskDef2 = new TaskDefinition(this, "TaskDef2", {
      compatibility: Compatibility.FARGATE_AND_MANAGED_INSTANCES,
      cpu: "1024",
      memoryMiB: "5500",
      networkMode: NetworkMode.AWS_VPC,
      taskRole,
      family: "managedinstancescapacityproviderTaskDef2",
    });

    taskDef2.addContainer("web2", {
      image: ContainerImage.fromRegistry("public.ecr.aws/docker/library/nginx:latest"),
      essential: true,
      portMappings: [
        {
          containerPort: 80,
          protocol: Protocol.TCP,
        },
      ],
    });

    //==============================================================================
    // ECS SERVICES
    //==============================================================================
    // Service 1 - Using FargateService with Managed Instances capacity provider
    const service1 = new FargateService(this, "ManagedInstancesService", {
      cluster,
      taskDefinition: taskDef1,
      serviceName: "ManagedInstancesService1",
      desiredCount: 2,
      capacityProviderStrategies: [
        {
          capacityProvider: miCapacityProvider.capacityProviderName,
          weight: 1,
        },
      ],
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    // Service 2 - Using FargateService with Managed Instances capacity provider
    const service2 = new FargateService(this, "ManagedInstancesService2", {
      cluster,
      taskDefinition: taskDef2,
      serviceName: "ManagedInstancesService2",
      desiredCount: 2,
      capacityProviderStrategies: [
        {
          capacityProvider: miCapacityProvider.capacityProviderName,
          weight: 2,
        },
      ],
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    // Ensure Service 2 is created after Service 1
    service2.node.addDependency(service1);
  }
}
