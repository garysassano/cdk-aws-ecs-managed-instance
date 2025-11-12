import type { StackProps } from "aws-cdk-lib";
import { Stack } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { validateEnv } from "../utils/validate-env";

// Constants
const COLLECTORS_SECRETS_KEY_PREFIX = "serverless-otlp-forwarder/keys/";

// Required environment variables
const env = validateEnv(["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS"]);

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    //==============================================================================
    // AAA TEST
    //==============================================================================
  }
}
