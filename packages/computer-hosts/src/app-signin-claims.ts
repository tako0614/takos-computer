// Membership snapshots gate funded GUI sandbox creation. Sandbox access still
// requires the existing per-user ACL, independently of app membership.
export type AppSignInClaims = {
  capsuleId?: string;
  appRole?: "owner" | "member";
  // Retain the source binding so a runtime Workspace change invalidates the
  // compatibility grant instead of converting it into a Capsule app role.
  legacyWorkspaceId?: string;
};

export function resolveAppSignInClaims(
  evidence: unknown,
  expectedCapsuleId: string | undefined,
  expectedWorkspaceId?: string,
  workspaceMemberships?: unknown,
): AppSignInClaims {
  if (evidence !== undefined && (
    !evidence || typeof evidence !== "object" || Array.isArray(evidence)
  )) {
    throw new Error("Invalid Takosumi sign-in claims");
  }
  const claims = (evidence ?? {}) as Record<string, unknown>;
  const result: AppSignInClaims = {};
  if (claims.capsule_id !== undefined && (
    typeof claims.capsule_id !== "string" || !claims.capsule_id ||
    (expectedCapsuleId && claims.capsule_id !== expectedCapsuleId)
  )) {
    throw new Error("Takosumi sign-in Capsule mismatch");
  }
  // Legacy OIDC installations have no Capsule binding. Ignore a valid issuer
  // Capsule claim there; it must never supply its own expected binding.
  if (expectedCapsuleId && claims.capsule_id !== undefined) {
    result.capsuleId = claims.capsule_id as string;
  }
  if (claims.app_role !== undefined) {
    if (claims.app_role !== "owner" && claims.app_role !== "member") {
      throw new Error("Invalid app role in Takosumi sign-in");
    }
    if (claims.capsule_id === undefined) {
      throw new Error("Takosumi sign-in Capsule mismatch");
    }
    // An issuer claim cannot establish its own expected Capsule. Legacy
    // Workspace-only installs ignore the app role and keep their Workspace gate.
    if (expectedCapsuleId) {
      return { ...result, appRole: claims.app_role };
    }
  }

  // Current Accounts emits takosumi.{capsule_id,workspace_id,role} plus a
  // top-level string[] workspace_memberships, without app_role. Only a
  // configured matching Workspace may supply compatibility membership.
  if (!expectedWorkspaceId) return result;
  if (
    claims.workspace_id !== undefined &&
    claims.workspace_id !== expectedWorkspaceId
  ) {
    throw new Error("Takosumi sign-in Workspace mismatch");
  }
  if (claims.role !== undefined && (
    typeof claims.role !== "string" ||
    !["owner", "admin", "member", "viewer"].includes(claims.role)
  )) {
    throw new Error("Invalid legacy Workspace role in Takosumi sign-in");
  }
  if (workspaceMemberships !== undefined && (
    !Array.isArray(workspaceMemberships) ||
    !workspaceMemberships.every((id) => typeof id === "string" && id.length > 0)
  )) {
    throw new Error("Invalid legacy Workspace memberships in Takosumi sign-in");
  }
  if (
    Array.isArray(workspaceMemberships) &&
    !workspaceMemberships.includes(expectedWorkspaceId) &&
    (claims.workspace_id !== undefined || claims.role !== undefined)
  ) {
    throw new Error("Takosumi sign-in Workspace membership mismatch");
  }
  // Capsule-scoped compatibility must also bind the nested Workspace. Flat
  // membership-only compatibility is reserved for legacy identity context.
  if (result.capsuleId && claims.workspace_id === undefined) return result;
  if (
    (claims.workspace_id === expectedWorkspaceId && claims.role !== undefined) ||
    (Array.isArray(workspaceMemberships) &&
      workspaceMemberships.includes(expectedWorkspaceId))
  ) {
    return {
      ...result,
      // Legacy Workspace roles prove compatibility membership, not ownership
      // of this app. Accounts must issue a bound app_role for app ownership.
      appRole: "member",
      legacyWorkspaceId: expectedWorkspaceId,
    };
  }
  return result;
}
