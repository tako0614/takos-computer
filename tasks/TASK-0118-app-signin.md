# TASK-0118 Phase 7: per-app sign-in claims

- Scope: takos-computer GUI OIDC claims and session readback only.
- Authority: the verified ID token's `takosumi.capsule_id` must match the
  install-context `APP_CAPSULE_ID`; `app_role` accepts only `owner` or `member`.
  A matching Capsule without a role is an ordinary app user. Foreign Capsules
  and explicit malformed roles fail authentication, including on session reads.
- Compatibility: claim-absent legacy sessions and identity fields remain valid.
  Legacy `role` does not grant new management authority.
- App management: `/gui/api/auth/me` exposes `capsuleId`, `appRole`, and
  `canManageApp`. Existing per-user sandbox ACLs remain authoritative.
- Runtime wiring: `main.tf` already passes install-context `app_capsule_id` and
  `app_workspace_id` to the OpenTofu deploy adapter, which injects both Worker
  variables; retain this reviewed path.
- Coordination: PR #9 and PR #8 are merged. Their active local worktrees were
  clean and their owned files matched `origin/main` before this change. No
  unmerged overlap was found; no TASK-0117 worktree was edited.
- Validation: focused auth/session and deploy-configuration tests plus static
  checks locally; the full repository gate runs in CI under the Phase 7 resource
  constraint. No deploy, live sign-in, live database, provider, or secret changes.
  Local results: 63 focused tests pass, `bun run typecheck` passes, and
  `git diff --check` passes. Tests cover verified OIDC callbacks, current Capsule
  rechecks, malformed roles, legacy compatibility, and unchanged sandbox ACLs.
- Reversal: revert this commit; no schema or durable-state migration is required.
