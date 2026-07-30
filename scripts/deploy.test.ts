import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  RELEASE_SURFACE,
  type CommandResult,
  type DeployDependencies,
  runDeploy,
} from "./deploy.ts";

const COMMIT = "1234567890abcdef1234567890abcdef12345678";
const TAG_OBJECT = "abcdef1234567890abcdef1234567890abcdef12";
const TAG = "v2.1.4";

interface FakeOptions {
  dirty?: string;
  branch?: string;
  remoteMain?: string;
  localTag?: boolean;
  remoteTag?: boolean;
  githubTag?: boolean;
  githubRelease?: boolean;
  readbackCommit?: string;
  readbackTagObject?: string;
}

function fakeDependencies(options: FakeOptions = {}) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  let pushed = false;

  const dependencies: DeployDependencies = {
    readVersion: () => "2.1.4",
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    run(command, args): CommandResult {
      calls.push({ command, args: [...args] });
      const invocation = `${command} ${args.join(" ")}`;

      if (invocation === "git status --porcelain=v1 --untracked-files=all") {
        return ok(options.dirty ?? "");
      }
      if (
        invocation ===
        "git symbolic-ref --quiet --short HEAD"
      ) {
        return options.branch === "<detached>"
          ? fail(1)
          : ok(options.branch ?? "main");
      }
      if (invocation === "git rev-parse HEAD") return ok(COMMIT);
      if (invocation === "git ls-remote origin refs/heads/main") {
        const sha = options.remoteMain ?? COMMIT;
        return ok(`${sha}\trefs/heads/main\n`);
      }
      if (
        invocation ===
        `git show-ref --verify --quiet refs/tags/${TAG}`
      ) {
        return options.localTag ? ok() : fail(1);
      }
      if (
        invocation ===
        `git ls-remote --tags origin refs/tags/${TAG} refs/tags/${TAG}^{}`
      ) {
        if (pushed) {
          return ok(
            `${options.readbackTagObject ?? TAG_OBJECT}\trefs/tags/${TAG}\n` +
              `${options.readbackCommit ?? COMMIT}\trefs/tags/${TAG}^{}\n`,
          );
        }
        return options.remoteTag
          ? ok(`${TAG_OBJECT}\trefs/tags/${TAG}\n`)
          : ok();
      }
      if (
        invocation ===
        `gh api repos/tako0614/takos-computer/git/ref/tags/${TAG}`
      ) {
        if (pushed || options.githubTag) {
          return ok(
            JSON.stringify({
              ref: `refs/tags/${TAG}`,
              object: {
                type: "tag",
                sha: options.readbackTagObject ?? TAG_OBJECT,
              },
            }),
          );
        }
        return fail(1, "gh: Not Found (HTTP 404)");
      }
      if (
        invocation ===
        `gh release view ${TAG} --repo tako0614/takos-computer`
      ) {
        return options.githubRelease
          ? ok(`Takos Computer ${TAG}`)
          : fail(1, "release not found");
      }
      if (invocation === "bun run check") return ok();
      if (
        invocation ===
        `git tag --annotate ${TAG} ${COMMIT} --message Takos Computer ${TAG}\n\nSource-Commit: ${COMMIT}`
      ) {
        return ok();
      }
      if (
        invocation === `git cat-file -t refs/tags/${TAG}`
      ) {
        return ok("tag");
      }
      if (
        invocation === `git rev-parse refs/tags/${TAG}`
      ) {
        return ok(TAG_OBJECT);
      }
      if (
        invocation === `git rev-parse refs/tags/${TAG}^{}`
      ) {
        return ok(COMMIT);
      }
      if (
        invocation ===
        `git push origin refs/tags/${TAG}:refs/tags/${TAG}`
      ) {
        pushed = true;
        return ok();
      }
      return fail(127, `unexpected command: ${invocation}`);
    },
  };

  return { dependencies, calls, stdout, stderr };
}

function ok(stdout = ""): CommandResult {
  return { exitCode: 0, stdout, stderr: "" };
}

function fail(exitCode: number, stderr = ""): CommandResult {
  return { exitCode, stdout: "", stderr };
}

function commandStrings(
  calls: Array<{ command: string; args: string[] }>,
): string[] {
  return calls.map(({ command, args }) => `${command} ${args.join(" ")}`);
}

