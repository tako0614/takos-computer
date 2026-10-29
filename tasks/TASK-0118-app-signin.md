# TASK-0118 Phase 7: app sign-in and funded sandbox creation

- Scope: takos-computer GUI OIDC claims/session readback, funded GUI sandbox
  creation, machine Interface OAuth, and Capsule/legacy OpenTofu context.
- Authority: configured `APP_CAPSULE_ID` is the exact Capsule binding. Explicit
  `app_role` accepts only `owner` or `member`. A foreign Capsule or malformed
  explicit role/envelope fails authentication. A matching ordinary identity
  may sign in without gaining permission to create a funded sandbox.
- Current Accounts compatibility: the verified ID token currently carries
  `takosumi.{capsule_id,workspace_id,role}` and top-level string-array
  `workspace_memberships`, without `app_role`. When `app_role` is absent, only
  the configured matching `APP_WORKSPACE_ID` grants legacy membership. Legacy
  owner/admin/member/viewer retain their previous ability to create a sandbox
  as compatible members. Legacy Workspace role alone cannot prove app owner;
  Accounts must compare ownerUserId with the user before issuing a bound
  app_role=owner. Capsule-scoped compatibility also requires the matching
  nested Workspace id. A matching membership array alone
  grants member only in legacy Capsule-claim-absent or Capsule-unconfigured
  context, never owner. Malformed or conflicting supplied legacy evidence
  fails closed. An ordinary identity with no matching membership gets no grant.
- Legacy OIDC: when `APP_CAPSULE_ID` is unset, the issuer's valid Capsule claim
  and app_role are ignored and cannot define the expected binding. Configured
  Workspace membership remains supported. OpenTofu permits this with `enable_app_oidc`
  and a direct MCP bearer; it does not enable machine Interface OAuth.
- Funded creation: the shared create handler checks GUI app/legacy membership
  before parsing the payload or accessing the Container/quota/index. A normal
  signed-in user gets 403. Only an operator's explicit Worker setting
  `APP_ALLOW_PUBLIC_SANDBOX_CREATION=true` opens creation to other authenticated
  users. It does not allow anonymous creation. Host-admin/trusted-router and
  machine authorities keep their existing boundaries.
- OpenTofu: `allow_public_sandbox_creation` is nullable. With GUI OIDC and no
  configured app Capsule or Workspace, the plan requires an explicit choice:
  false retains the authenticated-user 403, true opts into funded creation.
  The deploy handoff emits `APP_ALLOW_PUBLIC_SANDBOX_CREATION=true` only for true.
  Existing app and Workspace binding checks are unchanged by this flag.
- Deploy order: update installable apps first, then open Accounts writer B #657
  sign-in issuance last. Unupdated self-host apps still rely on Workspace
  membership, so keep legacy claims until those apps have migrated.
- Session readback: `/gui/api/auth/me` exposes `capsuleId`, `appRole`, and
  `canManageApp`. Membership is a login snapshot with a maximum 12-hour session
  lifetime, used for sandbox creation. No access token is retained and there
  is no live role refresh or revocation lookup. Each request rechecks configured
  Capsule and compatibility Workspace bindings. A legacy-derived grant keeps
  its Workspace source marker, so a configuration change cannot silently turn
  it into a direct app role. Old cookies without membership need a new sign-in
  for creation; ordinary identities retain access to their own existing sessions.
- Sandbox ownership: app membership never grants another user's sandbox. GUI
  create still derives user/space from the sealed session; list/get/delete/MCP
  retain the per-user ACL and reserved published-MCP namespace boundary.
- Interface OAuth: issuer, exact configured Capsule/audience/scope/Interface/
  binding, and positive revision remain mandatory; an app role is not required.
  Optional Workspace evidence is validated when supplied. Capsule-only machine
  sandboxes keep empty legacy space context and ignore caller-supplied owners.
- Coordination: only PR #10 is open. Remote main `ff1407d` (TASK-0117 file-list
  UX, PR #11) was merged normally and its GUI changes were preserved. Existing
  remote TASK-0117/codex heads were inventoried; no foreign worktree was edited.
  The parent owns central coordination records.
- Validation: 84 focused tests across app claims, sandbox routes, Interface
  OAuth, and deploy config pass, alongside TypeScript, `git diff --check`, and
  `tofu fmt -check main.tf` and the Wrangler/OpenTofu static deploy check.
  Signed OIDC callback cases exercise the real current
  Accounts shape both with and without a configured Capsule, malformed and
  mismatched evidence, and binding changes. Creation tests prove ordinary
  identity is refused before any DO access, explicit opt-in stays authenticated,
  and member creates retain user ownership. Unbound OIDC creation is 403 until
  explicit opt-in, and a removed Capsule binding invalidates prior member
  snapshots. The Workspace-only deploy-config regression failed before its fix.
  Full repository/build/Container/OpenTofu
  checks run in CI under the Phase 7 resource constraint.
- Reversal: revert the change; there is no persisted schema migration. No
  deployment, live sign-in, live database, provider, or secret mutation occurred.
