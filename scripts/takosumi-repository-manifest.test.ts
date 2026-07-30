import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const text = await readFile(
  new URL(".well-known/takosumi.json", root),
  "utf8",
);
const manifest = JSON.parse(text) as RepositoryManifest;
const options = JSON.parse(
  await readFile(new URL("install-options.json", root), "utf8"),
) as { options: Array<{ source: { path: string } }> };
const moduleSource = await readFile(new URL("main.tf", root), "utf8");

test("Takos Computer publishes the closed Repository manifest for its selectable module", () => {
  expect(Object.keys(manifest).sort()).toEqual([
    "apiVersion",
    "install",
    "kind",
  ]);
  expect(manifest.apiVersion).toBe("takosumi.com/v1alpha1");
  expect(manifest.kind).toBe("Repository");
  expect(Object.keys(manifest.install)).toEqual(["modules"]);
  expect(Object.keys(manifest.install.modules)).toEqual(["."]);
  expect(options.options.map((option) => option.source.path)).toEqual(["."]);
});

test("manifest references real variables and no secret or host authority", () => {
  const module = manifest.install.modules["."];
  const variables = new Set(
    Array.from(
      moduleSource.matchAll(/variable\s+"([^"]+)"\s*\{/g),
      (match) => match[1],
    ),
  );
  for (const name of referencedVariables(module)) {
    expect(variables.has(name)).toBe(true);
  }
  for (const input of module.inputs) {
    expect(input.secret).toBeUndefined();
    if (input.source.kind === "module_default") {
      expect(variableBlock(moduleSource, input.name)).toMatch(
        /\n\s+default\s+=/,
      );
    }
  }
  for (const forbidden of [
    "cloudflare_account_id",
    "enable_cloudflare_resources",
    "published_mcp_auth_token",
    "sandbox_host_auth_token",
    "container_mcp_auth_token",
    "oidc_client_secret",
    "app_session_secret",
    "takos_token",
    "app_workspace_id",
    "app_capsule_id",
    "credential",
  ]) {
    expect(text).not.toContain(forbidden);
  }
  for (const authorityField of [
    "interfaceBlueprints",
    "outputAllowlist",
    "bindings",
    "permissions",
  ]) {
    expect(text).not.toContain(`"${authorityField}"`);
  }
});

test("the selected root module deploys instead of silently applying an empty graph", () => {
  expect(variableBlock(moduleSource, "enable_cloudflare_resources")).toMatch(
    /\n\s+default\s+=\s+true(?:\s|$)/,
  );
  expect(moduleSource).toContain(
    'resource "terraform_data" "sandbox_host_cleanup"',
  );
  expect(
    moduleSource.match(/command\s+=\s+"bun run destroy:opentofu"/g),
  ).toHaveLength(1);

  const deployResource = moduleSource.slice(
    moduleSource.indexOf('resource "terraform_data" "sandbox_host"'),
    moduleSource.indexOf(
      'resource "terraform_data" "sandbox_host_cleanup"',
    ),
  );
  expect(deployResource).not.toContain("when        = destroy");
  expect(deployResource).toContain("create_before_destroy = true");

  const cleanupResource = moduleSource.slice(
    moduleSource.indexOf(
      'resource "terraform_data" "sandbox_host_cleanup"',
    ),
  );
  expect(cleanupResource).toContain("when        = destroy");
  expect(cleanupResource).not.toContain("create_before_destroy = true");
  expect(cleanupResource).toContain(
    "trimspace(var.cloudflare_account_id)",
  );
  expect(cleanupResource).toContain("local.worker_name");
});

function variableBlock(source: string, name: string): string {
  const start = source.indexOf(`variable "${name}" {`);
  const next = source.indexOf("\nvariable ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

function referencedVariables(module: RepositoryModule): Set<string> {
  const names = new Set(module.inputs.map((input) => input.name));
  for (const projection of module.installExperience?.projections ?? []) {
    if (projection.variable) names.add(projection.variable);
    for (const value of Object.values(projection.variables ?? {})) {
      names.add(value);
    }
  }
  return names;
}

interface RepositoryManifest {
  apiVersion: string;
  kind: string;
  install: { modules: Record<string, RepositoryModule> };
}

interface RepositoryModule {
  inputs: Array<{
    name: string;
    source: { kind: string };
    secret?: boolean;
  }>;
  installExperience?: {
    projections: Array<{
      variable?: string;
      variables?: Record<string, string>;
    }>;
  };
}
