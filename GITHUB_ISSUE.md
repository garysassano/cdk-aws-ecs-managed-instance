### Describe the bug

The documentation example for [`ManagedInstancesCapacityProvider`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs.ManagedInstancesCapacityProvider.html) shows using `Ec2Service` with `Ec2TaskDefinition`, but this pattern **does not work** in CDK v2.223.0. Following the documentation example causes a deployment error requiring EC2 capacity on the cluster.

The actual working pattern requires using `FargateService` with `TaskDefinition` (specifying `Compatibility.MANAGED_INSTANCES`), which is counter-intuitive and completely different from what the documentation shows.

**For reference:** The [AWS official CloudFormation sample template](https://github.com/aws-samples/sample-amazon-ecs-managed-instances/blob/main/cfn-templates/ecs-stack.json) uses `RequiresCompatibilities: ["MANAGED_INSTANCES"]` with standard `AWS::ECS::Service` resources (not tied to Fargate or EC2 launch types), but CDK L2 constructs require the unintuitive `FargateService` + `TaskDefinition` combination.

#### Current Documentation Example (DOES NOT WORK)

The docs show this example, which **fails with a validation error**:

```typescript
declare const vpc: ec2.Vpc;
declare const infrastructureRole: iam.Role;
declare const instanceProfile: iam.InstanceProfile;

const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

// Create a Managed Instances Capacity Provider
const miCapacityProvider = new ecs.ManagedInstancesCapacityProvider(this, 'MICapacityProvider', {
  infrastructureRole,
  ec2InstanceProfile: instanceProfile,
  subnets: vpc.privateSubnets,
  securityGroups: [new ec2.SecurityGroup(this, 'MISecurityGroup', { vpc })],
  instanceRequirements: {
    vCpuCountMin: 1,
    memoryMin: Size.gibibytes(2),
    cpuManufacturers: [ec2.CpuManufacturer.INTEL],
    acceleratorManufacturers: [ec2.AcceleratorManufacturer.NVIDIA],
  },
  propagateTags: ecs.PropagateManagedInstancesTags.CAPACITY_PROVIDER,
});

// Optionally configure security group rules using IConnectable interface
miCapacityProvider.connections.allowFrom(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(80));

// Add the capacity provider to the cluster
cluster.addManagedInstancesCapacityProvider(miCapacityProvider);

const taskDefinition = new ecs.Ec2TaskDefinition(this, 'TaskDef');  // ❌ DOES NOT WORK

taskDefinition.addContainer('web', {
  image: ecs.ContainerImage.fromRegistry('amazon/amazon-ecs-sample'),
  memoryReservationMiB: 256,
});

new ecs.Ec2Service(this, 'EC2Service', {  // ❌ DOES NOT WORK
  cluster,
  taskDefinition,
  minHealthyPercent: 100,
  capacityProviderStrategies: [
    {
      capacityProvider: miCapacityProvider.capacityProviderName,
      weight: 1,
    },
  ],
});
```


### Regression Issue

- [ ] Select this option if this issue appears to be a regression.

### Last Known Working CDK Library Version

_No response_

### Expected Behavior

The CDK should provide an intuitive and type-safe way to work with ECS Managed Instances that doesn't require using `FargateService` for EC2-based infrastructure.

### Current Behavior

#### Problem

Following the documentation example causes this error during deployment:

```text
Error: Cluster for this service needs Ec2 capacity. Call addXxxCapacity() on the cluster.
```

The documentation shows using `Ec2Service` with `Ec2TaskDefinition`, but **this pattern does not work** with Managed Instances in CDK v2.223.0.

#### Current Workaround

The actual working pattern is completely different from the documentation and requires counter-intuitive construct combinations:

```typescript
import { SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  Compatibility,
  ContainerImage,
  FargateService,  // ✅ Use FargateService, not Ec2Service
  ManagedInstancesCapacityProvider,
  NetworkMode,
  PropagateManagedInstancesTags,
  Protocol,
  TaskDefinition,  // ✅ Use TaskDefinition, not Ec2TaskDefinition
} from 'aws-cdk-lib/aws-ecs';
import { InstanceProfile, ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';

const vpc = new Vpc(this, 'Vpc', { maxAzs: 2 });
const cluster = new Cluster(this, 'Cluster', { vpc });

// Create IAM roles
const infrastructureRole = new Role(this, 'InfraRole', {
  assumedBy: new ServicePrincipal('ecs.amazonaws.com'),
  managedPolicies: [
    ManagedPolicy.fromAwsManagedPolicyName('AmazonECSInfrastructureRolePolicyForManagedInstances')
  ],
});

const instanceRole = new Role(this, 'InstanceRole', {
  assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
  managedPolicies: [
    ManagedPolicy.fromAwsManagedPolicyName('AmazonECSInstanceRolePolicyForManagedInstances')
  ],
});

const instanceProfile = new InstanceProfile(this, 'InstanceProfile', {
  role: instanceRole,
});

const miCapacityProvider = new ManagedInstancesCapacityProvider(this, 'MICapacityProvider', {
  infrastructureRole,
  ec2InstanceProfile: instanceProfile,
  subnets: vpc.privateSubnets,
  securityGroups: [new SecurityGroup(this, 'MISecurityGroup', { vpc })],
  propagateTags: PropagateManagedInstancesTags.CAPACITY_PROVIDER,
});

cluster.addManagedInstancesCapacityProvider(miCapacityProvider);

// ✅ Use TaskDefinition with Compatibility.MANAGED_INSTANCES
const taskDefinition = new TaskDefinition(this, 'TaskDef', {
  compatibility: Compatibility.MANAGED_INSTANCES,
  cpu: '1024',        // Task-level CPU (string format)
  memoryMiB: '2048',  // Task-level memory (string format)
  networkMode: NetworkMode.AWS_VPC,
});

taskDefinition.addContainer('web', {
  image: ContainerImage.fromRegistry('amazon/amazon-ecs-sample'),
  essential: true,
  portMappings: [
    {
      containerPort: 80,
      protocol: Protocol.TCP,
    },
  ],
});

// ✅ Use FargateService, not Ec2Service
new FargateService(this, 'ManagedInstancesService', {
  cluster,
  taskDefinition,
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
```

#### Key Differences from Documentation

| Documentation Shows                                | Actually Works                                            |
| -------------------------------------------------- | --------------------------------------------------------- |
| `Ec2TaskDefinition`                                | `TaskDefinition` with `Compatibility.MANAGED_INSTANCES`   |
| `Ec2Service`                                       | `FargateService`                                          |
| Container-level resources (`memoryReservationMiB`) | Task-level resources (`cpu`, `memoryMiB`)                 |
| No compatibility specified                         | `compatibility: Compatibility.MANAGED_INSTANCES` required |

#### Root Cause Analysis

The documentation appears to be incorrect or based on a different CDK version. In CDK v2.223.0:

1. **`Ec2Service` validation fails** - It requires traditional EC2 Auto Scaling capacity and doesn't recognize Managed Instances capacity providers
2. **`FargateService` works** - Even though Managed Instances are EC2-based, they must be used with `FargateService` in the CDK
3. **Task definition compatibility** - Requires using the generic `TaskDefinition` class with `Compatibility.MANAGED_INSTANCES`, not `Ec2TaskDefinition`

This suggests that Managed Instances in CDK are treated more like Fargate from a service perspective, despite being EC2-based infrastructure.

The `Compatibility` enum includes various combinations specifically for Managed Instances:

```typescript
export enum Compatibility {
    EC2 = 0,
    FARGATE = 1,
    EC2_AND_FARGATE = 2,
    EXTERNAL = 3,
    MANAGED_INSTANCES = 4,
    EC2_AND_MANAGED_INSTANCES = 5,
    FARGATE_AND_MANAGED_INSTANCES = 6,
    FARGATE_AND_EC2_AND_MANAGED_INSTANCES = 7
}
```

However, there's no dedicated `ManagedInstancesTaskDefinition` or `ManagedInstancesService` class, forcing users to mix constructs in unintuitive ways.

#### Impact

- Users following the official documentation cannot deploy and will encounter confusing validation errors
- The pattern is counter-intuitive (using `FargateService` for EC2-based instances)
- Trial and error is required to discover the working pattern
- This significantly diminishes the developer experience for a new AWS feature (Managed Instances launched November 2024)

### Reproduction Steps

See above.

### Possible Solution

#### Option 1: Introduce Dedicated Constructs (Recommended)

Create new L2 constructs specifically for Managed Instances to provide a clear and type-safe developer experience:

**1. `ManagedInstancesTaskDefinition` class:**

```typescript
// Proposed new class
const taskDefinition = new ecs.ManagedInstancesTaskDefinition(this, 'TaskDef', {
  cpu: '1024',
  memoryMiB: '2048',
  networkMode: ecs.NetworkMode.AWS_VPC,
  taskRole,
});
```

This would:

- Automatically set `compatibility: Compatibility.MANAGED_INSTANCES`
- Provide appropriate defaults for Managed Instances workloads
- Make the intent explicit and clear
- Match the pattern of `Ec2TaskDefinition` and `FargateTaskDefinition`

**2. `ManagedInstancesService` class:**

```typescript
// Proposed new class
const service = new ecs.ManagedInstancesService(this, 'Service', {
  cluster,
  taskDefinition,
  desiredCount: 2,
  capacityProviderStrategies: [
    {
      capacityProvider: miCapacityProvider.capacityProviderName,
      weight: 1,
    },
  ],
});
```

This would:

- Validate that the cluster has Managed Instances capacity providers
- Automatically configure appropriate service settings
- Eliminate the confusion of using `FargateService` for EC2-based infrastructure
- Follow the established pattern in the CDK (like `Ec2Service` and `FargateService`)

**Benefits:**

- **Intuitive API**: Developers immediately understand they're working with Managed Instances
- **Type Safety**: Compile-time validation of configuration options
- **Consistency**: Follows the existing pattern of dedicated task definition and service classes
- **Discoverability**: Easy to find and understand through IDE autocomplete and documentation
- **Future-proof**: Room to add Managed Instances-specific features and optimizations

#### Option 2: Fix Documentation (Short-term)

Update the documentation to show the current working pattern:

- Use `TaskDefinition` with `Compatibility.MANAGED_INSTANCES`
- Use `FargateService` (not `Ec2Service`)
- Use task-level CPU/memory allocation

**Option 3 (Alternative):** Update `Ec2Service` validation to accept Managed Instances capacity providers, allowing the `Ec2Service` + `Ec2TaskDefinition` pattern shown in the current docs.

### Reproduction Steps

See above.

### Additional Information/Context

#### References

- [ManagedInstancesCapacityProvider API Documentation](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs.ManagedInstancesCapacityProvider.html) (contains the incorrect example)
- [ECS Managed Instances User Guide](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-managed-instances.html)
- Working CDK implementation: <https://github.com/garysassano/cdk-aws-ecs-managed-instance>

#### ECS AWS Console

![ECS Managed Instances Console Screenshot](https://github.com/user-attachments/assets/3ae476f0-c90c-480f-8c2d-6359af78ac83)

### AWS CDK Library version (aws-cdk-lib)

2.223.0

### AWS CDK CLI version

2.1031.2

### Node.js Version

24.11.0

### OS

Ubuntu 24.04

### Language

TypeScript

### Language Version

No response

### Other information

No response
