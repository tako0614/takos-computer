#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE_SURFACE = "takos-computer-source-release";

const REPOSITORY = "tako0614/takos-computer";
const OWNER_GATE = "bun run check";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CONTRACT = {
  kind: "takos.deploy-contract@v2",
  surfaces: [
    {
      surface: RELEASE_SURFACE,
      target: `git-tag:github.com/${REPOSITORY}/v<package-version>`,
      requiresScripts: ["check"],
      requiresTools: ["git", "bun", "gh"],
      requiresEnv: [],
      triggers: ["published-identity"],
      obligations: {
        provenance:
          "derives one SemVer tag from package.json; refuses a dirty, detached, non-main, or unpushed source tree; runs `bun run check`; revalidates the exact source commit after the gate; and records the full commit, annotated tag, and tag-object ids",
        "post-conditions":
          "reads refs/tags/<tag> and refs/tags/<tag>^{} from origin, requires the remote tag object to be annotated and its peeled ref to equal the exact source commit, then requires the GitHub Git-ref API to report that same tag object",
        reversal:
          "the entrypoint never replaces or deletes a tag; consumers can keep pinning the preceding release, and a defect is repaired with a higher SemVer tag. If only a local tag exists after a partial failure, an operator may remove that local-only ref only after authoritative proof that origin has no matching ref",
        "failure-handling":
          "prints command diagnostics and fails before mutation whenever absence or source identity cannot be proven; after local tag creation starts, any error is reported as an indeterminate publication and requires authoritative local, origin, and GitHub ref inspection before further action",
        "no-overwrite":
          "checks local tags, origin tags, the GitHub Git-ref API, and GitHub Releases both before and after the owner gate; creates one annotated tag and pushes it without force; and contains no update, force, remote-delete, or release-delete path",
      },
    },
  ],
} as const;

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DeployDependencies {
  readVersion(): string;
  run(command: string, args: string[]): CommandResult;
  stdout(text: string): void;
  stderr(text: string): void;
}

class DeployBlocked extends Error {
  constructor(
    message: string,
    readonly mutationStarted = false,
  ) {
    super(message);
  }
}

