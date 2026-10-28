// Per-app management claims supplement the GUI's existing sandbox ACL.
// Legacy workspace/role claims remain compatible identity data only.
export type AppSignInClaims = {
  capsuleId?: string;
  appRole?: "owner" | "member";
};

export function resolveAppSignInClaims(
  evidence: unknown,
  expectedCapsuleId: string | undefined,
): AppSignInClaims {
  if (evidence === undefined) return {};
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("Invalid Takosumi sign-in claims");
  }
  const claims = evidence as Record<string, unknown>;
  if (claims.capsule_id === undefined && claims.app_role === undefined) {
    return {};
  }
  if (
    typeof claims.capsule_id !== "string" || !claims.capsule_id ||
    !expectedCapsuleId || claims.capsule_id !== expectedCapsuleId
  ) {
    throw new Error("Takosumi sign-in Capsule mismatch");
  }
  if (
    claims.app_role !== undefined && claims.app_role !== "owner" &&
    claims.app_role !== "member"
  ) {
    throw new Error("Invalid app role in Takosumi sign-in");
  }
  return {
    capsuleId: claims.capsule_id,
    ...(claims.app_role ? { appRole: claims.app_role } : {}),
  };
}
