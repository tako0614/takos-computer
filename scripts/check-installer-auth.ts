/** Native, provider-free evaluation of the actual root module deployment input. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "computer-installer-auth-"));
const tofu = process.env.TAKOS_COMPUTER_TOFU ?? "tofu";
const registration = {
  cloudflare_account_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  public_url: "https://computer.example.test",
  takosumi_accounts_url: "https://accounts.example.test",
  takosumi_accounts_issuer_url: "https://accounts.example.test",
  oidc_client_id: "source-test-public-client",
  oidc_redirect_uri: "https://computer.example.test/gui/api/auth/callback",
  app_capsule_id: "source-test-capsule",
};
const cases = [
  { name: "repository registration enables GUI", variables: registration, enabled: true },
  { name: "explicit false is retained", variables: { ...registration, enable_app_oidc: false }, enabled: false },
  { name: "explicit true is retained", variables: { ...registration, enable_app_oidc: true }, enabled: true },
  { name: "MCP-only Capsule does not imply browser registration", variables: { cloudflare_account_id: registration.cloudflare_account_id, public_url: registration.public_url, takosumi_accounts_issuer_url: registration.takosumi_accounts_issuer_url, app_capsule_id: registration.app_capsule_id }, enabled: false },
  { name: "standalone without registration stays off", variables: { cloudflare_account_id: registration.cloudflare_account_id, public_url: registration.public_url }, enabled: false },
] as const;

try {
  const env: Record<string, string> = {};
  // Console needs installed provider schemas, never operator/provider credentials.
  for (const key of ["PATH", "HOME", "TMPDIR", "TF_DATA_DIR", "TF_CLI_CONFIG_FILE", "TF_PLUGIN_CACHE_DIR"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key]!;
  }
  env.CHECKPOINT_DISABLE = "1";
  env.TF_IN_AUTOMATION = "1";
  for (const [index, item] of cases.entries()) {
    const variables = join(temporary, `${index}.tfvars.json`);
    await writeFile(variables, JSON.stringify(item.variables), { mode: 0o600 });
    const child = Bun.spawn([tofu, "-chdir=" + root, "console", "-no-color", "-state=" + join(temporary, "unused.tfstate"), "-var-file=" + variables], {
      cwd: root, env, stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    child.stdin.write("jsonencode({ enabled = local.deploy_input.appOidc, capsule = local.deploy_input.capsuleId })\n");
    await child.stdin.flush();
    child.stdin.end();
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`Native installer auth console failed: ${item.name}\n${stderr}`);
    const actual = JSON.parse(JSON.parse(stdout.trim())) as { enabled: boolean; capsule: string };
    const expectedCapsule = "app_capsule_id" in item.variables ? item.variables.app_capsule_id : "";
    if (actual.enabled !== item.enabled || actual.capsule !== expectedCapsule) {
      throw new Error(`Native installer auth mismatch: ${item.name} (enabled=${actual.enabled})`);
    }
    console.log(`PASS: ${item.name}`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
