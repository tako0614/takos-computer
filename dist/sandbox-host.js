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
var appHtml = '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>takos computer</title>\n    <script type="module" crossorigin>(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll(\'link[rel="modulepreload"]\'))r(s);new MutationObserver(s=>{for(const o of s)if(o.type==="childList")for(const i of o.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&r(i)}).observe(document,{childList:!0,subtree:!0});function n(s){const o={};return s.integrity&&(o.integrity=s.integrity),s.referrerPolicy&&(o.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?o.credentials="include":s.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function r(s){if(s.ep)return;s.ep=!0;const o=n(s);fetch(s.href,o)}})();const $t=!1,xt=(e,t)=>e===t,fe=Symbol("solid-proxy"),et=typeof Proxy=="function",St=Symbol("solid-track"),de={equals:xt};let tt=lt;const z=1,he=2,nt={owned:null,cleanups:null,context:null,owner:null},Ce={};var w=null;let Ae=null,_t=null,_=null,T=null,B=null,be=0;function Z(e,t){const n=_,r=w,s=e.length===0,o=t===void 0?r:t,i=s?nt:{owned:null,cleanups:null,context:o?o.context:null,owner:o},l=s?e:()=>e(()=>N(()=>te(i)));w=i,_=null;try{return V(l,!0)}finally{_=n,w=r}}function k(e,t){t=t?Object.assign({},de,t):de;const n={value:e,observers:null,observerSlots:null,comparator:t.equals||void 0},r=s=>(typeof s=="function"&&(s=s(n.value)),it(n,s));return[ot.bind(n),r]}function Ct(e,t,n){const r=ve(e,t,!0,z);Y(r)}function D(e,t,n){const r=ve(e,t,!1,z);Y(r)}function At(e,t,n){tt=Tt;const r=ve(e,t,!1,z);r.user=!0,B?B.push(r):Y(r)}function E(e,t,n){n=n?Object.assign({},de,n):de;const r=ve(e,t,!0,0);return r.observers=null,r.observerSlots=null,r.comparator=n.equals||void 0,Y(r),ot.bind(r)}function Pt(e){return e&&typeof e=="object"&&"then"in e}function we(e,t,n){let r,s,o;typeof t=="function"?(r=e,s=t,o={}):(r=!0,s=e,o=t||{});let i=null,l=Ce,a=!1,u="initialValue"in o,f=typeof r=="function"&&E(r);const c=new Set,[d,h]=(o.storage||k)(o.initialValue),[p,g]=k(void 0),[m,b]=k(void 0,{equals:!1}),[y,x]=k(u?"ready":"unresolved");function $(O,P,j,R){return i===O&&(i=null,R!==void 0&&(u=!0),(O===l||P===l)&&o.onHydrated&&queueMicrotask(()=>o.onHydrated(R,{value:P})),l=Ce,I(P,j)),P}function I(O,P){V(()=>{P===void 0&&h(()=>O),x(P!==void 0?"errored":u?"ready":"unresolved"),g(P);for(const j of c.keys())j.decrement();c.clear()},!1)}function U(){const O=Lt,P=d(),j=p();if(j!==void 0&&!i)throw j;return _&&_.user,P}function G(O=!0){if(O!==!1&&a)return;a=!1;const P=f?f():r;if(P==null||P===!1){$(i,N(d));return}let j;const R=l!==Ce?l:N(()=>{try{return s(P,{value:d(),refetching:O})}catch(K){j=K}});if(j!==void 0){$(i,void 0,ce(j),P);return}else if(!Pt(R))return $(i,R,void 0,P),R;return i=R,"v"in R?(R.s===1?$(i,R.v,void 0,P):$(i,void 0,ce(R.v),P),R):(a=!0,queueMicrotask(()=>a=!1),V(()=>{x(u?"refreshing":"pending"),b()},!1),R.then(K=>$(R,K,void 0,P),K=>$(R,void 0,ce(K),P)))}Object.defineProperties(U,{state:{get:()=>y()},error:{get:()=>p()},loading:{get(){const O=y();return O==="pending"||O==="refreshing"}},latest:{get(){if(!u)return U();const O=p();if(O&&!i)throw O;return d()}}});let se=w;return f?Ct(()=>(se=w,G(!1))):G(!1),[U,{refetch:O=>Ne(se,()=>G(O)),mutate:h}]}function Et(e){return V(e,!1)}function N(e){if(_===null)return e();const t=_;_=null;try{return e()}finally{_=t}}function De(e,t,n){const r=Array.isArray(e);let s,o=n&&n.defer;return i=>{let l;if(r){l=Array(e.length);for(let u=0;u<e.length;u++)l[u]=e[u]()}else l=e();if(o)return o=!1,i;const a=N(()=>t(l,s,i));return s=l,a}}function kt(e){At(()=>N(e))}function re(e){return w===null||(w.cleanups===null?w.cleanups=[e]:w.cleanups.push(e)),e}function rt(){return w}function Ne(e,t){const n=w,r=_;w=e,_=null;try{return V(t,!0)}catch(s){Me(s)}finally{w=n,_=r}}function Ot(e){const t=_,n=w;return Promise.resolve().then(()=>{_=t,w=n;let r;return V(e,!1),_=w=null,r?r.done:void 0})}const[dr,hr]=k(!1);function st(e,t){const n=Symbol("context");return{id:n,Provider:Dt(n),defaultValue:e}}function je(e){let t;return w&&w.context&&(t=w.context[e.id])!==void 0?t:e.defaultValue}function Ue(e){const t=E(e),n=E(()=>Oe(t()));return n.toArray=()=>{const r=n();return Array.isArray(r)?r:r!=null?[r]:[]},n}let Lt;function ot(){if(this.sources&&this.state)if(this.state===z)Y(this);else{const e=T;T=null,V(()=>me(this),!1),T=e}if(_){const e=this.observers?this.observers.length:0;_.sources?(_.sources.push(this),_.sourceSlots.push(e)):(_.sources=[this],_.sourceSlots=[e]),this.observers?(this.observers.push(_),this.observerSlots.push(_.sources.length-1)):(this.observers=[_],this.observerSlots=[_.sources.length-1])}return this.value}function it(e,t,n){let r=e.value;return(!e.comparator||!e.comparator(r,t))&&(e.value=t,e.observers&&e.observers.length&&V(()=>{for(let s=0;s<e.observers.length;s+=1){const o=e.observers[s],i=Ae&&Ae.running;i&&Ae.disposed.has(o),(i?!o.tState:!o.state)&&(o.pure?T.push(o):B.push(o),o.observers&&at(o)),i||(o.state=z)}if(T.length>1e6)throw T=[],new Error},!1)),t}function Y(e){if(!e.fn)return;te(e);const t=be;It(e,e.value,t)}function It(e,t,n){let r;const s=w,o=_;_=w=e;try{r=e.fn(t)}catch(i){return e.pure&&(e.state=z,e.owned&&e.owned.forEach(te),e.owned=null),e.updatedAt=n+1,Me(i)}finally{_=o,w=s}(!e.updatedAt||e.updatedAt<=n)&&(e.updatedAt!=null&&"observers"in e?it(e,r):e.value=r,e.updatedAt=n)}function ve(e,t,n,r=z,s){const o={fn:e,state:r,updatedAt:null,owned:null,sources:null,sourceSlots:null,cleanups:null,value:t,owner:w,context:w?w.context:null,pure:n};return w===null||w!==nt&&(w.owned?w.owned.push(o):w.owned=[o]),o}function ge(e){if(e.state===0)return;if(e.state===he)return me(e);if(e.suspense&&N(e.suspense.inFallback))return e.suspense.effects.push(e);const t=[e];for(;(e=e.owner)&&(!e.updatedAt||e.updatedAt<be);)e.state&&t.push(e);for(let n=t.length-1;n>=0;n--)if(e=t[n],e.state===z)Y(e);else if(e.state===he){const r=T;T=null,V(()=>me(e,t[0]),!1),T=r}}function V(e,t){if(T)return e();let n=!1;t||(T=[]),B?n=!0:B=[],be++;try{const r=e();return Rt(n),r}catch(r){n||(B=null),T=null,Me(r)}}function Rt(e){if(T&&(lt(T),T=null),e)return;const t=B;B=null,t.length&&V(()=>tt(t),!1)}function lt(e){for(let t=0;t<e.length;t++)ge(e[t])}function Tt(e){let t,n=0;for(t=0;t<e.length;t++){const r=e[t];r.user?e[n++]=r:ge(r)}for(t=0;t<n;t++)ge(e[t])}function me(e,t){e.state=0;for(let n=0;n<e.sources.length;n+=1){const r=e.sources[n];if(r.sources){const s=r.state;s===z?r!==t&&(!r.updatedAt||r.updatedAt<be)&&ge(r):s===he&&me(r,t)}}}function at(e){for(let t=0;t<e.observers.length;t+=1){const n=e.observers[t];n.state||(n.state=he,n.pure?T.push(n):B.push(n),n.observers&&at(n))}}function te(e){let t;if(e.sources)for(;e.sources.length;){const n=e.sources.pop(),r=e.sourceSlots.pop(),s=n.observers;if(s&&s.length){const o=s.pop(),i=n.observerSlots.pop();r<s.length&&(o.sourceSlots[i]=r,s[r]=o,n.observerSlots[r]=i)}}if(e.tOwned){for(t=e.tOwned.length-1;t>=0;t--)te(e.tOwned[t]);delete e.tOwned}if(e.owned){for(t=e.owned.length-1;t>=0;t--)te(e.owned[t]);e.owned=null}if(e.cleanups){for(t=e.cleanups.length-1;t>=0;t--)e.cleanups[t]();e.cleanups=null}e.state=0}function ce(e){return e instanceof Error?e:new Error(typeof e=="string"?e:"Unknown error",{cause:e})}function Me(e,t=w){throw ce(e)}function Oe(e){if(typeof e=="function"&&!e.length)return Oe(e());if(Array.isArray(e)){const t=[];for(let n=0;n<e.length;n++){const r=Oe(e[n]);Array.isArray(r)?t.push.apply(t,r):t.push(r)}return t}return e}function Dt(e,t){return function(r){let s;return D(()=>s=N(()=>(w.context={...w.context,[e]:r.value},Ue(()=>r.children))),void 0),s}}const Nt=Symbol("fallback");function Ke(e){for(let t=0;t<e.length;t++)e[t]()}function jt(e,t,n={}){let r=[],s=[],o=[],i=0,l=t.length>1?[]:null;return re(()=>Ke(o)),()=>{let a=e()||[],u=a.length,f,c;return a[St],N(()=>{let h,p,g,m,b,y,x,$,I;if(u===0)i!==0&&(Ke(o),o=[],r=[],s=[],i=0,l&&(l=[])),n.fallback&&(r=[Nt],s[0]=Z(U=>(o[0]=U,n.fallback())),i=1);else if(i===0){for(s=new Array(u),c=0;c<u;c++)r[c]=a[c],s[c]=Z(d);i=u}else{for(g=new Array(u),m=new Array(u),l&&(b=new Array(u)),y=0,x=Math.min(i,u);y<x&&r[y]===a[y];y++);for(x=i-1,$=u-1;x>=y&&$>=y&&r[x]===a[$];x--,$--)g[$]=s[x],m[$]=o[x],l&&(b[$]=l[x]);for(h=new Map,p=new Array($+1),c=$;c>=y;c--)I=a[c],f=h.get(I),p[c]=f===void 0?-1:f,h.set(I,c);for(f=y;f<=x;f++)I=r[f],c=h.get(I),c!==void 0&&c!==-1?(g[c]=s[f],m[c]=o[f],l&&(b[c]=l[f]),c=p[c],h.set(I,c)):o[f]();for(c=y;c<u;c++)c in g?(s[c]=g[c],o[c]=m[c],l&&(l[c]=b[c],l[c](c))):s[c]=Z(d);s=s.slice(0,i=u),r=a.slice(0)}return s});function d(h){if(o[c]=h,l){const[p,g]=k(c);return l[c]=g,t(a[c],p)}return t(a[c])}}}function v(e,t){return N(()=>e(t||{}))}function le(){return!0}const Le={get(e,t,n){return t===fe?n:e.get(t)},has(e,t){return t===fe?!0:e.has(t)},set:le,deleteProperty:le,getOwnPropertyDescriptor(e,t){return{configurable:!0,enumerable:!0,get(){return e.get(t)},set:le,deleteProperty:le}},ownKeys(e){return e.keys()}};function Pe(e){return(e=typeof e=="function"?e():e)?e:{}}function Ut(){for(let e=0,t=this.length;e<t;++e){const n=this[e]();if(n!==void 0)return n}}function Ie(...e){let t=!1;for(let i=0;i<e.length;i++){const l=e[i];t=t||!!l&&fe in l,e[i]=typeof l=="function"?(t=!0,E(l)):l}if(et&&t)return new Proxy({get(i){for(let l=e.length-1;l>=0;l--){const a=Pe(e[l])[i];if(a!==void 0)return a}},has(i){for(let l=e.length-1;l>=0;l--)if(i in Pe(e[l]))return!0;return!1},keys(){const i=[];for(let l=0;l<e.length;l++)i.push(...Object.keys(Pe(e[l])));return[...new Set(i)]}},Le);const n={},r=Object.create(null);for(let i=e.length-1;i>=0;i--){const l=e[i];if(!l)continue;const a=Object.getOwnPropertyNames(l);for(let u=a.length-1;u>=0;u--){const f=a[u];if(f==="__proto__"||f==="constructor")continue;const c=Object.getOwnPropertyDescriptor(l,f);if(!r[f])r[f]=c.get?{enumerable:!0,configurable:!0,get:Ut.bind(n[f]=[c.get.bind(l)])}:c.value!==void 0?c:void 0;else{const d=n[f];d&&(c.get?d.push(c.get.bind(l)):c.value!==void 0&&d.push(()=>c.value))}}}const s={},o=Object.keys(r);for(let i=o.length-1;i>=0;i--){const l=o[i],a=r[l];a&&a.get?Object.defineProperty(s,l,a):s[l]=a?a.value:void 0}return s}function Mt(e,...t){const n=t.length;if(et&&fe in e){const s=n>1?t.flat():t[0],o=t.map(i=>new Proxy({get(l){return i.includes(l)?e[l]:void 0},has(l){return i.includes(l)&&l in e},keys(){return i.filter(l=>l in e)}},Le));return o.push(new Proxy({get(i){return s.includes(i)?void 0:e[i]},has(i){return s.includes(i)?!1:i in e},keys(){return Object.keys(e).filter(i=>!s.includes(i))}},Le)),o}const r=[];for(let s=0;s<=n;s++)r[s]={};for(const s of Object.getOwnPropertyNames(e)){let o=n;for(let a=0;a<t.length;a++)if(t[a].includes(s)){o=a;break}const i=Object.getOwnPropertyDescriptor(e,s);!i.get&&!i.set&&i.enumerable&&i.writable&&i.configurable?r[o][s]=i.value:Object.defineProperty(r[o],s,i)}return r}const Ft=e=>`Stale read from <${e}>.`;function $e(e){const t="fallback"in e&&{fallback:()=>e.fallback};return E(jt(()=>e.each,e.children,t||void 0))}function F(e){const t=e.keyed,n=E(()=>e.when,void 0,void 0),r=t?n:E(n,void 0,{equals:(s,o)=>!s==!o});return E(()=>{const s=r();if(s){const o=e.children;return typeof o=="function"&&o.length>0?N(()=>o(t?s:()=>{if(!N(r))throw Ft("Show");return n()})):o}return e.fallback},void 0,void 0)}const Vt=["allowfullscreen","async","alpha","autofocus","autoplay","checked","controls","default","disabled","formnovalidate","hidden","indeterminate","inert","ismap","loop","multiple","muted","nomodule","novalidate","open","playsinline","readonly","required","reversed","seamless","selected","adauctionheaders","browsingtopics","credentialless","defaultchecked","defaultmuted","defaultselected","defer","disablepictureinpicture","disableremoteplayback","preservespitch","shadowrootclonable","shadowrootcustomelementregistry","shadowrootdelegatesfocus","shadowrootserializable","sharedstoragewritable"],Bt=new Set(["className","value","readOnly","noValidate","formNoValidate","isMap","noModule","playsInline","adAuctionHeaders","allowFullscreen","browsingTopics","defaultChecked","defaultMuted","defaultSelected","disablePictureInPicture","disableRemotePlayback","preservesPitch","shadowRootClonable","shadowRootCustomElementRegistry","shadowRootDelegatesFocus","shadowRootSerializable","sharedStorageWritable",...Vt]),zt=new Set(["innerHTML","textContent","innerText","children"]),qt=Object.assign(Object.create(null),{className:"class",htmlFor:"for"}),Kt=Object.assign(Object.create(null),{class:"className",novalidate:{$:"noValidate",FORM:1},formnovalidate:{$:"formNoValidate",BUTTON:1,INPUT:1},ismap:{$:"isMap",IMG:1},nomodule:{$:"noModule",SCRIPT:1},playsinline:{$:"playsInline",VIDEO:1},readonly:{$:"readOnly",INPUT:1,TEXTAREA:1},adauctionheaders:{$:"adAuctionHeaders",IFRAME:1},allowfullscreen:{$:"allowFullscreen",IFRAME:1},browsingtopics:{$:"browsingTopics",IMG:1},defaultchecked:{$:"defaultChecked",INPUT:1},defaultmuted:{$:"defaultMuted",AUDIO:1,VIDEO:1},defaultselected:{$:"defaultSelected",OPTION:1},disablepictureinpicture:{$:"disablePictureInPicture",VIDEO:1},disableremoteplayback:{$:"disableRemotePlayback",AUDIO:1,VIDEO:1},preservespitch:{$:"preservesPitch",AUDIO:1,VIDEO:1},shadowrootclonable:{$:"shadowRootClonable",TEMPLATE:1},shadowrootdelegatesfocus:{$:"shadowRootDelegatesFocus",TEMPLATE:1},shadowrootserializable:{$:"shadowRootSerializable",TEMPLATE:1},sharedstoragewritable:{$:"sharedStorageWritable",IFRAME:1,IMG:1}});function Ht(e,t){const n=Kt[e];return typeof n=="object"?n[t]?n.$:void 0:n}const Wt=new Set(["beforeinput","click","dblclick","contextmenu","focusin","focusout","input","keydown","keyup","mousedown","mousemove","mouseout","mouseover","mouseup","pointerdown","pointermove","pointerout","pointerover","pointerup","touchend","touchmove","touchstart"]),Gt=e=>E(()=>e());function Jt(e,t,n){let r=n.length,s=t.length,o=r,i=0,l=0,a=t[s-1].nextSibling,u=null;for(;i<s||l<o;){if(t[i]===n[l]){i++,l++;continue}for(;t[s-1]===n[o-1];)s--,o--;if(s===i){const f=o<r?l?n[l-1].nextSibling:n[o-l]:a;for(;l<o;)e.insertBefore(n[l++],f)}else if(o===l)for(;i<s;)(!u||!u.has(t[i]))&&t[i].remove(),i++;else if(t[i]===n[o-1]&&n[l]===t[s-1]){const f=t[--s].nextSibling;e.insertBefore(n[l++],t[i++].nextSibling),e.insertBefore(n[--o],f),t[s]=n[o]}else{if(!u){u=new Map;let c=l;for(;c<o;)u.set(n[c],c++)}const f=u.get(t[i]);if(f!=null)if(l<f&&f<o){let c=i,d=1,h;for(;++c<s&&c<o&&!((h=u.get(t[c]))==null||h!==f+d);)d++;if(d>f-l){const p=t[i];for(;l<f;)e.insertBefore(n[l++],p)}else e.replaceChild(n[l++],t[i++])}else i++;else t[i++].remove()}}}const He="_$DX_DELEGATE";function Xt(e,t,n,r={}){let s;return Z(o=>{s=o,t===document?e():S(t,e(),t.firstChild?null:void 0,n)},r.owner),()=>{s(),t.textContent=""}}function L(e,t,n,r){let s;const o=()=>{const l=document.createElement("template");return l.innerHTML=e,l.content.firstChild},i=()=>(s||(s=o())).cloneNode(!0);return i.cloneNode=i,i}function q(e,t=window.document){const n=t[He]||(t[He]=new Set);for(let r=0,s=e.length;r<s;r++){const o=e[r];n.has(o)||(n.add(o),t.addEventListener(o,nn))}}function pe(e,t,n){n==null?e.removeAttribute(t):e.setAttribute(t,n)}function Yt(e,t,n){n?e.setAttribute(t,""):e.removeAttribute(t)}function Fe(e,t){t==null?e.removeAttribute("class"):e.className=t}function ct(e,t,n,r){if(r)Array.isArray(n)?(e[`$$${t}`]=n[0],e[`$$${t}Data`]=n[1]):e[`$$${t}`]=n;else if(Array.isArray(n)){const s=n[0];e.addEventListener(t,n[0]=o=>s.call(e,n[1],o))}else e.addEventListener(t,n,typeof n!="function"&&n)}function Qt(e,t,n={}){const r=Object.keys(t||{}),s=Object.keys(n);let o,i;for(o=0,i=s.length;o<i;o++){const l=s[o];!l||l==="undefined"||t[l]||(We(e,l,!1),delete n[l])}for(o=0,i=r.length;o<i;o++){const l=r[o],a=!!t[l];!l||l==="undefined"||n[l]===a||!a||(We(e,l,!0),n[l]=a)}return n}function ut(e,t,n){if(!t)return n?pe(e,"style"):t;const r=e.style;if(typeof t=="string")return r.cssText=t;typeof n=="string"&&(r.cssText=n=void 0),n||(n={}),t||(t={});let s,o;for(o in n)t[o]==null&&r.removeProperty(o),delete n[o];for(o in t)s=t[o],s!==n[o]&&(r.setProperty(o,s),n[o]=s);return n}function ft(e,t,n){n!=null?e.style.setProperty(t,n):e.style.removeProperty(t)}function Zt(e,t={},n,r){const s={};return D(()=>s.children=ne(e,t.children,s.children)),D(()=>typeof t.ref=="function"&&ye(t.ref,e)),D(()=>en(e,t,n,!0,s,!0)),s}function ye(e,t,n){return N(()=>e(t,n))}function S(e,t,n,r){if(n!==void 0&&!r&&(r=[]),typeof t!="function")return ne(e,t,r,n);D(s=>ne(e,t(),s,n),r)}function en(e,t,n,r,s={},o=!1){t||(t={});for(const i in s)if(!(i in t)){if(i==="children")continue;s[i]=Ge(e,i,null,s[i],n,o,t)}for(const i in t){if(i==="children")continue;const l=t[i];s[i]=Ge(e,i,l,s[i],n,o,t)}}function tn(e){return e.toLowerCase().replace(/-([a-z])/g,(t,n)=>n.toUpperCase())}function We(e,t,n){const r=t.trim().split(/\\s+/);for(let s=0,o=r.length;s<o;s++)e.classList.toggle(r[s],n)}function Ge(e,t,n,r,s,o,i){let l,a,u,f,c;if(t==="style")return ut(e,n,r);if(t==="classList")return Qt(e,n,r);if(n===r)return r;if(t==="ref")o||n(e);else if(t.slice(0,3)==="on:"){const d=t.slice(3);r&&e.removeEventListener(d,r,typeof r!="function"&&r),n&&e.addEventListener(d,n,typeof n!="function"&&n)}else if(t.slice(0,10)==="oncapture:"){const d=t.slice(10);r&&e.removeEventListener(d,r,!0),n&&e.addEventListener(d,n,!0)}else if(t.slice(0,2)==="on"){const d=t.slice(2).toLowerCase(),h=Wt.has(d);if(!h&&r){const p=Array.isArray(r)?r[0]:r;e.removeEventListener(d,p)}(h||n)&&(ct(e,d,n,h),h&&q([d]))}else t.slice(0,5)==="attr:"?pe(e,t.slice(5),n):t.slice(0,5)==="bool:"?Yt(e,t.slice(5),n):(c=t.slice(0,5)==="prop:")||(u=zt.has(t))||(f=Ht(t,e.tagName))||(a=Bt.has(t))||(l=e.nodeName.includes("-")||"is"in i)?(c&&(t=t.slice(5),a=!0),t==="class"||t==="className"?Fe(e,n):l&&!a&&!u?e[tn(t)]=n:e[f||t]=n):pe(e,qt[t]||t,n);return n}function nn(e){let t=e.target;const n=`$$${e.type}`,r=e.target,s=e.currentTarget,o=a=>Object.defineProperty(e,"target",{configurable:!0,value:a}),i=()=>{const a=t[n];if(a&&!t.disabled){const u=t[`${n}Data`];if(u!==void 0?a.call(t,u,e):a.call(t,e),e.cancelBubble)return}return t.host&&typeof t.host!="string"&&!t.host._$host&&t.contains(e.target)&&o(t.host),!0},l=()=>{for(;i()&&(t=t._$host||t.parentNode||t.host););};if(Object.defineProperty(e,"currentTarget",{configurable:!0,get(){return t||document}}),e.composedPath){const a=e.composedPath();o(a[0]);for(let u=0;u<a.length-2&&(t=a[u],!!i());u++){if(t._$host){t=t._$host,l();break}if(t.parentNode===s)break}}else l();o(r)}function ne(e,t,n,r,s){for(;typeof n=="function";)n=n();if(t===n)return n;const o=typeof t,i=r!==void 0;if(e=i&&n[0]&&n[0].parentNode||e,o==="string"||o==="number"){if(o==="number"&&(t=t.toString(),t===n))return n;if(i){let l=n[0];l&&l.nodeType===3?l.data!==t&&(l.data=t):l=document.createTextNode(t),n=X(e,n,r,l)}else n!==""&&typeof n=="string"?n=e.firstChild.data=t:n=e.textContent=t}else if(t==null||o==="boolean")n=X(e,n,r);else{if(o==="function")return D(()=>{let l=t();for(;typeof l=="function";)l=l();n=ne(e,l,n,r)}),()=>n;if(Array.isArray(t)){const l=[],a=n&&Array.isArray(n);if(Re(l,t,n,s))return D(()=>n=ne(e,l,n,r,!0)),()=>n;if(l.length===0){if(n=X(e,n,r),i)return n}else a?n.length===0?Je(e,l,r):Jt(e,n,l):(n&&X(e),Je(e,l));n=l}else if(t.nodeType){if(Array.isArray(n)){if(i)return n=X(e,n,r,t);X(e,n,null,t)}else n==null||n===""||!e.firstChild?e.appendChild(t):e.replaceChild(t,e.firstChild);n=t}}return n}function Re(e,t,n,r){let s=!1;for(let o=0,i=t.length;o<i;o++){let l=t[o],a=n&&n[e.length],u;if(!(l==null||l===!0||l===!1))if((u=typeof l)=="object"&&l.nodeType)e.push(l);else if(Array.isArray(l))s=Re(e,l,a)||s;else if(u==="function")if(r){for(;typeof l=="function";)l=l();s=Re(e,Array.isArray(l)?l:[l],Array.isArray(a)?a:[a])||s}else e.push(l),s=!0;else{const f=String(l);a&&a.nodeType===3&&a.data===f?e.push(a):e.push(document.createTextNode(f))}}return s}function Je(e,t,n=null){for(let r=0,s=t.length;r<s;r++)e.insertBefore(t[r],n)}function X(e,t,n,r){if(n===void 0)return e.textContent="";const s=r||document.createTextNode("");if(t.length){let o=!1;for(let i=t.length-1;i>=0;i--){const l=t[i];if(s!==l){const a=l.parentNode===e;!o&&!i?a?e.replaceChild(s,l):e.insertBefore(s,n):a&&l.remove()}else o=!0}}else e.insertBefore(s,n);return[s]}const rn=!1;function dt(){let e=new Set;function t(s){return e.add(s),()=>e.delete(s)}let n=!1;function r(s,o){if(n)return!(n=!1);const i={to:s,options:o,defaultPrevented:!1,preventDefault:()=>i.defaultPrevented=!0};for(const l of e)l.listener({...i,from:l.location,retry:a=>{a&&(n=!0),l.navigate(s,{...o,resolve:!1})}});return!i.defaultPrevented}return{subscribe:t,confirm:r}}let Te;function Ve(){(!window.history.state||window.history.state._depth==null)&&window.history.replaceState({...window.history.state,_depth:window.history.length-1},""),Te=window.history.state._depth}Ve();function sn(e){return{...e,_depth:window.history.state&&window.history.state._depth}}function on(e,t){let n=!1;return()=>{const r=Te;Ve();const s=r==null?null:Te-r;if(n){n=!1;return}s&&t(s)?(n=!0,window.history.go(-s)):e()}}const ln=/^(?:[a-z0-9]+:)?\\/\\//i,an=/^\\/+|(\\/)\\/+$/g,ht="http://sr";function W(e,t=!1){const n=e.replace(an,"$1");return n?t||/^[?#]/.test(n)?n:"/"+n:""}function ue(e,t,n){if(ln.test(t))return;const r=W(e),s=n&&W(n);let o="";return!s||t.startsWith("/")?o=r:s.toLowerCase().indexOf(r.toLowerCase())!==0?o=r+s:o=s,(o||"/")+W(t,!o)}function cn(e,t){if(e==null)throw new Error(t);return e}function un(e,t){return W(e).replace(/\\/*(\\*.*)?$/g,"")+W(t)}function gt(e){const t={};return e.searchParams.forEach((n,r)=>{r in t?Array.isArray(t[r])?t[r].push(n):t[r]=[t[r],n]:t[r]=n}),t}function fn(e,t,n){const[r,s]=e.split("/*",2),o=r.split("/").filter(Boolean),i=o.length;return l=>{const a=l.split("/").filter(Boolean),u=a.length-i;if(u<0||u>0&&s===void 0&&!t)return null;const f={path:i?"":"/",params:{}},c=d=>n===void 0?void 0:n[d];for(let d=0;d<i;d++){const h=o[d],p=h[0]===":",g=p?a[d]:a[d].toLowerCase(),m=p?h.slice(1):h.toLowerCase();if(p&&Ee(g,c(m)))f.params[m]=g;else if(p||!Ee(g,m))return null;f.path+=`/${g}`}if(s){const d=u?a.slice(-u).join("/"):"";if(Ee(d,c(s)))f.params[s]=d;else return null}return f}}function Ee(e,t){const n=r=>r===e;return t===void 0?!0:typeof t=="string"?n(t):typeof t=="function"?t(e):Array.isArray(t)?t.some(n):t instanceof RegExp?t.test(e):!1}function dn(e){const[t,n]=e.pattern.split("/*",2),r=t.split("/").filter(Boolean);return r.reduce((s,o)=>s+(o.startsWith(":")?2:3),r.length-(n===void 0?0:1))}function mt(e){const t=new Map,n=rt();return new Proxy({},{get(r,s){return t.has(s)||Ne(n,()=>t.set(s,E(()=>e()[s]))),t.get(s)()},getOwnPropertyDescriptor(){return{enumerable:!0,configurable:!0}},ownKeys(){return Reflect.ownKeys(e())}})}function pt(e){let t=/(\\/?\\:[^\\/]+)\\?/.exec(e);if(!t)return[e];let n=e.slice(0,t.index),r=e.slice(t.index+t[0].length);const s=[n,n+=t[1]];for(;t=/^(\\/\\:[^\\/]+)\\?/.exec(r);)s.push(n+=t[1]),r=r.slice(t[0].length);return pt(r).reduce((o,i)=>[...o,...s.map(l=>l+i)],[])}const hn=100,yt=st(),Be=st(),xe=()=>cn(je(yt),"<A> and \'use\' router primitives can be only used inside a Route."),gn=()=>je(Be)||xe().base,mn=e=>{const t=gn();return E(()=>t.resolvePath(e()))},pn=e=>{const t=xe();return E(()=>{const n=e();return n!==void 0?t.renderPath(n):n})},yn=()=>xe().location,bn=()=>xe().params;function wn(e,t=""){const{component:n,preload:r,load:s,children:o,info:i}=e,l=!o||Array.isArray(o)&&!o.length,a={key:e,component:n,preload:r||s,info:i};return bt(e.path).reduce((u,f)=>{for(const c of pt(f)){const d=un(t,c);let h=l?d:d.split("/*",1)[0];h=h.split("/").map(p=>p.startsWith(":")||p.startsWith("*")?p:encodeURIComponent(p)).join("/"),u.push({...a,originalPath:f,pattern:h,matcher:fn(h,!l,e.matchFilters)})}return u},[])}function vn(e,t=0){return{routes:e,score:dn(e[e.length-1])*1e4-t,matcher(n){const r=[];for(let s=e.length-1;s>=0;s--){const o=e[s],i=o.matcher(n);if(!i)return null;r.unshift({...i,route:o})}return r}}}function bt(e){return Array.isArray(e)?e:[e]}function wt(e,t="",n=[],r=[]){const s=bt(e);for(let o=0,i=s.length;o<i;o++){const l=s[o];if(l&&typeof l=="object"){l.hasOwnProperty("path")||(l.path="");const a=wn(l,t);for(const u of a){n.push(u);const f=Array.isArray(l.children)&&l.children.length===0;if(l.children&&!f)wt(l.children,u.pattern,n,r);else{const c=vn([...n],r.length);r.push(c)}n.pop()}}}return n.length?r:r.sort((o,i)=>i.score-o.score)}function ke(e,t){for(let n=0,r=e.length;n<r;n++){const s=e[n].matcher(t);if(s)return s}return[]}function $n(e,t,n){const r=new URL(ht),s=E(f=>{const c=e();try{return new URL(c,r)}catch{return console.error(`Invalid path ${c}`),f}},r,{equals:(f,c)=>f.href===c.href}),o=E(()=>s().pathname),i=E(()=>s().search,!0),l=E(()=>s().hash),a=()=>"",u=De(i,()=>gt(s()));return{get pathname(){return o()},get search(){return i()},get hash(){return l()},get state(){return t()},get key(){return a()},query:n?n(u):mt(u)}}let H;function xn(){return H}function Sn(e,t,n,r={}){const{signal:[s,o],utils:i={}}=e,l=i.parsePath||(C=>C),a=i.renderPath||(C=>C),u=i.beforeLeave||dt(),f=ue("",r.base||"");if(f===void 0)throw new Error(`${f} is not a valid base path`);f&&!s().value&&o({value:f,replace:!0,scroll:!1});const[c,d]=k(!1);let h;const p=(C,A)=>{A.value===g()&&A.state===b()||(h===void 0&&d(!0),H=C,h=A,Ot(()=>{h===A&&(m(h.value),y(h.state),I[1]([]))}).finally(()=>{h===A&&Et(()=>{H=void 0,C==="navigate"&&R(h),d(!1),h=void 0})}))},[g,m]=k(s().value),[b,y]=k(s().state),x=$n(g,b,i.queryWrapper),$=[],I=k([]),U=E(()=>typeof r.transformUrl=="function"?ke(t(),r.transformUrl(x.pathname)):ke(t(),x.pathname)),G=()=>{const C=U(),A={};for(let M=0;M<C.length;M++)Object.assign(A,C[M].params);return A},se=i.paramsWrapper?i.paramsWrapper(G,t):mt(G),O={pattern:f,path:()=>f,outlet:()=>null,resolvePath(C){return ue(f,C)}};return D(De(s,C=>p("native",C),{defer:!0})),{base:O,location:x,params:se,isRouting:c,renderPath:a,parsePath:l,navigatorFactory:j,matches:U,beforeLeave:u,preloadRoute:K,singleFlight:r.singleFlight===void 0?!0:r.singleFlight,submissions:I};function P(C,A,M){N(()=>{if(typeof A=="number"){A&&(i.go?i.go(A):console.warn("Router integration does not support relative routing"));return}const oe=!A||A[0]==="?",{replace:Se,resolve:J,scroll:_e,state:Q}={replace:!1,resolve:!oe,scroll:!0,...M},ie=J?C.resolvePath(A):ue(oe&&x.pathname||"",A);if(ie===void 0)throw new Error(`Path \'${A}\' is not a routable path`);if($.length>=hn)throw new Error("Too many redirects");const qe=g();(ie!==qe||Q!==b())&&(rn||u.confirm(ie,M)&&($.push({value:qe,replace:Se,scroll:_e,state:b()}),p("navigate",{value:ie,state:Q})))})}function j(C){return C=C||je(Be)||O,(A,M)=>P(C,A,M)}function R(C){const A=$[0];A&&(o({...C,replace:A.replace,scroll:A.scroll}),$.length=0)}function K(C,A){const M=ke(t(),C.pathname),oe=H;H="preload";for(let Se in M){const{route:J,params:_e}=M[Se];J.component&&J.component.preload&&J.component.preload();const{preload:Q}=J;A&&Q&&Ne(n(),()=>Q({params:_e,location:{pathname:C.pathname,search:C.search,hash:C.hash,query:gt(C),state:null,key:""},intent:"preload"}))}H=oe}}function _n(e,t,n,r){const{base:s,location:o,params:i}=e,{pattern:l,component:a,preload:u}=r().route,f=E(()=>r().path);a&&a.preload&&a.preload();const c=u?u({params:i,location:o,intent:H||"initial"}):void 0;return{parent:t,pattern:l,path:f,outlet:()=>a?v(a,{params:i,location:o,data:c,get children(){return n()}}):n(),resolvePath(h){return ue(s.path(),h,f())}}}const Cn=e=>t=>{const{base:n}=t,r=Ue(()=>t.children),s=E(()=>wt(r(),t.base||""));let o;const i=Sn(e,s,()=>o,{base:n,singleFlight:t.singleFlight,transformUrl:t.transformUrl});return e.create&&e.create(i),v(yt.Provider,{value:i,get children(){return v(An,{routerState:i,get root(){return t.root},get preload(){return t.rootPreload||t.rootLoad},get children(){return[Gt(()=>(o=rt())&&null),v(Pn,{routerState:i,get branches(){return s()}})]}})}})};function An(e){const t=e.routerState.location,n=e.routerState.params,r=E(()=>e.preload&&N(()=>{e.preload({params:n,location:t,intent:xn()||"initial"})}));return v(F,{get when(){return e.root},keyed:!0,get fallback(){return e.children},children:s=>v(s,{params:n,location:t,get data(){return r()},get children(){return e.children}})})}function Pn(e){const t=[];let n;const r=E(De(e.routerState.matches,(s,o,i)=>{let l=o&&s.length===o.length;const a=[];for(let u=0,f=s.length;u<f;u++){const c=o&&o[u],d=s[u];i&&c&&d.route.key===c.route.key?a[u]=i[u]:(l=!1,t[u]&&t[u](),Z(h=>{t[u]=h,a[u]=_n(e.routerState,a[u-1]||e.routerState.base,Xe(()=>r()[u+1]),()=>e.routerState.matches()[u])}))}return t.splice(s.length).forEach(u=>u()),i&&l?i:(n=a[0],a)}));return Xe(()=>r()&&n)()}const Xe=e=>()=>v(F,{get when(){return e()},keyed:!0,children:t=>v(Be.Provider,{value:t,get children(){return t.outlet()}})}),Ye=e=>{const t=Ue(()=>e.children);return Ie(e,{get children(){return t()}})};function En([e,t],n,r){return[e,r?s=>t(r(s)):t]}function kn(e){let t=!1;const n=s=>typeof s=="string"?{value:s}:s,r=En(k(n(e.get()),{equals:(s,o)=>s.value===o.value&&s.state===o.state}),void 0,s=>(!t&&e.set(s),s));return e.init&&re(e.init((s=e.get())=>{t=!0,r[1](n(s)),t=!1})),Cn({signal:r,create:e.create,utils:e.utils})}function On(e,t,n){return e.addEventListener(t,n),()=>e.removeEventListener(t,n)}function Ln(e,t){const n=e&&document.getElementById(e);n?n.scrollIntoView():t&&window.scrollTo(0,0)}const In=new Map;function Rn(e=!0,t=!1,n="/_server",r){return s=>{const o=s.base.path(),i=s.navigatorFactory(s.base);let l,a;function u(g){return g.namespaceURI==="http://www.w3.org/2000/svg"}function f(g){if(g.defaultPrevented||g.button!==0||g.metaKey||g.altKey||g.ctrlKey||g.shiftKey)return;const m=g.composedPath().find(U=>U instanceof Node&&U.nodeName.toUpperCase()==="A");if(!m||t&&!m.hasAttribute("link"))return;const b=u(m),y=b?m.href.baseVal:m.href;if((b?m.target.baseVal:m.target)||!y&&!m.hasAttribute("state"))return;const $=(m.getAttribute("rel")||"").split(/\\s+/);if(m.hasAttribute("download")||$&&$.includes("external"))return;const I=b?new URL(y,document.baseURI):new URL(y);if(!(I.origin!==window.location.origin||o&&I.pathname&&!I.pathname.toLowerCase().startsWith(o.toLowerCase())))return[m,I]}function c(g){const m=f(g);if(!m)return;const[b,y]=m,x=s.parsePath(y.pathname+y.search+y.hash),$=b.getAttribute("state");g.preventDefault(),i(x,{resolve:!1,replace:b.hasAttribute("replace"),scroll:!b.hasAttribute("noscroll"),state:$?JSON.parse($):void 0})}function d(g){const m=f(g);if(!m)return;const[b,y]=m;r&&(y.pathname=r(y.pathname)),s.preloadRoute(y,b.getAttribute("preload")!=="false")}function h(g){clearTimeout(l);const m=f(g);if(!m)return a=null;const[b,y]=m;a!==b&&(r&&(y.pathname=r(y.pathname)),l=setTimeout(()=>{s.preloadRoute(y,b.getAttribute("preload")!=="false"),a=b},20))}function p(g){if(g.defaultPrevented)return;let m=g.submitter&&g.submitter.hasAttribute("formaction")?g.submitter.getAttribute("formaction"):g.target.getAttribute("action");if(!m)return;if(!m.startsWith("https://action/")){const y=new URL(m,ht);if(m=s.parsePath(y.pathname+y.search),!m.startsWith(n))return}if(g.target.method.toUpperCase()!=="POST")throw new Error("Only POST forms are supported for Actions");const b=In.get(m);if(b){g.preventDefault();const y=new FormData(g.target,g.submitter);b.call({r:s,f:g.target},g.target.enctype==="multipart/form-data"?y:new URLSearchParams(y))}}q(["click","submit"]),document.addEventListener("click",c),e&&(document.addEventListener("mousemove",h,{passive:!0}),document.addEventListener("focusin",d,{passive:!0}),document.addEventListener("touchstart",d,{passive:!0})),document.addEventListener("submit",p),re(()=>{document.removeEventListener("click",c),e&&(document.removeEventListener("mousemove",h),document.removeEventListener("focusin",d),document.removeEventListener("touchstart",d)),document.removeEventListener("submit",p)})}}function Tn(e){const t=()=>{const r=window.location.pathname.replace(/^\\/+/,"/")+window.location.search,s=window.history.state&&window.history.state._depth&&Object.keys(window.history.state).length===1?void 0:window.history.state;return{value:r+window.location.hash,state:s}},n=dt();return kn({get:t,set({value:r,replace:s,scroll:o,state:i}){s?window.history.replaceState(sn(i),"",r):window.history.pushState(i,"",r),Ln(decodeURIComponent(window.location.hash.slice(1)),o),Ve()},init:r=>On(window,"popstate",on(r,s=>{if(s&&s<0)return!n.confirm(s);{const o=t();return!n.confirm(o.value,{state:o.state})}})),create:Rn(e.preload,e.explicitLinks,e.actionBase,e.transformUrl),utils:{go:r=>window.history.go(r),beforeLeave:n}})(e)}var Dn=L("<a>");function vt(e){e=Ie({inactiveClass:"inactive",activeClass:"active"},e);const[,t]=Mt(e,["href","state","class","activeClass","inactiveClass","end"]),n=mn(()=>e.href),r=pn(n),s=yn(),o=E(()=>{const i=n();if(i===void 0)return[!1,!1];const l=W(i.split(/[?#]/,1)[0]).toLowerCase(),a=decodeURI(W(s.pathname).toLowerCase());return[e.end?l===a:a.startsWith(l+"/")||a===l,l===a]});return(()=>{var i=Dn();return Zt(i,Ie(t,{get href(){return r()||e.href},get state(){return JSON.stringify(e.state)},get classList(){return{...e.class&&{[e.class]:!0},[e.inactiveClass]:!o()[0],[e.activeClass]:o()[0],...t.classList}},link:"",get"aria-current"(){return o()[1]?"page":void 0}}),!1),i})()}async function ae(e){if(!e.ok){const t=await e.json().catch(()=>({}));throw new Error(t.error||`HTTP ${e.status}`)}return e.json()}const ee={list:()=>fetch("/gui/api/sandbox-sessions").then(e=>ae(e)),get:e=>fetch(`/gui/api/sandbox-session/${Qe(e)}`).then(t=>ae(t)),create:e=>fetch("/gui/api/sandbox-create",{method:"POST",headers:Nn,body:JSON.stringify(e)}).then(t=>ae(t)),destroy:e=>fetch(`/gui/api/sandbox-session/${Qe(e)}`,{method:"DELETE"}).then(t=>ae(t))},Nn={"Content-Type":"application/json"},Qe=encodeURIComponent;var jn=L("<div class=card><table class=session-table><thead><tr><th>Session ID</th><th>Status</th><th>Space</th><th>Created</th><th>Actions</th></tr></thead><tbody>"),Un=L(\'<tr><td class=mono style=font-size:0.8125rem></td><td><span></span></td><td style=font-size:0.8125rem;color:#94a3b8></td><td style=font-size:0.8125rem;color:#94a3b8></td><td><div class="flex gap-1"><button type=button class="btn btn-danger btn-sm">Delete\'),Mn=L("<tr><td colspan=5 style=text-align:center;color:#64748b;padding:2rem>");function Fn(e){const t=Date.now()-new Date(e).getTime(),n=Math.floor(t/6e4);if(n<1)return"just now";if(n<60)return n+"m ago";const r=Math.floor(n/60);return r<24?r+"h ago":Math.floor(r/24)+"d ago"}const Vn=e=>e==="active"?"badge badge-active":e==="starting"?"badge badge-starting":"badge badge-stopped";function Bn(e){return(()=>{var t=jn(),n=t.firstChild,r=n.firstChild,s=r.nextSibling;return S(s,v(F,{get when(){return!e.loading},get fallback(){return v(Ze,{text:"Loading..."})},get children(){return v(F,{get when(){return e.sessions.length>0},get fallback(){return v(Ze,{text:"No sessions"})},get children(){return v($e,{get each(){return e.sessions},children:o=>(()=>{var i=Un(),l=i.firstChild,a=l.nextSibling,u=a.firstChild,f=a.nextSibling,c=f.nextSibling,d=c.nextSibling,h=d.firstChild,p=h.firstChild;return S(l,()=>o.sessionId),S(u,()=>o.status),S(f,()=>o.spaceId),S(c,()=>Fn(o.createdAt)),S(h,v(vt,{get href(){return`/sandbox/${encodeURIComponent(o.sessionId)}`},class:"btn btn-primary btn-sm",children:"Open"}),p),p.$$click=()=>e.onDestroy(o.sessionId),D(()=>Fe(u,Vn(o.status))),i})()})}})}})),t})()}function Ze(e){return(()=>{var t=Mn(),n=t.firstChild;return S(n,()=>e.text),t})()}q(["click"]);var zn=L(\'<div class=modal-overlay><div class=modal-content><h2 style=font-size:1rem;font-weight:600;margin-bottom:1rem>Create Sandbox Session</h2><form><label>Session ID</label><input name=sessionId required placeholder="e.g. my-session-01"><label>Space ID</label><input name=spaceId required placeholder="e.g. space-abc"><label>User ID</label><input name=userId required placeholder="e.g. user-123"><div class="flex gap-2"style=justify-content:flex-end;margin-top:0.5rem><button type=button class="btn btn-ghost">Cancel</button><button type=submit class="btn btn-primary">\');function qn(e){const[t,n]=k(!1);let r;const s=async o=>{o.preventDefault(),n(!0);const i=new FormData(r),l={sessionId:i.get("sessionId"),spaceId:i.get("spaceId"),userId:i.get("userId")};try{await e.onCreate(l),r.reset(),e.onClose()}catch(a){alert("Create failed: "+(a instanceof Error?a.message:a))}finally{n(!1)}};return v(F,{get when(){return e.open},get children(){var o=zn(),i=o.firstChild,l=i.firstChild,a=l.nextSibling,u=a.firstChild,f=u.nextSibling,c=f.nextSibling,d=c.nextSibling,h=d.nextSibling,p=h.nextSibling,g=p.nextSibling,m=g.firstChild,b=m.nextSibling;o.$$click=x=>{x.target===x.currentTarget&&e.onClose()},a.addEventListener("submit",s);var y=r;return typeof y=="function"?ye(y,a):r=a,ct(m,"click",e.onClose,!0),S(b,()=>t()?"Creating...":"Create"),D(()=>b.disabled=t()),o}})}q(["click"]);var Kn=L(\'<div class=container><div class="flex items-center justify-between"style=margin-bottom:1.5rem><h1 style=font-size:1.25rem;font-weight:600>takos computer</h1></div><div class=flex style=justify-content:flex-end;margin-bottom:0.75rem><button type=button class="btn btn-primary">+ Sandbox Session</button></div><div class=muted style=margin-top:0.75rem;font-size:0.6875rem>Auto-refresh: every 10s\');function Hn(){const[e,t]=k(!1),[n,r]=k(0),s=()=>r(a=>a+1),[o]=we(()=>n(),()=>ee.list()),i=setInterval(s,1e4);re(()=>clearInterval(i));const l=async a=>{confirm(`Destroy sandbox session "${a}"?`)&&(await ee.destroy(a),s())};return(()=>{var a=Kn(),u=a.firstChild,f=u.nextSibling,c=f.firstChild,d=f.nextSibling;return c.$$click=()=>t(!0),S(a,v(Bn,{get sessions(){return o()?.sessions??[]},get loading(){return o.loading},onDestroy:l}),d),S(a,v(qn,{get open(){return e()},onClose:()=>t(!1),onCreate:async h=>{await ee.create(h),s()}}),null),a})()}q(["click"]);let Wn=0;async function ze(e,t,n={}){const r=await fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",method:"tools/call",params:{name:t,arguments:n},id:++Wn})});if(!r.ok)throw new Error(`MCP HTTP ${r.status}`);const s=await r.json();if(s.error)throw new Error(s.error.message||JSON.stringify(s.error));const o=s.result?.content;if(!o||!o.length)return null;const i=o[0];if(i.type==="text")try{return JSON.parse(i.text)}catch{return i.text}return i}var Gn=L(\'<div style="background:#0f172a;border:1px solid #1e293b;border-radius:0.5rem;overflow:hidden"><div class=mono style=height:420px;overflow-y:auto;padding:0.75rem;font-size:0.8125rem;line-height:1.6;white-space:pre-wrap;word-break:break-all></div><div class=flex style="border-top:1px solid #1e293b"><span class=mono style="padding:0.5rem 0.75rem;color:#6ee7b7;font-size:0.8125rem">$</span><input class=mono placeholder=command... autocomplete=off style="flex:1;background:transparent;border:none;outline:none;color:#e2e8f0;font-size:0.8125rem;padding:0.5rem 0.75rem 0.5rem 0">\'),Jn=L("<span>");function Xn(e){const[t,n]=k([{text:`Type a command and press Enter.\n`,color:"#64748b"}]),[r,s]=k([]),[o,i]=k(-1);let l,a;const u=(d,h)=>{n(p=>[...p,{text:d,color:h}]),requestAnimationFrame(()=>{a.scrollTop=a.scrollHeight})},f=async()=>{const d=l.value.trim();if(d){s(h=>[d,...h].slice(0,100)),i(-1),l.value="",u(`$ ${d}\n`,"#6ee7b7");try{const h=await ze(e.mcpUrl,"shell_exec",{command:d,cwd:e.cwd(),timeout_ms:3e4});h?.stdout&&u(h.stdout,"#e2e8f0"),h?.stderr&&u(h.stderr,"#fca5a5"),h?.timed_out?u(`(timed out)\n`,"#fcd34d"):h&&h.exit_code!==0&&u(`exit ${h.exit_code}\n`,"#64748b")}catch(h){u(`Error: ${h instanceof Error?h.message:h}\n`,"#ef4444")}}},c=d=>{if(d.key==="Enter"){f();return}if(d.key==="ArrowUp"){d.preventDefault();const h=r();if(!h.length)return;const p=Math.min(o()+1,h.length-1);i(p),l.value=h[p]}if(d.key==="ArrowDown"){if(d.preventDefault(),o()<=0){i(-1),l.value="";return}const h=o()-1;i(h),l.value=r()[h]}};return kt(()=>l.focus()),(()=>{var d=Gn(),h=d.firstChild,p=h.nextSibling,g=p.firstChild,m=g.nextSibling,b=a;typeof b=="function"?ye(b,h):a=h,S(h,v($e,{get each(){return t()},children:x=>(()=>{var $=Jn();return S($,()=>x.text),D(I=>ft($,"color",x.color)),$})()})),m.$$keydown=c;var y=l;return typeof y=="function"?ye(y,m):l=m,pe(m,"spellcheck",!1),d})()}q(["keydown"]);var Yn=L(\'<div><div class="flex gap-2 items-center"style=margin-bottom:0.5rem><span style=font-size:0.8125rem;font-weight:600>Files</span><input class="input input-mono flex-1"style=font-size:0.8125rem><button type=button class="btn btn-ghost btn-sm">Refresh</button></div><div class=card style=max-height:240px;overflow-y:auto;font-size:0.8125rem>\'),Qn=L("<div class=muted style=padding:1rem;text-align:center>Loading..."),Zn=L("<div class=muted style=padding:0.75rem>Empty directory"),er=L(\'<span class="mono muted"style=font-size:0.75rem>\'),tr=L(\'<div class="flex gap-2 items-center"><span></span><span class=flex-1>\');function nr(e){return e<1024?e+" B":e<1024*1024?(e/1024).toFixed(1)+" K":(e/(1024*1024)).toFixed(1)+" M"}function rr(e){const[t,n]=k(0),[r]=we(()=>({cwd:e.cwd(),v:t()}),async({cwd:o})=>{const l=(await ze(e.mcpUrl,"file_list",{path:o}))?.entries??[];return l.sort((a,u)=>a.type==="directory"&&u.type!=="directory"?-1:a.type!=="directory"&&u.type==="directory"?1:a.name.localeCompare(u.name)),l}),s=o=>{const i=e.cwd().replace(/\\/+$/,"");e.setCwd(o===".."?i.replace(/\\/[^/]+$/,"")||"/":i+"/"+o)};return(()=>{var o=Yn(),i=o.firstChild,l=i.firstChild,a=l.nextSibling,u=a.nextSibling,f=i.nextSibling;return a.$$keydown=c=>{c.key==="Enter"&&n(d=>d+1)},a.$$input=c=>e.setCwd(c.currentTarget.value),u.$$click=()=>n(c=>c+1),S(f,v(F,{get when(){return!r.loading},get fallback(){return Qn()},get children(){return v(F,{get when(){return(r()??[]).length>0},get fallback(){return Zn()},get children(){return v($e,{get each(){return r()},children:c=>(()=>{var d=tr(),h=d.firstChild,p=h.nextSibling;return d.$$click=()=>{c.type==="directory"&&s(c.name)},S(h,()=>c.type==="directory"?"\u{1F4C1}":"\u{1F4C4}"),S(p,()=>c.name),S(d,v(F,{get when(){return c.type==="file"},get children(){var g=er();return S(g,()=>nr(c.size)),g}}),null),D(g=>{var m=`padding:0.375rem 0.75rem; border-bottom:1px solid #0f172a;${c.type==="directory"?"cursor:pointer":""}`,b=c.type==="directory"?"#60a5fa":"#e2e8f0";return g.e=ut(d,m,g.e),b!==g.t&&ft(p,"color",g.t=b),g},{e:void 0,t:void 0}),d})()})}})}})),D(()=>a.value=e.cwd()),o})()}q(["input","keydown","click"]);var sr=L(\'<div><div class="flex gap-2 items-center"style=margin-bottom:0.5rem><span style=font-size:0.8125rem;font-weight:600>Processes</span><div class=flex-1></div><button type=button class="btn btn-ghost btn-sm">Refresh</button></div><div class=card style=max-height:180px;overflow-y:auto;font-size:0.8125rem>\'),or=L("<div class=muted style=padding:1rem;text-align:center>Loading..."),ir=L("<div class=muted style=padding:0.75rem>No processes"),lr=L(\'<div class="flex gap-2 items-center"style="padding:0.375rem 0.75rem;border-bottom:1px solid #0f172a"><span class="mono muted"style=min-width:3rem></span><span class="mono flex-1"style=overflow:hidden;text-overflow:ellipsis;white-space:nowrap></span><span class=muted style=font-size:0.75rem>% / <!>%\');function ar(e){const[t,n]=k(0),[r]=we(()=>t(),async()=>(await ze(e.mcpUrl,"process_list"))?.processes??[]);return(()=>{var s=sr(),o=s.firstChild,i=o.firstChild,l=i.nextSibling,a=l.nextSibling,u=o.nextSibling;return a.$$click=()=>n(f=>f+1),S(u,v(F,{get when(){return!r.loading},get fallback(){return or()},get children(){return v(F,{get when(){return(r()??[]).length>0},get fallback(){return ir()},get children(){return v($e,{get each(){return r()},children:f=>(()=>{var c=lr(),d=c.firstChild,h=d.nextSibling,p=h.nextSibling,g=p.firstChild,m=g.nextSibling;return m.nextSibling,S(d,()=>f.pid),S(h,()=>f.command),S(p,()=>f.cpu,g),S(p,()=>f.mem,m),c})()})}})}})),s})()}q(["click"]);var cr=L(\'<div class=container><div class="flex gap-2 items-center"style=margin-bottom:0.75rem><div style=width:1px;height:1.5rem;background:#334155></div><span class="mono muted"style=font-size:0.8125rem>Sandbox: </span><div class=flex-1></div><span></span><button type=button class="btn btn-danger btn-sm">Destroy</button></div><div style=margin-top:0.75rem></div><div style=margin-top:0.75rem>\');function ur(){const e=bn(),t=()=>e.id,n=()=>`/gui/api/sandbox-session/${encodeURIComponent(t())}/mcp`,[r,s]=k("/home/sandbox/workspace"),[o,i]=k(0),[l]=we(()=>o(),()=>ee.get(t()).catch(()=>null)),a=setInterval(()=>i(c=>c+1),1e4);re(()=>clearInterval(a));const u=()=>{const c=l()?.status;return c==="active"?"badge badge-active":c==="starting"?"badge badge-starting":"badge badge-stopped"},f=async()=>{confirm("Destroy this sandbox session?")&&(await ee.destroy(t()),location.href="/gui")};return(()=>{var c=cr(),d=c.firstChild,h=d.firstChild,p=h.nextSibling;p.firstChild;var g=p.nextSibling,m=g.nextSibling,b=m.nextSibling,y=d.nextSibling,x=y.nextSibling;return S(d,v(vt,{href:"/",class:"btn btn-ghost btn-sm",children:"\u2190 Dashboard"}),h),S(p,t,null),S(m,()=>l()?.status??"loading"),b.$$click=f,S(c,v(Xn,{get mcpUrl(){return n()},cwd:r}),y),S(y,v(rr,{get mcpUrl(){return n()},cwd:r,setCwd:s})),S(x,v(ar,{get mcpUrl(){return n()}})),D(()=>Fe(m,u())),c})()}q(["click"]);function fr(){return v(Tn,{base:"/gui",get children(){return[v(Ye,{path:"/",component:Hn}),v(Ye,{path:"/sandbox/:id",component:ur})]}})}Xt(()=>v(fr,{}),document.getElementById("app"));</script>\n    <style rel="stylesheet" crossorigin>*{box-sizing:border-box;margin:0}body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0}a{color:inherit}.container{max-width:960px;margin:0 auto;padding:1.5rem}.flex{display:flex}.gap-1{gap:.25rem}.gap-2{gap:.5rem}.gap-3{gap:.75rem}.items-center{align-items:center}.justify-between{justify-content:space-between}.flex-1{flex:1}.btn{display:inline-flex;align-items:center;justify-content:center;gap:.375rem;padding:.5rem 1rem;border:none;border-radius:.375rem;font-size:.8125rem;font-weight:500;cursor:pointer;transition:background .15s,opacity .15s;text-decoration:none}.btn:disabled{opacity:.5;cursor:not-allowed}.btn-primary{background:#2563eb;color:#fff}.btn-primary:hover:not(:disabled){background:#1d4ed8}.btn-ghost{background:transparent;color:#94a3b8}.btn-ghost:hover:not(:disabled){background:#1e293b;color:#f1f5f9}.btn-danger{background:#dc2626;color:#fff}.btn-danger:hover:not(:disabled){background:#b91c1c}.btn-sm{padding:.25rem .5rem;font-size:.75rem}.badge{display:inline-block;font-size:.625rem;font-weight:600;padding:.125rem .5rem;border-radius:9999px;text-transform:uppercase}.badge-active{background:#064e3b;color:#6ee7b7}.badge-starting{background:#78350f;color:#fcd34d}.badge-stopped{background:#7f1d1d;color:#fca5a5}.tab-btn{padding:.5rem 1rem;border:none;border-radius:.375rem .375rem 0 0;font-size:.8125rem;font-weight:500;cursor:pointer;transition:background .15s,color .15s;background:#1e293b;color:#94a3b8}.tab-btn:hover{background:#334155;color:#f1f5f9}.tab-btn.active{background:#334155;color:#f1f5f9;border-bottom:2px solid #3b82f6}.session-table{width:100%;border-collapse:collapse}.session-table th,.session-table td{padding:.625rem .75rem;text-align:left;border-bottom:1px solid #0f172a}.session-table th{font-size:.75rem;font-weight:500;color:#64748b;text-transform:uppercase;letter-spacing:.05em}.session-table tr:hover td{background:#ffffff05}.card{background:#1e293b;border-radius:.75rem;overflow:hidden}.input{width:100%;padding:.5rem .75rem;background:#0f172a;border:1px solid #334155;border-radius:.375rem;color:#e2e8f0;font-size:.8125rem;outline:none}.input:focus{border-color:#3b82f6}.input-mono{font-family:SF Mono,SFMono-Regular,Menlo,Consolas,monospace}.modal-overlay{position:fixed;inset:0;background:#0009;display:flex;align-items:center;justify-content:center;z-index:50}.modal-content{background:#1e293b;border:1px solid #334155;border-radius:.75rem;padding:1.5rem;width:100%;max-width:28rem}.modal-content label{display:block;font-size:.75rem;font-weight:500;color:#94a3b8;margin-bottom:.25rem}.modal-content input{width:100%;padding:.5rem .75rem;background:#0f172a;border:1px solid #334155;border-radius:.375rem;color:#e2e8f0;font-size:.8125rem;margin-bottom:.75rem;outline:none}.modal-content input:focus{border-color:#3b82f6}.nav-btn{display:inline-flex;align-items:center;justify-content:center;width:2rem;height:2rem;border:none;border-radius:.375rem;background:#1e293b;color:#94a3b8;font-size:1rem;cursor:pointer}.nav-btn:hover{background:#334155;color:#f1f5f9}.spinner{width:40px;height:40px;border:3px solid #334155;border-top-color:#3b82f6;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.muted{color:#64748b}.mono{font-family:SF Mono,SFMono-Regular,Menlo,Consolas,monospace}</style>\n  </head>\n  <body>\n    <div id="app"></div>\n  </body>\n</html>\n';

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

// src/sandbox-host.ts
var MAX_MCP_FORWARD_BODY_BYTES = 1024 * 1024;
var PROXY_TOKENS_STORAGE_KEY = "proxyTokens";
var SESSION_STATE_STORAGE_KEY = "sessionState";
var GUI_ADMIN_COOKIE = "takos_computer_admin_token";
var GUI_PROXY_COOKIE = "takos_computer_proxy_token";
var GUI_AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60;
function resolveContainerMcpAuthToken(env) {
  return env.MCP_AUTH_TOKEN || void 0;
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