describe("Takos Computer immutable source release", () => {
  test("--contract is side-effect-free and declares every release obligation", () => {
    const fake = fakeDependencies();
    expect(runDeploy(["--contract"], fake.dependencies)).toBe(0);
    expect(fake.calls).toEqual([]);

    const contract = JSON.parse(fake.stdout.join("")) as {
      kind: string;
      surfaces: Array<{
        surface: string;
        triggers: string[];
        obligations: Record<string, string>;
      }>;
    };
    expect(contract.kind).toBe("takos.deploy-contract@v2");
    expect(contract.surfaces).toHaveLength(1);
    expect(contract.surfaces[0]?.surface).toBe(RELEASE_SURFACE);
    expect(contract.surfaces[0]?.triggers).toEqual(["published-identity"]);
    expect(Object.keys(contract.surfaces[0]?.obligations ?? {}).sort()).toEqual(
      [
        "failure-handling",
        "no-overwrite",
        "post-conditions",
        "provenance",
        "reversal",
      ],
    );
  });

  test("package.json owns v2.1.4 and the product deploy entrypoint", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string; scripts: Record<string, string> };
    expect(packageJson.version).toBe("2.1.4");
    expect(packageJson.scripts.deploy).toBe("bun scripts/deploy.ts");
  });

  test.each([
    ["dirty source", { dirty: " M README.md" }, "worktree is not clean"],
    ["detached source", { branch: "<detached>" }, "detached HEAD"],
    ["non-main source", { branch: "feature/x" }, "requires main"],
    [
      "unpushed source",
      { remoteMain: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      "does not equal origin main",
    ],
  ] as const)("%s is blocked before the owner gate", (_label, options, error) => {
    const fake = fakeDependencies(options);
    expect(runDeploy([RELEASE_SURFACE], fake.dependencies)).toBe(1);
    expect(fake.stderr.join("")).toContain(error);
    expect(commandStrings(fake.calls)).not.toContain("bun run check");
    expect(commandStrings(fake.calls).some((call) => call.startsWith("git tag ")))
      .toBe(false);
  });

  test.each([
    ["local tag", { localTag: true }, "local tag v2.1.4 already exists"],
    ["remote tag", { remoteTag: true }, "remote tag v2.1.4 already exists"],
    ["GitHub tag", { githubTag: true }, "GitHub tag v2.1.4 already exists"],
    [
      "GitHub Release",
      { githubRelease: true },
      "GitHub Release v2.1.4 already exists",
    ],
  ] as const)("%s is never overwritten", (_label, options, error) => {
    const fake = fakeDependencies(options);
    expect(runDeploy([RELEASE_SURFACE], fake.dependencies)).toBe(1);
    expect(fake.stderr.join("")).toContain(error);
    expect(commandStrings(fake.calls)).not.toContain("bun run check");
  });

  test("dry-run revalidates after the full gate without creating a tag", () => {
    const fake = fakeDependencies();
    expect(runDeploy([RELEASE_SURFACE], fake.dependencies)).toBe(0);

    const calls = commandStrings(fake.calls);
    expect(calls.filter((call) => call === "bun run check")).toHaveLength(1);
    expect(
      calls.filter((call) =>
        call.startsWith("git show-ref --verify --quiet refs/tags/"),
      ),
    ).toHaveLength(2);
    expect(calls.some((call) => call.startsWith("git tag --annotate"))).toBe(
      false,
    );
    expect(calls.some((call) => call.startsWith("git push "))).toBe(false);
    expect(fake.stdout.join("")).toContain('"status": "DRY_RUN_VERIFIED"');
    expect(fake.stdout.join("")).toContain(`"commit": "${COMMIT}"`);
    expect(fake.stdout.join("")).toContain(`"tag": "${TAG}"`);
  });

  test("--execute creates one annotated tag without force and verifies exact refs", () => {
    const fake = fakeDependencies();
    expect(
      runDeploy([RELEASE_SURFACE, "--execute"], fake.dependencies),
    ).toBe(0);

    const calls = commandStrings(fake.calls);
    const gate = calls.indexOf("bun run check");
    const tag = calls.findIndex((call) =>
      call.startsWith(`git tag --annotate ${TAG} ${COMMIT}`),
    );
    const push = calls.indexOf(
      `git push origin refs/tags/${TAG}:refs/tags/${TAG}`,
    );
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(tag).toBeGreaterThan(gate);
    expect(push).toBeGreaterThan(tag);
    expect(calls.join("\n")).not.toContain("--force");
    expect(calls.join("\n")).not.toContain("tag -d");
    expect(fake.stdout.join("")).toContain('"status": "PUBLISHED"');
    expect(fake.stdout.join("")).toContain(
      '"postConditions": "EXACT_ANNOTATED_TAG_READBACK"',
    );
  });

  test("a postcondition mismatch is indeterminate and never deletes the tag", () => {
    const fake = fakeDependencies({
      readbackCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    expect(
      runDeploy([RELEASE_SURFACE, "--execute"], fake.dependencies),
    ).toBe(1);
    expect(fake.stderr.join("")).toContain("publication is indeterminate");
    expect(fake.stderr.join("")).toContain("expected");
    expect(commandStrings(fake.calls).join("\n")).not.toContain("tag -d");
    expect(commandStrings(fake.calls).join("\n")).not.toContain("delete");
  });

  test("CI cannot create tags or releases", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).not.toMatch(/branches:\s*\[[^\]]*tags/);
    expect(workflow).not.toMatch(/\btags:\s*/);
    expect(workflow).not.toMatch(/gh release create/);
    expect(workflow).not.toMatch(/git push[^\n]*refs\/tags/);
    expect(workflow).not.toMatch(/contents:\s*write/);
  });
});
