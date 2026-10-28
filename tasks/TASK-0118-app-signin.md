# TASK-0118 Phase 7: per-app sign-in claims

- Scope: takos-computer GUI OIDC claims/session readback and machine Interface
  OAuth capability validation, including Capsule-only OpenTofu installation.
- Authority: the verified ID token's `takosumi.capsule_id` must match the
  install-context `APP_CAPSULE_ID`; `app_role` accepts only `owner` or `member`.
  A matching Capsule without a role is an ordinary app user. Foreign Capsules
  and explicit malformed roles fail authentication, including on session reads.
- Compatibility: claim-absent legacy sessions and identity fields remain valid.
  Legacy `role` does not grant new management authority.
- App management: `/gui/api/auth/me` exposes `capsuleId`, `appRole`, and
  `canManageApp`. Existing per-user sandbox ACLs remain authoritative.
  The role is a display-only login snapshot with a maximum 12-hour session
  lifetime. No access token is retained; no live role refresh or revocation
  lookup exists. The snapshot must not authorize current management operations.
- Runtime wiring: `main.tf` already passes install-context `app_capsule_id` and
  `app_workspace_id` to the OpenTofu deploy adapter, which injects both Worker
  variables. Capsule-only installs now inject `APP_CAPSULE_ID` independently;
  the Workspace variable is optional legacy context. Interface OAuth always
  requires the configured exact Capsule, audience, scope, Interface, binding,
  and positive revision; it does not require an app role. Workspace evidence
  may be omitted even with a configured legacy Workspace, and when supplied
  must be bounded and match that configuration if present.
- Coordination: PR #9 and PR #8 are merged. Their active local worktrees were
  clean and their owned files matched `origin/main` before this change. No
  unmerged overlap was found; no TASK-0117 worktree was edited.
- Validation: focused auth/session and deploy-configuration tests plus static
  checks locally; the full repository gate runs in CI under the Phase 7 resource
  constraint. No deploy, live sign-in, live database, provider, or secret changes.
  Local results: 73 focused tests, `bun run typecheck`, and
  `git diff --check` pass. Tests cover verified OIDC callbacks, current Capsule
  rechecks, malformed roles, legacy compatibility, and unchanged sandbox ACLs.
  Capsule-only configuration/capability regression was RED before the change;
  full CI also plans a Capsule-only installation without a direct bearer.
- Independent review: malformed explicit Takosumi claim envelopes now fail
  authentication instead of receiving legacy ordinary-user compatibility.
- Reversal: revert this commit; no schema or durable-state migration is required.
