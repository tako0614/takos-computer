declare module "cloudflare:workers" {
  type RuntimeDurableObjectState =
    import("@takos-computer/common/cf-types").DurableObjectState;

  export abstract class DurableObject<Env = unknown> {
    protected ctx: RuntimeDurableObjectState;
    protected env: Env;
    constructor(ctx: RuntimeDurableObjectState, env: Env);
  }
}
