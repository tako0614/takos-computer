var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../../../../../.cache/deno/npm/registry.npmjs.org/@cloudflare/containers/0.1.1/dist/lib/helpers.js
function generateId(length = 9) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
}
function parseTimeExpression(timeExpression) {
  if (typeof timeExpression === "number") {
    return timeExpression;
  }
  if (typeof timeExpression === "string") {
    const match2 = timeExpression.match(/^(\d+)([smh])$/);
    if (!match2) {
      throw new Error(`invalid time expression ${timeExpression}`);
    }
    const value = parseInt(match2[1]);
    const unit = match2[2];
    switch (unit) {
      case "s":
        return value;
      case "m":
        return value * 60;
      case "h":
        return value * 60 * 60;
      default:
        throw new Error(`unknown time unit ${unit}`);
    }
  }
  throw new Error(`invalid type for a time expression: ${typeof timeExpression}`);
}
var init_helpers = __esm({
  "../../../../../../.cache/deno/npm/registry.npmjs.org/@cloudflare/containers/0.1.1/dist/lib/helpers.js"() {
  }
});

// ../../../../../../.cache/deno/npm/registry.npmjs.org/@cloudflare/containers/0.1.1/dist/lib/container.js
import { DurableObject } from "cloudflare:workers";
function isErrorOfType(e, matchingString) {
  const errorString = e instanceof Error ? e.message : String(e);
  return errorString.toLowerCase().includes(matchingString);
}
function getExitCodeFromError(error) {
  if (!(error instanceof Error)) {
    return null;
  }
  if (isRuntimeSignalledError(error)) {
    return +error.message.toLowerCase().slice(error.message.toLowerCase().indexOf(RUNTIME_SIGNALLED_ERROR) + RUNTIME_SIGNALLED_ERROR.length + 1);
  }
  if (isContainerExitNonZeroError(error)) {
    return +error.message.toLowerCase().slice(error.message.toLowerCase().indexOf(UNEXPECTED_EXIT_ERROR) + UNEXPECTED_EXIT_ERROR.length + 1);
  }
  return null;
}
function addTimeoutSignal(existingSignal, timeoutMs) {
  const controller = new AbortController();
  if (existingSignal?.aborted) {
    controller.abort();
    return controller.signal;
  }
  existingSignal?.addEventListener("abort", () => controller.abort());
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  controller.signal.addEventListener("abort", () => clearTimeout(timeoutId));
  return controller.signal;
}
var NO_CONTAINER_INSTANCE_ERROR, RUNTIME_SIGNALLED_ERROR, UNEXPECTED_EXIT_ERROR, NOT_LISTENING_ERROR, CONTAINER_STATE_KEY, MAX_ALARM_RETRIES, PING_TIMEOUT_MS, DEFAULT_SLEEP_AFTER, INSTANCE_POLL_INTERVAL_MS, TIMEOUT_TO_GET_CONTAINER_MS, TIMEOUT_TO_GET_PORTS_MS, FALLBACK_PORT_TO_CHECK, signalToNumbers, isNoInstanceError, isRuntimeSignalledError, isNotListeningError, isContainerExitNonZeroError, ContainerState, Container;
var init_container = __esm({
  "../../../../../../.cache/deno/npm/registry.npmjs.org/@cloudflare/containers/0.1.1/dist/lib/container.js"() {
    init_helpers();
    NO_CONTAINER_INSTANCE_ERROR = "there is no container instance that can be provided to this durable object";
    RUNTIME_SIGNALLED_ERROR = "runtime signalled the container to exit:";
    UNEXPECTED_EXIT_ERROR = "container exited with unexpected exit code:";
    NOT_LISTENING_ERROR = "the container is not listening";
    CONTAINER_STATE_KEY = "__CF_CONTAINER_STATE";
    MAX_ALARM_RETRIES = 3;
    PING_TIMEOUT_MS = 5e3;
    DEFAULT_SLEEP_AFTER = "10m";
    INSTANCE_POLL_INTERVAL_MS = 300;
    TIMEOUT_TO_GET_CONTAINER_MS = 8e3;
    TIMEOUT_TO_GET_PORTS_MS = 2e4;
    FALLBACK_PORT_TO_CHECK = 33;
    signalToNumbers = {
      SIGINT: 2,
      SIGTERM: 15,
      SIGKILL: 9
    };
    isNoInstanceError = (error) => isErrorOfType(error, NO_CONTAINER_INSTANCE_ERROR);
    isRuntimeSignalledError = (error) => isErrorOfType(error, RUNTIME_SIGNALLED_ERROR);
    isNotListeningError = (error) => isErrorOfType(error, NOT_LISTENING_ERROR);
    isContainerExitNonZeroError = (error) => isErrorOfType(error, UNEXPECTED_EXIT_ERROR);
    ContainerState = class {
      storage;
      status;
      constructor(storage) {
        this.storage = storage;
      }
      async setRunning() {
        await this.setStatusAndupdate("running");
      }
      async setHealthy() {
        await this.setStatusAndupdate("healthy");
      }
      async setStopping() {
        await this.setStatusAndupdate("stopping");
      }
      async setStopped() {
        await this.setStatusAndupdate("stopped");
      }
      async setStoppedWithCode(exitCode) {
        this.status = { status: "stopped_with_code", lastChange: Date.now(), exitCode };
        await this.update();
      }
      async getState() {
        if (!this.status) {
          const state = await this.storage.get(CONTAINER_STATE_KEY);
          if (!state) {
            this.status = {
              status: "stopped",
              lastChange: Date.now()
            };
            await this.update();
          } else {
            this.status = state;
          }
        }
        return this.status;
      }
      async setStatusAndupdate(status) {
        this.status = { status, lastChange: Date.now() };
        await this.update();
      }
      async update() {
        if (!this.status)
          throw new Error("status should be init");
        await this.storage.put(CONTAINER_STATE_KEY, this.status);
      }
    };
    Container = class extends DurableObject {
      // =========================
      //     Public Attributes
      // =========================
      // Default port for the container (undefined means no default port)
      defaultPort;
      // Required ports that should be checked for availability during container startup
      // Override this in your subclass to specify ports that must be ready
      requiredPorts;
      // Timeout after which the container will sleep if no activity
      // The signal sent to the container by default is a SIGTERM.
      // The container won't get a SIGKILL if this threshold is triggered.
      sleepAfter = DEFAULT_SLEEP_AFTER;
      // Container configuration properties
      // Set these properties directly in your container instance
      envVars = {};
      entrypoint;
      enableInternet = true;
      // pingEndpoint is the host and path value that the class will use to send a request to the container and check if the
      // instance is ready.
      //
      // The user does not have to implement this route by any means,
      // but it's still useful if you want to control the path that
      // the Container class uses to send HTTP requests to.
      pingEndpoint = "ping";
      // =========================
      //     PUBLIC INTERFACE
      // =========================
      constructor(ctx, env, options) {
        super(ctx, env);
        if (ctx.container === void 0) {
          throw new Error("Containers have not been enabled for this Durable Object class. Have you correctly setup your Wrangler config? More info: https://developers.cloudflare.com/containers/get-started/#configuration");
        }
        this.state = new ContainerState(this.ctx.storage);
        this.ctx.blockConcurrencyWhile(async () => {
          this.renewActivityTimeout();
          await this.scheduleNextAlarm();
        });
        this.container = ctx.container;
        if (options) {
          if (options.defaultPort !== void 0)
            this.defaultPort = options.defaultPort;
          if (options.sleepAfter !== void 0)
            this.sleepAfter = options.sleepAfter;
        }
        this.sql`
      CREATE TABLE IF NOT EXISTS container_schedules (
        id TEXT PRIMARY KEY NOT NULL DEFAULT (randomblob(9)),
        callback TEXT NOT NULL,
        payload TEXT,
        type TEXT NOT NULL CHECK(type IN ('scheduled', 'delayed')),
        time INTEGER NOT NULL,
        delayInSeconds INTEGER,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `;
        if (this.container.running) {
          this.monitor = this.container.monitor();
          this.setupMonitorCallbacks();
        }
      }
      /**
       * Gets the current state of the container
       * @returns Promise<State>
       */
      async getState() {
        return { ...await this.state.getState() };
      }
      // ==========================
      //     CONTAINER STARTING
      // ==========================
      /**
       * Start the container if it's not running and set up monitoring and lifecycle hooks,
       * without waiting for ports to be ready.
       *
       * It will automatically retry if the container fails to start, using the specified waitOptions
       *
       *
       * @example
       * await this.start({
       *   envVars: { DEBUG: 'true', NODE_ENV: 'development' },
       *   entrypoint: ['npm', 'run', 'dev'],
       *   enableInternet: false
       * });
       *
       * @param startOptions - Override `envVars`, `entrypoint` and `enableInternet` on a per-instance basis
       * @param waitOptions - Optional wait configuration with abort signal for cancellation. Default ~8s timeout.
       * @returns A promise that resolves when the container start command has been issued
       * @throws Error if no container context is available or if all start attempts fail
       */
      async start(startOptions, waitOptions) {
        const portToCheck = waitOptions?.portToCheck ?? this.defaultPort ?? (this.requiredPorts ? this.requiredPorts[0] : FALLBACK_PORT_TO_CHECK);
        const pollInterval = waitOptions?.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
        await this.startContainerIfNotRunning({
          signal: waitOptions?.signal,
          waitInterval: pollInterval,
          retries: waitOptions?.retries ?? Math.ceil(TIMEOUT_TO_GET_CONTAINER_MS / pollInterval),
          portToCheck
        }, startOptions);
        this.setupMonitorCallbacks();
        await this.ctx.blockConcurrencyWhile(async () => {
          await this.onStart();
        });
      }
      async startAndWaitForPorts(portsOrArgs, cancellationOptions, startOptions) {
        let ports;
        let resolvedCancellationOptions = {};
        let resolvedStartOptions = {};
        if (typeof portsOrArgs === "object" && portsOrArgs !== null && !Array.isArray(portsOrArgs)) {
          ports = portsOrArgs.ports;
          resolvedCancellationOptions = portsOrArgs.cancellationOptions;
          resolvedStartOptions = portsOrArgs.startOptions;
        } else {
          ports = portsOrArgs;
          resolvedCancellationOptions = cancellationOptions;
          resolvedStartOptions = startOptions;
        }
        const portsToCheck = await this.getPortsToCheck(ports);
        await this.syncPendingStoppedEvents();
        resolvedCancellationOptions ??= {};
        const containerGetTimeout = resolvedCancellationOptions.instanceGetTimeoutMS ?? TIMEOUT_TO_GET_CONTAINER_MS;
        const pollInterval = resolvedCancellationOptions.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
        let containerGetRetries = Math.ceil(containerGetTimeout / pollInterval);
        const waitOptions = {
          signal: resolvedCancellationOptions.abort,
          retries: containerGetRetries,
          waitInterval: pollInterval,
          portToCheck: portsToCheck[0]
        };
        const triesUsed = await this.startContainerIfNotRunning(waitOptions, resolvedStartOptions);
        const totalPortReadyTries = Math.ceil((resolvedCancellationOptions.portReadyTimeoutMS ?? TIMEOUT_TO_GET_PORTS_MS) / pollInterval);
        let triesLeft = totalPortReadyTries - triesUsed;
        for (const port of portsToCheck) {
          triesLeft = await this.waitForPort({
            signal: resolvedCancellationOptions.abort,
            waitInterval: pollInterval,
            retries: triesLeft,
            portToCheck: port
          });
        }
        this.setupMonitorCallbacks();
        await this.ctx.blockConcurrencyWhile(async () => {
          await this.state.setHealthy();
          await this.onStart();
        });
      }
      /**
       *
       * Waits for a specified port to be ready
       *
       * Returns the number of tries used to get the port, or throws if it couldn't get the port within the specified retry limits.
       *
       * @param waitOptions -
       * - `portToCheck`: The port number to check
       * - `abort`: Optional AbortSignal to cancel waiting
       * - `retries`: Number of retries before giving up (default: TRIES_TO_GET_PORTS)
       * - `waitInterval`: Interval between retries in milliseconds (default: INSTANCE_POLL_INTERVAL_MS)
       */
      async waitForPort(waitOptions) {
        const port = waitOptions.portToCheck;
        const tcpPort = this.container.getTcpPort(port);
        const abortedSignal = new Promise((res) => {
          waitOptions.signal?.addEventListener("abort", () => {
            res(true);
          });
        });
        const pollInterval = waitOptions.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
        let tries = waitOptions.retries ?? Math.ceil(TIMEOUT_TO_GET_PORTS_MS / pollInterval);
        for (let i = 0; i < tries; i++) {
          try {
            const combinedSignal = addTimeoutSignal(waitOptions.signal, PING_TIMEOUT_MS);
            await tcpPort.fetch(`http://${this.pingEndpoint}`, { signal: combinedSignal });
            console.log(`Port ${port} is ready`);
            break;
          } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.debug(`Error checking ${port}: ${errorMessage}`);
            if (!this.container.running) {
              try {
                await this.onError(new Error(`Container crashed while checking for ports, did you start the container and setup the entrypoint correctly?`));
              } catch {
              }
              throw e;
            }
            if (i === tries - 1) {
              try {
                await this.onError(`Failed to verify port ${port} is available after ${(i + 1) * pollInterval}ms, last error: ${errorMessage}`);
              } catch {
              }
              throw e;
            }
            await Promise.any([
              new Promise((resolve) => setTimeout(resolve, waitOptions.waitInterval)),
              abortedSignal
            ]);
            if (waitOptions.signal?.aborted) {
              throw new Error("Container request aborted.");
            }
          }
        }
        return tries;
      }
      // =======================
      //     LIFECYCLE HOOKS
      // =======================
      /**
       * Send a signal to the container.
       * @param signal - The signal to send to the container (default: 15 for SIGTERM)
       */
      async stop(signal = "SIGTERM") {
        if (this.container.running) {
          this.container.signal(typeof signal === "string" ? signalToNumbers[signal] : signal);
        }
        await this.syncPendingStoppedEvents();
      }
      /**
       * Destroys the container with a SIGKILL. Triggers onStop.
       */
      async destroy() {
        await this.container.destroy();
      }
      /**
       * Lifecycle method called when container starts successfully
       * Override this method in subclasses to handle container start events
       */
      onStart() {
      }
      /**
       * Lifecycle method called when container shuts down
       * Override this method in subclasses to handle Container stopped events
       * @param params - Object containing exitCode and reason for the stop
       */
      onStop(_) {
      }
      /**
       * Lifecycle method called when the container is running, and the activity timeout
       * expiration (set by `sleepAfter`) has been reached.
       *
       * If you want to shutdown the container, you should call this.stop() here
       *
       * By default, this method calls `this.stop()`
       */
      async onActivityExpired() {
        if (!this.container.running) {
          return;
        }
        await this.stop();
      }
      /**
       * Error handler for container errors
       * Override this method in subclasses to handle container errors
       * @param error - The error that occurred
       * @returns Can return any value or throw the error
       */
      onError(error) {
        console.error("Container error:", error);
        throw error;
      }
      /**
       * Renew the container's activity timeout
       *
       * Call this method whenever there is activity on the container
       */
      renewActivityTimeout() {
        const timeoutInMs = parseTimeExpression(this.sleepAfter) * 1e3;
        this.sleepAfterMs = Date.now() + timeoutInMs;
      }
      // ==================
      //     SCHEDULING
      // ==================
      /**
       * Schedule a task to be executed in the future.
       *
       * We strongly recommend using this instead of the `alarm` handler.
       *
       * @template T Type of the payload data
       * @param when When to execute the task (Date object or number of seconds delay)
       * @param callback Name of the method to call
       * @param payload Data to pass to the callback
       * @returns Schedule object representing the scheduled task
       */
      async schedule(when, callback, payload) {
        const id = generateId(9);
        if (typeof callback !== "string") {
          throw new Error("Callback must be a string (method name)");
        }
        if (typeof this[callback] !== "function") {
          throw new Error(`this.${callback} is not a function`);
        }
        if (when instanceof Date) {
          const timestamp = Math.floor(when.getTime() / 1e3);
          this.sql`
        INSERT OR REPLACE INTO container_schedules (id, callback, payload, type, time)
        VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'scheduled', ${timestamp})
      `;
          await this.scheduleNextAlarm();
          return {
            taskId: id,
            callback,
            payload,
            time: timestamp,
            type: "scheduled"
          };
        }
        if (typeof when === "number") {
          const time = Math.floor(Date.now() / 1e3 + when);
          this.sql`
        INSERT OR REPLACE INTO container_schedules (id, callback, payload, type, delayInSeconds, time)
        VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'delayed', ${when}, ${time})
      `;
          await this.scheduleNextAlarm();
          return {
            taskId: id,
            callback,
            payload,
            delayInSeconds: when,
            time,
            type: "delayed"
          };
        }
        throw new Error("Invalid schedule type. 'when' must be a Date or number of seconds");
      }
      // ============
      //     HTTP
      // ============
      /**
       * Send a request to the container (HTTP or WebSocket) using standard fetch API signature
       *
       * This method handles HTTP requests to the container.
       *
       * WebSocket requests done outside the DO won't work until https://github.com/cloudflare/workerd/issues/2319 is addressed.
       * Until then, please use `switchPort` + `fetch()`.
       *
       * Method supports multiple signatures to match standard fetch API:
       * - containerFetch(request: Request, port?: number)
       * - containerFetch(url: string | URL, init?: RequestInit, port?: number)
       *
       * Starts the container if not already running, and waits for the target port to be ready.
       *
       * @returns A Response from the container
       */
      async containerFetch(requestOrUrl, portOrInit, portParam) {
        let { request, port } = this.requestAndPortFromContainerFetchArgs(requestOrUrl, portOrInit, portParam);
        const state = await this.state.getState();
        if (!this.container.running || state.status !== "healthy") {
          try {
            await this.startAndWaitForPorts(port, { abort: request.signal });
          } catch (e) {
            if (isNoInstanceError(e)) {
              return new Response("There is no Container instance available at this time.\nThis is likely because you have reached your max concurrent instance count (set in wrangler config) or are you currently provisioning the Container.\nIf you are deploying your Container for the first time, check your dashboard to see provisioning status, this may take a few minutes.", { status: 503 });
            } else {
              return new Response(`Failed to start container: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
            }
          }
        }
        const tcpPort = this.container.getTcpPort(port);
        const containerUrl = request.url.replace("https:", "http:");
        try {
          this.renewActivityTimeout();
          const res = await tcpPort.fetch(containerUrl, request);
          return res;
        } catch (e) {
          if (!(e instanceof Error)) {
            throw e;
          }
          if (e.message.includes("Network connection lost.")) {
            return new Response("Container suddenly disconnected, try again", { status: 500 });
          }
          console.error(`Error proxying request to container ${this.ctx.id}:`, e);
          return new Response(`Error proxying request to container: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
        }
      }
      /**
       *
       * Fetch handler on the Container class.
       * By default this forwards all requests to the container by calling `containerFetch`.
       * Use `switchPort` to specify which port on the container to target, or this will use `defaultPort`.
       * @param request The request to handle
       */
      async fetch(request) {
        if (this.defaultPort === void 0 && !request.headers.has("cf-container-target-port")) {
          throw new Error("No port configured for this container. Set the `defaultPort` in your Container subclass, or specify a port with `container.fetch(switchPort(request, port))`.");
        }
        let portValue = this.defaultPort;
        if (request.headers.has("cf-container-target-port")) {
          const portFromHeaders = parseInt(request.headers.get("cf-container-target-port") ?? "");
          if (isNaN(portFromHeaders)) {
            throw new Error("port value from switchPort is not a number");
          } else {
            portValue = portFromHeaders;
          }
        }
        return await this.containerFetch(request, portValue);
      }
      // ===============================
      // ===============================
      //     PRIVATE METHODS & ATTRS
      // ===============================
      // ===============================
      // ==========================
      //     PRIVATE ATTRIBUTES
      // ==========================
      container;
      // onStopCalled will be true when we are in the middle of an onStop call
      onStopCalled = false;
      state;
      monitor;
      monitorSetup = false;
      sleepAfterMs = 0;
      // ==========================
      //     GENERAL HELPERS
      // ==========================
      /**
       * Execute SQL queries against the Container's database
       */
      sql(strings, ...values) {
        let query = "";
        query = strings.reduce((acc, str, i) => acc + str + (i < values.length ? "?" : ""), "");
        return [...this.ctx.storage.sql.exec(query, ...values)];
      }
      requestAndPortFromContainerFetchArgs(requestOrUrl, portOrInit, portParam) {
        let request;
        let port;
        if (requestOrUrl instanceof Request) {
          request = requestOrUrl;
          port = typeof portOrInit === "number" ? portOrInit : void 0;
        } else {
          const url = typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.toString();
          const init = typeof portOrInit === "number" ? {} : portOrInit || {};
          port = typeof portOrInit === "number" ? portOrInit : typeof portParam === "number" ? portParam : void 0;
          request = new Request(url, init);
        }
        port ??= this.defaultPort;
        if (port === void 0) {
          throw new Error("No port specified for container fetch. Set defaultPort or specify a port parameter.");
        }
        return { request, port };
      }
      /**
       *
       * The method prioritizes port sources in this order:
       * 1. Ports specified directly in the method call
       * 2. `requiredPorts` class property (if set)
       * 3. `defaultPort` (if neither of the above is specified)
       * 4. Falls back to port 33 if none of the above are set
       */
      async getPortsToCheck(overridePorts) {
        let portsToCheck = [];
        if (overridePorts !== void 0) {
          portsToCheck = Array.isArray(overridePorts) ? overridePorts : [overridePorts];
        } else if (this.requiredPorts && this.requiredPorts.length > 0) {
          portsToCheck = [...this.requiredPorts];
        } else {
          portsToCheck = [this.defaultPort ?? FALLBACK_PORT_TO_CHECK];
        }
        return portsToCheck;
      }
      // ===========================================
      //     CONTAINER INTERACTION & MONITORING
      // ===========================================
      /**
       * Tries to start a container if it's not already running
       * Returns the number of tries used
       */
      async startContainerIfNotRunning(waitOptions, options) {
        if (this.container.running) {
          if (!this.monitor) {
            this.monitor = this.container.monitor();
          }
          return 0;
        }
        const abortedSignal = new Promise((res) => {
          waitOptions.signal?.addEventListener("abort", () => {
            res(true);
          });
        });
        const pollInterval = waitOptions.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
        const totalTries = waitOptions.retries ?? Math.ceil(TIMEOUT_TO_GET_CONTAINER_MS / pollInterval);
        await this.state.setRunning();
        for (let tries = 0; tries < totalTries; tries++) {
          const envVars = options?.envVars ?? this.envVars;
          const entrypoint = options?.entrypoint ?? this.entrypoint;
          const enableInternet = options?.enableInternet ?? this.enableInternet;
          const startConfig = {
            enableInternet
          };
          if (envVars && Object.keys(envVars).length > 0)
            startConfig.env = envVars;
          if (entrypoint)
            startConfig.entrypoint = entrypoint;
          this.renewActivityTimeout();
          const handleError = async () => {
            const err = await this.monitor?.catch((err2) => err2);
            if (typeof err === "number") {
              const toThrow = new Error(`Container exited before we could determine the container health, exit code: ${err}`);
              try {
                await this.onError(toThrow);
              } catch {
              }
              throw toThrow;
            } else if (!isNoInstanceError(err)) {
              try {
                await this.onError(err);
              } catch {
              }
              throw err;
            }
          };
          if (tries > 0 && !this.container.running) {
            await handleError();
          }
          await this.scheduleNextAlarm();
          if (!this.container.running) {
            this.container.start(startConfig);
            this.monitor = this.container.monitor();
          } else {
            await this.scheduleNextAlarm();
          }
          this.renewActivityTimeout();
          const port = this.container.getTcpPort(waitOptions.portToCheck);
          try {
            const combinedSignal = addTimeoutSignal(waitOptions.signal, PING_TIMEOUT_MS);
            await port.fetch("http://containerstarthealthcheck", { signal: combinedSignal });
            return tries;
          } catch (error) {
            if (isNotListeningError(error) && this.container.running) {
              return tries;
            }
            if (!this.container.running && isNotListeningError(error)) {
              await handleError();
            }
            console.debug("Error checking if container is ready:", error instanceof Error ? error.message : String(error));
            await Promise.any([
              new Promise((res) => setTimeout(res, waitOptions.waitInterval)),
              abortedSignal
            ]);
            if (waitOptions.signal?.aborted) {
              throw new Error("Aborted waiting for container to start as we received a cancellation signal");
            }
            if (totalTries === tries + 1) {
              if (error instanceof Error && error.message.includes("Network connection lost")) {
                this.ctx.abort();
              }
              throw new Error(NO_CONTAINER_INSTANCE_ERROR);
            }
            continue;
          }
        }
        throw new Error(`Container did not start after ${totalTries * pollInterval}ms`);
      }
      setupMonitorCallbacks() {
        if (this.monitorSetup) {
          return;
        }
        this.monitorSetup = true;
        this.monitor?.then(async () => {
          await this.ctx.blockConcurrencyWhile(async () => {
            await this.state.setStoppedWithCode(0);
          });
        }).catch(async (error) => {
          if (isNoInstanceError(error)) {
            return;
          }
          const exitCode = getExitCodeFromError(error);
          if (exitCode !== null) {
            await this.state.setStoppedWithCode(exitCode);
            this.monitorSetup = false;
            this.monitor = void 0;
            return;
          }
          try {
            await this.onError(error);
          } catch {
          }
        }).finally(() => {
          this.monitorSetup = false;
          if (this.timeout) {
            if (this.resolve)
              this.resolve();
            clearTimeout(this.timeout);
          }
        });
      }
      deleteSchedules(name) {
        this.sql`DELETE FROM container_schedules WHERE callback = ${name}`;
      }
      // ============================
      //     ALARMS AND SCHEDULES
      // ============================
      /**
       * Method called when an alarm fires
       * Executes any scheduled tasks that are due
       */
      async alarm(alarmProps) {
        if (alarmProps.isRetry && alarmProps.retryCount > MAX_ALARM_RETRIES) {
          const scheduleCount = Number(this.sql`SELECT COUNT(*) as count FROM container_schedules`[0]?.count) || 0;
          const hasScheduledTasks = scheduleCount > 0;
          if (hasScheduledTasks || this.container.running) {
            await this.scheduleNextAlarm();
          }
          return;
        }
        const prevAlarm = Date.now();
        await this.ctx.storage.setAlarm(prevAlarm);
        await this.ctx.storage.sync();
        const result = this.sql`
         SELECT * FROM container_schedules;
       `;
        let minTime = Date.now() + 3 * 60 * 1e3;
        const now = Date.now() / 1e3;
        for (const row of result) {
          if (row.time > now) {
            continue;
          }
          const callback = this[row.callback];
          if (!callback || typeof callback !== "function") {
            console.error(`Callback ${row.callback} not found or is not a function`);
            continue;
          }
          const schedule = this.getSchedule(row.id);
          try {
            const payload = row.payload ? JSON.parse(row.payload) : void 0;
            await callback.call(this, payload, await schedule);
          } catch (e) {
            console.error(`Error executing scheduled callback "${row.callback}":`, e);
          }
          this.sql`DELETE FROM container_schedules WHERE id = ${row.id}`;
        }
        const resultForMinTime = this.sql`
         SELECT * FROM container_schedules;
       `;
        const minTimeFromSchedules = Math.min(...resultForMinTime.map((r) => r.time * 1e3));
        if (!this.container.running) {
          await this.syncPendingStoppedEvents();
          if (resultForMinTime.length == 0) {
            await this.ctx.storage.deleteAlarm();
          } else {
            await this.ctx.storage.setAlarm(minTimeFromSchedules);
          }
          return;
        }
        if (this.isActivityExpired()) {
          await this.onActivityExpired();
          this.renewActivityTimeout();
          return;
        }
        minTime = Math.min(minTimeFromSchedules, minTime, this.sleepAfterMs);
        const timeout = Math.max(0, minTime - Date.now());
        await new Promise((resolve) => {
          this.resolve = resolve;
          if (!this.container.running) {
            resolve();
            return;
          }
          this.timeout = setTimeout(() => {
            resolve();
          }, timeout);
        });
        await this.ctx.storage.setAlarm(Date.now());
      }
      timeout;
      resolve;
      // synchronises container state with the container source of truth to process events
      async syncPendingStoppedEvents() {
        const state = await this.state.getState();
        if (!this.container.running && state.status === "healthy") {
          await this.callOnStop({ exitCode: 0, reason: "exit" });
          return;
        }
        if (!this.container.running && state.status === "stopped_with_code") {
          await this.callOnStop({ exitCode: state.exitCode ?? 0, reason: "exit" });
          return;
        }
      }
      async callOnStop(onStopParams) {
        if (this.onStopCalled) {
          return;
        }
        this.onStopCalled = true;
        const promise = this.onStop(onStopParams);
        if (promise instanceof Promise) {
          await promise.finally(() => {
            this.onStopCalled = false;
          });
        } else {
          this.onStopCalled = false;
        }
        await this.state.setStopped();
      }
      /**
       * Schedule the next alarm based on upcoming tasks
       */
      async scheduleNextAlarm(ms = 1e3) {
        const nextTime = ms + Date.now();
        if (this.timeout) {
          if (this.resolve)
            this.resolve();
          clearTimeout(this.timeout);
        }
        await this.ctx.storage.setAlarm(nextTime);
        await this.ctx.storage.sync();
      }
      async listSchedules(name) {
        const result = this.sql`
      SELECT * FROM container_schedules WHERE callback = ${name} LIMIT 1
    `;
        if (!result || result.length === 0) {
          return [];
        }
        return result.map(this.toSchedule);
      }
      toSchedule(schedule) {
        let payload;
        try {
          payload = JSON.parse(schedule.payload);
        } catch (e) {
          console.error(`Error parsing payload for schedule ${schedule.id}:`, e);
          payload = void 0;
        }
        if (schedule.type === "delayed") {
          return {
            taskId: schedule.id,
            callback: schedule.callback,
            payload,
            type: "delayed",
            time: schedule.time,
            delayInSeconds: schedule.delayInSeconds
          };
        }
        return {
          taskId: schedule.id,
          callback: schedule.callback,
          payload,
          type: "scheduled",
          time: schedule.time
        };
      }
      /**
       * Get a scheduled task by ID
       * @template T Type of the payload data
       * @param id ID of the scheduled task
       * @returns The Schedule object or undefined if not found
       */
      async getSchedule(id) {
        const result = this.sql`
      SELECT * FROM container_schedules WHERE id = ${id} LIMIT 1
    `;
        if (!result || result.length === 0) {
          return void 0;
        }
        const schedule = result[0];
        return this.toSchedule(schedule);
      }
      isActivityExpired() {
        return this.sleepAfterMs <= Date.now();
      }
    };
  }
});

// ../../../../../../.cache/deno/npm/registry.npmjs.org/@cloudflare/containers/0.1.1/dist/lib/utils.js
async function getRandom(binding, instances = 3) {
  const id = Math.floor(Math.random() * instances).toString();
  const objectId = binding.idFromName(`instance-${id}`);
  return binding.get(objectId);
}
async function loadBalance(binding, instances = 3) {
  console.warn("loadBalance is deprecated, please use getRandom instead. This will be removed in a future version.");
  return getRandom(binding, instances);
}
function getContainer(binding, name = singletonContainerId) {
  const objectId = binding.idFromName(name);
  return binding.get(objectId);
}
function switchPort(request, port) {
  const headers = new Headers(request.headers);
  headers.set("cf-container-target-port", port.toString());
  return new Request(request, { headers });
}
var singletonContainerId;
var init_utils = __esm({
  "../../../../../../.cache/deno/npm/registry.npmjs.org/@cloudflare/containers/0.1.1/dist/lib/utils.js"() {
    singletonContainerId = "cf-singleton-container";
  }
});

// ../../../../../../.cache/deno/npm/registry.npmjs.org/@cloudflare/containers/0.1.1/dist/index.js
var dist_exports = {};
__export(dist_exports, {
  Container: () => Container,
  getContainer: () => getContainer,
  getRandom: () => getRandom,
  loadBalance: () => loadBalance,
  switchPort: () => switchPort
});
var init_dist = __esm({
  "../../../../../../.cache/deno/npm/registry.npmjs.org/@cloudflare/containers/0.1.1/dist/index.js"() {
    init_container();
    init_utils();
  }
});

// src/container-runtime.ts
var LocalHostContainerRuntime = class {
  ctx;
  env;
  envVars = {};
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  async startAndWaitForPorts(_ports) {
  }
  renewActivityTimeout() {
  }
  async destroy() {
  }
};
async function importContainerRuntime() {
  try {
    return await Promise.resolve().then(() => (init_dist(), dist_exports));
  } catch (error) {
    if (typeof Deno !== "undefined") return null;
    throw error;
  }
}
var runtimeModule = await importContainerRuntime();
var HostContainerRuntime = runtimeModule?.Container ?? LocalHostContainerRuntime;
var Container2 = runtimeModule?.Container ?? LocalHostContainerRuntime;

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/compose.js
var compose = (middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context.error = err;
            res = await onError(err, context);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context.finalized === false && onNotFound) {
          res = await onNotFound(context);
        }
      }
      if (res && (context.finalized === false || isError)) {
        context.res = res;
      }
      return context;
    }
  };
};

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/utils/body.js
var parseBody = async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = request instanceof HonoRequest ? request.raw.headers : request.headers;
  const contentType = headers.get("Content-Type");
  if (contentType?.startsWith("multipart/form-data") || contentType?.startsWith("application/x-www-form-urlencoded")) {
    return parseFormData(request, { all, dot });
  }
  return {};
};
async function parseFormData(request, options) {
  const formData = await request.formData();
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
var handleParsingAllValues = (form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
};
var handleParsingNestedValues = (form, key, value) => {
  if (/(?:^|\.)__proto__\./.test(key)) {
    return;
  }
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
};

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/utils/url.js
var splitPath = (path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
};
var splitRoutingPath = (routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
};
var extractGroupsFromPath = (path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path };
};
var replaceGroupMarks = (paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
};
var patternCache = {};
var getPattern = (label, next) => {
  if (label === "*") {
    return "*";
  }
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match2[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
};
var tryDecode = (str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
};
var tryDecodeURI = (str) => tryDecode(str, decodeURI);
var getPath = (request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) {
      break;
    }
  }
  return url.slice(start, i);
};
var getPathNoStrict = (request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
};
var mergePath = (base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
};
var checkOptionalParameter = (path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
};
var _decodeURI = (value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
};
var _getQueryParam = (url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = {};
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
};
var getQueryParam = _getQueryParam;
var getQueryParams = (url, key) => {
  return _getQueryParam(url, key, true);
};
var decodeURIComponent_ = decodeURIComponent;

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/request.js
var tryDecodeURIComponent = (str) => tryDecode(str, decodeURIComponent_);
var HonoRequest = class {
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
    this.#validatedData = {};
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = {};
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = (key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    const anyCachedKey = Object.keys(bodyCache)[0];
    if (anyCachedKey) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  };
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = (value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
};
var resolveCallback = async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
};

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = (contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
};
var createResponseInstance = (body, init) => new Response(body, init);
var Context = class {
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= createResponseInstance(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = (...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  };
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = (layout) => this.#layout = layout;
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = () => this.#layout;
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = (renderer) => {
    this.#renderer = renderer;
  };
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = (name, value, options) => {
    if (this.finalized) {
      this.#res = createResponseInstance(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  };
  status = (status) => {
    this.#status = status;
  };
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = (key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  };
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = (key) => {
    return this.#var ? this.#var.get(key) : void 0;
  };
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers();
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, { status, headers: responseHeaders });
  }
  newResponse = (...args) => this.#newResponse(...args);
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = (data, arg, headers) => this.#newResponse(data, arg, headers);
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = (text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  };
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = (object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  };
  html = (html, arg, headers) => {
    const res = (html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers));
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  };
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = (location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  };
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = () => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  };
};

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
};

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/hono-base.js
var notFoundHandler = (c) => {
  return c.text("404 Not Found", 404);
};
var errorHandler = (err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
};
var Hono = class _Hono {
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res;
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = (handler) => {
    this.errorHandler = handler;
    return this;
  };
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = (handler) => {
    this.#notFoundHandler = handler;
    return this;
  };
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = (request) => request;
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = url.pathname.slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    };
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = { basePath: this._basePath, path, method, handler };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    }
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} Env - env Object
   * @param {ExecutionContext} - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = (request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  };
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = (input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  };
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = () => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  };
};

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = (method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  };
  this.match = match2;
  return match2(method, path);
}

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
var Node = class _Node {
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== void 0) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new _Node();
        if (name !== "") {
          node.#varIndex = context.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new _Node();
      }
    }
    node.insert(restTokens, index, paramMap, context, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/router/reg-exp-router/trie.js
var Trie = class {
  #context = { varIndex: 0 };
  #root = new Node();
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i = 0; ; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/router/reg-exp-router/router.js
var nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    path === "*" ? "" : `^${path.replace(
      /\/\*$|([.\\+*[^\]$()])/g,
      (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)"
    )}$`
  );
}
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie();
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map(
    (route) => [!/\*|\/:/.test(route[0]), ...route]
  ).sort(
    ([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length
  );
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i = 0, j = -1, len = routesWithStaticPathFlag.length; i < len; i++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (; paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i = 0, len = handlerData.length; i < len; i++) {
    for (let j = 0, len2 = handlerData[i].length; j < len2; j++) {
      const map = handlerData[i][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length; k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i in indexReplacementMap) {
    handlerMap[i] = handlerData[indexReplacementMap[i]];
  }
  return [regexp, handlerMap, staticMap];
}
function findMiddleware(middleware, path) {
  if (!middleware) {
    return void 0;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
var RegExpRouter = class {
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      ;
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach(
            (p) => re.test(p) && routes[m][p].push([handler, paramCount])
          );
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length; i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler, paramCount - len + i + 1]);
        }
      });
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = void 0;
    clearWildcardRegExpCache();
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r) => {
      const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(
          ...Object.keys(r[METHOD_NAME_ALL]).map((path) => [path, r[METHOD_NAME_ALL][path]])
        );
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
};

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/router/smart-router/router.js
var SmartRouter = class {
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var hasChildren = (children) => {
  for (const _ in children) {
    return true;
  }
  return false;
};
var Node2 = class _Node2 {
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new _Node2();
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== void 0) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            }
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              this.#pushHandlerSets(handlerSets, astNode, method, node.#params);
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          if (matcher instanceof RegExp) {
            if (partOffsets === null) {
              partOffsets = new Array(len);
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.substring(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (hasChildren(child.#children)) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  params,
                  node.#params
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/router/trie-router/router.js
var TrieRouter = class {
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2();
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length; i < len; i++) {
        this.#node.insert(method, results[i], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// ../../../../../../.cache/deno/npm/registry.npmjs.org/hono/4.12.9/dist/hono.js
var Hono2 = class extends Hono {
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
};

// src/proxy-token.ts
function generateProxyToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// src/crypto-utils.ts
function constantTimeEqual(a, b) {
  const maxLen = Math.max(a.length, b.length);
  let result = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

// src/gui/assets.generated.ts
var appHtml = '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>takos computer</title>\n    <script type="module" crossorigin>(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const r of document.querySelectorAll(\'link[rel="modulepreload"]\'))s(r);new MutationObserver(r=>{for(const o of r)if(o.type==="childList")for(const i of o.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&s(i)}).observe(document,{childList:!0,subtree:!0});function n(r){const o={};return r.integrity&&(o.integrity=r.integrity),r.referrerPolicy&&(o.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?o.credentials="include":r.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function s(r){if(r.ep)return;r.ep=!0;const o=n(r);fetch(r.href,o)}})();const It=!1,kt=(e,t)=>e===t,ge=Symbol("solid-proxy"),ot=typeof Proxy=="function",Lt=Symbol("solid-track"),me={equals:kt};let it=ht;const K=1,pe=2,lt={owned:null,cleanups:null,context:null,owner:null},Pe={};var S=null;let Ee=null,Ot=null,_=null,j=null,q=null,$e=0;function ne(e,t){const n=_,s=S,r=e.length===0,o=t===void 0?s:t,i=r?lt:{owned:null,cleanups:null,context:o?o.context:null,owner:o},l=r?e:()=>e(()=>N(()=>se(i)));S=i,_=null;try{return B(l,!0)}finally{_=n,S=s}}function I(e,t){t=t?Object.assign({},me,t):me;const n={value:e,observers:null,observerSlots:null,comparator:t.equals||void 0},s=r=>(typeof r=="function"&&(r=r(n.value)),dt(n,r));return[ft.bind(n),s]}function Rt(e,t,n){const s=Se(e,t,!0,K);ee(s)}function D(e,t,n){const s=Se(e,t,!1,K);ee(s)}function at(e,t,n){it=Vt;const s=Se(e,t,!1,K);s.user=!0,q?q.push(s):ee(s)}function k(e,t,n){n=n?Object.assign({},me,n):me;const s=Se(e,t,!0,0);return s.observers=null,s.observerSlots=null,s.comparator=n.equals||void 0,ee(s),ft.bind(s)}function Tt(e){return e&&typeof e=="object"&&"then"in e}function xe(e,t,n){let s,r,o;typeof t=="function"?(s=e,r=t,o={}):(s=!0,r=e,o=t||{});let i=null,l=Pe,a=!1,c="initialValue"in o,d=typeof s=="function"&&k(s);const u=new Set,[h,f]=(o.storage||I)(o.initialValue),[g,m]=I(void 0),[p,v]=I(void 0,{equals:!1}),[y,x]=I(c?"ready":"unresolved");function w(O,E,U,T){return i===O&&(i=null,T!==void 0&&(c=!0),(O===l||E===l)&&o.onHydrated&&queueMicrotask(()=>o.onHydrated(T,{value:E})),l=Pe,C(E,U)),E}function C(O,E){B(()=>{E===void 0&&f(()=>O),x(E!==void 0?"errored":c?"ready":"unresolved"),m(E);for(const U of u.keys())U.decrement();u.clear()},!1)}function L(){const O=Ut,E=h(),U=g();if(U!==void 0&&!i)throw U;return _&&_.user,E}function H(O=!0){if(O!==!1&&a)return;a=!1;const E=d?d():s;if(E==null||E===!1){w(i,N(h));return}let U;const T=l!==Pe?l:N(()=>{try{return r(E,{value:h(),refetching:O})}catch(J){U=J}});if(U!==void 0){w(i,void 0,de(U),E);return}else if(!Tt(T))return w(i,T,void 0,E),T;return i=T,"v"in T?(T.s===1?w(i,T.v,void 0,E):w(i,void 0,de(T.v),E),T):(a=!0,queueMicrotask(()=>a=!1),B(()=>{x(c?"refreshing":"pending"),v()},!1),T.then(J=>w(T,J,void 0,E),J=>w(T,void 0,de(J),E)))}Object.defineProperties(L,{state:{get:()=>y()},error:{get:()=>g()},loading:{get(){const O=y();return O==="pending"||O==="refreshing"}},latest:{get(){if(!c)return L();const O=g();if(O&&!i)throw O;return h()}}});let G=S;return d?Rt(()=>(G=S,H(!1))):H(!1),[L,{refetch:O=>Ue(G,()=>H(O)),mutate:f}]}function Dt(e){return B(e,!1)}function N(e){if(_===null)return e();const t=_;_=null;try{return e()}finally{_=t}}function Ne(e,t,n){const s=Array.isArray(e);let r,o=n&&n.defer;return i=>{let l;if(s){l=Array(e.length);for(let c=0;c<e.length;c++)l[c]=e[c]()}else l=e();if(o)return o=!1,i;const a=N(()=>t(l,r,i));return r=l,a}}function jt(e){at(()=>N(e))}function ie(e){return S===null||(S.cleanups===null?S.cleanups=[e]:S.cleanups.push(e)),e}function ct(){return S}function Ue(e,t){const n=S,s=_;S=e,_=null;try{return B(t,!0)}catch(r){Ve(r)}finally{S=n,_=s}}function Nt(e){const t=_,n=S;return Promise.resolve().then(()=>{_=t,S=n;let s;return B(e,!1),_=S=null,s?s.done:void 0})}const[Pr,Er]=I(!1);function ut(e,t){const n=Symbol("context");return{id:n,Provider:Bt(n),defaultValue:e}}function Me(e){let t;return S&&S.context&&(t=S.context[e.id])!==void 0?t:e.defaultValue}function Fe(e){const t=k(e),n=k(()=>Oe(t()));return n.toArray=()=>{const s=n();return Array.isArray(s)?s:s!=null?[s]:[]},n}let Ut;function ft(){if(this.sources&&this.state)if(this.state===K)ee(this);else{const e=j;j=null,B(()=>ye(this),!1),j=e}if(_){const e=this.observers?this.observers.length:0;_.sources?(_.sources.push(this),_.sourceSlots.push(e)):(_.sources=[this],_.sourceSlots=[e]),this.observers?(this.observers.push(_),this.observerSlots.push(_.sources.length-1)):(this.observers=[_],this.observerSlots=[_.sources.length-1])}return this.value}function dt(e,t,n){let s=e.value;return(!e.comparator||!e.comparator(s,t))&&(e.value=t,e.observers&&e.observers.length&&B(()=>{for(let r=0;r<e.observers.length;r+=1){const o=e.observers[r],i=Ee&&Ee.running;i&&Ee.disposed.has(o),(i?!o.tState:!o.state)&&(o.pure?j.push(o):q.push(o),o.observers&&gt(o)),i||(o.state=K)}if(j.length>1e6)throw j=[],new Error},!1)),t}function ee(e){if(!e.fn)return;se(e);const t=$e;Mt(e,e.value,t)}function Mt(e,t,n){let s;const r=S,o=_;_=S=e;try{s=e.fn(t)}catch(i){return e.pure&&(e.state=K,e.owned&&e.owned.forEach(se),e.owned=null),e.updatedAt=n+1,Ve(i)}finally{_=o,S=r}(!e.updatedAt||e.updatedAt<=n)&&(e.updatedAt!=null&&"observers"in e?dt(e,s):e.value=s,e.updatedAt=n)}function Se(e,t,n,s=K,r){const o={fn:e,state:s,updatedAt:null,owned:null,sources:null,sourceSlots:null,cleanups:null,value:t,owner:S,context:S?S.context:null,pure:n};return S===null||S!==lt&&(S.owned?S.owned.push(o):S.owned=[o]),o}function be(e){if(e.state===0)return;if(e.state===pe)return ye(e);if(e.suspense&&N(e.suspense.inFallback))return e.suspense.effects.push(e);const t=[e];for(;(e=e.owner)&&(!e.updatedAt||e.updatedAt<$e);)e.state&&t.push(e);for(let n=t.length-1;n>=0;n--)if(e=t[n],e.state===K)ee(e);else if(e.state===pe){const s=j;j=null,B(()=>ye(e,t[0]),!1),j=s}}function B(e,t){if(j)return e();let n=!1;t||(j=[]),q?n=!0:q=[],$e++;try{const s=e();return Ft(n),s}catch(s){n||(q=null),j=null,Ve(s)}}function Ft(e){if(j&&(ht(j),j=null),e)return;const t=q;q=null,t.length&&B(()=>it(t),!1)}function ht(e){for(let t=0;t<e.length;t++)be(e[t])}function Vt(e){let t,n=0;for(t=0;t<e.length;t++){const s=e[t];s.user?e[n++]=s:be(s)}for(t=0;t<n;t++)be(e[t])}function ye(e,t){e.state=0;for(let n=0;n<e.sources.length;n+=1){const s=e.sources[n];if(s.sources){const r=s.state;r===K?s!==t&&(!s.updatedAt||s.updatedAt<$e)&&be(s):r===pe&&ye(s,t)}}}function gt(e){for(let t=0;t<e.observers.length;t+=1){const n=e.observers[t];n.state||(n.state=pe,n.pure?j.push(n):q.push(n),n.observers&&gt(n))}}function se(e){let t;if(e.sources)for(;e.sources.length;){const n=e.sources.pop(),s=e.sourceSlots.pop(),r=n.observers;if(r&&r.length){const o=r.pop(),i=n.observerSlots.pop();s<r.length&&(o.sourceSlots[i]=s,r[s]=o,n.observerSlots[s]=i)}}if(e.tOwned){for(t=e.tOwned.length-1;t>=0;t--)se(e.tOwned[t]);delete e.tOwned}if(e.owned){for(t=e.owned.length-1;t>=0;t--)se(e.owned[t]);e.owned=null}if(e.cleanups){for(t=e.cleanups.length-1;t>=0;t--)e.cleanups[t]();e.cleanups=null}e.state=0}function de(e){return e instanceof Error?e:new Error(typeof e=="string"?e:"Unknown error",{cause:e})}function Ve(e,t=S){throw de(e)}function Oe(e){if(typeof e=="function"&&!e.length)return Oe(e());if(Array.isArray(e)){const t=[];for(let n=0;n<e.length;n++){const s=Oe(e[n]);Array.isArray(s)?t.push.apply(t,s):t.push(s)}return t}return e}function Bt(e,t){return function(s){let r;return D(()=>r=N(()=>(S.context={...S.context,[e]:s.value},Fe(()=>s.children))),void 0),r}}const zt=Symbol("fallback");function Je(e){for(let t=0;t<e.length;t++)e[t]()}function Ht(e,t,n={}){let s=[],r=[],o=[],i=0,l=t.length>1?[]:null;return ie(()=>Je(o)),()=>{let a=e()||[],c=a.length,d,u;return a[Lt],N(()=>{let f,g,m,p,v,y,x,w,C;if(c===0)i!==0&&(Je(o),o=[],s=[],r=[],i=0,l&&(l=[])),n.fallback&&(s=[zt],r[0]=ne(L=>(o[0]=L,n.fallback())),i=1);else if(i===0){for(r=new Array(c),u=0;u<c;u++)s[u]=a[u],r[u]=ne(h);i=c}else{for(m=new Array(c),p=new Array(c),l&&(v=new Array(c)),y=0,x=Math.min(i,c);y<x&&s[y]===a[y];y++);for(x=i-1,w=c-1;x>=y&&w>=y&&s[x]===a[w];x--,w--)m[w]=r[x],p[w]=o[x],l&&(v[w]=l[x]);for(f=new Map,g=new Array(w+1),u=w;u>=y;u--)C=a[u],d=f.get(C),g[u]=d===void 0?-1:d,f.set(C,u);for(d=y;d<=x;d++)C=s[d],u=f.get(C),u!==void 0&&u!==-1?(m[u]=r[d],p[u]=o[d],l&&(v[u]=l[d]),u=g[u],f.set(C,u)):o[d]();for(u=y;u<c;u++)u in m?(r[u]=m[u],o[u]=p[u],l&&(l[u]=v[u],l[u](u))):r[u]=ne(h);r=r.slice(0,i=c),s=a.slice(0)}return r});function h(f){if(o[u]=f,l){const[g,m]=I(u);return l[u]=m,t(a[u],g)}return t(a[u])}}}function $(e,t){return N(()=>e(t||{}))}function ue(){return!0}const Re={get(e,t,n){return t===ge?n:e.get(t)},has(e,t){return t===ge?!0:e.has(t)},set:ue,deleteProperty:ue,getOwnPropertyDescriptor(e,t){return{configurable:!0,enumerable:!0,get(){return e.get(t)},set:ue,deleteProperty:ue}},ownKeys(e){return e.keys()}};function Ie(e){return(e=typeof e=="function"?e():e)?e:{}}function qt(){for(let e=0,t=this.length;e<t;++e){const n=this[e]();if(n!==void 0)return n}}function Te(...e){let t=!1;for(let i=0;i<e.length;i++){const l=e[i];t=t||!!l&&ge in l,e[i]=typeof l=="function"?(t=!0,k(l)):l}if(ot&&t)return new Proxy({get(i){for(let l=e.length-1;l>=0;l--){const a=Ie(e[l])[i];if(a!==void 0)return a}},has(i){for(let l=e.length-1;l>=0;l--)if(i in Ie(e[l]))return!0;return!1},keys(){const i=[];for(let l=0;l<e.length;l++)i.push(...Object.keys(Ie(e[l])));return[...new Set(i)]}},Re);const n={},s=Object.create(null);for(let i=e.length-1;i>=0;i--){const l=e[i];if(!l)continue;const a=Object.getOwnPropertyNames(l);for(let c=a.length-1;c>=0;c--){const d=a[c];if(d==="__proto__"||d==="constructor")continue;const u=Object.getOwnPropertyDescriptor(l,d);if(!s[d])s[d]=u.get?{enumerable:!0,configurable:!0,get:qt.bind(n[d]=[u.get.bind(l)])}:u.value!==void 0?u:void 0;else{const h=n[d];h&&(u.get?h.push(u.get.bind(l)):u.value!==void 0&&h.push(()=>u.value))}}}const r={},o=Object.keys(s);for(let i=o.length-1;i>=0;i--){const l=o[i],a=s[l];a&&a.get?Object.defineProperty(r,l,a):r[l]=a?a.value:void 0}return r}function Kt(e,...t){const n=t.length;if(ot&&ge in e){const r=n>1?t.flat():t[0],o=t.map(i=>new Proxy({get(l){return i.includes(l)?e[l]:void 0},has(l){return i.includes(l)&&l in e},keys(){return i.filter(l=>l in e)}},Re));return o.push(new Proxy({get(i){return r.includes(i)?void 0:e[i]},has(i){return r.includes(i)?!1:i in e},keys(){return Object.keys(e).filter(i=>!r.includes(i))}},Re)),o}const s=[];for(let r=0;r<=n;r++)s[r]={};for(const r of Object.getOwnPropertyNames(e)){let o=n;for(let a=0;a<t.length;a++)if(t[a].includes(r)){o=a;break}const i=Object.getOwnPropertyDescriptor(e,r);!i.get&&!i.set&&i.enumerable&&i.writable&&i.configurable?s[o][r]=i.value:Object.defineProperty(s[o],r,i)}return s}const Wt=e=>`Stale read from <${e}>.`;function le(e){const t="fallback"in e&&{fallback:()=>e.fallback};return k(Ht(()=>e.each,e.children,t||void 0))}function F(e){const t=e.keyed,n=k(()=>e.when,void 0,void 0),s=t?n:k(n,void 0,{equals:(r,o)=>!r==!o});return k(()=>{const r=s();if(r){const o=e.children;return typeof o=="function"&&o.length>0?N(()=>o(t?r:()=>{if(!N(s))throw Wt("Show");return n()})):o}return e.fallback},void 0,void 0)}const Gt=["allowfullscreen","async","alpha","autofocus","autoplay","checked","controls","default","disabled","formnovalidate","hidden","indeterminate","inert","ismap","loop","multiple","muted","nomodule","novalidate","open","playsinline","readonly","required","reversed","seamless","selected","adauctionheaders","browsingtopics","credentialless","defaultchecked","defaultmuted","defaultselected","defer","disablepictureinpicture","disableremoteplayback","preservespitch","shadowrootclonable","shadowrootcustomelementregistry","shadowrootdelegatesfocus","shadowrootserializable","sharedstoragewritable"],Jt=new Set(["className","value","readOnly","noValidate","formNoValidate","isMap","noModule","playsInline","adAuctionHeaders","allowFullscreen","browsingTopics","defaultChecked","defaultMuted","defaultSelected","disablePictureInPicture","disableRemotePlayback","preservesPitch","shadowRootClonable","shadowRootCustomElementRegistry","shadowRootDelegatesFocus","shadowRootSerializable","sharedStorageWritable",...Gt]),Xt=new Set(["innerHTML","textContent","innerText","children"]),Yt=Object.assign(Object.create(null),{className:"class",htmlFor:"for"}),Qt=Object.assign(Object.create(null),{class:"className",novalidate:{$:"noValidate",FORM:1},formnovalidate:{$:"formNoValidate",BUTTON:1,INPUT:1},ismap:{$:"isMap",IMG:1},nomodule:{$:"noModule",SCRIPT:1},playsinline:{$:"playsInline",VIDEO:1},readonly:{$:"readOnly",INPUT:1,TEXTAREA:1},adauctionheaders:{$:"adAuctionHeaders",IFRAME:1},allowfullscreen:{$:"allowFullscreen",IFRAME:1},browsingtopics:{$:"browsingTopics",IMG:1},defaultchecked:{$:"defaultChecked",INPUT:1},defaultmuted:{$:"defaultMuted",AUDIO:1,VIDEO:1},defaultselected:{$:"defaultSelected",OPTION:1},disablepictureinpicture:{$:"disablePictureInPicture",VIDEO:1},disableremoteplayback:{$:"disableRemotePlayback",AUDIO:1,VIDEO:1},preservespitch:{$:"preservesPitch",AUDIO:1,VIDEO:1},shadowrootclonable:{$:"shadowRootClonable",TEMPLATE:1},shadowrootdelegatesfocus:{$:"shadowRootDelegatesFocus",TEMPLATE:1},shadowrootserializable:{$:"shadowRootSerializable",TEMPLATE:1},sharedstoragewritable:{$:"sharedStorageWritable",IFRAME:1,IMG:1}});function Zt(e,t){const n=Qt[e];return typeof n=="object"?n[t]?n.$:void 0:n}const en=new Set(["beforeinput","click","dblclick","contextmenu","focusin","focusout","input","keydown","keyup","mousedown","mousemove","mouseout","mouseover","mouseup","pointerdown","pointermove","pointerout","pointerover","pointerup","touchend","touchmove","touchstart"]),Be=e=>k(()=>e());function tn(e,t,n){let s=n.length,r=t.length,o=s,i=0,l=0,a=t[r-1].nextSibling,c=null;for(;i<r||l<o;){if(t[i]===n[l]){i++,l++;continue}for(;t[r-1]===n[o-1];)r--,o--;if(r===i){const d=o<s?l?n[l-1].nextSibling:n[o-l]:a;for(;l<o;)e.insertBefore(n[l++],d)}else if(o===l)for(;i<r;)(!c||!c.has(t[i]))&&t[i].remove(),i++;else if(t[i]===n[o-1]&&n[l]===t[r-1]){const d=t[--r].nextSibling;e.insertBefore(n[l++],t[i++].nextSibling),e.insertBefore(n[--o],d),t[r]=n[o]}else{if(!c){c=new Map;let u=l;for(;u<o;)c.set(n[u],u++)}const d=c.get(t[i]);if(d!=null)if(l<d&&d<o){let u=i,h=1,f;for(;++u<r&&u<o&&!((f=c.get(t[u]))==null||f!==d+h);)h++;if(h>d-l){const g=t[i];for(;l<d;)e.insertBefore(n[l++],g)}else e.replaceChild(n[l++],t[i++])}else i++;else t[i++].remove()}}}const Xe="_$DX_DELEGATE";function nn(e,t,n,s={}){let r;return ne(o=>{r=o,t===document?e():b(t,e(),t.firstChild?null:void 0,n)},s.owner),()=>{r(),t.textContent=""}}function R(e,t,n,s){let r;const o=()=>{const l=document.createElement("template");return l.innerHTML=e,l.content.firstChild},i=()=>(r||(r=o())).cloneNode(!0);return i.cloneNode=i,i}function z(e,t=window.document){const n=t[Xe]||(t[Xe]=new Set);for(let s=0,r=e.length;s<r;s++){const o=e[s];n.has(o)||(n.add(o),t.addEventListener(o,cn))}}function V(e,t,n){n==null?e.removeAttribute(t):e.setAttribute(t,n)}function rn(e,t,n){n?e.setAttribute(t,""):e.removeAttribute(t)}function ze(e,t){t==null?e.removeAttribute("class"):e.className=t}function mt(e,t,n,s){if(s)Array.isArray(n)?(e[`$$${t}`]=n[0],e[`$$${t}Data`]=n[1]):e[`$$${t}`]=n;else if(Array.isArray(n)){const r=n[0];e.addEventListener(t,n[0]=o=>r.call(e,n[1],o))}else e.addEventListener(t,n,typeof n!="function"&&n)}function sn(e,t,n={}){const s=Object.keys(t||{}),r=Object.keys(n);let o,i;for(o=0,i=r.length;o<i;o++){const l=r[o];!l||l==="undefined"||t[l]||(Ye(e,l,!1),delete n[l])}for(o=0,i=s.length;o<i;o++){const l=s[o],a=!!t[l];!l||l==="undefined"||n[l]===a||!a||(Ye(e,l,!0),n[l]=a)}return n}function pt(e,t,n){if(!t)return n?V(e,"style"):t;const s=e.style;if(typeof t=="string")return s.cssText=t;typeof n=="string"&&(s.cssText=n=void 0),n||(n={}),t||(t={});let r,o;for(o in n)t[o]==null&&s.removeProperty(o),delete n[o];for(o in t)r=t[o],r!==n[o]&&(s.setProperty(o,r),n[o]=r);return n}function we(e,t,n){n!=null?e.style.setProperty(t,n):e.style.removeProperty(t)}function on(e,t={},n,s){const r={};return D(()=>r.children=oe(e,t.children,r.children)),D(()=>typeof t.ref=="function"&&ve(t.ref,e)),D(()=>ln(e,t,n,!0,r,!0)),r}function ve(e,t,n){return N(()=>e(t,n))}function b(e,t,n,s){if(n!==void 0&&!s&&(s=[]),typeof t!="function")return oe(e,t,s,n);D(r=>oe(e,t(),r,n),s)}function ln(e,t,n,s,r={},o=!1){t||(t={});for(const i in r)if(!(i in t)){if(i==="children")continue;r[i]=Qe(e,i,null,r[i],n,o,t)}for(const i in t){if(i==="children")continue;const l=t[i];r[i]=Qe(e,i,l,r[i],n,o,t)}}function an(e){return e.toLowerCase().replace(/-([a-z])/g,(t,n)=>n.toUpperCase())}function Ye(e,t,n){const s=t.trim().split(/\\s+/);for(let r=0,o=s.length;r<o;r++)e.classList.toggle(s[r],n)}function Qe(e,t,n,s,r,o,i){let l,a,c,d,u;if(t==="style")return pt(e,n,s);if(t==="classList")return sn(e,n,s);if(n===s)return s;if(t==="ref")o||n(e);else if(t.slice(0,3)==="on:"){const h=t.slice(3);s&&e.removeEventListener(h,s,typeof s!="function"&&s),n&&e.addEventListener(h,n,typeof n!="function"&&n)}else if(t.slice(0,10)==="oncapture:"){const h=t.slice(10);s&&e.removeEventListener(h,s,!0),n&&e.addEventListener(h,n,!0)}else if(t.slice(0,2)==="on"){const h=t.slice(2).toLowerCase(),f=en.has(h);if(!f&&s){const g=Array.isArray(s)?s[0]:s;e.removeEventListener(h,g)}(f||n)&&(mt(e,h,n,f),f&&z([h]))}else t.slice(0,5)==="attr:"?V(e,t.slice(5),n):t.slice(0,5)==="bool:"?rn(e,t.slice(5),n):(u=t.slice(0,5)==="prop:")||(c=Xt.has(t))||(d=Zt(t,e.tagName))||(a=Jt.has(t))||(l=e.nodeName.includes("-")||"is"in i)?(u&&(t=t.slice(5),a=!0),t==="class"||t==="className"?ze(e,n):l&&!a&&!c?e[an(t)]=n:e[d||t]=n):V(e,Yt[t]||t,n);return n}function cn(e){let t=e.target;const n=`$$${e.type}`,s=e.target,r=e.currentTarget,o=a=>Object.defineProperty(e,"target",{configurable:!0,value:a}),i=()=>{const a=t[n];if(a&&!t.disabled){const c=t[`${n}Data`];if(c!==void 0?a.call(t,c,e):a.call(t,e),e.cancelBubble)return}return t.host&&typeof t.host!="string"&&!t.host._$host&&t.contains(e.target)&&o(t.host),!0},l=()=>{for(;i()&&(t=t._$host||t.parentNode||t.host););};if(Object.defineProperty(e,"currentTarget",{configurable:!0,get(){return t||document}}),e.composedPath){const a=e.composedPath();o(a[0]);for(let c=0;c<a.length-2&&(t=a[c],!!i());c++){if(t._$host){t=t._$host,l();break}if(t.parentNode===r)break}}else l();o(s)}function oe(e,t,n,s,r){for(;typeof n=="function";)n=n();if(t===n)return n;const o=typeof t,i=s!==void 0;if(e=i&&n[0]&&n[0].parentNode||e,o==="string"||o==="number"){if(o==="number"&&(t=t.toString(),t===n))return n;if(i){let l=n[0];l&&l.nodeType===3?l.data!==t&&(l.data=t):l=document.createTextNode(t),n=Z(e,n,s,l)}else n!==""&&typeof n=="string"?n=e.firstChild.data=t:n=e.textContent=t}else if(t==null||o==="boolean")n=Z(e,n,s);else{if(o==="function")return D(()=>{let l=t();for(;typeof l=="function";)l=l();n=oe(e,l,n,s)}),()=>n;if(Array.isArray(t)){const l=[],a=n&&Array.isArray(n);if(De(l,t,n,r))return D(()=>n=oe(e,l,n,s,!0)),()=>n;if(l.length===0){if(n=Z(e,n,s),i)return n}else a?n.length===0?Ze(e,l,s):tn(e,n,l):(n&&Z(e),Ze(e,l));n=l}else if(t.nodeType){if(Array.isArray(n)){if(i)return n=Z(e,n,s,t);Z(e,n,null,t)}else n==null||n===""||!e.firstChild?e.appendChild(t):e.replaceChild(t,e.firstChild);n=t}}return n}function De(e,t,n,s){let r=!1;for(let o=0,i=t.length;o<i;o++){let l=t[o],a=n&&n[e.length],c;if(!(l==null||l===!0||l===!1))if((c=typeof l)=="object"&&l.nodeType)e.push(l);else if(Array.isArray(l))r=De(e,l,a)||r;else if(c==="function")if(s){for(;typeof l=="function";)l=l();r=De(e,Array.isArray(l)?l:[l],Array.isArray(a)?a:[a])||r}else e.push(l),r=!0;else{const d=String(l);a&&a.nodeType===3&&a.data===d?e.push(a):e.push(document.createTextNode(d))}}return r}function Ze(e,t,n=null){for(let s=0,r=t.length;s<r;s++)e.insertBefore(t[s],n)}function Z(e,t,n,s){if(n===void 0)return e.textContent="";const r=s||document.createTextNode("");if(t.length){let o=!1;for(let i=t.length-1;i>=0;i--){const l=t[i];if(r!==l){const a=l.parentNode===e;!o&&!i?a?e.replaceChild(r,l):e.insertBefore(r,n):a&&l.remove()}else o=!0}}else e.insertBefore(r,n);return[r]}const un=!1;function bt(){let e=new Set;function t(r){return e.add(r),()=>e.delete(r)}let n=!1;function s(r,o){if(n)return!(n=!1);const i={to:r,options:o,defaultPrevented:!1,preventDefault:()=>i.defaultPrevented=!0};for(const l of e)l.listener({...i,from:l.location,retry:a=>{a&&(n=!0),l.navigate(r,{...o,resolve:!1})}});return!i.defaultPrevented}return{subscribe:t,confirm:s}}let je;function He(){(!window.history.state||window.history.state._depth==null)&&window.history.replaceState({...window.history.state,_depth:window.history.length-1},""),je=window.history.state._depth}He();function fn(e){return{...e,_depth:window.history.state&&window.history.state._depth}}function dn(e,t){let n=!1;return()=>{const s=je;He();const r=s==null?null:je-s;if(n){n=!1;return}r&&t(r)?(n=!0,window.history.go(-r)):e()}}const hn=/^(?:[a-z0-9]+:)?\\/\\//i,gn=/^\\/+|(\\/)\\/+$/g,yt="http://sr";function Y(e,t=!1){const n=e.replace(gn,"$1");return n?t||/^[?#]/.test(n)?n:"/"+n:""}function he(e,t,n){if(hn.test(t))return;const s=Y(e),r=n&&Y(n);let o="";return!r||t.startsWith("/")?o=s:r.toLowerCase().indexOf(s.toLowerCase())!==0?o=s+r:o=r,(o||"/")+Y(t,!o)}function mn(e,t){if(e==null)throw new Error(t);return e}function pn(e,t){return Y(e).replace(/\\/*(\\*.*)?$/g,"")+Y(t)}function wt(e){const t={};return e.searchParams.forEach((n,s)=>{s in t?Array.isArray(t[s])?t[s].push(n):t[s]=[t[s],n]:t[s]=n}),t}function bn(e,t,n){const[s,r]=e.split("/*",2),o=s.split("/").filter(Boolean),i=o.length;return l=>{const a=l.split("/").filter(Boolean),c=a.length-i;if(c<0||c>0&&r===void 0&&!t)return null;const d={path:i?"":"/",params:{}},u=h=>n===void 0?void 0:n[h];for(let h=0;h<i;h++){const f=o[h],g=f[0]===":",m=g?a[h]:a[h].toLowerCase(),p=g?f.slice(1):f.toLowerCase();if(g&&ke(m,u(p)))d.params[p]=m;else if(g||!ke(m,p))return null;d.path+=`/${m}`}if(r){const h=c?a.slice(-c).join("/"):"";if(ke(h,u(r)))d.params[r]=h;else return null}return d}}function ke(e,t){const n=s=>s===e;return t===void 0?!0:typeof t=="string"?n(t):typeof t=="function"?t(e):Array.isArray(t)?t.some(n):t instanceof RegExp?t.test(e):!1}function yn(e){const[t,n]=e.pattern.split("/*",2),s=t.split("/").filter(Boolean);return s.reduce((r,o)=>r+(o.startsWith(":")?2:3),s.length-(n===void 0?0:1))}function vt(e){const t=new Map,n=ct();return new Proxy({},{get(s,r){return t.has(r)||Ue(n,()=>t.set(r,k(()=>e()[r]))),t.get(r)()},getOwnPropertyDescriptor(){return{enumerable:!0,configurable:!0}},ownKeys(){return Reflect.ownKeys(e())}})}function $t(e){let t=/(\\/?\\:[^\\/]+)\\?/.exec(e);if(!t)return[e];let n=e.slice(0,t.index),s=e.slice(t.index+t[0].length);const r=[n,n+=t[1]];for(;t=/^(\\/\\:[^\\/]+)\\?/.exec(s);)r.push(n+=t[1]),s=s.slice(t[0].length);return $t(s).reduce((o,i)=>[...o,...r.map(l=>l+i)],[])}const wn=100,xt=ut(),qe=ut(),Ce=()=>mn(Me(xt),"<A> and \'use\' router primitives can be only used inside a Route."),vn=()=>Me(qe)||Ce().base,$n=e=>{const t=vn();return k(()=>t.resolvePath(e()))},xn=e=>{const t=Ce();return k(()=>{const n=e();return n!==void 0?t.renderPath(n):n})},Sn=()=>Ce().location,Cn=()=>Ce().params;function _n(e,t=""){const{component:n,preload:s,load:r,children:o,info:i}=e,l=!o||Array.isArray(o)&&!o.length,a={key:e,component:n,preload:s||r,info:i};return St(e.path).reduce((c,d)=>{for(const u of $t(d)){const h=pn(t,u);let f=l?h:h.split("/*",1)[0];f=f.split("/").map(g=>g.startsWith(":")||g.startsWith("*")?g:encodeURIComponent(g)).join("/"),c.push({...a,originalPath:d,pattern:f,matcher:bn(f,!l,e.matchFilters)})}return c},[])}function An(e,t=0){return{routes:e,score:yn(e[e.length-1])*1e4-t,matcher(n){const s=[];for(let r=e.length-1;r>=0;r--){const o=e[r],i=o.matcher(n);if(!i)return null;s.unshift({...i,route:o})}return s}}}function St(e){return Array.isArray(e)?e:[e]}function Ct(e,t="",n=[],s=[]){const r=St(e);for(let o=0,i=r.length;o<i;o++){const l=r[o];if(l&&typeof l=="object"){l.hasOwnProperty("path")||(l.path="");const a=_n(l,t);for(const c of a){n.push(c);const d=Array.isArray(l.children)&&l.children.length===0;if(l.children&&!d)Ct(l.children,c.pattern,n,s);else{const u=An([...n],s.length);s.push(u)}n.pop()}}}return n.length?s:s.sort((o,i)=>i.score-o.score)}function Le(e,t){for(let n=0,s=e.length;n<s;n++){const r=e[n].matcher(t);if(r)return r}return[]}function Pn(e,t,n){const s=new URL(yt),r=k(d=>{const u=e();try{return new URL(u,s)}catch{return console.error(`Invalid path ${u}`),d}},s,{equals:(d,u)=>d.href===u.href}),o=k(()=>r().pathname),i=k(()=>r().search,!0),l=k(()=>r().hash),a=()=>"",c=Ne(i,()=>wt(r()));return{get pathname(){return o()},get search(){return i()},get hash(){return l()},get state(){return t()},get key(){return a()},query:n?n(c):vt(c)}}let X;function En(){return X}function In(e,t,n,s={}){const{signal:[r,o],utils:i={}}=e,l=i.parsePath||(A=>A),a=i.renderPath||(A=>A),c=i.beforeLeave||bt(),d=he("",s.base||"");if(d===void 0)throw new Error(`${d} is not a valid base path`);d&&!r().value&&o({value:d,replace:!0,scroll:!1});const[u,h]=I(!1);let f;const g=(A,P)=>{P.value===m()&&P.state===v()||(f===void 0&&h(!0),X=A,f=P,Nt(()=>{f===P&&(p(f.value),y(f.state),C[1]([]))}).finally(()=>{f===P&&Dt(()=>{X=void 0,A==="navigate"&&T(f),h(!1),f=void 0})}))},[m,p]=I(r().value),[v,y]=I(r().state),x=Pn(m,v,i.queryWrapper),w=[],C=I([]),L=k(()=>typeof s.transformUrl=="function"?Le(t(),s.transformUrl(x.pathname)):Le(t(),x.pathname)),H=()=>{const A=L(),P={};for(let M=0;M<A.length;M++)Object.assign(P,A[M].params);return P},G=i.paramsWrapper?i.paramsWrapper(H,t):vt(H),O={pattern:d,path:()=>d,outlet:()=>null,resolvePath(A){return he(d,A)}};return D(Ne(r,A=>g("native",A),{defer:!0})),{base:O,location:x,params:G,isRouting:u,renderPath:a,parsePath:l,navigatorFactory:U,matches:L,beforeLeave:c,preloadRoute:J,singleFlight:s.singleFlight===void 0?!0:s.singleFlight,submissions:C};function E(A,P,M){N(()=>{if(typeof P=="number"){P&&(i.go?i.go(P):console.warn("Router integration does not support relative routing"));return}const ae=!P||P[0]==="?",{replace:_e,resolve:Q,scroll:Ae,state:te}={replace:!1,resolve:!ae,scroll:!0,...M},ce=Q?A.resolvePath(P):he(ae&&x.pathname||"",P);if(ce===void 0)throw new Error(`Path \'${P}\' is not a routable path`);if(w.length>=wn)throw new Error("Too many redirects");const Ge=m();(ce!==Ge||te!==v())&&(un||c.confirm(ce,M)&&(w.push({value:Ge,replace:_e,scroll:Ae,state:v()}),g("navigate",{value:ce,state:te})))})}function U(A){return A=A||Me(qe)||O,(P,M)=>E(A,P,M)}function T(A){const P=w[0];P&&(o({...A,replace:P.replace,scroll:P.scroll}),w.length=0)}function J(A,P){const M=Le(t(),A.pathname),ae=X;X="preload";for(let _e in M){const{route:Q,params:Ae}=M[_e];Q.component&&Q.component.preload&&Q.component.preload();const{preload:te}=Q;P&&te&&Ue(n(),()=>te({params:Ae,location:{pathname:A.pathname,search:A.search,hash:A.hash,query:wt(A),state:null,key:""},intent:"preload"}))}X=ae}}function kn(e,t,n,s){const{base:r,location:o,params:i}=e,{pattern:l,component:a,preload:c}=s().route,d=k(()=>s().path);a&&a.preload&&a.preload();const u=c?c({params:i,location:o,intent:X||"initial"}):void 0;return{parent:t,pattern:l,path:d,outlet:()=>a?$(a,{params:i,location:o,data:u,get children(){return n()}}):n(),resolvePath(f){return he(r.path(),f,d())}}}const Ln=e=>t=>{const{base:n}=t,s=Fe(()=>t.children),r=k(()=>Ct(s(),t.base||""));let o;const i=In(e,r,()=>o,{base:n,singleFlight:t.singleFlight,transformUrl:t.transformUrl});return e.create&&e.create(i),$(xt.Provider,{value:i,get children(){return $(On,{routerState:i,get root(){return t.root},get preload(){return t.rootPreload||t.rootLoad},get children(){return[Be(()=>(o=ct())&&null),$(Rn,{routerState:i,get branches(){return r()}})]}})}})};function On(e){const t=e.routerState.location,n=e.routerState.params,s=k(()=>e.preload&&N(()=>{e.preload({params:n,location:t,intent:En()||"initial"})}));return $(F,{get when(){return e.root},keyed:!0,get fallback(){return e.children},children:r=>$(r,{params:n,location:t,get data(){return s()},get children(){return e.children}})})}function Rn(e){const t=[];let n;const s=k(Ne(e.routerState.matches,(r,o,i)=>{let l=o&&r.length===o.length;const a=[];for(let c=0,d=r.length;c<d;c++){const u=o&&o[c],h=r[c];i&&u&&h.route.key===u.route.key?a[c]=i[c]:(l=!1,t[c]&&t[c](),ne(f=>{t[c]=f,a[c]=kn(e.routerState,a[c-1]||e.routerState.base,et(()=>s()[c+1]),()=>e.routerState.matches()[c])}))}return t.splice(r.length).forEach(c=>c()),i&&l?i:(n=a[0],a)}));return et(()=>s()&&n)()}const et=e=>()=>$(F,{get when(){return e()},keyed:!0,children:t=>$(qe.Provider,{value:t,get children(){return t.outlet()}})}),tt=e=>{const t=Fe(()=>e.children);return Te(e,{get children(){return t()}})};function Tn([e,t],n,s){return[e,s?r=>t(s(r)):t]}function Dn(e){let t=!1;const n=r=>typeof r=="string"?{value:r}:r,s=Tn(I(n(e.get()),{equals:(r,o)=>r.value===o.value&&r.state===o.state}),void 0,r=>(!t&&e.set(r),r));return e.init&&ie(e.init((r=e.get())=>{t=!0,s[1](n(r)),t=!1})),Ln({signal:s,create:e.create,utils:e.utils})}function jn(e,t,n){return e.addEventListener(t,n),()=>e.removeEventListener(t,n)}function Nn(e,t){const n=e&&document.getElementById(e);n?n.scrollIntoView():t&&window.scrollTo(0,0)}const Un=new Map;function Mn(e=!0,t=!1,n="/_server",s){return r=>{const o=r.base.path(),i=r.navigatorFactory(r.base);let l,a;function c(m){return m.namespaceURI==="http://www.w3.org/2000/svg"}function d(m){if(m.defaultPrevented||m.button!==0||m.metaKey||m.altKey||m.ctrlKey||m.shiftKey)return;const p=m.composedPath().find(L=>L instanceof Node&&L.nodeName.toUpperCase()==="A");if(!p||t&&!p.hasAttribute("link"))return;const v=c(p),y=v?p.href.baseVal:p.href;if((v?p.target.baseVal:p.target)||!y&&!p.hasAttribute("state"))return;const w=(p.getAttribute("rel")||"").split(/\\s+/);if(p.hasAttribute("download")||w&&w.includes("external"))return;const C=v?new URL(y,document.baseURI):new URL(y);if(!(C.origin!==window.location.origin||o&&C.pathname&&!C.pathname.toLowerCase().startsWith(o.toLowerCase())))return[p,C]}function u(m){const p=d(m);if(!p)return;const[v,y]=p,x=r.parsePath(y.pathname+y.search+y.hash),w=v.getAttribute("state");m.preventDefault(),i(x,{resolve:!1,replace:v.hasAttribute("replace"),scroll:!v.hasAttribute("noscroll"),state:w?JSON.parse(w):void 0})}function h(m){const p=d(m);if(!p)return;const[v,y]=p;s&&(y.pathname=s(y.pathname)),r.preloadRoute(y,v.getAttribute("preload")!=="false")}function f(m){clearTimeout(l);const p=d(m);if(!p)return a=null;const[v,y]=p;a!==v&&(s&&(y.pathname=s(y.pathname)),l=setTimeout(()=>{r.preloadRoute(y,v.getAttribute("preload")!=="false"),a=v},20))}function g(m){if(m.defaultPrevented)return;let p=m.submitter&&m.submitter.hasAttribute("formaction")?m.submitter.getAttribute("formaction"):m.target.getAttribute("action");if(!p)return;if(!p.startsWith("https://action/")){const y=new URL(p,yt);if(p=r.parsePath(y.pathname+y.search),!p.startsWith(n))return}if(m.target.method.toUpperCase()!=="POST")throw new Error("Only POST forms are supported for Actions");const v=Un.get(p);if(v){m.preventDefault();const y=new FormData(m.target,m.submitter);v.call({r,f:m.target},m.target.enctype==="multipart/form-data"?y:new URLSearchParams(y))}}z(["click","submit"]),document.addEventListener("click",u),e&&(document.addEventListener("mousemove",f,{passive:!0}),document.addEventListener("focusin",h,{passive:!0}),document.addEventListener("touchstart",h,{passive:!0})),document.addEventListener("submit",g),ie(()=>{document.removeEventListener("click",u),e&&(document.removeEventListener("mousemove",f),document.removeEventListener("focusin",h),document.removeEventListener("touchstart",h)),document.removeEventListener("submit",g)})}}function Fn(e){const t=()=>{const s=window.location.pathname.replace(/^\\/+/,"/")+window.location.search,r=window.history.state&&window.history.state._depth&&Object.keys(window.history.state).length===1?void 0:window.history.state;return{value:s+window.location.hash,state:r}},n=bt();return Dn({get:t,set({value:s,replace:r,scroll:o,state:i}){r?window.history.replaceState(fn(i),"",s):window.history.pushState(i,"",s),Nn(decodeURIComponent(window.location.hash.slice(1)),o),He()},init:s=>jn(window,"popstate",dn(s,r=>{if(r&&r<0)return!n.confirm(r);{const o=t();return!n.confirm(o.value,{state:o.state})}})),create:Mn(e.preload,e.explicitLinks,e.actionBase,e.transformUrl),utils:{go:s=>window.history.go(s),beforeLeave:n}})(e)}var Vn=R("<a>");function _t(e){e=Te({inactiveClass:"inactive",activeClass:"active"},e);const[,t]=Kt(e,["href","state","class","activeClass","inactiveClass","end"]),n=$n(()=>e.href),s=xn(n),r=Sn(),o=k(()=>{const i=n();if(i===void 0)return[!1,!1];const l=Y(i.split(/[?#]/,1)[0]).toLowerCase(),a=decodeURI(Y(r.pathname).toLowerCase());return[e.end?l===a:a.startsWith(l+"/")||a===l,l===a]});return(()=>{var i=Vn();return on(i,Te(t,{get href(){return s()||e.href},get state(){return JSON.stringify(e.state)},get classList(){return{...e.class&&{[e.class]:!0},[e.inactiveClass]:!o()[0],[e.activeClass]:o()[0],...t.classList}},link:"",get"aria-current"(){return o()[1]?"page":void 0}}),!1),i})()}async function fe(e){if(!e.ok){const t=await e.json().catch(()=>({}));throw new Error(t.error||`HTTP ${e.status}`)}return e.json()}const re={list:()=>fetch("/gui/api/sandbox-sessions").then(e=>fe(e)),get:e=>fetch(`/gui/api/sandbox-session/${nt(e)}`).then(t=>fe(t)),create:e=>fetch("/gui/api/sandbox-create",{method:"POST",headers:Bn,body:JSON.stringify(e)}).then(t=>fe(t)),destroy:e=>fetch(`/gui/api/sandbox-session/${nt(e)}`,{method:"DELETE"}).then(t=>fe(t))},Bn={"Content-Type":"application/json"},nt=encodeURIComponent,At="takos-lang",zn={actions:"Actions",active:"active",autoRefresh:"Auto-refresh: every 10s",backToDashboard:"Dashboard",cancel:"Cancel",commandPlaceholder:"command...",create:"Create",createFailed:"Create failed: {message}",createSandboxSession:"Create Sandbox Session",creating:"Creating...",created:"Created",delete:"Delete",destroy:"Destroy",destroyCurrentConfirm:"Destroy this sandbox session?",destroySessionConfirm:\'Destroy sandbox session "{id}"?\',emptyDirectory:"Empty directory",error:"Error: {message}",files:"Files",justNow:"just now",language:"Language",loading:"loading",loadingEllipsis:"Loading...",noProcesses:"No processes",noSessions:"No sessions",open:"Open",processes:"Processes",refresh:"Refresh",sandbox:"Sandbox:",sandboxSession:"+ Sandbox Session",sessionId:"Session ID",sessionIdPlaceholder:"e.g. my-session-01",space:"Space",spaceId:"Space ID",spaceIdPlaceholder:"e.g. space-abc",status:"Status",starting:"starting",stopped:"stopped",timeAgoDays:"{count}d ago",timeAgoHours:"{count}h ago",timeAgoMinutes:"{count}m ago",timedOut:"(timed out)",typeCommandHint:`Type a command and press Enter.\n`,userId:"User ID",userIdPlaceholder:"e.g. user-123"},Hn={actions:"\u64CD\u4F5C",active:"\u7A3C\u50CD\u4E2D",autoRefresh:"\u81EA\u52D5\u66F4\u65B0: 10 \u79D2\u3054\u3068",backToDashboard:"\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9",cancel:"\u30AD\u30E3\u30F3\u30BB\u30EB",commandPlaceholder:"\u30B3\u30DE\u30F3\u30C9...",create:"\u4F5C\u6210",createFailed:"\u4F5C\u6210\u306B\u5931\u6557\u3057\u307E\u3057\u305F: {message}",createSandboxSession:"\u30B5\u30F3\u30C9\u30DC\u30C3\u30AF\u30B9\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u4F5C\u6210",creating:"\u4F5C\u6210\u4E2D...",created:"\u4F5C\u6210\u65E5\u6642",delete:"\u524A\u9664",destroy:"\u7834\u68C4",destroyCurrentConfirm:"\u3053\u306E\u30B5\u30F3\u30C9\u30DC\u30C3\u30AF\u30B9\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u7834\u68C4\u3057\u307E\u3059\u304B\uFF1F",destroySessionConfirm:\'\u30B5\u30F3\u30C9\u30DC\u30C3\u30AF\u30B9\u30BB\u30C3\u30B7\u30E7\u30F3 "{id}" \u3092\u7834\u68C4\u3057\u307E\u3059\u304B\uFF1F\',emptyDirectory:"\u7A7A\u306E\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA",error:"\u30A8\u30E9\u30FC: {message}",files:"\u30D5\u30A1\u30A4\u30EB",justNow:"\u305F\u3063\u305F\u4ECA",language:"\u8A00\u8A9E",loading:"\u8AAD\u307F\u8FBC\u307F\u4E2D",loadingEllipsis:"\u8AAD\u307F\u8FBC\u307F\u4E2D...",noProcesses:"\u30D7\u30ED\u30BB\u30B9\u306F\u3042\u308A\u307E\u305B\u3093",noSessions:"\u30BB\u30C3\u30B7\u30E7\u30F3\u306F\u3042\u308A\u307E\u305B\u3093",open:"\u958B\u304F",processes:"\u30D7\u30ED\u30BB\u30B9",refresh:"\u66F4\u65B0",sandbox:"\u30B5\u30F3\u30C9\u30DC\u30C3\u30AF\u30B9:",sandboxSession:"+ \u30B5\u30F3\u30C9\u30DC\u30C3\u30AF\u30B9\u30BB\u30C3\u30B7\u30E7\u30F3",sessionId:"\u30BB\u30C3\u30B7\u30E7\u30F3 ID",sessionIdPlaceholder:"\u4F8B: my-session-01",space:"\u30B9\u30DA\u30FC\u30B9",spaceId:"\u30B9\u30DA\u30FC\u30B9 ID",spaceIdPlaceholder:"\u4F8B: space-abc",status:"\u72B6\u614B",starting:"\u8D77\u52D5\u4E2D",stopped:"\u505C\u6B62\u4E2D",timeAgoDays:"{count} \u65E5\u524D",timeAgoHours:"{count} \u6642\u9593\u524D",timeAgoMinutes:"{count} \u5206\u524D",timedOut:"(\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8)",typeCommandHint:`\u30B3\u30DE\u30F3\u30C9\u3092\u5165\u529B\u3057\u3066 Enter \u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002\n`,userId:"\u30E6\u30FC\u30B6\u30FC ID",userIdPlaceholder:"\u4F8B: user-123"},rt={en:zn,ja:Hn};function qn(){try{const t=globalThis.localStorage?.getItem(At);if(t==="ja"||t==="en")return t}catch{}return(globalThis.navigator?.language?.toLowerCase()??"").startsWith("ja")?"ja":"en"}const[Ke,Kn]=I(qn());function Wn(e,t){return t?e.replace(/\\{(\\w+)\\}/g,(n,s)=>{const r=t[s];return r===void 0?`{${s}}`:String(r)}):e}function Pt(e){Kn(e);try{globalThis.localStorage?.setItem(At,e)}catch{}globalThis.document?.documentElement&&(globalThis.document.documentElement.lang=e)}function Gn(e,t){const n=Ke();return Wn(rt[n][e]??rt.en[e],t)}function W(){return{language:Ke,setLanguage:Pt,t:Gn}}Pt(Ke());var Jn=R("<div class=card><table class=session-table><thead><tr><th></th><th></th><th></th><th></th><th></th></tr></thead><tbody>"),Xn=R(\'<tr><td class=mono style=font-size:0.8125rem></td><td><span></span></td><td style=font-size:0.8125rem;color:#94a3b8></td><td style=font-size:0.8125rem;color:#94a3b8></td><td><div class="flex gap-1"><button type=button class="btn btn-danger btn-sm">\'),Yn=R("<tr><td colspan=5 style=text-align:center;color:#64748b;padding:2rem>");const Qn=e=>e==="active"?"badge badge-active":e==="starting"?"badge badge-starting":"badge badge-stopped",Zn=e=>e==="active"||e==="starting"?e:"stopped";function er(e){const{t}=W(),n=s=>{const r=Date.now()-new Date(s).getTime(),o=Math.floor(r/6e4);if(o<1)return t("justNow");if(o<60)return t("timeAgoMinutes",{count:o});const i=Math.floor(o/60);return i<24?t("timeAgoHours",{count:i}):t("timeAgoDays",{count:Math.floor(i/24)})};return(()=>{var s=Jn(),r=s.firstChild,o=r.firstChild,i=o.firstChild,l=i.firstChild,a=l.nextSibling,c=a.nextSibling,d=c.nextSibling,u=d.nextSibling,h=o.nextSibling;return b(l,()=>t("sessionId")),b(a,()=>t("status")),b(c,()=>t("space")),b(d,()=>t("created")),b(u,()=>t("actions")),b(h,$(F,{get when(){return!e.loading},get fallback(){return $(st,{get text(){return t("loadingEllipsis")}})},get children(){return $(F,{get when(){return e.sessions.length>0},get fallback(){return $(st,{get text(){return t("noSessions")}})},get children(){return $(le,{get each(){return e.sessions},children:f=>(()=>{var g=Xn(),m=g.firstChild,p=m.nextSibling,v=p.firstChild,y=p.nextSibling,x=y.nextSibling,w=x.nextSibling,C=w.firstChild,L=C.firstChild;return b(m,()=>f.sessionId),b(v,()=>t(Zn(f.status))),b(y,()=>f.spaceId),b(x,()=>n(f.createdAt)),b(C,$(_t,{get href(){return`/sandbox/${encodeURIComponent(f.sessionId)}`},class:"btn btn-primary btn-sm",get children(){return t("open")}}),L),L.$$click=()=>e.onDestroy(f.sessionId),b(L,()=>t("delete")),D(()=>ze(v,Qn(f.status))),g})()})}})}})),s})()}function st(e){return(()=>{var t=Yn(),n=t.firstChild;return b(n,()=>e.text),t})()}z(["click"]);var tr=R(\'<div class=modal-overlay><div class=modal-content><h2 style=font-size:1rem;font-weight:600;margin-bottom:1rem></h2><form><label></label><input name=sessionId required><label></label><input name=spaceId required><label></label><input name=userId required><div class="flex gap-2"style=justify-content:flex-end;margin-top:0.5rem><button type=button class="btn btn-ghost"></button><button type=submit class="btn btn-primary">\');function nr(e){const{t}=W(),[n,s]=I(!1);let r;const o=async i=>{i.preventDefault(),s(!0);const l=new FormData(r),a={sessionId:l.get("sessionId"),spaceId:l.get("spaceId"),userId:l.get("userId")};try{await e.onCreate(a),r.reset(),e.onClose()}catch(c){alert(t("createFailed",{message:c instanceof Error?c.message:String(c)}))}finally{s(!1)}};return $(F,{get when(){return e.open},get children(){var i=tr(),l=i.firstChild,a=l.firstChild,c=a.nextSibling,d=c.firstChild,u=d.nextSibling,h=u.nextSibling,f=h.nextSibling,g=f.nextSibling,m=g.nextSibling,p=m.nextSibling,v=p.firstChild,y=v.nextSibling;i.$$click=w=>{w.target===w.currentTarget&&e.onClose()},b(a,()=>t("createSandboxSession")),c.addEventListener("submit",o);var x=r;return typeof x=="function"?ve(x,c):r=c,b(d,()=>t("sessionId")),b(h,()=>t("spaceId")),b(g,()=>t("userId")),mt(v,"click",e.onClose,!0),b(v,()=>t("cancel")),b(y,(()=>{var w=Be(()=>!!n());return()=>w()?t("creating"):t("create")})()),D(w=>{var C=t("sessionIdPlaceholder"),L=t("spaceIdPlaceholder"),H=t("userIdPlaceholder"),G=n();return C!==w.e&&V(u,"placeholder",w.e=C),L!==w.t&&V(f,"placeholder",w.t=L),H!==w.a&&V(m,"placeholder",w.a=H),G!==w.o&&(y.disabled=w.o=G),w},{e:void 0,t:void 0,a:void 0,o:void 0}),i}})}z(["click"]);var rr=R(\'<div class="inline-flex rounded-lg"style="border:1px solid #334155;background:#0f172a;padding:0.125rem">\'),sr=R(\'<button type=button class="btn btn-sm">\');const or=[{label:"\u65E5\u672C\u8A9E",value:"ja"},{label:"English",value:"en"}];function Et(){const{language:e,setLanguage:t,t:n}=W();return(()=>{var s=rr();return b(s,$(le,{each:or,children:r=>(()=>{var o=sr();return o.$$click=()=>t(r.value),b(o,()=>r.label),D(i=>{var l=e()===r.value?"#334155":"transparent",a=e()===r.value?"#f1f5f9":"#94a3b8",c=e()===r.value;return l!==i.e&&we(o,"background",i.e=l),a!==i.t&&we(o,"color",i.t=a),c!==i.a&&V(o,"aria-pressed",i.a=c),i},{e:void 0,t:void 0,a:void 0}),o})()})),D(()=>V(s,"aria-label",n("language"))),s})()}z(["click"]);var ir=R(\'<div class=container><div class="flex items-center justify-between"style=margin-bottom:1.5rem><h1 style=font-size:1.25rem;font-weight:600>takos computer</h1></div><div class=flex style=justify-content:flex-end;margin-bottom:0.75rem><button type=button class="btn btn-primary"></button></div><div class=muted style=margin-top:0.75rem;font-size:0.6875rem>\');function lr(){const{t:e}=W(),[t,n]=I(!1),[s,r]=I(0),o=()=>r(c=>c+1),[i]=xe(()=>s(),()=>re.list()),l=setInterval(o,1e4);ie(()=>clearInterval(l));const a=async c=>{confirm(e("destroySessionConfirm",{id:c}))&&(await re.destroy(c),o())};return(()=>{var c=ir(),d=c.firstChild;d.firstChild;var u=d.nextSibling,h=u.firstChild,f=u.nextSibling;return b(d,$(Et,{}),null),h.$$click=()=>n(!0),b(h,()=>e("sandboxSession")),b(c,$(er,{get sessions(){return i()?.sessions??[]},get loading(){return i.loading},onDestroy:a}),f),b(f,()=>e("autoRefresh")),b(c,$(nr,{get open(){return t()},onClose:()=>n(!1),onCreate:async g=>{await re.create(g),o()}}),null),c})()}z(["click"]);let ar=0;async function We(e,t,n={}){const s=await fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",method:"tools/call",params:{name:t,arguments:n},id:++ar})});if(!s.ok)throw new Error(`MCP HTTP ${s.status}`);const r=await s.json();if(r.error)throw new Error(r.error.message||JSON.stringify(r.error));const o=r.result?.content;if(!o||!o.length)return null;const i=o[0];if(i.type==="text")try{return JSON.parse(i.text)}catch{return i.text}return i}var cr=R(\'<div style="background:#0f172a;border:1px solid #1e293b;border-radius:0.5rem;overflow:hidden"><div class=mono style=height:420px;overflow-y:auto;padding:0.75rem;font-size:0.8125rem;line-height:1.6;white-space:pre-wrap;word-break:break-all></div><div class=flex style="border-top:1px solid #1e293b"><span class=mono style="padding:0.5rem 0.75rem;color:#6ee7b7;font-size:0.8125rem">$</span><input class=mono autocomplete=off style="flex:1;background:transparent;border:none;outline:none;color:#e2e8f0;font-size:0.8125rem;padding:0.5rem 0.75rem 0.5rem 0">\'),ur=R("<span>");function fr(e){const{t}=W(),[n,s]=I([{text:t("typeCommandHint"),color:"#64748b"}]),[r,o]=I([]),[i,l]=I(-1);let a,c;at(()=>{s(f=>f.length!==1?f:[{text:t("typeCommandHint"),color:"#64748b"}])});const d=(f,g)=>{s(m=>[...m,{text:f,color:g}]),requestAnimationFrame(()=>{c.scrollTop=c.scrollHeight})},u=async()=>{const f=a.value.trim();if(f){o(g=>[f,...g].slice(0,100)),l(-1),a.value="",d(`$ ${f}\n`,"#6ee7b7");try{const g=await We(e.mcpUrl,"shell_exec",{command:f,cwd:e.cwd(),timeout_ms:3e4});g?.stdout&&d(g.stdout,"#e2e8f0"),g?.stderr&&d(g.stderr,"#fca5a5"),g?.timed_out?d(`${t("timedOut")}\n`,"#fcd34d"):g&&g.exit_code!==0&&d(`exit ${g.exit_code}\n`,"#64748b")}catch(g){d(`${t("error",{message:g instanceof Error?g.message:String(g)})}\n`,"#ef4444")}}},h=f=>{if(f.key==="Enter"){u();return}if(f.key==="ArrowUp"){f.preventDefault();const g=r();if(!g.length)return;const m=Math.min(i()+1,g.length-1);l(m),a.value=g[m]}if(f.key==="ArrowDown"){if(f.preventDefault(),i()<=0){l(-1),a.value="";return}const g=i()-1;l(g),a.value=r()[g]}};return jt(()=>a.focus()),(()=>{var f=cr(),g=f.firstChild,m=g.nextSibling,p=m.firstChild,v=p.nextSibling,y=c;typeof y=="function"?ve(y,g):c=g,b(g,$(le,{get each(){return n()},children:w=>(()=>{var C=ur();return b(C,()=>w.text),D(L=>we(C,"color",w.color)),C})()})),v.$$keydown=h;var x=a;return typeof x=="function"?ve(x,v):a=v,V(v,"spellcheck",!1),D(()=>V(v,"placeholder",t("commandPlaceholder"))),f})()}z(["keydown"]);var dr=R(\'<div><div class="flex gap-2 items-center"style=margin-bottom:0.5rem><span style=font-size:0.8125rem;font-weight:600></span><input class="input input-mono flex-1"style=font-size:0.8125rem><button type=button class="btn btn-ghost btn-sm"></button></div><div class=card style=max-height:240px;overflow-y:auto;font-size:0.8125rem>\'),hr=R("<div class=muted style=padding:1rem;text-align:center>"),gr=R("<div class=muted style=padding:0.75rem>"),mr=R(\'<span class="mono muted"style=font-size:0.75rem>\'),pr=R(\'<div class="flex gap-2 items-center"><span></span><span class=flex-1>\');function br(e){return e<1024?e+" B":e<1024*1024?(e/1024).toFixed(1)+" K":(e/(1024*1024)).toFixed(1)+" M"}function yr(e){const{t}=W(),[n,s]=I(0),[r]=xe(()=>({cwd:e.cwd(),v:n()}),async({cwd:i})=>{const a=(await We(e.mcpUrl,"file_list",{path:i}))?.entries??[];return a.sort((c,d)=>c.type==="directory"&&d.type!=="directory"?-1:c.type!=="directory"&&d.type==="directory"?1:c.name.localeCompare(d.name)),a}),o=i=>{const l=e.cwd().replace(/\\/+$/,"");e.setCwd(i===".."?l.replace(/\\/[^/]+$/,"")||"/":l+"/"+i)};return(()=>{var i=dr(),l=i.firstChild,a=l.firstChild,c=a.nextSibling,d=c.nextSibling,u=l.nextSibling;return b(a,()=>t("files")),c.$$keydown=h=>{h.key==="Enter"&&s(f=>f+1)},c.$$input=h=>e.setCwd(h.currentTarget.value),d.$$click=()=>s(h=>h+1),b(d,()=>t("refresh")),b(u,$(F,{get when(){return!r.loading},get fallback(){return(()=>{var h=hr();return b(h,()=>t("loadingEllipsis")),h})()},get children(){return $(F,{get when(){return(r()??[]).length>0},get fallback(){return(()=>{var h=gr();return b(h,()=>t("emptyDirectory")),h})()},get children(){return $(le,{get each(){return r()},children:h=>(()=>{var f=pr(),g=f.firstChild,m=g.nextSibling;return f.$$click=()=>{h.type==="directory"&&o(h.name)},b(g,()=>h.type==="directory"?"\u{1F4C1}":"\u{1F4C4}"),b(m,()=>h.name),b(f,$(F,{get when(){return h.type==="file"},get children(){var p=mr();return b(p,()=>br(h.size)),p}}),null),D(p=>{var v=`padding:0.375rem 0.75rem; border-bottom:1px solid #0f172a;${h.type==="directory"?"cursor:pointer":""}`,y=h.type==="directory"?"#60a5fa":"#e2e8f0";return p.e=pt(f,v,p.e),y!==p.t&&we(m,"color",p.t=y),p},{e:void 0,t:void 0}),f})()})}})}})),D(()=>c.value=e.cwd()),i})()}z(["input","keydown","click"]);var wr=R(\'<div><div class="flex gap-2 items-center"style=margin-bottom:0.5rem><span style=font-size:0.8125rem;font-weight:600></span><div class=flex-1></div><button type=button class="btn btn-ghost btn-sm"></button></div><div class=card style=max-height:180px;overflow-y:auto;font-size:0.8125rem>\'),vr=R("<div class=muted style=padding:1rem;text-align:center>"),$r=R("<div class=muted style=padding:0.75rem>"),xr=R(\'<div class="flex gap-2 items-center"style="padding:0.375rem 0.75rem;border-bottom:1px solid #0f172a"><span class="mono muted"style=min-width:3rem></span><span class="mono flex-1"style=overflow:hidden;text-overflow:ellipsis;white-space:nowrap></span><span class=muted style=font-size:0.75rem>% / <!>%\');function Sr(e){const{t}=W(),[n,s]=I(0),[r]=xe(()=>n(),async()=>(await We(e.mcpUrl,"process_list"))?.processes??[]);return(()=>{var o=wr(),i=o.firstChild,l=i.firstChild,a=l.nextSibling,c=a.nextSibling,d=i.nextSibling;return b(l,()=>t("processes")),c.$$click=()=>s(u=>u+1),b(c,()=>t("refresh")),b(d,$(F,{get when(){return!r.loading},get fallback(){return(()=>{var u=vr();return b(u,()=>t("loadingEllipsis")),u})()},get children(){return $(F,{get when(){return(r()??[]).length>0},get fallback(){return(()=>{var u=$r();return b(u,()=>t("noProcesses")),u})()},get children(){return $(le,{get each(){return r()},children:u=>(()=>{var h=xr(),f=h.firstChild,g=f.nextSibling,m=g.nextSibling,p=m.firstChild,v=p.nextSibling;return v.nextSibling,b(f,()=>u.pid),b(g,()=>u.command),b(m,()=>u.cpu,p),b(m,()=>u.mem,v),h})()})}})}})),o})()}z(["click"]);var Cr=R(\'<div class=container><div class="flex gap-2 items-center"style=margin-bottom:0.75rem><div style=width:1px;height:1.5rem;background:#334155></div><span class="mono muted"style=font-size:0.8125rem> </span><div class=flex-1></div><span></span><button type=button class="btn btn-danger btn-sm"></button></div><div style=margin-top:0.75rem></div><div style=margin-top:0.75rem>\');function _r(){const{t:e}=W(),t=Cn(),n=()=>t.id,s=()=>`/gui/api/sandbox-session/${encodeURIComponent(n())}/mcp`,[r,o]=I("/home/sandbox/workspace"),[i,l]=I(0),[a]=xe(()=>i(),()=>re.get(n()).catch(()=>null)),c=setInterval(()=>l(f=>f+1),1e4);ie(()=>clearInterval(c));const d=()=>{const f=a()?.status;return f==="active"?"badge badge-active":f==="starting"?"badge badge-starting":"badge badge-stopped"},u=()=>{const f=a()?.status;return e(f==="active"||f==="starting"||f==="stopped"?f:"loading")},h=async()=>{confirm(e("destroyCurrentConfirm"))&&(await re.destroy(n()),location.href="/gui")};return(()=>{var f=Cr(),g=f.firstChild,m=g.firstChild,p=m.nextSibling,v=p.firstChild,y=p.nextSibling,x=y.nextSibling,w=x.nextSibling,C=g.nextSibling,L=C.nextSibling;return b(g,$(_t,{href:"/",class:"btn btn-ghost btn-sm",get children(){return["\u2190 ",Be(()=>e("backToDashboard"))]}}),m),b(p,()=>e("sandbox"),v),b(p,n,null),b(g,$(Et,{}),x),b(x,u),w.$$click=h,b(w,()=>e("destroy")),b(f,$(fr,{get mcpUrl(){return s()},cwd:r}),C),b(C,$(yr,{get mcpUrl(){return s()},cwd:r,setCwd:o})),b(L,$(Sr,{get mcpUrl(){return s()}})),D(()=>ze(x,d())),f})()}z(["click"]);function Ar(){return $(Fn,{base:"/gui",get children(){return[$(tt,{path:"/",component:lr}),$(tt,{path:"/sandbox/:id",component:_r})]}})}nn(()=>$(Ar,{}),document.getElementById("app"));</script>\n    <style rel="stylesheet" crossorigin>*{box-sizing:border-box;margin:0}body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0}a{color:inherit}.container{max-width:960px;margin:0 auto;padding:1.5rem}.flex{display:flex}.gap-1{gap:.25rem}.gap-2{gap:.5rem}.gap-3{gap:.75rem}.items-center{align-items:center}.justify-between{justify-content:space-between}.flex-1{flex:1}.btn{display:inline-flex;align-items:center;justify-content:center;gap:.375rem;padding:.5rem 1rem;border:none;border-radius:.375rem;font-size:.8125rem;font-weight:500;cursor:pointer;transition:background .15s,opacity .15s;text-decoration:none}.btn:disabled{opacity:.5;cursor:not-allowed}.btn-primary{background:#2563eb;color:#fff}.btn-primary:hover:not(:disabled){background:#1d4ed8}.btn-ghost{background:transparent;color:#94a3b8}.btn-ghost:hover:not(:disabled){background:#1e293b;color:#f1f5f9}.btn-danger{background:#dc2626;color:#fff}.btn-danger:hover:not(:disabled){background:#b91c1c}.btn-sm{padding:.25rem .5rem;font-size:.75rem}.badge{display:inline-block;font-size:.625rem;font-weight:600;padding:.125rem .5rem;border-radius:9999px;text-transform:uppercase}.badge-active{background:#064e3b;color:#6ee7b7}.badge-starting{background:#78350f;color:#fcd34d}.badge-stopped{background:#7f1d1d;color:#fca5a5}.tab-btn{padding:.5rem 1rem;border:none;border-radius:.375rem .375rem 0 0;font-size:.8125rem;font-weight:500;cursor:pointer;transition:background .15s,color .15s;background:#1e293b;color:#94a3b8}.tab-btn:hover{background:#334155;color:#f1f5f9}.tab-btn.active{background:#334155;color:#f1f5f9;border-bottom:2px solid #3b82f6}.session-table{width:100%;border-collapse:collapse}.session-table th,.session-table td{padding:.625rem .75rem;text-align:left;border-bottom:1px solid #0f172a}.session-table th{font-size:.75rem;font-weight:500;color:#64748b;text-transform:uppercase;letter-spacing:.05em}.session-table tr:hover td{background:#ffffff05}.card{background:#1e293b;border-radius:.75rem;overflow:hidden}.input{width:100%;padding:.5rem .75rem;background:#0f172a;border:1px solid #334155;border-radius:.375rem;color:#e2e8f0;font-size:.8125rem;outline:none}.input:focus{border-color:#3b82f6}.input-mono{font-family:SF Mono,SFMono-Regular,Menlo,Consolas,monospace}.modal-overlay{position:fixed;inset:0;background:#0009;display:flex;align-items:center;justify-content:center;z-index:50}.modal-content{background:#1e293b;border:1px solid #334155;border-radius:.75rem;padding:1.5rem;width:100%;max-width:28rem}.modal-content label{display:block;font-size:.75rem;font-weight:500;color:#94a3b8;margin-bottom:.25rem}.modal-content input{width:100%;padding:.5rem .75rem;background:#0f172a;border:1px solid #334155;border-radius:.375rem;color:#e2e8f0;font-size:.8125rem;margin-bottom:.75rem;outline:none}.modal-content input:focus{border-color:#3b82f6}.nav-btn{display:inline-flex;align-items:center;justify-content:center;width:2rem;height:2rem;border:none;border-radius:.375rem;background:#1e293b;color:#94a3b8;font-size:1rem;cursor:pointer}.nav-btn:hover{background:#334155;color:#f1f5f9}.spinner{width:40px;height:40px;border:3px solid #334155;border-top-color:#3b82f6;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.muted{color:#64748b}.mono{font-family:SF Mono,SFMono-Regular,Menlo,Consolas,monospace}</style>\n  </head>\n  <body>\n    <div id="app"></div>\n  </body>\n</html>\n';

// src/gui/assets.ts
var styleCss = `
body {
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  margin: 0;
  background: #0f172a;
  color: #e2e8f0;
}

code {
  color: #bfdbfe;
}
`;

// src/gui/icon.ts
var computerIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="Computer">
  <defs>
    <linearGradient id="computer-bg" x1="13" y1="10" x2="83" y2="86" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0f172a"/>
      <stop offset="1" stop-color="#0f766e"/>
    </linearGradient>
    <linearGradient id="computer-screen" x1="25" y1="25" x2="71" y2="62" gradientUnits="userSpaceOnUse">
      <stop stop-color="#1e293b"/>
      <stop offset="1" stop-color="#020617"/>
    </linearGradient>
  </defs>
  <rect width="96" height="96" rx="22" fill="url(#computer-bg)"/>
  <rect x="18" y="23" width="60" height="42" rx="9" fill="#ccfbf1"/>
  <rect x="24" y="29" width="48" height="30" rx="5" fill="url(#computer-screen)"/>
  <path d="M33 42l7 6-7 6M46 54h15" fill="none" stroke="#5eead4" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M43 65v8M32 76h32" stroke="#99f6e4" stroke-width="6" stroke-linecap="round"/>
</svg>`;

// src/sandbox-host.ts
var MAX_MCP_FORWARD_BODY_BYTES = 1024 * 1024;
var PROXY_TOKENS_STORAGE_KEY = "proxyTokens";
var SESSION_STATE_STORAGE_KEY = "sessionState";
var GUI_ADMIN_COOKIE = "takos_computer_admin_token";
var GUI_PROXY_COOKIE = "takos_computer_proxy_token";
var GUI_AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60;
var PUBLISHED_MCP_DEFAULT_SESSION_ID = "agent-default";
var PUBLISHED_MCP_DEFAULT_SPACE_ID = "published-mcp";
var PUBLISHED_MCP_DEFAULT_USER_ID = "takos-agent";
function resolveContainerMcpAuthToken(env) {
  return env.MCP_AUTH_TOKEN || void 0;
}
function resolvePublishedMcpAuthToken(env) {
  return env.PUBLISHED_MCP_AUTH_TOKEN || void 0;
}
var SandboxSessionContainer = class extends HostContainerRuntime {
  defaultPort = 8080;
  sleepAfter = "10m";
  pingEndpoint = "internal/healthz";
  cachedTokens = null;
  sessionState = null;
  proxyTokensLoaded = false;
  sessionStateLoaded = false;
  applyContainerEnv() {
    const nextEnvVars = { ...this.envVars };
    const mcpAuthToken = resolveContainerMcpAuthToken(this.env);
    if (mcpAuthToken) {
      nextEnvVars.MCP_AUTH_TOKEN = mcpAuthToken;
    } else {
      delete nextEnvVars.MCP_AUTH_TOKEN;
    }
    if (this.env.TAKOS_TOKEN) {
      nextEnvVars.TAKOS_TOKEN = this.env.TAKOS_TOKEN;
    } else {
      delete nextEnvVars.TAKOS_TOKEN;
    }
    if (this.env.TAKOS_API_URL) {
      nextEnvVars.TAKOS_API_URL = this.env.TAKOS_API_URL;
    } else {
      delete nextEnvVars.TAKOS_API_URL;
    }
    const spaceId = this.sessionState?.spaceId;
    if (spaceId) {
      nextEnvVars.TAKOS_SPACE_ID = spaceId;
    } else {
      delete nextEnvVars.TAKOS_SPACE_ID;
    }
    this.envVars = nextEnvVars;
  }
  async ensureProxyTokensLoaded() {
    if (this.proxyTokensLoaded) return;
    const stored = await this.ctx.storage.get(PROXY_TOKENS_STORAGE_KEY);
    this.cachedTokens = stored ? new Map(Object.entries(stored)) : null;
    this.proxyTokensLoaded = true;
  }
  async ensureSessionStateLoaded() {
    if (this.sessionStateLoaded) return;
    this.sessionState = await this.ctx.storage.get(
      SESSION_STATE_STORAGE_KEY
    ) ?? null;
    this.sessionStateLoaded = true;
  }
  async persistProxyTokens(tokenMap) {
    await this.ctx.storage.put(PROXY_TOKENS_STORAGE_KEY, tokenMap);
    this.cachedTokens = new Map(Object.entries(tokenMap));
    this.proxyTokensLoaded = true;
  }
  async persistSessionState(sessionState) {
    await this.ctx.storage.put(SESSION_STATE_STORAGE_KEY, sessionState);
    this.sessionState = sessionState;
    this.sessionStateLoaded = true;
  }
  async clearPersistedSession() {
    this.cachedTokens = null;
    this.sessionState = null;
    this.proxyTokensLoaded = true;
    this.sessionStateLoaded = true;
    await Promise.all([
      this.ctx.storage.delete(PROXY_TOKENS_STORAGE_KEY),
      this.ctx.storage.delete(SESSION_STATE_STORAGE_KEY)
    ]);
  }
  async createSession(payload) {
    const proxyToken = generateProxyToken();
    const tokenInfo = {
      sessionId: payload.sessionId,
      spaceId: payload.spaceId,
      userId: payload.userId
    };
    const tokenMap = {
      [proxyToken]: tokenInfo
    };
    const sessionState = {
      sessionId: payload.sessionId,
      spaceId: payload.spaceId,
      userId: payload.userId,
      status: "starting",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.persistProxyTokens(tokenMap);
    await this.persistSessionState(sessionState);
    this.applyContainerEnv();
    try {
      await this.startAndWaitForPorts([8080]);
      const activeState = {
        ...sessionState,
        status: "active"
      };
      await this.persistSessionState(activeState);
      return { ok: true, proxyToken };
    } catch (error) {
      await Promise.allSettled([this.clearPersistedSession(), this.destroy()]);
      throw error;
    }
  }
  async verifyProxyToken(token) {
    await this.ensureProxyTokensLoaded();
    if (!this.cachedTokens) return null;
    for (const [storedToken, info] of this.cachedTokens) {
      if (constantTimeEqual(token, storedToken)) return info;
    }
    return null;
  }
  async getSessionState() {
    await this.ensureSessionStateLoaded();
    return this.sessionState;
  }
  async destroySession() {
    await this.ensureSessionStateLoaded();
    if (this.sessionState) {
      await this.persistSessionState({
        ...this.sessionState,
        status: "stopped"
      });
    }
    await this.clearPersistedSession();
    await this.destroy();
  }
  /** Forward an HTTP request to the container. */
  async forwardToContainer(path, init) {
    await this.ensureSessionStateLoaded();
    this.applyContainerEnv();
    this.renewActivityTimeout();
    const tcpPort = this.container.getTcpPort(8080);
    const request = new Request(`http://internal${path}`, init);
    return tcpPort.fetch(request.url, request);
  }
};
var app = new Hono2();
function getDOStub(env, sessionId) {
  const id = env.SANDBOX_CONTAINER.idFromName(sessionId);
  return env.SANDBOX_CONTAINER.get(id);
}
function errorResponse(c, err) {
  return c.json(
    { error: err instanceof Error ? err.message : "Unknown error" },
    500
  );
}
function sessionIdParam(c) {
  const sessionId = c.req.param("id");
  if (!sessionId) return c.json({ error: "Missing session id" }, 400);
  return sessionId;
}
function extractBearerToken(c) {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    return token || null;
  }
  const headerToken = c.req.header("X-Proxy-Token")?.trim();
  if (headerToken) return headerToken;
  if (isGuiPath(new URL(c.req.url).pathname)) {
    return getCookie(c.req.header("Cookie"), GUI_ADMIN_COOKIE) ?? getCookie(c.req.header("Cookie"), GUI_PROXY_COOKIE);
  }
  return null;
}
function authError(c, status, message) {
  return c.json({ error: message }, status);
}
function isTrustedTakosRoutedRequest(c) {
  return c.env.TAKOS_TRUST_ROUTED_GUI_API === "1" && c.req.header("X-Takos-Internal-Marker") === "1";
}
function isGuiPath(pathname) {
  return pathname === "/gui" || pathname.startsWith("/gui/");
}
function getCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== name || rawValue.length === 0) continue;
    const value = rawValue.join("=");
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}
function buildAuthCookie(c, name, value) {
  const secure = new URL(c.req.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/gui; Max-Age=${GUI_AUTH_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Strict${secure}`;
}
function redirectWithoutGuiAuthQuery(c, cookieName, token) {
  const url = new URL(c.req.url);
  url.searchParams.delete("authToken");
  url.searchParams.delete("hostToken");
  url.searchParams.delete("proxyToken");
  const location = `${url.pathname}${url.search}`;
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      "Location": location,
      "Set-Cookie": buildAuthCookie(c, cookieName, token)
    }
  });
}
function validateHostAdminToken(c, token) {
  const expected = c.env.SANDBOX_HOST_AUTH_TOKEN;
  if (!expected) {
    return authError(c, 503, "Sandbox host auth token is not configured");
  }
  if (!constantTimeEqual(token, expected)) {
    return authError(c, 401, "Unauthorized");
  }
  return null;
}
function guiSessionIdFromPath(pathname) {
  for (const prefix of ["/gui/sandbox/", "/gui/session/", "/gui/sessions/"]) {
    if (!pathname.startsWith(prefix)) continue;
    const raw2 = pathname.slice(prefix.length).split("/")[0];
    if (!raw2) return null;
    try {
      return decodeURIComponent(raw2);
    } catch {
      return raw2;
    }
  }
  return null;
}
async function validateSessionProxyToken(c, sessionId, token) {
  const stub = getDOStub(c.env, sessionId);
  const tokenInfo = await stub.verifyProxyToken(token);
  if (!tokenInfo || tokenInfo.sessionId !== sessionId) {
    return authError(c, 401, "Unauthorized");
  }
  return null;
}
async function authorizeGuiApp(c) {
  if (isTrustedTakosRoutedRequest(c)) return null;
  const url = new URL(c.req.url);
  const adminQueryToken = url.searchParams.get("authToken")?.trim() || url.searchParams.get("hostToken")?.trim();
  if (adminQueryToken) {
    const auth = validateHostAdminToken(c, adminQueryToken);
    if (auth) return auth;
    return redirectWithoutGuiAuthQuery(c, GUI_ADMIN_COOKIE, adminQueryToken);
  }
  const sessionId = guiSessionIdFromPath(url.pathname);
  const adminCookie = getCookie(c.req.header("Cookie"), GUI_ADMIN_COOKIE);
  if (adminCookie) {
    const auth = validateHostAdminToken(c, adminCookie);
    if (!auth) return null;
  }
  const proxyCookie = getCookie(c.req.header("Cookie"), GUI_PROXY_COOKIE);
  if (proxyCookie && sessionId) {
    const auth = await validateSessionProxyToken(c, sessionId, proxyCookie);
    if (!auth) return null;
  }
  const headerToken = extractBearerToken(c);
  if (headerToken) {
    const adminAuth = validateHostAdminToken(c, headerToken);
    if (!adminAuth) return null;
    if (sessionId) {
      const proxyAuth = await validateSessionProxyToken(
        c,
        sessionId,
        headerToken
      );
      if (!proxyAuth) return null;
    }
  }
  return authError(c, 401, "Unauthorized");
}
async function readRequestTextWithLimit(request, maxBytes) {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength) {
    const parsed = Number(contentLength);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return {
        ok: false,
        response: Response.json({ error: "Invalid Content-Length" }, {
          status: 400
        })
      };
    }
    if (parsed > maxBytes) {
      return {
        ok: false,
        response: Response.json({ error: "MCP request body too large" }, {
          status: 413
        })
      };
    }
  }
  const reader = request.body?.getReader();
  if (!reader) return { ok: true, body: "" };
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return {
        ok: false,
        response: Response.json({ error: "MCP request body too large" }, {
          status: 413
        })
      };
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      ok: true,
      body: new TextDecoder("utf-8", { fatal: true }).decode(body)
    };
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Invalid UTF-8 body" }, { status: 400 })
    };
  }
}
function requireHostAdmin(c) {
  if (isTrustedTakosRoutedRequest(c)) return null;
  const expected = c.env.SANDBOX_HOST_AUTH_TOKEN;
  if (!expected) {
    return authError(c, 503, "Sandbox host auth token is not configured");
  }
  const token = extractBearerToken(c);
  if (!token || !constantTimeEqual(token, expected)) {
    return authError(c, 401, "Unauthorized");
  }
  return null;
}
function requirePublishedMcpAuth(c) {
  const expected = resolvePublishedMcpAuthToken(c.env);
  if (!expected) {
    return authError(c, 503, "Published MCP auth token is not configured");
  }
  const token = extractBearerToken(c);
  if (!token || !constantTimeEqual(token, expected)) {
    return authError(c, 401, "Unauthorized");
  }
  return null;
}
async function authorizeSessionAccess(c, sessionId, stub) {
  if (isTrustedTakosRoutedRequest(c)) return null;
  const token = extractBearerToken(c);
  if (!token) return authError(c, 401, "Unauthorized");
  const adminToken = c.env.SANDBOX_HOST_AUTH_TOKEN;
  if (adminToken && constantTimeEqual(token, adminToken)) return null;
  const tokenInfo = await stub.verifyProxyToken(token);
  if (!tokenInfo || tokenInfo.sessionId !== sessionId) {
    return authError(c, 401, "Unauthorized");
  }
  return null;
}
function collectMissingRuntimeBindings(env) {
  const missing = [];
  if (!env.SANDBOX_CONTAINER) missing.push("SANDBOX_CONTAINER");
  if (!env.SANDBOX_HOST_AUTH_TOKEN) missing.push("SANDBOX_HOST_AUTH_TOKEN");
  if (!resolveContainerMcpAuthToken(env)) {
    missing.push("MCP_AUTH_TOKEN");
  }
  if (!resolvePublishedMcpAuthToken(env)) {
    missing.push("PUBLISHED_MCP_AUTH_TOKEN");
  }
  if (!env.SESSION_INDEX) missing.push("SESSION_INDEX");
  return missing;
}
app.get("/healthz", (c) => {
  const missing = collectMissingRuntimeBindings(c.env);
  return c.json({
    status: "ok",
    service: "takos-sandbox-host",
    ready: missing.length === 0,
    missingBindings: missing
  });
});
app.get("/health", (c) => {
  const missing = collectMissingRuntimeBindings(c.env);
  return c.json({
    status: missing.length === 0 ? "ok" : "misconfigured",
    service: "takos-sandbox-host",
    missingBindings: missing
  }, missing.length === 0 ? 200 : 503);
});
app.get("/readyz", (c) => {
  const missing = collectMissingRuntimeBindings(c.env);
  return c.json({
    status: missing.length === 0 ? "ok" : "misconfigured",
    service: "takos-sandbox-host",
    missingBindings: missing
  }, missing.length === 0 ? 200 : 503);
});
async function serveGuiApp(c) {
  const auth = await authorizeGuiApp(c);
  if (auth) return auth;
  return new Response(appHtml, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
function serveGuiStyle() {
  return new Response(styleCss, {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=300"
    }
  });
}
function serveComputerIcon() {
  return new Response(computerIconSvg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
app.get("/icons/computer.svg", serveComputerIcon);
app.get("/gui/icons/computer.svg", serveComputerIcon);
app.get("/gui", serveGuiApp);
app.get("/gui/", serveGuiApp);
async function listSessions(c) {
  const auth = requireHostAdmin(c);
  if (auth) return auth;
  const kv = c.env.SESSION_INDEX;
  if (!kv) return c.json({ sessions: [] });
  const list = await kv.list({ prefix: "session:" });
  const sessions = [];
  for (const key of list.keys) {
    const val = await kv.get(key.name, { type: "json" });
    if (val) sessions.push(val);
  }
  return c.json({ sessions });
}
app.get("/gui/api/sessions", listSessions);
app.get("/gui/api/sandbox-sessions", listSessions);
async function createSession(c) {
  const auth = requireHostAdmin(c);
  if (auth) return auth;
  const payload = await c.req.json();
  if (!payload.sessionId || !payload.spaceId || !payload.userId) {
    return c.json({
      error: "Missing required fields: sessionId, spaceId, userId"
    }, 400);
  }
  try {
    const stub = getDOStub(c.env, payload.sessionId);
    const result = await stub.createSession(payload);
    const state = await stub.getSessionState();
    const kv = c.env.SESSION_INDEX;
    if (kv && state) {
      await kv.put(`session:${payload.sessionId}`, JSON.stringify(state));
    }
    return c.json(result, 201);
  } catch (err) {
    return errorResponse(c, err);
  }
}
async function getSession(c) {
  const sessionId = sessionIdParam(c);
  if (sessionId instanceof Response) return sessionId;
  const stub = getDOStub(c.env, sessionId);
  const auth = await authorizeSessionAccess(c, sessionId, stub);
  if (auth) return auth;
  const state = await stub.getSessionState();
  if (!state) return c.json({ error: "Session not found" }, 404);
  return c.json(state);
}
async function destroySession(c) {
  const sessionId = sessionIdParam(c);
  if (sessionId instanceof Response) return sessionId;
  const stub = getDOStub(c.env, sessionId);
  try {
    const auth = await authorizeSessionAccess(c, sessionId, stub);
    if (auth) return auth;
    await stub.destroySession();
    const kv = c.env.SESSION_INDEX;
    if (kv) await kv.delete(`session:${sessionId}`);
    return c.json({ ok: true });
  } catch (err) {
    return errorResponse(c, err);
  }
}
app.post("/create", createSession);
app.post("/gui/api/sandbox-create", createSession);
app.get("/session/:id", getSession);
app.get("/gui/api/sandbox-session/:id", getSession);
app.delete("/session/:id", destroySession);
app.delete("/gui/api/sandbox-session/:id", destroySession);
var publishedSessionInputProperties = {
  session_id: {
    type: "string",
    description: "Sandbox session id. Omit to use the default agent session, or pass the id returned by computer_session_create."
  },
  space_id: {
    type: "string",
    description: "Space id used when creating a new sandbox session. Optional for the default agent session."
  },
  user_id: {
    type: "string",
    description: "User id used when creating a new sandbox session. Optional for the default agent session."
  }
};
var publishedMcpTools = [
  {
    name: "computer_session_create",
    description: "Create or reuse a takos-computer sandbox session. Use this before multi-step computer work when you want an explicit session id.",
    inputSchema: {
      type: "object",
      properties: publishedSessionInputProperties
    },
    handle: async (args, c) => {
      const { state } = await ensurePublishedMcpSession(c, args);
      return publishedMcpJson(toPublishedSessionState(state));
    }
  },
  {
    name: "computer_session_status",
    description: "Get the current state for a takos-computer sandbox session.",
    inputSchema: {
      type: "object",
      properties: publishedSessionInputProperties
    },
    handle: async (args, c) => {
      const { sessionId } = resolvePublishedMcpSessionArgs(args);
      const state = await getDOStub(c.env, sessionId).getSessionState();
      return publishedMcpJson(
        state ? toPublishedSessionState(state) : { session_id: sessionId, status: "missing" }
      );
    }
  },
  {
    name: "computer_session_destroy",
    description: "Destroy a takos-computer sandbox session and remove it from the session index.",
    inputSchema: {
      type: "object",
      properties: publishedSessionInputProperties
    },
    handle: async (args, c) => {
      const { sessionId } = resolvePublishedMcpSessionArgs(args);
      await getDOStub(c.env, sessionId).destroySession();
      const kv = c.env.SESSION_INDEX;
      if (kv) await kv.delete(`session:${sessionId}`);
      return publishedMcpJson({ ok: true, session_id: sessionId });
    }
  },
  {
    name: "computer_shell_exec",
    description: "Execute a shell command in a takos-computer sandbox. Automatically creates the sandbox session if needed.",
    inputSchema: {
      type: "object",
      properties: {
        ...publishedSessionInputProperties,
        command: { type: "string", description: "Shell command to execute." },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds. Default: 30000."
        },
        cwd: { type: "string", description: "Working directory." },
        env: {
          type: "object",
          description: "Additional environment variables.",
          additionalProperties: { type: "string" }
        },
        allow_takos_token: {
          type: "boolean",
          description: "Set to true to include TAKOS_TOKEN in the child process environment."
        },
        takos_token: {
          type: "string",
          description: "Optional explicit TAKOS token to pass instead of the container token."
        }
      },
      required: ["command"]
    },
    handle: (args, c) => callSandboxToolThroughPublishedMcp(
      c,
      "shell_exec",
      args
    )
  },
  {
    name: "computer_file_read",
    description: "Read a file from the takos-computer sandbox workspace.",
    inputSchema: {
      type: "object",
      properties: {
        ...publishedSessionInputProperties,
        path: {
          type: "string",
          description: "Workspace-relative path or absolute path inside /home/sandbox/workspace."
        },
        offset: { type: "number", description: "Byte offset to start at." },
        limit: { type: "number", description: "Maximum bytes to read." },
        encoding: {
          type: "string",
          enum: ["utf-8", "base64"],
          description: "Output encoding. Default: utf-8."
        }
      },
      required: ["path"]
    },
    handle: (args, c) => callSandboxToolThroughPublishedMcp(
      c,
      "file_read",
      args
    )
  },
  {
    name: "computer_file_write",
    description: "Write a file in the takos-computer sandbox workspace.",
    inputSchema: {
      type: "object",
      properties: {
        ...publishedSessionInputProperties,
        path: {
          type: "string",
          description: "Workspace-relative path or absolute path inside /home/sandbox/workspace."
        },
        content: { type: "string", description: "Content to write." },
        encoding: {
          type: "string",
          enum: ["utf-8", "base64"],
          description: "Input encoding. Default: utf-8."
        },
        create_dirs: {
          type: "boolean",
          description: "Create parent directories if missing."
        }
      },
      required: ["path", "content"]
    },
    handle: (args, c) => callSandboxToolThroughPublishedMcp(
      c,
      "file_write",
      args
    )
  },
  {
    name: "computer_file_list",
    description: "List files in the takos-computer sandbox workspace.",
    inputSchema: {
      type: "object",
      properties: {
        ...publishedSessionInputProperties,
        path: {
          type: "string",
          description: "Workspace-relative directory path or absolute path inside /home/sandbox/workspace."
        },
        recursive: {
          type: "boolean",
          description: "Recurse into subdirectories."
        },
        glob: {
          type: "string",
          description: 'Filter entries by glob pattern, for example "*.ts".'
        }
      },
      required: ["path"]
    },
    handle: (args, c) => callSandboxToolThroughPublishedMcp(
      c,
      "file_list",
      args
    )
  },
  {
    name: "computer_file_info",
    description: "Get metadata for a file or directory in the takos-computer sandbox workspace.",
    inputSchema: {
      type: "object",
      properties: {
        ...publishedSessionInputProperties,
        path: {
          type: "string",
          description: "Workspace-relative path or absolute path inside /home/sandbox/workspace."
        }
      },
      required: ["path"]
    },
    handle: (args, c) => callSandboxToolThroughPublishedMcp(
      c,
      "file_info",
      args
    )
  },
  {
    name: "computer_process_list",
    description: "List running processes in the takos-computer sandbox.",
    inputSchema: {
      type: "object",
      properties: publishedSessionInputProperties
    },
    handle: (args, c) => callSandboxToolThroughPublishedMcp(
      c,
      "process_list",
      args
    )
  },
  {
    name: "computer_process_kill",
    description: "Kill a process tracked by the takos-computer sandbox shell manager.",
    inputSchema: {
      type: "object",
      properties: {
        ...publishedSessionInputProperties,
        pid: { type: "number", description: "Process ID to kill." },
        signal: {
          type: "string",
          description: "Signal name. Default: SIGTERM."
        }
      },
      required: ["pid"]
    },
    handle: (args, c) => callSandboxToolThroughPublishedMcp(
      c,
      "process_kill",
      args
    )
  }
];
var publishedMcpToolMap = new Map(
  publishedMcpTools.map((tool) => [tool.name, tool])
);
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function jsonRpcResponse(id, result) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}
function jsonRpcError(id, code, message) {
  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message }
  });
}
function publishedMcpJson(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
  };
}
function nonEmptyStringArg(args, names, fallback) {
  for (const name of names) {
    const value = args[name];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return fallback;
}
function resolvePublishedMcpSessionArgs(args) {
  return {
    sessionId: nonEmptyStringArg(
      args,
      ["session_id", "sessionId"],
      PUBLISHED_MCP_DEFAULT_SESSION_ID
    ),
    spaceId: nonEmptyStringArg(
      args,
      ["space_id", "spaceId"],
      PUBLISHED_MCP_DEFAULT_SPACE_ID
    ),
    userId: nonEmptyStringArg(
      args,
      ["user_id", "userId"],
      PUBLISHED_MCP_DEFAULT_USER_ID
    )
  };
}
function stripPublishedMcpSessionArgs(args) {
  const stripped = { ...args };
  for (const key of [
    "session_id",
    "sessionId",
    "space_id",
    "spaceId",
    "user_id",
    "userId"
  ]) {
    delete stripped[key];
  }
  return stripped;
}
function toPublishedSessionState(state) {
  return {
    session_id: state.sessionId,
    space_id: state.spaceId,
    user_id: state.userId,
    status: state.status,
    created_at: state.createdAt
  };
}
async function indexPublishedMcpSession(c, state) {
  const kv = c.env.SESSION_INDEX;
  if (kv) await kv.put(`session:${state.sessionId}`, JSON.stringify(state));
}
async function ensurePublishedMcpSession(c, args) {
  const { sessionId, spaceId, userId } = resolvePublishedMcpSessionArgs(args);
  const stub = getDOStub(c.env, sessionId);
  const existing = await stub.getSessionState();
  if (existing && existing.status !== "stopped") {
    return { stub, state: existing };
  }
  await stub.createSession({ sessionId, spaceId, userId });
  const state = await stub.getSessionState() ?? {
    sessionId,
    spaceId,
    userId,
    status: "active",
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await indexPublishedMcpSession(c, state);
  return { stub, state };
}
async function callSandboxToolThroughPublishedMcp(c, targetToolName, args) {
  const { stub } = await ensurePublishedMcpSession(c, args);
  const mcpAuthToken = resolveContainerMcpAuthToken(c.env);
  if (!mcpAuthToken) {
    throw new Error("Sandbox MCP auth token is not configured");
  }
  const response = await stub.forwardToContainer("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${mcpAuthToken}`
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "published-mcp-call",
      method: "tools/call",
      params: {
        name: targetToolName,
        arguments: stripPublishedMcpSessionArgs(args)
      }
    }),
    signal: c.req.raw.signal
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Sandbox MCP HTTP ${response.status}`);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Sandbox MCP returned non-JSON response");
  }
  if (!isRecord(payload)) {
    throw new Error("Sandbox MCP returned invalid response");
  }
  if (isRecord(payload.error)) {
    const message = typeof payload.error.message === "string" ? payload.error.message : JSON.stringify(payload.error);
    throw new Error(message);
  }
  const result = payload.result;
  if (isRecord(result) && Array.isArray(result.content) && result.content.every(
    (item) => isRecord(item) && item.type === "text" && typeof item.text === "string"
  )) {
    return result;
  }
  return publishedMcpJson(result ?? null);
}
async function handlePublishedMcp(c) {
  if (c.req.raw.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { Allow: "POST, OPTIONS" }
    });
  }
  if (c.req.raw.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "MCP Streamable HTTP requests must use POST; server-to-client GET streams are not supported by this endpoint"
      }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          Allow: "POST, OPTIONS"
        }
      }
    );
  }
  const auth = requirePublishedMcpAuth(c);
  if (auth) return auth;
  let body;
  try {
    body = await c.req.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }
  if (!isRecord(body)) return jsonRpcError(null, -32600, "Invalid Request");
  const request = body;
  const id = request.id;
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return jsonRpcError(id, -32600, "Invalid Request");
  }
  if (request.method === "initialize") {
    return jsonRpcResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: {
        name: "takos-computer",
        version: "2.0.0"
      }
    });
  }
  if (request.method === "notifications/initialized") {
    return new Response(null, { status: 204 });
  }
  if (request.method === "tools/list") {
    return jsonRpcResponse(id, {
      tools: publishedMcpTools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema
      }))
    });
  }
  if (request.method !== "tools/call") {
    return jsonRpcError(id, -32601, "Method not found");
  }
  if (!isRecord(request.params) || typeof request.params.name !== "string") {
    return jsonRpcError(id, -32602, "Invalid params");
  }
  const tool = publishedMcpToolMap.get(request.params.name);
  if (!tool) {
    return jsonRpcError(id, -32602, `Unknown tool: ${request.params.name}`);
  }
  try {
    const args = isRecord(request.params.arguments) ? request.params.arguments : {};
    return jsonRpcResponse(id, await tool.handle(args, c));
  } catch (error) {
    return jsonRpcError(
      id,
      -32e3,
      error instanceof Error ? error.message : String(error)
    );
  }
}
app.all("/mcp", handlePublishedMcp);
async function forwardMcp(c) {
  const sessionId = sessionIdParam(c);
  if (sessionId instanceof Response) return sessionId;
  const stub = getDOStub(c.env, sessionId);
  try {
    const auth = await authorizeSessionAccess(c, sessionId, stub);
    if (auth) return auth;
    const mcpAuthToken = resolveContainerMcpAuthToken(c.env);
    if (!mcpAuthToken) {
      return authError(c, 503, "Sandbox MCP auth token is not configured");
    }
    const headers = new Headers();
    headers.set(
      "Content-Type",
      c.req.header("Content-Type") ?? "application/json"
    );
    headers.set("Authorization", `Bearer ${mcpAuthToken}`);
    const accept = c.req.header("Accept");
    if (accept) headers.set("Accept", accept);
    const init = {
      method: c.req.raw.method,
      headers,
      signal: c.req.raw.signal
    };
    if (c.req.raw.method === "POST") {
      const body = await readRequestTextWithLimit(
        c.req.raw,
        MAX_MCP_FORWARD_BODY_BYTES
      );
      if (!body.ok) return body.response;
      init.body = body.body;
    }
    const response = await stub.forwardToContainer("/mcp", init);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers
    });
  } catch (err) {
    return errorResponse(c, err);
  }
}
app.all("/session/:id/mcp", forwardMcp);
app.all("/gui/api/sandbox-session/:id/mcp", forwardMcp);
app.get("/gui/style.css", serveGuiStyle);
app.get("/gui/*", serveGuiApp);
var sandbox_host_default = {
  fetch: app.fetch
};
export {
  SandboxSessionContainer,
  sandbox_host_default as default
};