function defaultDependencies(): DeployDependencies {
  return {
    readVersion() {
      const packageJson = JSON.parse(
        readFileSync(resolve(root, "package.json"), "utf8"),
      ) as { version?: unknown };
      return String(packageJson.version ?? "");
    },
    run(command, args) {
      const result = spawnSync(command, args, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return {
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr:
          (result.stderr ?? "") +
          (result.error ? `${result.error.message}\n` : ""),
      };
    },
    stdout(text) {
      process.stdout.write(text);
    },
    stderr(text) {
      process.stderr.write(text);
    },
  };
}

function outputJson(
  dependencies: DeployDependencies,
  value: Record<string, unknown>,
): void {
  dependencies.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

function commandDetail(result: CommandResult): string {
  return [result.stdout.trim(), result.stderr.trim()]
    .filter(Boolean)
    .join("\n");
}

function requireSuccess(
  dependencies: DeployDependencies,
  command: string,
  args: string[],
  label: string,
  mutationStarted = false,
): string {
  const result = dependencies.run(command, args);
  if (result.exitCode !== 0) {
    const detail = commandDetail(result);
    throw new DeployBlocked(
      `${label} failed${detail ? `:\n${detail}` : ""}`,
      mutationStarted,
    );
  }
  return result.stdout.trim();
}

function requireSourceIdentity(dependencies: DeployDependencies): string {
  const status = requireSuccess(
    dependencies,
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    "cannot inspect the worktree",
  );
  if (status !== "") {
    throw new DeployBlocked(
      `the worktree is not clean; release bytes must belong to one commit:\n${status}`,
    );
  }

  const branchResult = dependencies.run("git", [
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  ]);
  if (branchResult.exitCode !== 0) {
    if (branchResult.exitCode === 1) {
      throw new DeployBlocked("release publication refuses detached HEAD");
    }
    throw new DeployBlocked(
      `cannot determine the current branch${commandDetail(branchResult) ? `:\n${commandDetail(branchResult)}` : ""}`,
    );
  }
  const branch = branchResult.stdout.trim();
  if (branch !== "main") {
    throw new DeployBlocked(
      `release publication requires main, found ${branch || "<empty>"}`,
    );
  }

  const commit = requireSuccess(
    dependencies,
    "git",
    ["rev-parse", "HEAD"],
    "cannot resolve HEAD",
  );
  if (!/^[a-f0-9]{40,64}$/u.test(commit)) {
    throw new DeployBlocked(`HEAD resolved to an invalid commit id: ${commit}`);
  }

  const remoteMain = requireSuccess(
    dependencies,
    "git",
    ["ls-remote", "origin", "refs/heads/main"],
    "cannot read origin main",
  );
  const remoteCommit = parseRemoteRef(remoteMain, "refs/heads/main");
  if (remoteCommit !== commit) {
    throw new DeployBlocked(
      `local main ${commit} does not equal origin main ${remoteCommit || "<missing>"}`,
    );
  }
  return commit;
}

function parseRemoteRef(output: string, ref: string): string {
  for (const line of output.split(/\r?\n/u)) {
    const [sha, name] = line.trim().split(/\s+/u);
    if (name === ref && sha) return sha;
  }
  return "";
}

function githubAbsence(
  result: CommandResult,
  label: string,
): void {
  if (result.exitCode === 0) {
    throw new DeployBlocked(`${label} already exists`);
  }
  const detail = commandDetail(result);
  if (!/(?:HTTP\s+404|Not Found|release not found)/iu.test(detail)) {
    throw new DeployBlocked(
      `cannot prove ${label} is absent${detail ? `:\n${detail}` : ""}`,
    );
  }
}

function requireNoExistingIdentity(
  dependencies: DeployDependencies,
  tag: string,
): void {
  const local = dependencies.run("git", [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/tags/${tag}`,
  ]);
  if (local.exitCode === 0) {
    throw new DeployBlocked(`local tag ${tag} already exists`);
  }
  if (local.exitCode !== 1) {
    throw new DeployBlocked(
      `cannot prove local tag ${tag} is absent${commandDetail(local) ? `:\n${commandDetail(local)}` : ""}`,
    );
  }

  const remote = requireSuccess(
    dependencies,
    "git",
    [
      "ls-remote",
      "--tags",
      "origin",
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ],
    `cannot inspect origin tag ${tag}`,
  );
  if (remote !== "") {
    throw new DeployBlocked(`remote tag ${tag} already exists`);
  }

  githubAbsence(
    dependencies.run("gh", [
      "api",
      `repos/${REPOSITORY}/git/ref/tags/${tag}`,
    ]),
    `GitHub tag ${tag}`,
  );
  githubAbsence(
    dependencies.run("gh", [
      "release",
      "view",
      tag,
      "--repo",
      REPOSITORY,
    ]),
    `GitHub Release ${tag}`,
  );
}

function semverTag(version: string): string {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(version)) {
    throw new DeployBlocked(
      `package.json version ${JSON.stringify(version)} must be a stable SemVer`,
    );
  }
  return `v${version}`;
}

function createAndPublishTag(
  dependencies: DeployDependencies,
  commit: string,
  tag: string,
): { tagObject: string } {
  const mutationFailure = (
    command: string,
    args: string[],
    label: string,
  ): string =>
    requireSuccess(dependencies, command, args, label, true);

  mutationFailure(
    "git",
    [
      "tag",
      "--annotate",
      tag,
      commit,
      "--message",
      `Takos Computer ${tag}\n\nSource-Commit: ${commit}`,
    ],
    `cannot create local annotated tag ${tag}`,
  );

  const objectType = mutationFailure(
    "git",
    ["cat-file", "-t", `refs/tags/${tag}`],
    `cannot inspect local tag ${tag}`,
  );
  if (objectType !== "tag") {
    throw new DeployBlocked(
      `local ref refs/tags/${tag} is ${objectType || "<missing>"}, expected an annotated tag object`,
      true,
    );
  }
  const tagObject = mutationFailure(
    "git",
    ["rev-parse", `refs/tags/${tag}`],
    `cannot resolve local tag object ${tag}`,
  );
  const peeledCommit = mutationFailure(
    "git",
    ["rev-parse", `refs/tags/${tag}^{}`],
    `cannot peel local tag ${tag}`,
  );
  if (peeledCommit !== commit) {
    throw new DeployBlocked(
      `local tag ${tag} resolves to ${peeledCommit || "<missing>"}, expected ${commit}`,
      true,
    );
  }

  mutationFailure(
    "git",
    ["push", "origin", `refs/tags/${tag}:refs/tags/${tag}`],
    `push of ${tag} did not complete cleanly`,
  );
  return { tagObject };
}

function verifyPublishedTag(
  dependencies: DeployDependencies,
  commit: string,
  tag: string,
  tagObject: string,
): void {
  const remote = requireSuccess(
    dependencies,
    "git",
    [
      "ls-remote",
      "--tags",
      "origin",
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ],
    `cannot read origin tag ${tag}`,
    true,
  );
  const remoteObject = parseRemoteRef(remote, `refs/tags/${tag}`);
  const remoteCommit = parseRemoteRef(remote, `refs/tags/${tag}^{}`);
  if (remoteObject !== tagObject || remoteCommit !== commit) {
    throw new DeployBlocked(
      `origin tag ${tag} has object ${remoteObject || "<missing>"} and commit ${remoteCommit || "<missing>"}, expected object ${tagObject} and commit ${commit}`,
      true,
    );
  }

  const githubRef = requireSuccess(
    dependencies,
    "gh",
    ["api", `repos/${REPOSITORY}/git/ref/tags/${tag}`],
    `cannot read GitHub tag ${tag}`,
    true,
  );
  let decoded: unknown;
  try {
    decoded = JSON.parse(githubRef);
  } catch {
    throw new DeployBlocked(
      `GitHub tag ${tag} readback was not JSON`,
      true,
    );
  }
  const ref = decoded as {
    ref?: unknown;
    object?: { type?: unknown; sha?: unknown };
  };
  if (
    ref.ref !== `refs/tags/${tag}` ||
    ref.object?.type !== "tag" ||
    ref.object.sha !== tagObject
  ) {
    throw new DeployBlocked(
      `GitHub tag ${tag} does not report annotated object ${tagObject}`,
      true,
    );
  }
}

function deployRelease(
  execute: boolean,
  dependencies: DeployDependencies,
): void {
  const tag = semverTag(dependencies.readVersion());
  const firstCommit = requireSourceIdentity(dependencies);
  requireNoExistingIdentity(dependencies, tag);

  dependencies.stdout(`\n==> ${OWNER_GATE}\n`);
  const gate = dependencies.run("bun", ["run", "check"]);
  if (gate.stdout) dependencies.stdout(gate.stdout);
  if (gate.stderr) dependencies.stderr(gate.stderr);
  if (gate.exitCode !== 0) {
    throw new DeployBlocked(`${OWNER_GATE} failed`);
  }

  const commit = requireSourceIdentity(dependencies);
  if (commit !== firstCommit) {
    throw new DeployBlocked(
      `source commit changed during the owner gate: ${firstCommit} -> ${commit}`,
    );
  }
  requireNoExistingIdentity(dependencies, tag);

  if (!execute) {
    outputJson(dependencies, {
      kind: "takos.deploy-result@v1",
      surface: RELEASE_SURFACE,
      target: `git-tag:github.com/${REPOSITORY}/${tag}`,
      commit,
      tag,
      status: "DRY_RUN_VERIFIED",
    });
    return;
  }

  dependencies.stdout(`\n==> create immutable annotated tag ${tag}\n`);
  const { tagObject } = createAndPublishTag(
    dependencies,
    commit,
    tag,
  );
  verifyPublishedTag(dependencies, commit, tag, tagObject);
  outputJson(dependencies, {
    kind: "takos.deploy-result@v1",
    surface: RELEASE_SURFACE,
    target: `git-tag:github.com/${REPOSITORY}/${tag}`,
    commit,
    tag,
    tagObject,
    postConditions: "EXACT_ANNOTATED_TAG_READBACK",
    status: "PUBLISHED",
  });
}

export function runDeploy(
  args: string[],
  dependencies: DeployDependencies = defaultDependencies(),
): number {
  if (args.length === 1 && args[0] === "--contract") {
    dependencies.stdout(`${JSON.stringify(CONTRACT, null, 2)}\n`);
    return 0;
  }

  const execute =
    args.length === 2 &&
    args[0] === RELEASE_SURFACE &&
    args[1] === "--execute";
  const dryRun = args.length === 1 && args[0] === RELEASE_SURFACE;
  if (!execute && !dryRun) {
    dependencies.stderr(
      `usage: bun run deploy -- ${RELEASE_SURFACE} [--execute]\n`,
    );
    return 1;
  }

  try {
    deployRelease(execute, dependencies);
    return 0;
  } catch (error) {
    if (error instanceof DeployBlocked) {
      const prefix = error.mutationStarted
        ? "deploy failed after tag mutation started: publication is indeterminate"
        : "deploy blocked";
      dependencies.stderr(`${prefix}: ${error.message}\n`);
      if (error.mutationStarted) {
        dependencies.stderr(
          "inspect the local tag, origin refs/tags/<tag>, and GitHub Git ref before any retry; do not overwrite or delete a published identity\n",
        );
      }
      return 1;
    }
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    dependencies.stderr(`deploy blocked: unexpected error:\n${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = runDeploy(process.argv.slice(2));
}
