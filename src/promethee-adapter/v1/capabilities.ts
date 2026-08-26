import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeOperation,
  type CapabilityGrant,
  type CapabilityId,
  type CapabilityRequest,
  type CapabilityRequirement,
  type ClientHello,
  type CompatibilityPolicy
} from "./types.ts";

export const DEFAULT_COMPATIBILITY_POLICY: CompatibilityPolicy = Object.freeze({
  allowedPrometheeVersions: Object.freeze(["1.3.26"]),
  supportedProtocolVersions: Object.freeze([BRIDGE_PROTOCOL_VERSION])
});

export const SAFE_V1_CAPABILITY_REQUESTS: readonly CapabilityRequest[] = Object.freeze([
  {
    id: "session.read",
    supportedVersions: [BRIDGE_PROTOCOL_VERSION],
    operations: ["session.snapshot"]
  },
  {
    id: "session.events",
    supportedVersions: [BRIDGE_PROTOCOL_VERSION],
    operations: ["session.subscribe"]
  },
  {
    id: "session.pause",
    supportedVersions: [BRIDGE_PROTOCOL_VERSION],
    operations: ["session.pause"]
  },
  {
    id: "session.resume",
    supportedVersions: [BRIDGE_PROTOCOL_VERSION],
    operations: ["session.resume"]
  },
  {
    id: "tasks.read",
    supportedVersions: [BRIDGE_PROTOCOL_VERSION],
    operations: ["tasks.snapshot"]
  },
  {
    id: "tasks.events",
    supportedVersions: [BRIDGE_PROTOCOL_VERSION],
    operations: ["tasks.subscribe"]
  },
  {
    id: "hud.read",
    supportedVersions: [BRIDGE_PROTOCOL_VERSION],
    operations: ["hud.snapshot"]
  },
  {
    id: "hud.events",
    supportedVersions: [BRIDGE_PROTOCOL_VERSION],
    operations: ["hud.subscribe"]
  },
  {
    id: "hud.geometry",
    supportedVersions: [BRIDGE_PROTOCOL_VERSION]
  }
]);

export const SESSION_COORDINATION_REQUIREMENTS: readonly CapabilityRequirement[] =
  Object.freeze([
    {
      id: "session.read",
      version: BRIDGE_PROTOCOL_VERSION,
      operations: ["session.snapshot"]
    },
    {
      id: "session.events",
      version: BRIDGE_PROTOCOL_VERSION,
      operations: ["session.subscribe"]
    },
    {
      id: "session.pause",
      version: BRIDGE_PROTOCOL_VERSION,
      operations: ["session.pause"]
    }
  ]);

export const COMPLETE_READ_MODEL_REQUIREMENTS: readonly CapabilityRequirement[] =
  Object.freeze([
    ...SESSION_COORDINATION_REQUIREMENTS,
    {
      id: "tasks.read",
      version: BRIDGE_PROTOCOL_VERSION,
      operations: ["tasks.snapshot"]
    },
    {
      id: "tasks.events",
      version: BRIDGE_PROTOCOL_VERSION,
      operations: ["tasks.subscribe"]
    },
    {
      id: "hud.read",
      version: BRIDGE_PROTOCOL_VERSION,
      operations: ["hud.snapshot"]
    },
    {
      id: "hud.events",
      version: BRIDGE_PROTOCOL_VERSION,
      operations: ["hud.subscribe"]
    },
    { id: "hud.geometry", version: BRIDGE_PROTOCOL_VERSION }
  ]);

const OPERATIONS_BY_CAPABILITY: Readonly<Record<CapabilityId, readonly BridgeOperation[]>> =
  Object.freeze({
    "session.read": ["session.snapshot"],
    "session.events": ["session.subscribe"],
    "session.pause": ["session.pause"],
    "session.resume": ["session.resume"],
    "tasks.read": ["tasks.snapshot"],
    "tasks.events": ["tasks.subscribe"],
    "hud.read": ["hud.snapshot"],
    "hud.events": ["hud.subscribe"],
    "hud.geometry": []
  });

export function operationsForCapability(id: CapabilityId): readonly BridgeOperation[] {
  return OPERATIONS_BY_CAPABILITY[id];
}

export function createClientHello(clientVersion: string, nonce: string): ClientHello {
  return {
    clientId: "promethee-pomodoro",
    clientVersion,
    supportedProtocolVersions: [BRIDGE_PROTOCOL_VERSION],
    requestedCapabilities: SAFE_V1_CAPABILITY_REQUESTS,
    nonce
  };
}

export function findGrant(
  grants: readonly CapabilityGrant[],
  capabilityId: CapabilityId
): CapabilityGrant | null {
  return grants.find((grant) => grant.id === capabilityId) ?? null;
}

export function grantAllows(
  grants: readonly CapabilityGrant[],
  capabilityId: CapabilityId,
  operation: BridgeOperation
): boolean {
  const grant = findGrant(grants, capabilityId);
  return grant?.operations?.includes(operation) === true;
}
