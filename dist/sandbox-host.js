var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/.bun/@cloudflare+containers@0.1.1/node_modules/@cloudflare/containers/dist/lib/helpers.js
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
  "node_modules/.bun/@cloudflare+containers@0.1.1/node_modules/@cloudflare/containers/dist/lib/helpers.js"() {
  }
});

// node_modules/.bun/@cloudflare+containers@0.1.1/node_modules/@cloudflare/containers/dist/lib/container.js
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
  "node_modules/.bun/@cloudflare+containers@0.1.1/node_modules/@cloudflare/containers/dist/lib/container.js"() {
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

// node_modules/.bun/@cloudflare+containers@0.1.1/node_modules/@cloudflare/containers/dist/lib/utils.js
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
  "node_modules/.bun/@cloudflare+containers@0.1.1/node_modules/@cloudflare/containers/dist/lib/utils.js"() {
    singletonContainerId = "cf-singleton-container";
  }
});

// node_modules/.bun/@cloudflare+containers@0.1.1/node_modules/@cloudflare/containers/dist/index.js
var dist_exports = {};
__export(dist_exports, {
  Container: () => Container,
  getContainer: () => getContainer,
  getRandom: () => getRandom,
  loadBalance: () => loadBalance,
  switchPort: () => switchPort
});
var init_dist = __esm({
  "node_modules/.bun/@cloudflare+containers@0.1.1/node_modules/@cloudflare/containers/dist/index.js"() {
    init_container();
    init_utils();
  }
});

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/compose.js
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

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/utils/body.js
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

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/utils/url.js
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

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/request.js
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
   * `.bytes()` parses the request body as a `Uint8Array`.
   *
   * @see {@link https://hono.dev/docs/api/request#bytes}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.bytes()
   * })
   * ```
   */
  bytes() {
    return this.#cachedBody("arrayBuffer").then((buffer) => new Uint8Array(buffer));
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

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/utils/html.js
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

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/context.js
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

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
};

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/hono-base.js
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
      subApp.#addRoute(r.method, r.path, handler, r.basePath);
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
        url.pathname = this.getPath(request).slice(pathPrefixLength) || "/";
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
  #addRoute(method, path, handler, baseRoutePath) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = {
      basePath: baseRoutePath !== void 0 ? mergePath(this._basePath, baseRoutePath) : this._basePath,
      path,
      method,
      handler
    };
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

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = ((method2, path2) => {
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
  });
  this.match = match2;
  return match2(method, path);
}

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/router/reg-exp-router/node.js
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

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/router/reg-exp-router/trie.js
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

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/router/reg-exp-router/router.js
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

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/router/smart-router/router.js
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

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/router/trie-router/node.js
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

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/router/trie-router/router.js
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

// node_modules/.bun/hono@4.12.23/node_modules/hono/dist/hono.js
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

// packages/common/src/mcp-rpc.ts
var MCP_TOOL_CALL_ERROR_CODE = -32603;
var MCP_PROTOCOL_VERSION = "2024-11-05";
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
function mcpMethodNotAllowed(endpointLabel = "endpoint") {
  return new Response(
    JSON.stringify({
      error: `MCP Streamable HTTP requests must use POST; server-to-client GET streams are not supported by this ${endpointLabel}`
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
function mcpOptionsPreflight() {
  return new Response(null, {
    status: 204,
    headers: { Allow: "POST, OPTIONS" }
  });
}
function mcpText(text) {
  return { content: [{ type: "text", text }] };
}
function mcpJson(value) {
  return mcpText(JSON.stringify(value, null, 2));
}
var MAX_MCP_BODY_BYTES = 1024 * 1024;
async function readBodyTextBounded(request, max) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > max) return null;
  if (!request.body) {
    const text = await request.text();
    return new TextEncoder().encode(text).length > max ? null : text;
  }
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buf);
}
function createMcpEnvelope(config) {
  const { serverInfo, tools, toolMap, authorize, callContext } = config;
  const endpointLabel = config.endpointLabel ?? "endpoint";
  return async (request) => {
    if (request.method === "OPTIONS") {
      return mcpOptionsPreflight();
    }
    if (request.method !== "POST") {
      return mcpMethodNotAllowed(endpointLabel);
    }
    const denied = await authorize(request);
    if (denied) return denied;
    const bodyText = await readBodyTextBounded(request, MAX_MCP_BODY_BYTES);
    if (bodyText === null) {
      return jsonRpcError(null, -32600, "Request body too large");
    }
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return jsonRpcError(null, -32700, "Parse error");
    }
    if (!isRecord(body)) {
      return jsonRpcError(null, -32600, "Invalid Request");
    }
    const id = body.id;
    if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      return jsonRpcError(id, -32600, "Invalid Request");
    }
    if (body.method === "initialize") {
      return jsonRpcResponse(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo
      });
    }
    if (body.method === "notifications/initialized") {
      return new Response(null, { status: 204 });
    }
    if (body.method === "tools/list") {
      return jsonRpcResponse(id, {
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema
        }))
      });
    }
    if (body.method !== "tools/call") {
      return jsonRpcError(id, -32601, "Method not found");
    }
    if (!isRecord(body.params) || typeof body.params.name !== "string") {
      return jsonRpcError(id, -32602, "Invalid params");
    }
    const tool = toolMap.get(body.params.name);
    if (!tool) {
      return jsonRpcError(id, -32602, `Unknown tool: ${body.params.name}`);
    }
    const args = isRecord(body.params.arguments) ? body.params.arguments : {};
    try {
      return jsonRpcResponse(id, await tool.handle(args, callContext(request)));
    } catch (err) {
      return jsonRpcError(
        id,
        MCP_TOOL_CALL_ERROR_CODE,
        err instanceof Error ? err.message : String(err)
      );
    }
  };
}

// packages/common/src/crypto.ts
function constantTimeEqual(a, b) {
  const maxLen = Math.max(a.length, b.length);
  let result = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    ""
  );
}
function randomBase64UrlToken(byteLength = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

// packages/computer-hosts/src/oidc-verify.ts
var CLOCK_SKEW_SECONDS = 60;
function normalizeIssuer(value) {
  return value.replace(/\/+$/, "");
}
function base64UrlBytes(value) {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
      Math.ceil(value.length / 4) * 4,
      "="
    );
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
function parseBase64UrlJson(value) {
  try {
    const bytes = base64UrlBytes(value);
    return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
  } catch {
    return null;
  }
}
function stringClaim(value) {
  return typeof value === "string" && value ? value : void 0;
}
function numberClaim(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
var DISCOVERY_TTL_MS = 5 * 60 * 1e3;
var JWKS_TTL_MS = 5 * 60 * 1e3;
var discoveryCache = /* @__PURE__ */ new Map();
var jwksCache = /* @__PURE__ */ new Map();
async function discoverOidc(config) {
  if (!config.issuer) return {};
  const cached = discoveryCache.get(config.issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.doc;
  const response = await fetch(
    `${config.issuer}/.well-known/openid-configuration`,
    { headers: { Accept: "application/json" } }
  ).catch(() => null);
  if (!response || !response.ok) return {};
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object") return {};
  if (typeof body.issuer === "string" && normalizeIssuer(body.issuer) !== config.issuer) {
    throw new Error("OIDC discovery issuer mismatch");
  }
  discoveryCache.set(config.issuer, {
    doc: body,
    expiresAt: Date.now() + DISCOVERY_TTL_MS
  });
  return body;
}
async function fetchJwks(uri, forceRefresh = false) {
  const cached = jwksCache.get(uri);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.jwks;
  }
  const response = await fetch(uri, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`OIDC JWKS fetch failed: ${response.status}`);
  }
  const jwks = await response.json();
  jwksCache.set(uri, { jwks, expiresAt: Date.now() + JWKS_TTL_MS });
  return jwks;
}
async function oidcEndpoints(config) {
  const issuer = config.issuer;
  if (config.authorizationEndpoint && config.tokenEndpoint && config.userinfoEndpoint && config.jwksUri) {
    return {
      authorizationEndpoint: config.authorizationEndpoint,
      tokenEndpoint: config.tokenEndpoint,
      userinfoEndpoint: config.userinfoEndpoint,
      jwksUri: config.jwksUri
    };
  }
  const discovery = await discoverOidc(config);
  return {
    authorizationEndpoint: config.authorizationEndpoint ?? discovery.authorization_endpoint ?? `${issuer}/oauth/authorize`,
    tokenEndpoint: config.tokenEndpoint ?? discovery.token_endpoint ?? `${issuer}/oauth/token`,
    userinfoEndpoint: config.userinfoEndpoint ?? discovery.userinfo_endpoint ?? `${issuer}/oauth/userinfo`,
    jwksUri: config.jwksUri ?? discovery.jwks_uri ?? `${issuer}/oauth/jwks`
  };
}
function jwtSigningInput(parts) {
  return new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
}
async function verifyJwtSignature(input) {
  const signature = new Uint8Array(input.signature);
  const signingInput = new Uint8Array(input.signingInput);
  if (input.alg === "ES256") {
    const key = await crypto.subtle.importKey(
      "jwk",
      input.jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      signingInput
    );
  }
  if (input.alg === "RS256") {
    const key = await crypto.subtle.importKey(
      "jwk",
      input.jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      signature,
      signingInput
    );
  }
  return false;
}
function selectJwk(jwks, header) {
  const alg = typeof header.alg === "string" ? header.alg : void 0;
  const kid = typeof header.kid === "string" ? header.kid : void 0;
  return (jwks.keys ?? []).find((key) => {
    if (key.use && key.use !== "sig") return false;
    if (alg && key.alg && key.alg !== alg) return false;
    if (kid && key.kid !== kid) {
      return false;
    }
    return true;
  }) ?? null;
}
function validateIdTokenClaims(claims, config, nonce) {
  const now = Math.floor(Date.now() / 1e3);
  if (stringClaim(claims.iss) !== config.issuer) {
    throw new Error("ID token issuer mismatch");
  }
  if (!stringClaim(claims.sub)) {
    throw new Error("ID token missing subject");
  }
  const audience = claims.aud;
  const audienceMatches = typeof audience === "string" ? audience === config.clientId : Array.isArray(audience) && audience.includes(config.clientId);
  if (!audienceMatches) throw new Error("ID token audience mismatch");
  if (Array.isArray(audience) && audience.length > 1) {
    if (stringClaim(claims.azp) !== config.clientId) {
      throw new Error("ID token authorized party mismatch");
    }
  } else if (claims.azp !== void 0 && stringClaim(claims.azp) !== config.clientId) {
    throw new Error("ID token authorized party mismatch");
  }
  const exp = numberClaim(claims.exp);
  if (!exp || exp <= now - CLOCK_SKEW_SECONDS) {
    throw new Error("ID token expired");
  }
  const nbf = numberClaim(claims.nbf);
  if (nbf && nbf > now + CLOCK_SKEW_SECONDS) {
    throw new Error("ID token not yet valid");
  }
  const iat = numberClaim(claims.iat);
  if (iat && iat > now + CLOCK_SKEW_SECONDS) {
    throw new Error("ID token issued in the future");
  }
  if (stringClaim(claims.nonce) !== nonce) {
    throw new Error("ID token nonce mismatch");
  }
}
async function verifyIdToken(config, idToken, nonce) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid ID token format");
  const header = parseBase64UrlJson(parts[0]);
  const claims = parseBase64UrlJson(parts[1]);
  const signature = base64UrlBytes(parts[2]);
  if (!header || !claims || !signature) throw new Error("Invalid ID token");
  const alg = typeof header.alg === "string" ? header.alg : "";
  if (!["ES256", "RS256"].includes(alg)) {
    throw new Error("Unsupported ID token algorithm");
  }
  const endpoints = await oidcEndpoints(config);
  let jwk = selectJwk(await fetchJwks(endpoints.jwksUri), header);
  if (!jwk) {
    jwk = selectJwk(await fetchJwks(endpoints.jwksUri, true), header);
  }
  if (!jwk) throw new Error("ID token signing key not found");
  const valid = await verifyJwtSignature({
    alg,
    jwk,
    signingInput: jwtSigningInput(parts),
    signature
  });
  if (!valid) throw new Error("ID token signature invalid");
  validateIdTokenClaims(claims, config, nonce);
  return claims;
}

// packages/computer-hosts/src/app-auth.ts
var SESSION_COOKIE = "takos_computer_session";
var STATE_COOKIE = "takos_computer_oauth_state";
var SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
var STATE_MAX_AGE_SECONDS = 10 * 60;
var DEFAULT_AUTH_PATH = "/gui/api/auth";
var DEFAULT_CALLBACK_PATH = `${DEFAULT_AUTH_PATH}/callback`;
var DEFAULT_LAUNCH_PATH = `${DEFAULT_AUTH_PATH}/launch`;
function envValue(env, name) {
  const value = env[name];
  return typeof value === "string" && value.trim() !== "" ? value : void 0;
}
function flagEnabled(env, name) {
  const value = envValue(env, name);
  return value ? ["1", "true", "yes"].includes(value.toLowerCase()) : false;
}
function appBaseUrl(request, env) {
  const configured = envValue(env, "BASE_URL");
  if (configured) return normalizeIssuer(configured);
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
function authConfig(env) {
  const issuer = envValue(env, "OIDC_ISSUER_URL");
  return {
    required: flagEnabled(env, "APP_AUTH_REQUIRED"),
    issuer: issuer ? normalizeIssuer(issuer) : void 0,
    authorizationEndpoint: envValue(env, "OIDC_AUTHORIZATION_URL"),
    tokenEndpoint: envValue(env, "OIDC_TOKEN_URL"),
    userinfoEndpoint: envValue(env, "OIDC_USERINFO_URL"),
    jwksUri: envValue(env, "OIDC_JWKS_URL"),
    clientId: envValue(env, "OIDC_CLIENT_ID"),
    clientSecret: envValue(env, "OIDC_CLIENT_SECRET"),
    redirectUri: envValue(env, "OIDC_REDIRECT_URI"),
    sessionSecret: envValue(env, "APP_SESSION_SECRET")
  };
}
function guiAppAuthRequired(env) {
  return authConfig(env).required;
}
function authMissing(env) {
  const config = authConfig(env);
  if (!config.required) return [];
  const requiredValues = [
    ["APP_SESSION_SECRET", config.sessionSecret],
    ["OIDC_ISSUER_URL", config.issuer],
    ["OIDC_CLIENT_ID", config.clientId],
    ["OIDC_CLIENT_SECRET", config.clientSecret]
  ];
  return requiredValues.flatMap(([name, value]) => value ? [] : [name]);
}
function appAuthMisconfigured(env) {
  const missing = authMissing(env);
  if (missing.length === 0) return null;
  return Response.json({
    error: "GUI app auth is not configured",
    missing
  }, { status: 503 });
}
function launchMissing(env) {
  const requiredValues = [
    ["APP_SESSION_SECRET", envValue(env, "APP_SESSION_SECRET")],
    ["ACCOUNTS_BASE_URL", envValue(env, "ACCOUNTS_BASE_URL")],
    [
      "INSTALL_LAUNCH_INSTALLATION_ID",
      envValue(env, "INSTALL_LAUNCH_INSTALLATION_ID")
    ],
    [
      "INSTALL_LAUNCH_CONSUME_PATH",
      envValue(env, "INSTALL_LAUNCH_CONSUME_PATH")
    ]
  ];
  return requiredValues.flatMap(([name, value]) => value ? [] : [name]);
}
function launchMisconfigured(env) {
  const missing = launchMissing(env);
  if (missing.length === 0) return null;
  return Response.json({
    error: "Launch token auth is not configured",
    missing
  }, { status: 503 });
}
function base64UrlJson(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}
async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );
  return base64Url(new Uint8Array(signature));
}
async function seal(value, secret) {
  const payload = base64UrlJson(value);
  return `${payload}.${await sign(payload, secret)}`;
}
async function unseal(token, secret) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  if (!constantTimeEqual(await sign(payload, secret), signature)) return null;
  return parseBase64UrlJson(payload);
}
async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return base64Url(new Uint8Array(digest));
}
function parseCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName !== name) continue;
    const value = rest.join("=");
    try {
      return decodeURIComponent(value);
    } catch {
      return value || null;
    }
  }
  return null;
}
function cookieHeader(request, name, value, maxAge, path) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
function clearCookie(request, name, path) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
function safeReturnTo(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/gui";
  }
  if (value === "/") return "/gui";
  return value.startsWith("/gui") ? value : "/gui";
}
function callbackUrl(request, env) {
  const config = authConfig(env);
  if (config.redirectUri) return config.redirectUri;
  return new URL(DEFAULT_CALLBACK_PATH, appBaseUrl(request, env)).toString();
}
async function exchangeCode(env, request, code, codeVerifier) {
  const config = authConfig(env);
  const endpoints = await oidcEndpoints(config);
  const response = await fetch(endpoints.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: callbackUrl(request, env),
      code_verifier: codeVerifier
    })
  });
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed: ${response.status}`);
  }
  const body = await response.json();
  if (!body.access_token || !body.id_token) {
    throw new Error("OAuth token response missing access_token or id_token");
  }
  return body;
}
async function fetchUserInfo(env, accessToken) {
  const config = authConfig(env);
  const endpoints = await oidcEndpoints(config);
  const response = await fetch(endpoints.userinfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error(`OAuth userinfo failed: ${response.status}`);
  }
  const body = await response.json();
  const sub = body.user?.id ?? body.sub;
  if (!sub) throw new Error("OAuth userinfo response missing subject");
  return { sub, name: body.user?.name ?? body.name };
}
async function createSessionCookie(env, request, session) {
  const secret = envValue(env, "APP_SESSION_SECRET");
  if (!secret) throw new Error("APP_SESSION_SECRET is required");
  return cookieHeader(
    request,
    SESSION_COOKIE,
    await seal(
      {
        ...session,
        exp: Math.floor(Date.now() / 1e3) + SESSION_MAX_AGE_SECONDS
      },
      secret
    ),
    SESSION_MAX_AGE_SECONDS,
    "/gui"
  );
}
async function readGuiSession(env, request) {
  const config = authConfig(env);
  if (!config.required || !config.sessionSecret) return null;
  const raw2 = parseCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!raw2) return null;
  const session = await unseal(raw2, config.sessionSecret);
  if (!session || session.exp <= Math.floor(Date.now() / 1e3)) return null;
  return session;
}
async function requireGuiAppAuth(env, request) {
  if (!guiAppAuthRequired(env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const misconfigured = appAuthMisconfigured(env);
  if (misconfigured) return misconfigured;
  const session = await readGuiSession(env, request);
  return session ? null : Response.json({ error: "Unauthorized" }, {
    status: 401
  });
}
function loginRedirect(request) {
  const url = new URL(request.url);
  const loginUrl = new URL(`${DEFAULT_AUTH_PATH}/login`, url.origin);
  loginUrl.searchParams.set(
    "return_to",
    safeReturnTo(`${url.pathname}${url.search}`)
  );
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      "Location": `${loginUrl.pathname}${loginUrl.search}`
    }
  });
}
async function requireGuiAppOrRedirect(env, request) {
  const auth = await requireGuiAppAuth(env, request);
  if (!auth) return null;
  return auth.status === 401 ? loginRedirect(request) : auth;
}
function launchRedirectUri(request, env) {
  const consumePath = envValue(env, "INSTALL_LAUNCH_CONSUME_PATH") ?? DEFAULT_LAUNCH_PATH;
  const redirectUri = new URL(consumePath, appBaseUrl(request, env));
  const current = new URL(request.url);
  for (const [key, value] of current.searchParams.entries()) {
    if (key !== "launch_token") redirectUri.searchParams.append(key, value);
  }
  return redirectUri.toString();
}
function consumeUrl(env) {
  const accountsBaseUrl = normalizeIssuer(envValue(env, "ACCOUNTS_BASE_URL"));
  const installationId = encodeURIComponent(
    envValue(env, "INSTALL_LAUNCH_INSTALLATION_ID")
  );
  return `${accountsBaseUrl}/v1/installations/${installationId}/launch-token/consume`;
}
async function consumeLaunchToken(env, request, token) {
  const response = await fetch(consumeUrl(env), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      redirect_uri: launchRedirectUri(request, env)
    })
  });
  if (!response.ok) {
    throw new Error(`Launch token consume failed: ${response.status}`);
  }
  const body = await response.json();
  const sub = stringClaim(body.sub) ?? stringClaim(body.subject);
  if (body.consumed !== true || !sub) {
    throw new Error("Launch token consume response is invalid");
  }
  return {
    sub,
    accountId: stringClaim(body.account_id) ?? stringClaim(body.accountId),
    spaceId: stringClaim(body.space_id) ?? stringClaim(body.spaceId),
    appId: stringClaim(body.app_id) ?? stringClaim(body.appId),
    role: stringClaim(body.role)
  };
}
function redirectToLogin(returnTo) {
  const url = new URL(
    `${DEFAULT_AUTH_PATH}/login`,
    "https://takos-computer.local"
  );
  url.searchParams.set("return_to", safeReturnTo(returnTo));
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      "Location": `${url.pathname}${url.search}`
    }
  });
}
function registerGuiAuthRoutes(app2) {
  app2.get(`${DEFAULT_AUTH_PATH}/login`, async (c) => {
    const misconfigured = appAuthMisconfigured(c.env);
    if (misconfigured) return misconfigured;
    const config = authConfig(c.env);
    try {
      const endpoints = await oidcEndpoints(config);
      const codeVerifier = randomBase64UrlToken();
      const state = {
        state: randomBase64UrlToken(),
        nonce: randomBase64UrlToken(),
        codeVerifier,
        returnTo: safeReturnTo(c.req.query("return_to") ?? null),
        exp: Math.floor(Date.now() / 1e3) + STATE_MAX_AGE_SECONDS
      };
      const authUrl = new URL(endpoints.authorizationEndpoint);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", config.clientId);
      authUrl.searchParams.set("redirect_uri", callbackUrl(c.req.raw, c.env));
      authUrl.searchParams.set("scope", "openid profile email");
      authUrl.searchParams.set("state", state.state);
      authUrl.searchParams.set("nonce", state.nonce);
      authUrl.searchParams.set(
        "code_challenge",
        await sha256Base64Url(codeVerifier)
      );
      authUrl.searchParams.set("code_challenge_method", "S256");
      return new Response(null, {
        status: 302,
        headers: {
          "Cache-Control": "no-store",
          "Location": authUrl.toString(),
          "Set-Cookie": cookieHeader(
            c.req.raw,
            STATE_COOKIE,
            await seal(state, config.sessionSecret),
            STATE_MAX_AGE_SECONDS,
            DEFAULT_AUTH_PATH
          )
        }
      });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "OIDC login failed"
      }, { status: 503 });
    }
  });
  app2.get(`${DEFAULT_AUTH_PATH}/callback`, async (c) => {
    const config = authConfig(c.env);
    const misconfigured = appAuthMisconfigured(c.env);
    if (misconfigured) return misconfigured;
    const code = c.req.query("code");
    const returnedState = c.req.query("state");
    const stateCookie = parseCookie(c.req.header("Cookie"), STATE_COOKIE);
    const state = stateCookie ? await unseal(stateCookie, config.sessionSecret) : null;
    if (!code || !returnedState || !state || state.state !== returnedState || state.exp <= Math.floor(Date.now() / 1e3)) {
      return Response.json({ error: "Invalid OAuth state" }, { status: 400 });
    }
    try {
      const token = await exchangeCode(
        c.env,
        c.req.raw,
        code,
        state.codeVerifier
      );
      const claims = await verifyIdToken(config, token.id_token, state.nonce);
      const user = await fetchUserInfo(c.env, token.access_token);
      const subject = stringClaim(claims.sub);
      if (!subject || user.sub !== subject) {
        throw new Error("OAuth userinfo subject mismatch");
      }
      const headers = new Headers({
        "Cache-Control": "no-store",
        "Location": state.returnTo
      });
      headers.append(
        "Set-Cookie",
        clearCookie(c.req.raw, STATE_COOKIE, DEFAULT_AUTH_PATH)
      );
      headers.append(
        "Set-Cookie",
        await createSessionCookie(c.env, c.req.raw, {
          sub: subject,
          name: user.name ?? stringClaim(claims.name) ?? stringClaim(claims.email),
          accountId: stringClaim(claims.takosumi?.account_id),
          spaceId: stringClaim(claims.takosumi?.space_id),
          appId: stringClaim(claims.takosumi?.app_id),
          role: stringClaim(claims.takosumi?.role)
        })
      );
      return new Response(null, { status: 302, headers });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "OAuth callback failed"
      }, { status: 502 });
    }
  });
  app2.get(`${DEFAULT_AUTH_PATH}/me`, async (c) => {
    const auth = await requireGuiAppAuth(c.env, c.req.raw);
    if (auth) return auth;
    const session = await readGuiSession(c.env, c.req.raw);
    return c.json({
      authenticated: true,
      subject: session?.sub,
      name: session?.name,
      accountId: session?.accountId,
      spaceId: session?.spaceId,
      appId: session?.appId,
      role: session?.role
    });
  });
  app2.post(`${DEFAULT_AUTH_PATH}/logout`, (c) => {
    return Response.json({ success: true }, {
      headers: {
        "Set-Cookie": clearCookie(c.req.raw, SESSION_COOKIE, "/gui")
      }
    });
  });
  app2.get(DEFAULT_LAUNCH_PATH, async (c) => {
    const misconfigured = launchMisconfigured(c.env);
    if (misconfigured) return misconfigured;
    const token = c.req.query("launch_token")?.trim();
    const returnTo = safeReturnTo(c.req.query("return_to") ?? null);
    if (!token) {
      return Response.json({ error: "launch_token is required" }, {
        status: 400
      });
    }
    try {
      const consumed = await consumeLaunchToken(c.env, c.req.raw, token);
      return new Response(null, {
        status: 302,
        headers: {
          "Cache-Control": "no-store",
          "Location": returnTo,
          "Set-Cookie": await createSessionCookie(c.env, c.req.raw, {
            sub: consumed.sub,
            accountId: consumed.accountId,
            spaceId: consumed.spaceId,
            appId: consumed.appId,
            role: consumed.role
          })
        }
      });
    } catch {
      return redirectToLogin(returnTo);
    }
  });
}

// packages/computer-hosts/src/gui/assets.generated.ts
var appHtml = '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>takos computer</title>\n    <script type="module" crossorigin>(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll(\'link[rel="modulepreload"]\'))r(s);new MutationObserver(s=>{for(const o of s)if(o.type==="childList")for(const i of o.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&r(i)}).observe(document,{childList:!0,subtree:!0});function n(s){const o={};return s.integrity&&(o.integrity=s.integrity),s.referrerPolicy&&(o.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?o.credentials="include":s.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function r(s){if(s.ep)return;s.ep=!0;const o=n(s);fetch(s.href,o)}})();const cn=!1,un=(e,t)=>e===t,fn=Symbol("solid-track"),Ce={equals:un};let _t=Lt;const W=1,Ee=2,Pt={owned:null,cleanups:null,context:null,owner:null},qe={};var I=null;let He=null,dn=null,E=null,j=null,K=null,De=0;function Se(e,t){const n=E,r=I,s=e.length===0,o=t===void 0?r:t,i=s?Pt:{owned:null,cleanups:null,context:o?o.context:null,owner:o},l=s?e:()=>e(()=>q(()=>ge(i)));I=i,E=null;try{return X(l,!0)}finally{E=n,I=r}}function N(e,t){t=t?Object.assign({},Ce,t):Ce;const n={value:e,observers:null,observerSlots:null,comparator:t.equals||void 0},r=s=>(typeof s=="function"&&(s=s(n.value)),kt(n,s));return[Ot.bind(n),r]}function hn(e,t,n){const r=je(e,t,!0,W);fe(r)}function F(e,t,n){const r=je(e,t,!1,W);fe(r)}function It(e,t,n){_t=$n;const r=je(e,t,!1,W);r.user=!0,K?K.push(r):fe(r)}function ue(e,t,n){n=n?Object.assign({},Ce,n):Ce;const r=je(e,t,!0,0);return r.observers=null,r.observerSlots=null,r.comparator=n.equals||void 0,fe(r),Ot.bind(r)}function gn(e){return e&&typeof e=="object"&&"then"in e}function Ne(e,t,n){let r,s,o;typeof t=="function"?(r=e,s=t,o={}):(r=!0,s=e,o=t||{});let i=null,l=qe,a=!1,c="initialValue"in o,f=typeof r=="function"&&ue(r);const u=new Set,[h,d]=(o.storage||N)(o.initialValue),[g,m]=N(void 0),[p,$]=N(void 0,{equals:!1}),[b,v]=N(c?"ready":"unresolved");function w(L,O,M,D){return i===L&&(i=null,D!==void 0&&(c=!0),(L===l||O===l)&&o.onHydrated&&queueMicrotask(()=>o.onHydrated(D,{value:O})),l=qe,x(O,M)),O}function x(L,O){X(()=>{O===void 0&&d(()=>L),v(O!==void 0?"errored":c?"ready":"unresolved"),m(O);for(const M of u.keys())M.decrement();u.clear()},!1)}function k(){const L=yn,O=h(),M=g();if(M!==void 0&&!i)throw M;return E&&E.user,O}function H(L=!0){if(L!==!1&&a)return;a=!1;const O=f?f():r;if(O==null||O===!1){w(i,q(h));return}let M;const D=l!==qe?l:q(()=>{try{return s(O,{value:h(),refetching:L})}catch(te){M=te}});if(M!==void 0){w(i,void 0,xe(M),O);return}else if(!gn(D))return w(i,D,void 0,O),D;return i=D,"v"in D?(D.s===1?w(i,D.v,void 0,O):w(i,void 0,xe(D.v),O),D):(a=!0,queueMicrotask(()=>a=!1),X(()=>{v(c?"refreshing":"pending"),$()},!1),D.then(te=>w(D,te,void 0,O),te=>w(D,void 0,xe(te),O)))}Object.defineProperties(k,{state:{get:()=>b()},error:{get:()=>g()},loading:{get(){const L=b();return L==="pending"||L==="refreshing"}},latest:{get(){if(!c)return k();const L=g();if(L&&!i)throw L;return h()}}});let ee=I;return f?hn(()=>(ee=I,H(!1))):H(!1),[k,{refetch:L=>pn(ee,()=>H(L)),mutate:d}]}function q(e){if(E===null)return e();const t=E;E=null;try{return e()}finally{E=t}}function mn(e){It(()=>q(e))}function rt(e){return I===null||(I.cleanups===null?I.cleanups=[e]:I.cleanups.push(e)),e}function pn(e,t){const n=I,r=E;I=e,E=null;try{return X(t,!0)}catch(s){ot(s)}finally{I=n,E=r}}const[Er,_r]=N(!1);let yn;function Ot(){if(this.sources&&this.state)if(this.state===W)fe(this);else{const e=j;j=null,X(()=>Pe(this),!1),j=e}if(E){const e=this.observers;if(!e||e[e.length-1]!==E){const t=e?e.length:0;E.sources?(E.sources.push(this),E.sourceSlots.push(t)):(E.sources=[this],E.sourceSlots=[t]),e?(e.push(E),this.observerSlots.push(E.sources.length-1)):(this.observers=[E],this.observerSlots=[E.sources.length-1])}}return this.value}function kt(e,t,n){let r=e.value;return(!e.comparator||!e.comparator(r,t))&&(e.value=t,e.observers&&e.observers.length&&X(()=>{for(let s=0;s<e.observers.length;s+=1){const o=e.observers[s],i=He&&He.running;i&&He.disposed.has(o),(i?!o.tState:!o.state)&&(o.pure?j.push(o):K.push(o),o.observers&&Tt(o)),i||(o.state=W)}if(j.length>1e6)throw j=[],new Error},!1)),t}function fe(e){if(!e.fn)return;ge(e);const t=De;bn(e,e.value,t)}function bn(e,t,n){let r;const s=I,o=E;E=I=e;try{r=e.fn(t)}catch(i){return e.pure&&(e.state=W,e.owned&&e.owned.forEach(ge),e.owned=null),e.updatedAt=n+1,ot(i)}finally{E=o,I=s}(!e.updatedAt||e.updatedAt<=n)&&(e.updatedAt!=null&&"observers"in e?kt(e,r):e.value=r,e.updatedAt=n)}function je(e,t,n,r=W,s){const o={fn:e,state:r,updatedAt:null,owned:null,sources:null,sourceSlots:null,cleanups:null,value:t,owner:I,context:I?I.context:null,pure:n};return I===null||I!==Pt&&(I.owned?I.owned.push(o):I.owned=[o]),o}function _e(e){if(e.state===0)return;if(e.state===Ee)return Pe(e);if(e.suspense&&q(e.suspense.inFallback))return e.suspense.effects.push(e);const t=[e];for(;(e=e.owner)&&(!e.updatedAt||e.updatedAt<De);)e.state&&t.push(e);for(let n=t.length-1;n>=0;n--)if(e=t[n],e.state===W)fe(e);else if(e.state===Ee){const r=j;j=null,X(()=>Pe(e,t[0]),!1),j=r}}function X(e,t){if(j)return e();let n=!1;t||(j=[]),K?n=!0:K=[],De++;try{const r=e();return wn(n),r}catch(r){n||(K=null),j=null,ot(r)}}function wn(e){if(j&&(Lt(j),j=null),e)return;const t=K;K=null,t.length&&X(()=>_t(t),!1)}function Lt(e){for(let t=0;t<e.length;t++)_e(e[t])}function $n(e){let t,n=0;for(t=0;t<e.length;t++){const r=e[t];r.user?e[n++]=r:_e(r)}for(t=0;t<n;t++)_e(e[t])}function Pe(e,t){e.state=0;for(let n=0;n<e.sources.length;n+=1){const r=e.sources[n];if(r.sources){const s=r.state;s===W?r!==t&&(!r.updatedAt||r.updatedAt<De)&&_e(r):s===Ee&&Pe(r,t)}}}function Tt(e){for(let t=0;t<e.observers.length;t+=1){const n=e.observers[t];n.state||(n.state=Ee,n.pure?j.push(n):K.push(n),n.observers&&Tt(n))}}function ge(e){let t;if(e.sources)for(;e.sources.length;){const n=e.sources.pop(),r=e.sourceSlots.pop(),s=n.observers;if(s&&s.length){const o=s.pop(),i=n.observerSlots.pop();r<s.length&&(o.sourceSlots[i]=r,s[r]=o,n.observerSlots[r]=i)}}if(e.tOwned){for(t=e.tOwned.length-1;t>=0;t--)ge(e.tOwned[t]);delete e.tOwned}if(e.owned){for(t=e.owned.length-1;t>=0;t--)ge(e.owned[t]);e.owned=null}if(e.cleanups){for(t=e.cleanups.length-1;t>=0;t--)e.cleanups[t]();e.cleanups=null}e.state=0}function xe(e){return e instanceof Error?e:new Error(typeof e=="string"?e:"Unknown error",{cause:e})}function ot(e,t=I){throw xe(e)}const vn=Symbol("fallback");function mt(e){for(let t=0;t<e.length;t++)e[t]()}function Sn(e,t,n={}){let r=[],s=[],o=[],i=0,l=t.length>1?[]:null;return rt(()=>mt(o)),()=>{let a=e()||[],c=a.length,f,u;return a[fn],q(()=>{let d,g,m,p,$,b,v,w,x;if(c===0)i!==0&&(mt(o),o=[],r=[],s=[],i=0,l&&(l=[])),n.fallback&&(r=[vn],s[0]=Se(k=>(o[0]=k,n.fallback())),i=1);else if(i===0){for(s=new Array(c),u=0;u<c;u++)r[u]=a[u],s[u]=Se(h);i=c}else{for(m=new Array(c),p=new Array(c),l&&($=new Array(c)),b=0,v=Math.min(i,c);b<v&&r[b]===a[b];b++);for(v=i-1,w=c-1;v>=b&&w>=b&&r[v]===a[w];v--,w--)m[w]=s[v],p[w]=o[v],l&&($[w]=l[v]);for(d=new Map,g=new Array(w+1),u=w;u>=b;u--)x=a[u],f=d.get(x),g[u]=f===void 0?-1:f,d.set(x,u);for(f=b;f<=v;f++)x=r[f],u=d.get(x),u!==void 0&&u!==-1?(m[u]=s[f],p[u]=o[f],l&&($[u]=l[f]),u=g[u],d.set(x,u)):o[f]();for(u=b;u<c;u++)u in m?(s[u]=m[u],o[u]=p[u],l&&(l[u]=$[u],l[u](u))):s[u]=Se(h);s=s.slice(0,i=c),r=a.slice(0)}return s});function h(d){if(o[u]=d,l){const[g,m]=N(u);return l[u]=m,t(a[u],g)}return t(a[u])}}}function A(e,t){return q(()=>e(t||{}))}const xn=e=>`Stale read from <${e}>.`;function pe(e){const t="fallback"in e&&{fallback:()=>e.fallback};return ue(Sn(()=>e.each,e.children,t||void 0))}function z(e){const t=e.keyed,n=ue(()=>e.when,void 0,void 0),r=t?n:ue(n,void 0,{equals:(s,o)=>!s==!o});return ue(()=>{const s=r();if(s){const o=e.children;return typeof o=="function"&&o.length>0?q(()=>o(t?s:()=>{if(!q(r))throw xn("Show");return n()})):o}return e.fallback},void 0,void 0)}const Rt=e=>ue(()=>e());function An(e,t,n){let r=n.length,s=t.length,o=r,i=0,l=0,a=t[s-1].nextSibling,c=null;for(;i<s||l<o;){if(t[i]===n[l]){i++,l++;continue}for(;t[s-1]===n[o-1];)s--,o--;if(s===i){const f=o<r?l?n[l-1].nextSibling:n[o-l]:a;for(;l<o;)e.insertBefore(n[l++],f)}else if(o===l)for(;i<s;)(!c||!c.has(t[i]))&&t[i].remove(),i++;else if(t[i]===n[o-1]&&n[l]===t[s-1]){const f=t[--s].nextSibling;e.insertBefore(n[l++],t[i++].nextSibling),e.insertBefore(n[--o],f),t[s]=n[o]}else{if(!c){c=new Map;let u=l;for(;u<o;)c.set(n[u],u++)}const f=c.get(t[i]);if(f!=null)if(l<f&&f<o){let u=i,h=1,d;for(;++u<s&&u<o&&!((d=c.get(t[u]))==null||d!==f+h);)h++;if(h>f-l){const g=t[i];for(;l<f;)e.insertBefore(n[l++],g)}else e.replaceChild(n[l++],t[i++])}else i++;else t[i++].remove()}}}const pt="_$DX_DELEGATE";function Cn(e,t,n,r={}){let s;return Se(o=>{s=o,t===document?e():y(t,e(),t.firstChild?null:void 0,n)},r.owner),()=>{s(),t.textContent=""}}function R(e,t,n,r){let s;const o=()=>{const l=document.createElement("template");return l.innerHTML=e,l.content.firstChild},i=()=>(s||(s=o())).cloneNode(!0);return i.cloneNode=i,i}function Y(e,t=window.document){const n=t[pt]||(t[pt]=new Set);for(let r=0,s=e.length;r<s;r++){const o=e[r];n.has(o)||(n.add(o),t.addEventListener(o,Pn))}}function G(e,t,n){n==null?e.removeAttribute(t):e.setAttribute(t,n)}function Dt(e,t){t==null?e.removeAttribute("class"):e.className=t}function En(e,t,n,r){Array.isArray(n)?(e[`$$${t}`]=n[0],e[`$$${t}Data`]=n[1]):e[`$$${t}`]=n}function _n(e,t,n){if(!t)return n?G(e,"style"):t;const r=e.style;if(typeof t=="string")return r.cssText=t;typeof n=="string"&&(r.cssText=n=void 0),n||(n={}),t||(t={});let s,o;for(o in n)t[o]==null&&r.removeProperty(o),delete n[o];for(o in t)s=t[o],s!==n[o]&&(r.setProperty(o,s),n[o]=s);return n}function Ie(e,t,n){n!=null?e.style.setProperty(t,n):e.style.removeProperty(t)}function Je(e,t,n){return q(()=>e(t,n))}function y(e,t,n,r){if(n!==void 0&&!r&&(r=[]),typeof t!="function")return Oe(e,t,r,n);F(s=>Oe(e,t(),s,n),r)}function Pn(e){let t=e.target;const n=`$$${e.type}`,r=e.target,s=e.currentTarget,o=a=>Object.defineProperty(e,"target",{configurable:!0,value:a}),i=()=>{const a=t[n];if(a&&!t.disabled){const c=t[`${n}Data`];if(c!==void 0?a.call(t,c,e):a.call(t,e),e.cancelBubble)return}return t.host&&typeof t.host!="string"&&!t.host._$host&&t.contains(e.target)&&o(t.host),!0},l=()=>{for(;i()&&(t=t._$host||t.parentNode||t.host););};if(Object.defineProperty(e,"currentTarget",{configurable:!0,get(){return t||document}}),e.composedPath){const a=e.composedPath();o(a[0]);for(let c=0;c<a.length-2&&(t=a[c],!!i());c++){if(t._$host){t=t._$host,l();break}if(t.parentNode===s)break}}else l();o(r)}function Oe(e,t,n,r,s){for(;typeof n=="function";)n=n();if(t===n)return n;const o=typeof t,i=r!==void 0;if(e=i&&n[0]&&n[0].parentNode||e,o==="string"||o==="number"){if(o==="number"&&(t=t.toString(),t===n))return n;if(i){let l=n[0];l&&l.nodeType===3?l.data!==t&&(l.data=t):l=document.createTextNode(t),n=ae(e,n,r,l)}else n!==""&&typeof n=="string"?n=e.firstChild.data=t:n=e.textContent=t}else if(t==null||o==="boolean")n=ae(e,n,r);else{if(o==="function")return F(()=>{let l=t();for(;typeof l=="function";)l=l();n=Oe(e,l,n,r)}),()=>n;if(Array.isArray(t)){const l=[],a=n&&Array.isArray(n);if(Xe(l,t,n,s))return F(()=>n=Oe(e,l,n,r,!0)),()=>n;if(l.length===0){if(n=ae(e,n,r),i)return n}else a?n.length===0?yt(e,l,r):An(e,n,l):(n&&ae(e),yt(e,l));n=l}else if(t.nodeType){if(Array.isArray(n)){if(i)return n=ae(e,n,r,t);ae(e,n,null,t)}else n==null||n===""||!e.firstChild?e.appendChild(t):e.replaceChild(t,e.firstChild);n=t}}return n}function Xe(e,t,n,r){let s=!1;for(let o=0,i=t.length;o<i;o++){let l=t[o],a=n&&n[e.length],c;if(!(l==null||l===!0||l===!1))if((c=typeof l)=="object"&&l.nodeType)e.push(l);else if(Array.isArray(l))s=Xe(e,l,a)||s;else if(c==="function")if(r){for(;typeof l=="function";)l=l();s=Xe(e,Array.isArray(l)?l:[l],Array.isArray(a)?a:[a])||s}else e.push(l),s=!0;else{const f=String(l);a&&a.nodeType===3&&a.data===f?e.push(a):e.push(document.createTextNode(f))}}return s}function yt(e,t,n=null){for(let r=0,s=t.length;r<s;r++)e.insertBefore(t[r],n)}function ae(e,t,n,r){if(n===void 0)return e.textContent="";const s=r||document.createTextNode("");if(t.length){let o=!1;for(let i=t.length-1;i>=0;i--){const l=t[i];if(s!==l){const a=l.parentNode===e;!o&&!i?a?e.replaceChild(s,l):e.insertBefore(s,n):a&&l.remove()}else o=!0}}else e.insertBefore(s,n);return[s]}const In=!1,On=(e,t)=>e===t,ke=Symbol("solid-proxy"),Nt=typeof Proxy=="function",Le={equals:On};let kn=Wt;const ie=1,Te=2,jt={owned:null,cleanups:null,context:null,owner:null};var S=null;let Ke=null,Ln=null,_=null,U=null,se=null,Ue=0;function Tn(e,t){const n=_,r=S,s=e.length===0,o=r,i=s?jt:{owned:null,cleanups:null,context:o?o.context:null,owner:o},l=s?e:()=>e(()=>V(()=>me(i)));S=i,_=null;try{return Q(l,!0)}finally{_=n,S=r}}function ce(e,t){t=t?Object.assign({},Le,t):Le;const n={value:e,observers:null,observerSlots:null,comparator:t.equals||void 0},r=s=>(typeof s=="function"&&(s=s(n.value)),qt(n,s));return[Vt.bind(n),r]}function re(e,t,n){const r=Ht(e,t,!1,ie);Me(r)}function T(e,t,n){n=n?Object.assign({},Le,n):Le;const r=Ht(e,t,!0,0);return r.observers=null,r.observerSlots=null,r.comparator=n.equals||void 0,Me(r),Vt.bind(r)}function Rn(e){return Q(e,!1)}function V(e){if(_===null)return e();const t=_;_=null;try{return e()}finally{_=t}}function it(e,t,n){const r=Array.isArray(e);let s,o=n&&n.defer;return i=>{let l;if(r){l=Array(e.length);for(let c=0;c<e.length;c++)l[c]=e[c]()}else l=e();if(o)return o=!1,i;const a=V(()=>t(l,s,i));return s=l,a}}function Ut(e){return S===null||(S.cleanups===null?S.cleanups=[e]:S.cleanups.push(e)),e}function Mt(){return S}function Ft(e,t){const n=S,r=_;S=e,_=null;try{return Q(t,!0)}catch(s){ct(s)}finally{S=n,_=r}}function Dn(e){const t=_,n=S;return Promise.resolve().then(()=>{_=t,S=n;let r;return Q(e,!1),_=S=null,r?r.done:void 0})}const[Pr,Ir]=ce(!1);function Bt(e,t){const n=Symbol("context");return{id:n,Provider:Mn(n),defaultValue:e}}function lt(e){let t;return S&&S.context&&(t=S.context[e.id])!==void 0?t:e.defaultValue}function at(e){const t=T(e),n=T(()=>Ye(t()));return n.toArray=()=>{const r=n();return Array.isArray(r)?r:r!=null?[r]:[]},n}function Vt(){if(this.sources&&this.state)if(this.state===ie)Me(this);else{const e=U;U=null,Q(()=>Re(this),!1),U=e}if(_){const e=this.observers?this.observers.length:0;_.sources?(_.sources.push(this),_.sourceSlots.push(e)):(_.sources=[this],_.sourceSlots=[e]),this.observers?(this.observers.push(_),this.observerSlots.push(_.sources.length-1)):(this.observers=[_],this.observerSlots=[_.sources.length-1])}return this.value}function qt(e,t,n){let r=e.value;return(!e.comparator||!e.comparator(r,t))&&(e.value=t,e.observers&&e.observers.length&&Q(()=>{for(let s=0;s<e.observers.length;s+=1){const o=e.observers[s],i=Ke&&Ke.running;i&&Ke.disposed.has(o),(i?!o.tState:!o.state)&&(o.pure?U.push(o):se.push(o),o.observers&&zt(o)),i||(o.state=ie)}if(U.length>1e6)throw U=[],new Error},!1)),t}function Me(e){if(!e.fn)return;me(e);const t=Ue;Nn(e,e.value,t)}function Nn(e,t,n){let r;const s=S,o=_;_=S=e;try{r=e.fn(t)}catch(i){return e.pure&&(e.state=ie,e.owned&&e.owned.forEach(me),e.owned=null),e.updatedAt=n+1,ct(i)}finally{_=o,S=s}(!e.updatedAt||e.updatedAt<=n)&&(e.updatedAt!=null&&"observers"in e?qt(e,r):e.value=r,e.updatedAt=n)}function Ht(e,t,n,r=ie,s){const o={fn:e,state:r,updatedAt:null,owned:null,sources:null,sourceSlots:null,cleanups:null,value:t,owner:S,context:S?S.context:null,pure:n};return S===null||S!==jt&&(S.owned?S.owned.push(o):S.owned=[o]),o}function Kt(e){if(e.state===0)return;if(e.state===Te)return Re(e);if(e.suspense&&V(e.suspense.inFallback))return e.suspense.effects.push(e);const t=[e];for(;(e=e.owner)&&(!e.updatedAt||e.updatedAt<Ue);)e.state&&t.push(e);for(let n=t.length-1;n>=0;n--)if(e=t[n],e.state===ie)Me(e);else if(e.state===Te){const r=U;U=null,Q(()=>Re(e,t[0]),!1),U=r}}function Q(e,t){if(U)return e();let n=!1;t||(U=[]),se?n=!0:se=[],Ue++;try{const r=e();return jn(n),r}catch(r){n||(se=null),U=null,ct(r)}}function jn(e){if(U&&(Wt(U),U=null),e)return;const t=se;se=null,t.length&&Q(()=>kn(t),!1)}function Wt(e){for(let t=0;t<e.length;t++)Kt(e[t])}function Re(e,t){e.state=0;for(let n=0;n<e.sources.length;n+=1){const r=e.sources[n];if(r.sources){const s=r.state;s===ie?r!==t&&(!r.updatedAt||r.updatedAt<Ue)&&Kt(r):s===Te&&Re(r,t)}}}function zt(e){for(let t=0;t<e.observers.length;t+=1){const n=e.observers[t];n.state||(n.state=Te,n.pure?U.push(n):se.push(n),n.observers&&zt(n))}}function me(e){let t;if(e.sources)for(;e.sources.length;){const n=e.sources.pop(),r=e.sourceSlots.pop(),s=n.observers;if(s&&s.length){const o=s.pop(),i=n.observerSlots.pop();r<s.length&&(o.sourceSlots[i]=r,s[r]=o,n.observerSlots[r]=i)}}if(e.tOwned){for(t=e.tOwned.length-1;t>=0;t--)me(e.tOwned[t]);delete e.tOwned}if(e.owned){for(t=e.owned.length-1;t>=0;t--)me(e.owned[t]);e.owned=null}if(e.cleanups){for(t=e.cleanups.length-1;t>=0;t--)e.cleanups[t]();e.cleanups=null}e.state=0}function Un(e){return e instanceof Error?e:new Error(typeof e=="string"?e:"Unknown error",{cause:e})}function ct(e,t=S){throw Un(e)}function Ye(e){if(typeof e=="function"&&!e.length)return Ye(e());if(Array.isArray(e)){const t=[];for(let n=0;n<e.length;n++){const r=Ye(e[n]);Array.isArray(r)?t.push.apply(t,r):t.push(r)}return t}return e}function Mn(e,t){return function(r){let s;return re(()=>s=V(()=>(S.context={...S.context,[e]:r.value},at(()=>r.children))),void 0),s}}function J(e,t){return V(()=>e(t||{}))}function we(){return!0}const Qe={get(e,t,n){return t===ke?n:e.get(t)},has(e,t){return t===ke?!0:e.has(t)},set:we,deleteProperty:we,getOwnPropertyDescriptor(e,t){return{configurable:!0,enumerable:!0,get(){return e.get(t)},set:we,deleteProperty:we}},ownKeys(e){return e.keys()}};function We(e){return(e=typeof e=="function"?e():e)?e:{}}function Fn(){for(let e=0,t=this.length;e<t;++e){const n=this[e]();if(n!==void 0)return n}}function Ze(...e){let t=!1;for(let i=0;i<e.length;i++){const l=e[i];t=t||!!l&&ke in l,e[i]=typeof l=="function"?(t=!0,T(l)):l}if(Nt&&t)return new Proxy({get(i){for(let l=e.length-1;l>=0;l--){const a=We(e[l])[i];if(a!==void 0)return a}},has(i){for(let l=e.length-1;l>=0;l--)if(i in We(e[l]))return!0;return!1},keys(){const i=[];for(let l=0;l<e.length;l++)i.push(...Object.keys(We(e[l])));return[...new Set(i)]}},Qe);const n={},r=Object.create(null);for(let i=e.length-1;i>=0;i--){const l=e[i];if(!l)continue;const a=Object.getOwnPropertyNames(l);for(let c=a.length-1;c>=0;c--){const f=a[c];if(f==="__proto__"||f==="constructor")continue;const u=Object.getOwnPropertyDescriptor(l,f);if(!r[f])r[f]=u.get?{enumerable:!0,configurable:!0,get:Fn.bind(n[f]=[u.get.bind(l)])}:u.value!==void 0?u:void 0;else{const h=n[f];h&&(u.get?h.push(u.get.bind(l)):u.value!==void 0&&h.push(()=>u.value))}}}const s={},o=Object.keys(r);for(let i=o.length-1;i>=0;i--){const l=o[i],a=r[l];a&&a.get?Object.defineProperty(s,l,a):s[l]=a?a.value:void 0}return s}function Bn(e,...t){const n=t.length;if(Nt&&ke in e){const s=n>1?t.flat():t[0],o=t.map(i=>new Proxy({get(l){return i.includes(l)?e[l]:void 0},has(l){return i.includes(l)&&l in e},keys(){return i.filter(l=>l in e)}},Qe));return o.push(new Proxy({get(i){return s.includes(i)?void 0:e[i]},has(i){return s.includes(i)?!1:i in e},keys(){return Object.keys(e).filter(i=>!s.includes(i))}},Qe)),o}const r=[];for(let s=0;s<=n;s++)r[s]={};for(const s of Object.getOwnPropertyNames(e)){let o=n;for(let a=0;a<t.length;a++)if(t[a].includes(s)){o=a;break}const i=Object.getOwnPropertyDescriptor(e,s);!i.get&&!i.set&&i.enumerable&&i.writable&&i.configurable?r[o][s]=i.value:Object.defineProperty(r[o],s,i)}return r}const Vn=e=>`Stale read from <${e}>.`;function Gt(e){const t=e.keyed,n=T(()=>e.when,void 0,void 0),r=t?n:T(n,void 0,{equals:(s,o)=>!s==!o});return T(()=>{const s=r();if(s){const o=e.children;return typeof o=="function"&&o.length>0?V(()=>o(t?s:()=>{if(!V(r))throw Vn("Show");return n()})):o}return e.fallback},void 0,void 0)}const qn=["allowfullscreen","async","alpha","autofocus","autoplay","checked","controls","default","disabled","formnovalidate","hidden","indeterminate","inert","ismap","loop","multiple","muted","nomodule","novalidate","open","playsinline","readonly","required","reversed","seamless","selected","adauctionheaders","browsingtopics","credentialless","defaultchecked","defaultmuted","defaultselected","defer","disablepictureinpicture","disableremoteplayback","preservespitch","shadowrootclonable","shadowrootcustomelementregistry","shadowrootdelegatesfocus","shadowrootserializable","sharedstoragewritable"],Hn=new Set(["className","value","readOnly","noValidate","formNoValidate","isMap","noModule","playsInline","adAuctionHeaders","allowFullscreen","browsingTopics","defaultChecked","defaultMuted","defaultSelected","disablePictureInPicture","disableRemotePlayback","preservesPitch","shadowRootClonable","shadowRootCustomElementRegistry","shadowRootDelegatesFocus","shadowRootSerializable","sharedStorageWritable",...qn]),Kn=new Set(["innerHTML","textContent","innerText","children"]),Wn=Object.assign(Object.create(null),{className:"class",htmlFor:"for"}),zn=Object.assign(Object.create(null),{class:"className",novalidate:{$:"noValidate",FORM:1},formnovalidate:{$:"formNoValidate",BUTTON:1,INPUT:1},ismap:{$:"isMap",IMG:1},nomodule:{$:"noModule",SCRIPT:1},playsinline:{$:"playsInline",VIDEO:1},readonly:{$:"readOnly",INPUT:1,TEXTAREA:1},adauctionheaders:{$:"adAuctionHeaders",IFRAME:1},allowfullscreen:{$:"allowFullscreen",IFRAME:1},browsingtopics:{$:"browsingTopics",IMG:1},defaultchecked:{$:"defaultChecked",INPUT:1},defaultmuted:{$:"defaultMuted",AUDIO:1,VIDEO:1},defaultselected:{$:"defaultSelected",OPTION:1},disablepictureinpicture:{$:"disablePictureInPicture",VIDEO:1},disableremoteplayback:{$:"disableRemotePlayback",AUDIO:1,VIDEO:1},preservespitch:{$:"preservesPitch",AUDIO:1,VIDEO:1},shadowrootclonable:{$:"shadowRootClonable",TEMPLATE:1},shadowrootdelegatesfocus:{$:"shadowRootDelegatesFocus",TEMPLATE:1},shadowrootserializable:{$:"shadowRootSerializable",TEMPLATE:1},sharedstoragewritable:{$:"sharedStorageWritable",IFRAME:1,IMG:1}});function Gn(e,t){const n=zn[e];return typeof n=="object"?n[t]?n.$:void 0:n}const Jn=new Set(["beforeinput","click","dblclick","contextmenu","focusin","focusout","input","keydown","keyup","mousedown","mousemove","mouseout","mouseover","mouseup","pointerdown","pointermove","pointerout","pointerover","pointerup","touchend","touchmove","touchstart"]),Xn=e=>T(()=>e());function Yn(e,t,n){let r=n.length,s=t.length,o=r,i=0,l=0,a=t[s-1].nextSibling,c=null;for(;i<s||l<o;){if(t[i]===n[l]){i++,l++;continue}for(;t[s-1]===n[o-1];)s--,o--;if(s===i){const f=o<r?l?n[l-1].nextSibling:n[o-l]:a;for(;l<o;)e.insertBefore(n[l++],f)}else if(o===l)for(;i<s;)(!c||!c.has(t[i]))&&t[i].remove(),i++;else if(t[i]===n[o-1]&&n[l]===t[s-1]){const f=t[--s].nextSibling;e.insertBefore(n[l++],t[i++].nextSibling),e.insertBefore(n[--o],f),t[s]=n[o]}else{if(!c){c=new Map;let u=l;for(;u<o;)c.set(n[u],u++)}const f=c.get(t[i]);if(f!=null)if(l<f&&f<o){let u=i,h=1,d;for(;++u<s&&u<o&&!((d=c.get(t[u]))==null||d!==f+h);)h++;if(h>f-l){const g=t[i];for(;l<f;)e.insertBefore(n[l++],g)}else e.replaceChild(n[l++],t[i++])}else i++;else t[i++].remove()}}}const bt="_$DX_DELEGATE";function Qn(e,t,n,r){let s;const o=()=>{const l=r?document.createElementNS("http://www.w3.org/1998/Math/MathML","template"):document.createElement("template");return l.innerHTML=e,n?l.content.firstChild.firstChild:r?l.firstChild:l.content.firstChild},i=t?()=>V(()=>document.importNode(s||(s=o()),!0)):()=>(s||(s=o())).cloneNode(!0);return i.cloneNode=i,i}function Jt(e,t=window.document){const n=t[bt]||(t[bt]=new Set);for(let r=0,s=e.length;r<s;r++){const o=e[r];n.has(o)||(n.add(o),t.addEventListener(o,as))}}function et(e,t,n){n==null?e.removeAttribute(t):e.setAttribute(t,n)}function Zn(e,t,n){n?e.setAttribute(t,""):e.removeAttribute(t)}function es(e,t){t==null?e.removeAttribute("class"):e.className=t}function ts(e,t,n,r){if(r)Array.isArray(n)?(e[`$$${t}`]=n[0],e[`$$${t}Data`]=n[1]):e[`$$${t}`]=n;else if(Array.isArray(n)){const s=n[0];e.addEventListener(t,n[0]=o=>s.call(e,n[1],o))}else e.addEventListener(t,n,typeof n!="function"&&n)}function ns(e,t,n={}){const r=Object.keys(t||{}),s=Object.keys(n);let o,i;for(o=0,i=s.length;o<i;o++){const l=s[o];!l||l==="undefined"||t[l]||(wt(e,l,!1),delete n[l])}for(o=0,i=r.length;o<i;o++){const l=r[o],a=!!t[l];!l||l==="undefined"||n[l]===a||!a||(wt(e,l,!0),n[l]=a)}return n}function ss(e,t,n){if(!t)return n?et(e,"style"):t;const r=e.style;if(typeof t=="string")return r.cssText=t;typeof n=="string"&&(r.cssText=n=void 0),n||(n={}),t||(t={});let s,o;for(o in n)t[o]==null&&r.removeProperty(o),delete n[o];for(o in t)s=t[o],s!==n[o]&&(r.setProperty(o,s),n[o]=s);return n}function rs(e,t={},n,r){const s={};return re(()=>s.children=tt(e,t.children,s.children)),re(()=>typeof t.ref=="function"&&os(t.ref,e)),re(()=>is(e,t,n,!0,s,!0)),s}function os(e,t,n){return V(()=>e(t,n))}function is(e,t,n,r,s={},o=!1){t||(t={});for(const i in s)if(!(i in t)){if(i==="children")continue;s[i]=$t(e,i,null,s[i],n,o,t)}for(const i in t){if(i==="children")continue;const l=t[i];s[i]=$t(e,i,l,s[i],n,o,t)}}function ls(e){return e.toLowerCase().replace(/-([a-z])/g,(t,n)=>n.toUpperCase())}function wt(e,t,n){const r=t.trim().split(/\\s+/);for(let s=0,o=r.length;s<o;s++)e.classList.toggle(r[s],n)}function $t(e,t,n,r,s,o,i){let l,a,c,f,u;if(t==="style")return ss(e,n,r);if(t==="classList")return ns(e,n,r);if(n===r)return r;if(t==="ref")o||n(e);else if(t.slice(0,3)==="on:"){const h=t.slice(3);r&&e.removeEventListener(h,r,typeof r!="function"&&r),n&&e.addEventListener(h,n,typeof n!="function"&&n)}else if(t.slice(0,10)==="oncapture:"){const h=t.slice(10);r&&e.removeEventListener(h,r,!0),n&&e.addEventListener(h,n,!0)}else if(t.slice(0,2)==="on"){const h=t.slice(2).toLowerCase(),d=Jn.has(h);if(!d&&r){const g=Array.isArray(r)?r[0]:r;e.removeEventListener(h,g)}(d||n)&&(ts(e,h,n,d),d&&Jt([h]))}else t.slice(0,5)==="attr:"?et(e,t.slice(5),n):t.slice(0,5)==="bool:"?Zn(e,t.slice(5),n):(u=t.slice(0,5)==="prop:")||(c=Kn.has(t))||(f=Gn(t,e.tagName))||(a=Hn.has(t))||(l=e.nodeName.includes("-")||"is"in i)?(u&&(t=t.slice(5),a=!0),t==="class"||t==="className"?es(e,n):l&&!a&&!c?e[ls(t)]=n:e[f||t]=n):et(e,Wn[t]||t,n);return n}function as(e){let t=e.target;const n=`$$${e.type}`,r=e.target,s=e.currentTarget,o=a=>Object.defineProperty(e,"target",{configurable:!0,value:a}),i=()=>{const a=t[n];if(a&&!t.disabled){const c=t[`${n}Data`];if(c!==void 0?a.call(t,c,e):a.call(t,e),e.cancelBubble)return}return t.host&&typeof t.host!="string"&&!t.host._$host&&t.contains(e.target)&&o(t.host),!0},l=()=>{for(;i()&&(t=t._$host||t.parentNode||t.host););};if(Object.defineProperty(e,"currentTarget",{configurable:!0,get(){return t||document}}),e.composedPath){const a=e.composedPath();o(a[0]);for(let c=0;c<a.length-2&&(t=a[c],!!i());c++){if(t._$host){t=t._$host,l();break}if(t.parentNode===s)break}}else l();o(r)}function tt(e,t,n,r,s){for(;typeof n=="function";)n=n();if(t===n)return n;const o=typeof t;if(e=e,o==="string"||o==="number"){if(o==="number"&&(t=t.toString(),t===n))return n;n!==""&&typeof n=="string"?n=e.firstChild.data=t:n=e.textContent=t}else if(t==null||o==="boolean")n=$e(e,n,r);else{if(o==="function")return re(()=>{let i=t();for(;typeof i=="function";)i=i();n=tt(e,i,n,r)}),()=>n;if(Array.isArray(t)){const i=[],l=n&&Array.isArray(n);if(nt(i,t,n,s))return re(()=>n=tt(e,i,n,r,!0)),()=>n;i.length===0?n=$e(e,n,r):l?n.length===0?vt(e,i,r):Yn(e,n,i):(n&&$e(e),vt(e,i)),n=i}else t.nodeType&&(Array.isArray(n)?$e(e,n,null,t):n==null||n===""||!e.firstChild?e.appendChild(t):e.replaceChild(t,e.firstChild),n=t)}return n}function nt(e,t,n,r){let s=!1;for(let o=0,i=t.length;o<i;o++){let l=t[o],a=n&&n[e.length],c;if(!(l==null||l===!0||l===!1))if((c=typeof l)=="object"&&l.nodeType)e.push(l);else if(Array.isArray(l))s=nt(e,l,a)||s;else if(c==="function")if(r){for(;typeof l=="function";)l=l();s=nt(e,Array.isArray(l)?l:[l],Array.isArray(a)?a:[a])||s}else e.push(l),s=!0;else{const f=String(l);a&&a.nodeType===3&&a.data===f?e.push(a):e.push(document.createTextNode(f))}}return s}function vt(e,t,n=null){for(let r=0,s=t.length;r<s;r++)e.insertBefore(t[r],n)}function $e(e,t,n,r){if(n===void 0)return e.textContent="";const s=r||document.createTextNode("");if(t.length){let o=!1;for(let i=t.length-1;i>=0;i--){const l=t[i];if(s!==l){const a=l.parentNode===e;!o&&!i?a?e.replaceChild(s,l):e.insertBefore(s,n):a&&l.remove()}else o=!0}}else e.insertBefore(s,n);return[s]}const cs=!1;function Xt(){let e=new Set;function t(s){return e.add(s),()=>e.delete(s)}let n=!1;function r(s,o){if(n)return!(n=!1);const i={to:s,options:o,defaultPrevented:!1,preventDefault:()=>i.defaultPrevented=!0};for(const l of e)l.listener({...i,from:l.location,retry:a=>{a&&(n=!0),l.navigate(s,{...o,resolve:!1})}});return!i.defaultPrevented}return{subscribe:t,confirm:r}}let st;function ut(){(!window.history.state||window.history.state._depth==null)&&window.history.replaceState({...window.history.state,_depth:window.history.length-1},""),st=window.history.state._depth}ut();function us(e){return{...e,_depth:window.history.state&&window.history.state._depth}}function fs(e,t){let n=!1;return()=>{const r=st;ut();const s=r==null?null:st-r;if(n){n=!1;return}s&&t(s)?(n=!0,window.history.go(-s)):e()}}const ds=/^(?:[a-z0-9]+:)?\\/\\//i,hs=/^\\/+|(\\/)\\/+$/g,Yt="http://sr";function oe(e,t=!1){const n=e.replace(hs,"$1");return n?t||/^[?#]/.test(n)?n:"/"+n:""}function Ae(e,t,n){if(ds.test(t))return;const r=oe(e),s=n&&oe(n);let o="";return!s||t.startsWith("/")?o=r:s.toLowerCase().indexOf(r.toLowerCase())!==0?o=r+s:o=s,(o||"/")+oe(t,!o)}function gs(e,t){if(e==null)throw new Error(t);return e}function ms(e,t){return oe(e).replace(/\\/*(\\*.*)?$/g,"")+oe(t)}function Qt(e){const t={};return e.searchParams.forEach((n,r)=>{r in t?Array.isArray(t[r])?t[r].push(n):t[r]=[t[r],n]:t[r]=n}),t}function ps(e,t,n){const[r,s]=e.split("/*",2),o=r.split("/").filter(Boolean),i=o.length;return l=>{const a=l.split("/").filter(Boolean),c=a.length-i;if(c<0||c>0&&s===void 0&&!t)return null;const f={path:i?"":"/",params:{}},u=h=>n===void 0?void 0:n[h];for(let h=0;h<i;h++){const d=o[h],g=d[0]===":",m=g?a[h]:a[h].toLowerCase(),p=g?d.slice(1):d.toLowerCase();if(g&&ze(m,u(p)))f.params[p]=m;else if(g||!ze(m,p))return null;f.path+=`/${m}`}if(s){const h=c?a.slice(-c).join("/"):"";if(ze(h,u(s)))f.params[s]=h;else return null}return f}}function ze(e,t){const n=r=>r===e;return t===void 0?!0:typeof t=="string"?n(t):typeof t=="function"?t(e):Array.isArray(t)?t.some(n):t instanceof RegExp?t.test(e):!1}function ys(e){const[t,n]=e.pattern.split("/*",2),r=t.split("/").filter(Boolean);return r.reduce((s,o)=>s+(o.startsWith(":")?2:3),r.length-(n===void 0?0:1))}function Zt(e){const t=new Map,n=Mt();return new Proxy({},{get(r,s){return t.has(s)||Ft(n,()=>t.set(s,T(()=>e()[s]))),t.get(s)()},getOwnPropertyDescriptor(){return{enumerable:!0,configurable:!0}},ownKeys(){return Reflect.ownKeys(e())}})}function en(e){let t=/(\\/?\\:[^\\/]+)\\?/.exec(e);if(!t)return[e];let n=e.slice(0,t.index),r=e.slice(t.index+t[0].length);const s=[n,n+=t[1]];for(;t=/^(\\/\\:[^\\/]+)\\?/.exec(r);)s.push(n+=t[1]),r=r.slice(t[0].length);return en(r).reduce((o,i)=>[...o,...s.map(l=>l+i)],[])}const bs=100,tn=Bt(),ft=Bt(),Fe=()=>gs(lt(tn),"<A> and \'use\' router primitives can be only used inside a Route."),ws=()=>lt(ft)||Fe().base,$s=e=>{const t=ws();return T(()=>t.resolvePath(e()))},vs=e=>{const t=Fe();return T(()=>{const n=e();return n!==void 0?t.renderPath(n):n})},Ss=()=>Fe().location,xs=()=>Fe().params;function As(e,t=""){const{component:n,preload:r,load:s,children:o,info:i}=e,l=!o||Array.isArray(o)&&!o.length,a={key:e,component:n,preload:r||s,info:i};return nn(e.path).reduce((c,f)=>{for(const u of en(f)){const h=ms(t,u);let d=l?h:h.split("/*",1)[0];d=d.split("/").map(g=>g.startsWith(":")||g.startsWith("*")?g:encodeURIComponent(g)).join("/"),c.push({...a,originalPath:f,pattern:d,matcher:ps(d,!l,e.matchFilters)})}return c},[])}function Cs(e,t=0){return{routes:e,score:ys(e[e.length-1])*1e4-t,matcher(n){const r=[];for(let s=e.length-1;s>=0;s--){const o=e[s],i=o.matcher(n);if(!i)return null;r.unshift({...i,route:o})}return r}}}function nn(e){return Array.isArray(e)?e:[e]}function sn(e,t="",n=[],r=[]){const s=nn(e);for(let o=0,i=s.length;o<i;o++){const l=s[o];if(l&&typeof l=="object"){l.hasOwnProperty("path")||(l.path="");const a=As(l,t);for(const c of a){n.push(c);const f=Array.isArray(l.children)&&l.children.length===0;if(l.children&&!f)sn(l.children,c.pattern,n,r);else{const u=Cs([...n],r.length);r.push(u)}n.pop()}}}return n.length?r:r.sort((o,i)=>i.score-o.score)}function Ge(e,t){for(let n=0,r=e.length;n<r;n++){const s=e[n].matcher(t);if(s)return s}return[]}function Es(e,t,n){const r=new URL(Yt),s=T(f=>{const u=e();try{return new URL(u,r)}catch{return console.error(`Invalid path ${u}`),f}},r,{equals:(f,u)=>f.href===u.href}),o=T(()=>s().pathname),i=T(()=>s().search,!0),l=T(()=>s().hash),a=()=>"",c=it(i,()=>Qt(s()));return{get pathname(){return o()},get search(){return i()},get hash(){return l()},get state(){return t()},get key(){return a()},query:n?n(c):Zt(c)}}let ne;function _s(){return ne}function Ps(e,t,n,r={}){const{signal:[s,o],utils:i={}}=e,l=i.parsePath||(C=>C),a=i.renderPath||(C=>C),c=i.beforeLeave||Xt(),f=Ae("",r.base||"");if(f===void 0)throw new Error(`${f} is not a valid base path`);f&&!s().value&&o({value:f,replace:!0,scroll:!1});const[u,h]=ce(!1);let d;const g=(C,P)=>{P.value===m()&&P.state===$()||(d===void 0&&h(!0),ne=C,d=P,Dn(()=>{d===P&&(p(d.value),b(d.state),x[1]([]))}).finally(()=>{d===P&&Rn(()=>{ne=void 0,C==="navigate"&&D(d),h(!1),d=void 0})}))},[m,p]=ce(s().value),[$,b]=ce(s().state),v=Es(m,$,i.queryWrapper),w=[],x=ce([]),k=T(()=>typeof r.transformUrl=="function"?Ge(t(),r.transformUrl(v.pathname)):Ge(t(),v.pathname)),H=()=>{const C=k(),P={};for(let B=0;B<C.length;B++)Object.assign(P,C[B].params);return P},ee=i.paramsWrapper?i.paramsWrapper(H,t):Zt(H),L={pattern:f,path:()=>f,outlet:()=>null,resolvePath(C){return Ae(f,C)}};return re(it(s,C=>g("native",C),{defer:!0})),{base:L,location:v,params:ee,isRouting:u,renderPath:a,parsePath:l,navigatorFactory:M,matches:k,beforeLeave:c,preloadRoute:te,singleFlight:r.singleFlight===void 0?!0:r.singleFlight,submissions:x};function O(C,P,B){V(()=>{if(typeof P=="number"){P&&(i.go?i.go(P):console.warn("Router integration does not support relative routing"));return}const ye=!P||P[0]==="?",{replace:Be,resolve:le,scroll:Ve,state:de}={replace:!1,resolve:!ye,scroll:!0,...B},be=le?C.resolvePath(P):Ae(ye&&v.pathname||"",P);if(be===void 0)throw new Error(`Path \'${P}\' is not a routable path`);if(w.length>=bs)throw new Error("Too many redirects");const gt=m();(be!==gt||de!==$())&&(cs||c.confirm(be,B)&&(w.push({value:gt,replace:Be,scroll:Ve,state:$()}),g("navigate",{value:be,state:de})))})}function M(C){return C=C||lt(ft)||L,(P,B)=>O(C,P,B)}function D(C){const P=w[0];P&&(o({...C,replace:P.replace,scroll:P.scroll}),w.length=0)}function te(C,P){const B=Ge(t(),C.pathname),ye=ne;ne="preload";for(let Be in B){const{route:le,params:Ve}=B[Be];le.component&&le.component.preload&&le.component.preload();const{preload:de}=le;P&&de&&Ft(n(),()=>de({params:Ve,location:{pathname:C.pathname,search:C.search,hash:C.hash,query:Qt(C),state:null,key:""},intent:"preload"}))}ne=ye}}function Is(e,t,n,r){const{base:s,location:o,params:i}=e,{pattern:l,component:a,preload:c}=r().route,f=T(()=>r().path);a&&a.preload&&a.preload();const u=c?c({params:i,location:o,intent:ne||"initial"}):void 0;return{parent:t,pattern:l,path:f,outlet:()=>a?J(a,{params:i,location:o,data:u,get children(){return n()}}):n(),resolvePath(d){return Ae(s.path(),d,f())}}}const Os=e=>t=>{const{base:n}=t,r=at(()=>t.children),s=T(()=>sn(r(),t.base||""));let o;const i=Ps(e,s,()=>o,{base:n,singleFlight:t.singleFlight,transformUrl:t.transformUrl});return e.create&&e.create(i),J(tn.Provider,{value:i,get children(){return J(ks,{routerState:i,get root(){return t.root},get preload(){return t.rootPreload||t.rootLoad},get children(){return[Xn(()=>(o=Mt())&&null),J(Ls,{routerState:i,get branches(){return s()}})]}})}})};function ks(e){const t=e.routerState.location,n=e.routerState.params,r=T(()=>e.preload&&V(()=>{e.preload({params:n,location:t,intent:_s()||"initial"})}));return J(Gt,{get when(){return e.root},keyed:!0,get fallback(){return e.children},children:s=>J(s,{params:n,location:t,get data(){return r()},get children(){return e.children}})})}function Ls(e){const t=[];let n;const r=T(it(e.routerState.matches,(s,o,i)=>{let l=o&&s.length===o.length;const a=[];for(let c=0,f=s.length;c<f;c++){const u=o&&o[c],h=s[c];i&&u&&h.route.key===u.route.key?a[c]=i[c]:(l=!1,t[c]&&t[c](),Tn(d=>{t[c]=d,a[c]=Is(e.routerState,a[c-1]||e.routerState.base,St(()=>r()[c+1]),()=>e.routerState.matches()[c])}))}return t.splice(s.length).forEach(c=>c()),i&&l?i:(n=a[0],a)}));return St(()=>r()&&n)()}const St=e=>()=>J(Gt,{get when(){return e()},keyed:!0,children:t=>J(ft.Provider,{value:t,get children(){return t.outlet()}})}),xt=e=>{const t=at(()=>e.children);return Ze(e,{get children(){return t()}})};function Ts([e,t],n,r){return[e,r?s=>t(r(s)):t]}function Rs(e){let t=!1;const n=s=>typeof s=="string"?{value:s}:s,r=Ts(ce(n(e.get()),{equals:(s,o)=>s.value===o.value&&s.state===o.state}),void 0,s=>(!t&&e.set(s),s));return e.init&&Ut(e.init((s=e.get())=>{t=!0,r[1](n(s)),t=!1})),Os({signal:r,create:e.create,utils:e.utils})}function Ds(e,t,n){return e.addEventListener(t,n),()=>e.removeEventListener(t,n)}function Ns(e,t){const n=e&&document.getElementById(e);n?n.scrollIntoView():t&&window.scrollTo(0,0)}const js=new Map;function Us(e=!0,t=!1,n="/_server",r){return s=>{const o=s.base.path(),i=s.navigatorFactory(s.base);let l,a;function c(m){return m.namespaceURI==="http://www.w3.org/2000/svg"}function f(m){if(m.defaultPrevented||m.button!==0||m.metaKey||m.altKey||m.ctrlKey||m.shiftKey)return;const p=m.composedPath().find(k=>k instanceof Node&&k.nodeName.toUpperCase()==="A");if(!p||t&&!p.hasAttribute("link"))return;const $=c(p),b=$?p.href.baseVal:p.href;if(($?p.target.baseVal:p.target)||!b&&!p.hasAttribute("state"))return;const w=(p.getAttribute("rel")||"").split(/\\s+/);if(p.hasAttribute("download")||w&&w.includes("external"))return;const x=$?new URL(b,document.baseURI):new URL(b);if(!(x.origin!==window.location.origin||o&&x.pathname&&!x.pathname.toLowerCase().startsWith(o.toLowerCase())))return[p,x]}function u(m){const p=f(m);if(!p)return;const[$,b]=p,v=s.parsePath(b.pathname+b.search+b.hash),w=$.getAttribute("state");m.preventDefault(),i(v,{resolve:!1,replace:$.hasAttribute("replace"),scroll:!$.hasAttribute("noscroll"),state:w?JSON.parse(w):void 0})}function h(m){const p=f(m);if(!p)return;const[$,b]=p;r&&(b.pathname=r(b.pathname)),s.preloadRoute(b,$.getAttribute("preload")!=="false")}function d(m){clearTimeout(l);const p=f(m);if(!p)return a=null;const[$,b]=p;a!==$&&(r&&(b.pathname=r(b.pathname)),l=setTimeout(()=>{s.preloadRoute(b,$.getAttribute("preload")!=="false"),a=$},20))}function g(m){if(m.defaultPrevented)return;let p=m.submitter&&m.submitter.hasAttribute("formaction")?m.submitter.getAttribute("formaction"):m.target.getAttribute("action");if(!p)return;if(!p.startsWith("https://action/")){const b=new URL(p,Yt);if(p=s.parsePath(b.pathname+b.search),!p.startsWith(n))return}if(m.target.method.toUpperCase()!=="POST")throw new Error("Only POST forms are supported for Actions");const $=js.get(p);if($){m.preventDefault();const b=new FormData(m.target,m.submitter);$.call({r:s,f:m.target},m.target.enctype==="multipart/form-data"?b:new URLSearchParams(b))}}Jt(["click","submit"]),document.addEventListener("click",u),e&&(document.addEventListener("mousemove",d,{passive:!0}),document.addEventListener("focusin",h,{passive:!0}),document.addEventListener("touchstart",h,{passive:!0})),document.addEventListener("submit",g),Ut(()=>{document.removeEventListener("click",u),e&&(document.removeEventListener("mousemove",d),document.removeEventListener("focusin",h),document.removeEventListener("touchstart",h)),document.removeEventListener("submit",g)})}}function Ms(e){const t=()=>{const r=window.location.pathname.replace(/^\\/+/,"/")+window.location.search,s=window.history.state&&window.history.state._depth&&Object.keys(window.history.state).length===1?void 0:window.history.state;return{value:r+window.location.hash,state:s}},n=Xt();return Rs({get:t,set({value:r,replace:s,scroll:o,state:i}){s?window.history.replaceState(us(i),"",r):window.history.pushState(i,"",r),Ns(decodeURIComponent(window.location.hash.slice(1)),o),ut()},init:r=>Ds(window,"popstate",fs(r,s=>{if(s&&s<0)return!n.confirm(s);{const o=t();return!n.confirm(o.value,{state:o.state})}})),create:Us(e.preload,e.explicitLinks,e.actionBase,e.transformUrl),utils:{go:r=>window.history.go(r),beforeLeave:n}})(e)}var Fs=Qn("<a>");function rn(e){e=Ze({inactiveClass:"inactive",activeClass:"active"},e);const[,t]=Bn(e,["href","state","class","activeClass","inactiveClass","end"]),n=$s(()=>e.href),r=vs(n),s=Ss(),o=T(()=>{const i=n();if(i===void 0)return[!1,!1];const l=oe(i.split(/[?#]/,1)[0]).toLowerCase(),a=decodeURI(oe(s.pathname).toLowerCase());return[e.end?l===a:a.startsWith(l+"/")||a===l,l===a]});return(()=>{var i=Fs();return rs(i,Ze(t,{get href(){return r()||e.href},get state(){return JSON.stringify(e.state)},get classList(){return{...e.class&&{[e.class]:!0},[e.inactiveClass]:!o()[0],[e.activeClass]:o()[0],...t.classList}},link:"",get"aria-current"(){return o()[1]?"page":void 0}}),!1),i})()}async function ve(e){if(!e.ok){const t=await e.json().catch(()=>({}));throw new Error(t.error||`HTTP ${e.status}`)}return e.json()}const he={list:()=>fetch("/gui/api/sandbox-sessions").then(e=>ve(e)),get:e=>fetch(`/gui/api/sandbox-session/${At(e)}`).then(t=>ve(t)),create:e=>fetch("/gui/api/sandbox-create",{method:"POST",headers:Bs,body:JSON.stringify(e)}).then(t=>ve(t)),destroy:e=>fetch(`/gui/api/sandbox-session/${At(e)}`,{method:"DELETE"}).then(t=>ve(t))},Bs={"Content-Type":"application/json"},At=encodeURIComponent,on="takos-lang",Vs={actions:"Actions",active:"active",autoRefresh:"Auto-refresh: every 10s",backToDashboard:"Dashboard",cancel:"Cancel",commandPlaceholder:"command...",create:"Create",createFailed:"Create failed: {message}",createSandboxSession:"Create Sandbox Session",creating:"Creating...",created:"Created",delete:"Delete",destroy:"Destroy",destroyCurrentConfirm:"Destroy this sandbox session?",destroySessionConfirm:\'Destroy sandbox session "{id}"?\',emptyDirectory:"Empty directory",error:"Error: {message}",files:"Files",justNow:"just now",language:"Language",loading:"loading",loadingEllipsis:"Loading...",noProcesses:"No processes",noSessions:"No sessions",open:"Open",processes:"Processes",refresh:"Refresh",sandbox:"Sandbox:",sandboxSession:"+ Sandbox Session",sessionId:"Session ID",sessionIdPlaceholder:"e.g. my-session-01",space:"Space",spaceId:"Space ID",spaceIdPlaceholder:"e.g. space-abc",status:"Status",starting:"starting",stopped:"stopped",timeAgoDays:"{count}d ago",timeAgoHours:"{count}h ago",timeAgoMinutes:"{count}m ago",timedOut:"(timed out)",typeCommandHint:`Type a command and press Enter.\n`,userId:"User ID",userIdPlaceholder:"e.g. user-123"},qs={actions:"\u64CD\u4F5C",active:"\u7A3C\u50CD\u4E2D",autoRefresh:"\u81EA\u52D5\u66F4\u65B0: 10 \u79D2\u3054\u3068",backToDashboard:"\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9",cancel:"\u30AD\u30E3\u30F3\u30BB\u30EB",commandPlaceholder:"\u30B3\u30DE\u30F3\u30C9...",create:"\u4F5C\u6210",createFailed:"\u4F5C\u6210\u306B\u5931\u6557\u3057\u307E\u3057\u305F: {message}",createSandboxSession:"\u30B5\u30F3\u30C9\u30DC\u30C3\u30AF\u30B9\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u4F5C\u6210",creating:"\u4F5C\u6210\u4E2D...",created:"\u4F5C\u6210\u65E5\u6642",delete:"\u524A\u9664",destroy:"\u7834\u68C4",destroyCurrentConfirm:"\u3053\u306E\u30B5\u30F3\u30C9\u30DC\u30C3\u30AF\u30B9\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u7834\u68C4\u3057\u307E\u3059\u304B\uFF1F",destroySessionConfirm:\'\u30B5\u30F3\u30C9\u30DC\u30C3\u30AF\u30B9\u30BB\u30C3\u30B7\u30E7\u30F3 "{id}" \u3092\u7834\u68C4\u3057\u307E\u3059\u304B\uFF1F\',emptyDirectory:"\u7A7A\u306E\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA",error:"\u30A8\u30E9\u30FC: {message}",files:"\u30D5\u30A1\u30A4\u30EB",justNow:"\u305F\u3063\u305F\u4ECA",language:"\u8A00\u8A9E",loading:"\u8AAD\u307F\u8FBC\u307F\u4E2D",loadingEllipsis:"\u8AAD\u307F\u8FBC\u307F\u4E2D...",noProcesses:"\u30D7\u30ED\u30BB\u30B9\u306F\u3042\u308A\u307E\u305B\u3093",noSessions:"\u30BB\u30C3\u30B7\u30E7\u30F3\u306F\u3042\u308A\u307E\u305B\u3093",open:"\u958B\u304F",processes:"\u30D7\u30ED\u30BB\u30B9",refresh:"\u66F4\u65B0",sandbox:"\u30B5\u30F3\u30C9\u30DC\u30C3\u30AF\u30B9:",sandboxSession:"+ \u30B5\u30F3\u30C9\u30DC\u30C3\u30AF\u30B9\u30BB\u30C3\u30B7\u30E7\u30F3",sessionId:"\u30BB\u30C3\u30B7\u30E7\u30F3 ID",sessionIdPlaceholder:"\u4F8B: my-session-01",space:"\u30B9\u30DA\u30FC\u30B9",spaceId:"\u30B9\u30DA\u30FC\u30B9 ID",spaceIdPlaceholder:"\u4F8B: space-abc",status:"\u72B6\u614B",starting:"\u8D77\u52D5\u4E2D",stopped:"\u505C\u6B62\u4E2D",timeAgoDays:"{count} \u65E5\u524D",timeAgoHours:"{count} \u6642\u9593\u524D",timeAgoMinutes:"{count} \u5206\u524D",timedOut:"(\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8)",typeCommandHint:`\u30B3\u30DE\u30F3\u30C9\u3092\u5165\u529B\u3057\u3066 Enter \u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002\n`,userId:"\u30E6\u30FC\u30B6\u30FC ID",userIdPlaceholder:"\u4F8B: user-123"},Ct={en:Vs,ja:qs};function Hs(){try{const t=globalThis.localStorage?.getItem(on);if(t==="ja"||t==="en")return t}catch{}return(globalThis.navigator?.language?.toLowerCase()??"").startsWith("ja")?"ja":"en"}const[dt,Ks]=N(Hs());function Ws(e,t){return t?e.replace(/\\{(\\w+)\\}/g,(n,r)=>{const s=t[r];return s===void 0?`{${r}}`:String(s)}):e}function ln(e){Ks(e);try{globalThis.localStorage?.setItem(on,e)}catch{}globalThis.document?.documentElement&&(globalThis.document.documentElement.lang=e)}function zs(e,t){const n=dt();return Ws(Ct[n][e]??Ct.en[e],t)}function Z(){return{language:dt,setLanguage:ln,t:zs}}ln(dt());var Gs=R("<div class=card><table class=session-table><thead><tr><th></th><th></th><th></th><th></th><th></th></tr></thead><tbody>"),Js=R(\'<tr><td class=mono style=font-size:0.8125rem></td><td><span></span></td><td style=font-size:0.8125rem;color:#94a3b8></td><td style=font-size:0.8125rem;color:#94a3b8></td><td><div class="flex gap-1"><button type=button class="btn btn-danger btn-sm">\'),Xs=R("<tr><td colspan=5 style=text-align:center;color:#64748b;padding:2rem>");const Ys=e=>e==="active"?"badge badge-active":e==="starting"?"badge badge-starting":"badge badge-stopped",Qs=e=>e==="active"||e==="starting"?e:"stopped";function Zs(e){const{t}=Z(),n=r=>{const s=Date.now()-new Date(r).getTime(),o=Math.floor(s/6e4);if(o<1)return t("justNow");if(o<60)return t("timeAgoMinutes",{count:o});const i=Math.floor(o/60);return i<24?t("timeAgoHours",{count:i}):t("timeAgoDays",{count:Math.floor(i/24)})};return(()=>{var r=Gs(),s=r.firstChild,o=s.firstChild,i=o.firstChild,l=i.firstChild,a=l.nextSibling,c=a.nextSibling,f=c.nextSibling,u=f.nextSibling,h=o.nextSibling;return y(l,()=>t("sessionId")),y(a,()=>t("status")),y(c,()=>t("space")),y(f,()=>t("created")),y(u,()=>t("actions")),y(h,A(z,{get when(){return!e.loading},get fallback(){return A(Et,{get text(){return t("loadingEllipsis")}})},get children(){return A(z,{get when(){return e.sessions.length>0},get fallback(){return A(Et,{get text(){return t("noSessions")}})},get children(){return A(pe,{get each(){return e.sessions},children:d=>(()=>{var g=Js(),m=g.firstChild,p=m.nextSibling,$=p.firstChild,b=p.nextSibling,v=b.nextSibling,w=v.nextSibling,x=w.firstChild,k=x.firstChild;return y(m,()=>d.sessionId),y($,()=>t(Qs(d.status))),y(b,()=>d.spaceId),y(v,()=>n(d.createdAt)),y(x,A(rn,{get href(){return`/sandbox/${encodeURIComponent(d.sessionId)}`},class:"btn btn-primary btn-sm",get children(){return t("open")}}),k),k.$$click=()=>e.onDestroy(d.sessionId),y(k,()=>t("delete")),F(()=>Dt($,Ys(d.status))),g})()})}})}})),r})()}function Et(e){return(()=>{var t=Xs(),n=t.firstChild;return y(n,()=>e.text),t})()}Y(["click"]);var er=R(\'<div class=modal-overlay><div class=modal-content><h2 style=font-size:1rem;font-weight:600;margin-bottom:1rem></h2><form><label></label><input name=sessionId required><label></label><input name=spaceId required><label></label><input name=userId required><div class="flex gap-2"style=justify-content:flex-end;margin-top:0.5rem><button type=button class="btn btn-ghost"></button><button type=submit class="btn btn-primary">\');function tr(e){const{t}=Z(),[n,r]=N(!1);let s;const o=async i=>{i.preventDefault(),r(!0);const l=new FormData(s),a={sessionId:l.get("sessionId"),spaceId:l.get("spaceId"),userId:l.get("userId")};try{await e.onCreate(a),s.reset(),e.onClose()}catch(c){alert(t("createFailed",{message:c instanceof Error?c.message:String(c)}))}finally{r(!1)}};return A(z,{get when(){return e.open},get children(){var i=er(),l=i.firstChild,a=l.firstChild,c=a.nextSibling,f=c.firstChild,u=f.nextSibling,h=u.nextSibling,d=h.nextSibling,g=d.nextSibling,m=g.nextSibling,p=m.nextSibling,$=p.firstChild,b=$.nextSibling;i.$$click=w=>{w.target===w.currentTarget&&e.onClose()},y(a,()=>t("createSandboxSession")),c.addEventListener("submit",o);var v=s;return typeof v=="function"?Je(v,c):s=c,y(f,()=>t("sessionId")),y(h,()=>t("spaceId")),y(g,()=>t("userId")),En($,"click",e.onClose),y($,()=>t("cancel")),y(b,(()=>{var w=Rt(()=>!!n());return()=>w()?t("creating"):t("create")})()),F(w=>{var x=t("sessionIdPlaceholder"),k=t("spaceIdPlaceholder"),H=t("userIdPlaceholder"),ee=n();return x!==w.e&&G(u,"placeholder",w.e=x),k!==w.t&&G(d,"placeholder",w.t=k),H!==w.a&&G(m,"placeholder",w.a=H),ee!==w.o&&(b.disabled=w.o=ee),w},{e:void 0,t:void 0,a:void 0,o:void 0}),i}})}Y(["click"]);var nr=R(\'<div class="inline-flex rounded-lg"style="border:1px solid #334155;background:#0f172a;padding:0.125rem">\'),sr=R(\'<button type=button class="btn btn-sm">\');const rr=[{label:"\u65E5\u672C\u8A9E",value:"ja"},{label:"English",value:"en"}];function an(){const{language:e,setLanguage:t,t:n}=Z();return(()=>{var r=nr();return y(r,A(pe,{each:rr,children:s=>(()=>{var o=sr();return o.$$click=()=>t(s.value),y(o,()=>s.label),F(i=>{var l=e()===s.value?"#334155":"transparent",a=e()===s.value?"#f1f5f9":"#94a3b8",c=e()===s.value;return l!==i.e&&Ie(o,"background",i.e=l),a!==i.t&&Ie(o,"color",i.t=a),c!==i.a&&G(o,"aria-pressed",i.a=c),i},{e:void 0,t:void 0,a:void 0}),o})()})),F(()=>G(r,"aria-label",n("language"))),r})()}Y(["click"]);var or=R(\'<div class=container><div class="flex items-center justify-between"style=margin-bottom:1.5rem><h1 style=font-size:1.25rem;font-weight:600>takos computer</h1></div><div class=flex style=justify-content:flex-end;margin-bottom:0.75rem><button type=button class="btn btn-primary"></button></div><div class=muted style=margin-top:0.75rem;font-size:0.6875rem>\');function ir(){const{t:e}=Z(),[t,n]=N(!1),[r,s]=N(0),o=()=>s(c=>c+1),[i]=Ne(()=>r(),()=>he.list()),l=setInterval(o,1e4);rt(()=>clearInterval(l));const a=async c=>{confirm(e("destroySessionConfirm",{id:c}))&&(await he.destroy(c),o())};return(()=>{var c=or(),f=c.firstChild;f.firstChild;var u=f.nextSibling,h=u.firstChild,d=u.nextSibling;return y(f,A(an,{}),null),h.$$click=()=>n(!0),y(h,()=>e("sandboxSession")),y(c,A(Zs,{get sessions(){return i()?.sessions??[]},get loading(){return i.loading},onDestroy:a}),d),y(d,()=>e("autoRefresh")),y(c,A(tr,{get open(){return t()},onClose:()=>n(!1),onCreate:async g=>{await he.create(g),o()}}),null),c})()}Y(["click"]);let lr=0;async function ht(e,t,n={}){const r=await fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",method:"tools/call",params:{name:t,arguments:n},id:++lr})});if(!r.ok)throw new Error(`MCP HTTP ${r.status}`);const s=await r.json();if(s.error)throw new Error(s.error.message||JSON.stringify(s.error));const o=s.result?.content;if(!o||!o.length)return null;const i=o[0];if(i.type==="text")try{return JSON.parse(i.text)}catch{return i.text}return i}var ar=R(\'<div style="background:#0f172a;border:1px solid #1e293b;border-radius:0.5rem;overflow:hidden"><div class=mono style=height:420px;overflow-y:auto;padding:0.75rem;font-size:0.8125rem;line-height:1.6;white-space:pre-wrap;word-break:break-all></div><div class=flex style="border-top:1px solid #1e293b"><span class=mono style="padding:0.5rem 0.75rem;color:#6ee7b7;font-size:0.8125rem">$</span><input class=mono autocomplete=off style="flex:1;background:transparent;border:none;outline:none;color:#e2e8f0;font-size:0.8125rem;padding:0.5rem 0.75rem 0.5rem 0">\'),cr=R("<span>");function ur(e){const{t}=Z(),[n,r]=N([{text:t("typeCommandHint"),color:"#64748b"}]),[s,o]=N([]),[i,l]=N(-1);let a,c;It(()=>{r(d=>d.length!==1?d:[{text:t("typeCommandHint"),color:"#64748b"}])});const f=(d,g)=>{r(m=>[...m,{text:d,color:g}]),requestAnimationFrame(()=>{c.scrollTop=c.scrollHeight})},u=async()=>{const d=a.value.trim();if(d){o(g=>[d,...g].slice(0,100)),l(-1),a.value="",f(`$ ${d}\n`,"#6ee7b7");try{const g=await ht(e.mcpUrl,"shell_exec",{command:d,cwd:e.cwd(),timeout_ms:3e4});g?.stdout&&f(g.stdout,"#e2e8f0"),g?.stderr&&f(g.stderr,"#fca5a5"),g?.timed_out?f(`${t("timedOut")}\n`,"#fcd34d"):g&&g.exit_code!==0&&f(`exit ${g.exit_code}\n`,"#64748b")}catch(g){f(`${t("error",{message:g instanceof Error?g.message:String(g)})}\n`,"#ef4444")}}},h=d=>{if(d.key==="Enter"){u();return}if(d.key==="ArrowUp"){d.preventDefault();const g=s();if(!g.length)return;const m=Math.min(i()+1,g.length-1);l(m),a.value=g[m]}if(d.key==="ArrowDown"){if(d.preventDefault(),i()<=0){l(-1),a.value="";return}const g=i()-1;l(g),a.value=s()[g]}};return mn(()=>a.focus()),(()=>{var d=ar(),g=d.firstChild,m=g.nextSibling,p=m.firstChild,$=p.nextSibling,b=c;typeof b=="function"?Je(b,g):c=g,y(g,A(pe,{get each(){return n()},children:w=>(()=>{var x=cr();return y(x,()=>w.text),F(k=>Ie(x,"color",w.color)),x})()})),$.$$keydown=h;var v=a;return typeof v=="function"?Je(v,$):a=$,G($,"spellcheck",!1),F(()=>G($,"placeholder",t("commandPlaceholder"))),d})()}Y(["keydown"]);var fr=R(\'<div><div class="flex gap-2 items-center"style=margin-bottom:0.5rem><span style=font-size:0.8125rem;font-weight:600></span><input class="input input-mono flex-1"style=font-size:0.8125rem><button type=button class="btn btn-ghost btn-sm"></button></div><div class=card style=max-height:240px;overflow-y:auto;font-size:0.8125rem>\'),dr=R("<div class=muted style=padding:1rem;text-align:center>"),hr=R("<div class=muted style=padding:0.75rem>"),gr=R(\'<span class="mono muted"style=font-size:0.75rem>\'),mr=R(\'<div class="flex gap-2 items-center"><span></span><span class=flex-1>\');function pr(e){return e<1024?e+" B":e<1024*1024?(e/1024).toFixed(1)+" K":(e/(1024*1024)).toFixed(1)+" M"}function yr(e){const{t}=Z(),[n,r]=N(0),[s]=Ne(()=>({cwd:e.cwd(),v:n()}),async({cwd:i})=>{const a=(await ht(e.mcpUrl,"file_list",{path:i}))?.entries??[];return a.sort((c,f)=>c.type==="directory"&&f.type!=="directory"?-1:c.type!=="directory"&&f.type==="directory"?1:c.name.localeCompare(f.name)),a}),o=i=>{const l=e.cwd().replace(/\\/+$/,"");e.setCwd(i===".."?l.replace(/\\/[^/]+$/,"")||"/":l+"/"+i)};return(()=>{var i=fr(),l=i.firstChild,a=l.firstChild,c=a.nextSibling,f=c.nextSibling,u=l.nextSibling;return y(a,()=>t("files")),c.$$keydown=h=>{h.key==="Enter"&&r(d=>d+1)},c.$$input=h=>e.setCwd(h.currentTarget.value),f.$$click=()=>r(h=>h+1),y(f,()=>t("refresh")),y(u,A(z,{get when(){return!s.loading},get fallback(){return(()=>{var h=dr();return y(h,()=>t("loadingEllipsis")),h})()},get children(){return A(z,{get when(){return(s()??[]).length>0},get fallback(){return(()=>{var h=hr();return y(h,()=>t("emptyDirectory")),h})()},get children(){return A(pe,{get each(){return s()},children:h=>(()=>{var d=mr(),g=d.firstChild,m=g.nextSibling;return d.$$click=()=>{h.type==="directory"&&o(h.name)},y(g,()=>h.type==="directory"?"\u{1F4C1}":"\u{1F4C4}"),y(m,()=>h.name),y(d,A(z,{get when(){return h.type==="file"},get children(){var p=gr();return y(p,()=>pr(h.size)),p}}),null),F(p=>{var $=`padding:0.375rem 0.75rem; border-bottom:1px solid #0f172a;${h.type==="directory"?"cursor:pointer":""}`,b=h.type==="directory"?"#60a5fa":"#e2e8f0";return p.e=_n(d,$,p.e),b!==p.t&&Ie(m,"color",p.t=b),p},{e:void 0,t:void 0}),d})()})}})}})),F(()=>c.value=e.cwd()),i})()}Y(["input","keydown","click"]);var br=R(\'<div><div class="flex gap-2 items-center"style=margin-bottom:0.5rem><span style=font-size:0.8125rem;font-weight:600></span><div class=flex-1></div><button type=button class="btn btn-ghost btn-sm"></button></div><div class=card style=max-height:180px;overflow-y:auto;font-size:0.8125rem>\'),wr=R("<div class=muted style=padding:1rem;text-align:center>"),$r=R("<div class=muted style=padding:0.75rem>"),vr=R(\'<div class="flex gap-2 items-center"style="padding:0.375rem 0.75rem;border-bottom:1px solid #0f172a"><span class="mono muted"style=min-width:3rem></span><span class="mono flex-1"style=overflow:hidden;text-overflow:ellipsis;white-space:nowrap></span><span class=muted style=font-size:0.75rem>% / <!>%\');function Sr(e){const{t}=Z(),[n,r]=N(0),[s]=Ne(()=>n(),async()=>(await ht(e.mcpUrl,"process_list"))?.processes??[]);return(()=>{var o=br(),i=o.firstChild,l=i.firstChild,a=l.nextSibling,c=a.nextSibling,f=i.nextSibling;return y(l,()=>t("processes")),c.$$click=()=>r(u=>u+1),y(c,()=>t("refresh")),y(f,A(z,{get when(){return!s.loading},get fallback(){return(()=>{var u=wr();return y(u,()=>t("loadingEllipsis")),u})()},get children(){return A(z,{get when(){return(s()??[]).length>0},get fallback(){return(()=>{var u=$r();return y(u,()=>t("noProcesses")),u})()},get children(){return A(pe,{get each(){return s()},children:u=>(()=>{var h=vr(),d=h.firstChild,g=d.nextSibling,m=g.nextSibling,p=m.firstChild,$=p.nextSibling;return $.nextSibling,y(d,()=>u.pid),y(g,()=>u.command),y(m,()=>u.cpu,p),y(m,()=>u.mem,$),h})()})}})}})),o})()}Y(["click"]);var xr=R(\'<div class=container><div class="flex gap-2 items-center"style=margin-bottom:0.75rem><div style=width:1px;height:1.5rem;background:#334155></div><span class="mono muted"style=font-size:0.8125rem> </span><div class=flex-1></div><span></span><button type=button class="btn btn-danger btn-sm"></button></div><div style=margin-top:0.75rem></div><div style=margin-top:0.75rem>\');function Ar(){const{t:e}=Z(),t=xs(),n=()=>t.id,r=()=>`/gui/api/sandbox-session/${encodeURIComponent(n())}/mcp`,[s,o]=N("/home/sandbox/workspace"),[i,l]=N(0),[a]=Ne(()=>i(),()=>he.get(n()).catch(()=>null)),c=setInterval(()=>l(d=>d+1),1e4);rt(()=>clearInterval(c));const f=()=>{const d=a()?.status;return d==="active"?"badge badge-active":d==="starting"?"badge badge-starting":"badge badge-stopped"},u=()=>{const d=a()?.status;return e(d==="active"||d==="starting"||d==="stopped"?d:"loading")},h=async()=>{confirm(e("destroyCurrentConfirm"))&&(await he.destroy(n()),location.href="/gui")};return(()=>{var d=xr(),g=d.firstChild,m=g.firstChild,p=m.nextSibling,$=p.firstChild,b=p.nextSibling,v=b.nextSibling,w=v.nextSibling,x=g.nextSibling,k=x.nextSibling;return y(g,A(rn,{href:"/",class:"btn btn-ghost btn-sm",get children(){return["\u2190 ",Rt(()=>e("backToDashboard"))]}}),m),y(p,()=>e("sandbox"),$),y(p,n,null),y(g,A(an,{}),v),y(v,u),w.$$click=h,y(w,()=>e("destroy")),y(d,A(ur,{get mcpUrl(){return r()},cwd:s}),x),y(x,A(yr,{get mcpUrl(){return r()},cwd:s,setCwd:o})),y(k,A(Sr,{get mcpUrl(){return r()}})),F(()=>Dt(v,f())),d})()}Y(["click"]);function Cr(){return A(Ms,{base:"/gui",get children(){return[A(xt,{path:"/",component:ir}),A(xt,{path:"/sandbox/:id",component:Ar})]}})}Cn(()=>A(Cr,{}),document.getElementById("app"));</script>\n    <style rel="stylesheet" crossorigin>*{box-sizing:border-box;margin:0}body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0}a{color:inherit}.container{max-width:960px;margin:0 auto;padding:1.5rem}.flex{display:flex}.gap-1{gap:.25rem}.gap-2{gap:.5rem}.gap-3{gap:.75rem}.items-center{align-items:center}.justify-between{justify-content:space-between}.flex-1{flex:1}.btn{display:inline-flex;align-items:center;justify-content:center;gap:.375rem;padding:.5rem 1rem;border:none;border-radius:.375rem;font-size:.8125rem;font-weight:500;cursor:pointer;transition:background .15s,opacity .15s;text-decoration:none}.btn:disabled{opacity:.5;cursor:not-allowed}.btn-primary{background:#2563eb;color:#fff}.btn-primary:hover:not(:disabled){background:#1d4ed8}.btn-ghost{background:transparent;color:#94a3b8}.btn-ghost:hover:not(:disabled){background:#1e293b;color:#f1f5f9}.btn-danger{background:#dc2626;color:#fff}.btn-danger:hover:not(:disabled){background:#b91c1c}.btn-sm{padding:.25rem .5rem;font-size:.75rem}.badge{display:inline-block;font-size:.625rem;font-weight:600;padding:.125rem .5rem;border-radius:9999px;text-transform:uppercase}.badge-active{background:#064e3b;color:#6ee7b7}.badge-starting{background:#78350f;color:#fcd34d}.badge-stopped{background:#7f1d1d;color:#fca5a5}.tab-btn{padding:.5rem 1rem;border:none;border-radius:.375rem .375rem 0 0;font-size:.8125rem;font-weight:500;cursor:pointer;transition:background .15s,color .15s;background:#1e293b;color:#94a3b8}.tab-btn:hover{background:#334155;color:#f1f5f9}.tab-btn.active{background:#334155;color:#f1f5f9;border-bottom:2px solid #3b82f6}.session-table{width:100%;border-collapse:collapse}.session-table th,.session-table td{padding:.625rem .75rem;text-align:left;border-bottom:1px solid #0f172a}.session-table th{font-size:.75rem;font-weight:500;color:#64748b;text-transform:uppercase;letter-spacing:.05em}.session-table tr:hover td{background:#ffffff05}.card{background:#1e293b;border-radius:.75rem;overflow:hidden}.input{width:100%;padding:.5rem .75rem;background:#0f172a;border:1px solid #334155;border-radius:.375rem;color:#e2e8f0;font-size:.8125rem;outline:none}.input:focus{border-color:#3b82f6}.input-mono{font-family:SF Mono,SFMono-Regular,Menlo,Consolas,monospace}.modal-overlay{position:fixed;inset:0;background:#0009;display:flex;align-items:center;justify-content:center;z-index:50}.modal-content{background:#1e293b;border:1px solid #334155;border-radius:.75rem;padding:1.5rem;width:100%;max-width:28rem}.modal-content label{display:block;font-size:.75rem;font-weight:500;color:#94a3b8;margin-bottom:.25rem}.modal-content input{width:100%;padding:.5rem .75rem;background:#0f172a;border:1px solid #334155;border-radius:.375rem;color:#e2e8f0;font-size:.8125rem;margin-bottom:.75rem;outline:none}.modal-content input:focus{border-color:#3b82f6}.nav-btn{display:inline-flex;align-items:center;justify-content:center;width:2rem;height:2rem;border:none;border-radius:.375rem;background:#1e293b;color:#94a3b8;font-size:1rem;cursor:pointer}.nav-btn:hover{background:#334155;color:#f1f5f9}.spinner{width:40px;height:40px;border:3px solid #334155;border-top-color:#3b82f6;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.muted{color:#64748b}.mono{font-family:SF Mono,SFMono-Regular,Menlo,Consolas,monospace}</style>\n  </head>\n  <body>\n    <div id="app"></div>\n  </body>\n</html>\n';

// packages/computer-hosts/src/gui/icon.ts
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

// packages/computer-hosts/src/container-runtime.ts
var LocalHostContainerRuntime = class {
  ctx;
  env;
  envVars = {};
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  /**
   * `@cloudflare/containers`'s `Container` exposes a `container` field with
   * a `getTcpPort()` method that proxies HTTP into the sandboxed container.
   * Declaring it here keeps the structural type identical between the
   * Cloudflare runtime and the local fallback so consumers never need a
   * platform-shim cast. The local fallback throws because it cannot host a
   * sidecar container; if this is invoked in local mode the operator
   * configuration is wrong.
   */
  get container() {
    throw new Error(
      "container.getTcpPort is unavailable in LocalHostContainerRuntime; run inside Cloudflare Workers with @cloudflare/containers installed"
    );
  }
  /**
   * Mirrors `@cloudflare/containers` `Container.getState()`. The real runtime
   * reports the container's lifecycle status; the local fallback reports
   * "stopped" because it cannot host a sidecar.
   */
  async getState() {
    return { status: "stopped" };
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
  } catch {
    return null;
  }
}
var runtimeModule = await importContainerRuntime();
var HostContainerRuntime = runtimeModule?.Container ?? LocalHostContainerRuntime;

// packages/computer-hosts/src/proxy-token.ts
function generateProxyToken() {
  return randomBase64UrlToken(32);
}

// packages/computer-hosts/src/sandbox-session-container.ts
var PROXY_TOKENS_STORAGE_KEY = "proxyTokens";
var SESSION_STATE_STORAGE_KEY = "sessionState";
function resolveContainerMcpAuthToken(env) {
  return env.MCP_AUTH_TOKEN || void 0;
}
function getDOStub(env, sessionId) {
  const id = env.SANDBOX_CONTAINER.idFromName(sessionId);
  return env.SANDBOX_CONTAINER.get(id);
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
    delete nextEnvVars.TAKOS_TOKEN;
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
  firstProxyToken() {
    if (!this.cachedTokens) return null;
    for (const token of this.cachedTokens.keys()) return token;
    return null;
  }
  async createSession(payload, options = {}) {
    await this.ensureSessionStateLoaded();
    await this.ensureProxyTokensLoaded();
    const existing = this.sessionState;
    if (existing && existing.status !== "stopped" && !options.force) {
      const ownerChanged = existing.userId !== payload.userId || existing.spaceId !== payload.spaceId;
      if (ownerChanged) {
        throw new Error("Session id already exists for a different owner");
      }
      const reusedToken = this.firstProxyToken();
      if (reusedToken) {
        await this.ensureContainerStarted();
        return { ok: true, proxyToken: reusedToken, reused: true };
      }
    }
    if (existing && options.force) {
      await Promise.allSettled([this.clearPersistedSession(), this.destroy()]);
    }
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
  /**
   * Start the container if it is not already running/healthy.
   *
   * The `@cloudflare/containers` framework stops a container after `sleepAfter`
   * (10m) idle via `onActivityExpired()`, but leaves DO `sessionState` intact,
   * so the session keeps reporting "active". `renewActivityTimeout()` only
   * moves the sleep deadline — it does NOT restart a stopped container. Without
   * this, a forward to a slept/crashed container hits a not-listening error and
   * the session is permanently broken (500) until an explicit destroy+recreate.
   */
  async ensureContainerStarted() {
    let healthy = false;
    try {
      healthy = this.container.running && (await this.getState()).status === "healthy";
    } catch {
      healthy = false;
    }
    if (healthy) return;
    await this.startAndWaitForPorts([8080]);
    if (this.sessionState && this.sessionState.status !== "active") {
      await this.persistSessionState({
        ...this.sessionState,
        status: "active"
      });
    }
  }
  /** Forward an HTTP request to the container. */
  async forwardToContainer(path, init) {
    await this.ensureSessionStateLoaded();
    this.applyContainerEnv();
    await this.ensureContainerStarted();
    this.renewActivityTimeout();
    const tcpPort = this.container.getTcpPort(8080);
    const request = new Request(`http://internal${path}`, init);
    return tcpPort.fetch(request.url, request);
  }
};

// packages/computer-hosts/src/sandbox-session-types.ts
var PUBLISHED_MCP_SCOPE_PREFIX = "pmcp-";
function isPublishedScopedId(id) {
  return id.startsWith(PUBLISHED_MCP_SCOPE_PREFIX);
}

// packages/computer-hosts/src/sandbox-host-auth.ts
var GUI_ADMIN_COOKIE = "takos_computer_admin_token";
var GUI_AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60;
function resolvePublishedMcpAuthToken(env) {
  return env.PUBLISHED_MCP_AUTH_TOKEN || void 0;
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
function extractBearerToken(c) {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    return token || null;
  }
  const headerToken = c.req.header("X-Proxy-Token")?.trim();
  if (headerToken) return headerToken;
  if (isGuiPath(new URL(c.req.url).pathname)) {
    return parseCookie(c.req.header("Cookie"), GUI_ADMIN_COOKIE);
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
function guiSessionOwnsSandbox(guiSession, state) {
  if (isPublishedScopedId(state.sessionId)) return false;
  if (guiSession.sub !== state.userId) return false;
  if (guiSession.spaceId && guiSession.spaceId !== state.spaceId) return false;
  return true;
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
  const adminCookie = parseCookie(c.req.header("Cookie"), GUI_ADMIN_COOKIE);
  if (adminCookie) {
    const auth = validateHostAdminToken(c, adminCookie);
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
  if (guiAppAuthRequired(c.env)) {
    return await requireGuiAppOrRedirect(c.env, c.req.raw);
  }
  return authError(c, 401, "Unauthorized");
}
async function resolveHostAdminScope(c) {
  if (isTrustedTakosRoutedRequest(c)) return { response: null, kind: "admin" };
  const token = extractBearerToken(c);
  const expected = c.env.SANDBOX_HOST_AUTH_TOKEN;
  if (token && expected && constantTimeEqual(token, expected)) {
    return { response: null, kind: "admin" };
  }
  if (isGuiPath(new URL(c.req.url).pathname) && guiAppAuthRequired(c.env)) {
    const auth = await requireGuiAppAuth(c.env, c.req.raw);
    if (auth) return { response: auth };
    const guiSession = await readGuiSession(c.env, c.req.raw);
    if (!guiSession) return { response: authError(c, 401, "Unauthorized") };
    return { response: null, kind: "gui", guiSession };
  }
  if (!expected) {
    return {
      response: authError(c, 503, "Sandbox host auth token is not configured")
    };
  }
  return { response: authError(c, 401, "Unauthorized") };
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
  const adminToken = c.env.SANDBOX_HOST_AUTH_TOKEN;
  if (token && adminToken && constantTimeEqual(token, adminToken)) return null;
  if (token) {
    const tokenInfo = await stub.verifyProxyToken(token);
    if (tokenInfo && tokenInfo.sessionId === sessionId) return null;
  }
  if (isGuiPath(new URL(c.req.url).pathname) && guiAppAuthRequired(c.env)) {
    const auth = await requireGuiAppAuth(c.env, c.req.raw);
    if (auth) return auth;
    const guiSession = await readGuiSession(c.env, c.req.raw);
    if (!guiSession) return authError(c, 401, "Unauthorized");
    if (isPublishedScopedId(sessionId)) return authError(c, 403, "Forbidden");
    const state = await stub.getSessionState();
    if (!state || !guiSessionOwnsSandbox(guiSession, state)) {
      return authError(c, 403, "Forbidden");
    }
    return null;
  }
  return authError(c, 401, "Unauthorized");
}

// packages/computer-hosts/src/session-index.ts
var SESSION_INDEX_GLOBAL_PREFIX = "session:";
function ownerSegment(userId) {
  return encodeURIComponent(userId);
}
function sessionIndexKey(input) {
  return `${SESSION_INDEX_GLOBAL_PREFIX}${ownerSegment(input.userId)}:${input.sessionId}`;
}
function ownerIndexPrefix(userId) {
  return `${SESSION_INDEX_GLOBAL_PREFIX}${ownerSegment(userId)}:`;
}
async function indexSession(kv, state) {
  await kv.put(sessionIndexKey(state), JSON.stringify(state));
}
async function unindexSession(kv, input) {
  await kv.delete(sessionIndexKey(input));
}
async function listSessionStates(kv, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    for (const key of page.keys) {
      const value = await kv.get(key.name, { type: "json" });
      if (value) out.push(value);
    }
    cursor = page.list_complete ? void 0 : page.cursor;
  } while (cursor);
  return out;
}
async function countOwnerSessions(kv, userId) {
  const prefix = ownerIndexPrefix(userId);
  let count = 0;
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    for (const key of page.keys) {
      if (isPublishedScopedId(key.name.slice(prefix.length))) continue;
      count += 1;
    }
    cursor = page.list_complete ? void 0 : page.cursor;
  } while (cursor);
  return count;
}

// packages/computer-hosts/src/sandbox-host-published-mcp.ts
var PUBLISHED_MCP_DEFAULT_SESSION_ID = "agent-default";
var PUBLISHED_MCP_DEFAULT_SPACE_ID = "published-mcp";
var PUBLISHED_MCP_DEFAULT_USER_ID = "takos-agent";
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
      const { state, sessionId } = await ensurePublishedMcpSession(c, args);
      return mcpJson(toPublishedSessionState(state, sessionId));
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
      const { sessionId, scopedId } = await resolvePublishedMcpSessionArgs(
        c,
        args
      );
      const state = await getDOStub(c.env, scopedId).getSessionState();
      return mcpJson(
        state ? toPublishedSessionState(state, sessionId) : { session_id: sessionId, status: "missing" }
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
      const { sessionId, scopedId, userId } = await resolvePublishedMcpSessionArgs(c, args);
      const stub = getDOStub(c.env, scopedId);
      const state = await stub.getSessionState();
      await stub.destroySession();
      const kv = c.env.SESSION_INDEX;
      if (kv) {
        await unindexSession(kv, {
          userId: state?.userId ?? userId,
          sessionId: scopedId
        });
      }
      return mcpJson({ ok: true, session_id: sessionId });
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
function nonEmptyStringArg(args, names, fallback) {
  for (const name of names) {
    const value = args[name];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return fallback;
}
var tokenNamespaceCache = /* @__PURE__ */ new Map();
async function publishedMcpTokenNamespace(c) {
  const token = resolvePublishedMcpAuthToken(c.env);
  if (!token) {
    throw new Error("Published MCP auth token is not configured");
  }
  const cached = tokenNamespaceCache.get(token);
  if (cached) return cached;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const namespace = `${PUBLISHED_MCP_SCOPE_PREFIX}${hex.slice(0, 16)}`;
  tokenNamespaceCache.set(token, namespace);
  return namespace;
}
async function resolvePublishedMcpSessionArgs(c, args) {
  const sessionId = nonEmptyStringArg(
    args,
    ["session_id", "sessionId"],
    PUBLISHED_MCP_DEFAULT_SESSION_ID
  );
  const namespace = await publishedMcpTokenNamespace(c);
  return {
    sessionId,
    scopedId: `${namespace}:${sessionId}`,
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
function toPublishedSessionState(state, logicalSessionId = state.sessionId) {
  return {
    session_id: logicalSessionId,
    space_id: state.spaceId,
    user_id: state.userId,
    status: state.status,
    created_at: state.createdAt
  };
}
async function indexPublishedMcpSession(c, scopedId, state) {
  const kv = c.env.SESSION_INDEX;
  if (!kv) return;
  const indexedState = { ...state, sessionId: scopedId };
  await indexSession(kv, indexedState);
}
async function ensurePublishedMcpSession(c, args) {
  const { sessionId, scopedId, spaceId, userId } = await resolvePublishedMcpSessionArgs(c, args);
  const stub = getDOStub(c.env, scopedId);
  const existing = await stub.getSessionState();
  if (existing && existing.status !== "stopped") {
    return { stub, state: existing, sessionId };
  }
  await stub.createSession({ sessionId, spaceId, userId });
  const state = await stub.getSessionState() ?? {
    sessionId,
    spaceId,
    userId,
    status: "active",
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await indexPublishedMcpSession(c, scopedId, state);
  return { stub, state, sessionId };
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
  return mcpJson(result ?? null);
}
function handlePublishedMcp(c) {
  const handle = createMcpEnvelope({
    serverInfo: { name: "takos-computer", version: "2.0.0" },
    tools: publishedMcpTools,
    toolMap: publishedMcpToolMap,
    authorize: () => requirePublishedMcpAuth(c),
    callContext: () => c
  });
  return handle(c.req.raw);
}

// packages/computer-hosts/src/sandbox-host.ts
var DEFAULT_MAX_SESSIONS_PER_USER = 10;
function maxSessionsPerUser(env) {
  const raw2 = env.MAX_SANDBOX_SESSIONS_PER_USER;
  if (!raw2) return DEFAULT_MAX_SESSIONS_PER_USER;
  const parsed = Number(raw2);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_SESSIONS_PER_USER;
}
var app = new Hono2();
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
  if (guiAppAuthRequired(env)) {
    for (const name of [
      "APP_SESSION_SECRET",
      "OIDC_ISSUER_URL",
      "OIDC_CLIENT_ID",
      "OIDC_CLIENT_SECRET",
      "ACCOUNTS_BASE_URL",
      "INSTALL_LAUNCH_INSTALLATION_ID",
      "INSTALL_LAUNCH_CONSUME_PATH"
    ]) {
      if (!env[name]) missing.push(name);
    }
  }
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
function readinessResponse(c) {
  const missing = collectMissingRuntimeBindings(c.env);
  return c.json({
    status: missing.length === 0 ? "ok" : "misconfigured",
    service: "takos-sandbox-host",
    missingBindings: missing
  }, missing.length === 0 ? 200 : 503);
}
app.get("/health", readinessResponse);
app.get("/readyz", readinessResponse);
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
registerGuiAuthRoutes(app);
app.get("/gui", serveGuiApp);
app.get("/gui/", serveGuiApp);
async function listSessions(c) {
  const scope = await resolveHostAdminScope(c);
  if (scope.response) return scope.response;
  const kv = c.env.SESSION_INDEX;
  if (!kv) return c.json({ sessions: [] });
  const prefix = scope.kind === "gui" ? ownerIndexPrefix(scope.guiSession.sub) : SESSION_INDEX_GLOBAL_PREFIX;
  const all = await listSessionStates(kv, prefix);
  const sessions = scope.kind === "gui" ? all.filter((val) => guiSessionOwnsSandbox(scope.guiSession, val)) : all;
  return c.json({ sessions });
}
app.get("/gui/api/sessions", listSessions);
app.get("/gui/api/sandbox-sessions", listSessions);
async function createSession(c) {
  const scope = await resolveHostAdminScope(c);
  if (scope.response) return scope.response;
  const payload = await c.req.json();
  let { sessionId, spaceId, userId } = payload;
  if (scope.kind === "gui") {
    userId = scope.guiSession.sub;
    spaceId = scope.guiSession.spaceId ?? "";
  }
  if (!sessionId || !userId || scope.kind !== "gui" && !spaceId) {
    return c.json({
      error: "Missing required fields: sessionId, spaceId, userId"
    }, 400);
  }
  if (isPublishedScopedId(sessionId)) {
    return c.json(
      { error: `sessionId must not start with "${PUBLISHED_MCP_SCOPE_PREFIX}"` },
      400
    );
  }
  try {
    const kv = c.env.SESSION_INDEX;
    if (scope.kind === "gui") {
      const existing = await getDOStub(c.env, sessionId).getSessionState();
      if (existing && !guiSessionOwnsSandbox(scope.guiSession, existing)) {
        return c.json(
          { error: "Session id is owned by another principal" },
          409
        );
      }
      if (!existing && kv) {
        const owned = await countOwnerSessions(kv, userId);
        if (owned >= maxSessionsPerUser(c.env)) {
          return c.json(
            { error: "Active sandbox session limit reached" },
            429
          );
        }
      }
    }
    const stub = getDOStub(c.env, sessionId);
    const result = await stub.createSession({ sessionId, spaceId, userId });
    const state = await stub.getSessionState();
    if (kv && state) {
      try {
        await indexSession(kv, state);
      } catch (indexErr) {
        await stub.destroySession().catch(() => {
        });
        throw indexErr;
      }
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
    const state = await stub.getSessionState();
    await stub.destroySession();
    const kv = c.env.SESSION_INDEX;
    if (kv) {
      await unindexSession(kv, {
        userId: state?.userId ?? "",
        sessionId
      });
    }
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
app.all("/mcp", handlePublishedMcp);
async function forwardMcp(c) {
  if (c.req.raw.method === "OPTIONS") {
    return mcpOptionsPreflight();
  }
  const sessionId = sessionIdParam(c);
  if (sessionId instanceof Response) return sessionId;
  const stub = getDOStub(c.env, sessionId);
  try {
    const auth = await authorizeSessionAccess(c, sessionId, stub);
    if (auth) return auth;
    if (c.req.raw.method !== "POST") {
      return mcpMethodNotAllowed();
    }
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
        MAX_MCP_BODY_BYTES
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
app.get("/gui/*", serveGuiApp);
var sandbox_host_default = {
  fetch: app.fetch
};
export {
  SandboxSessionContainer,
  sandbox_host_default as default
};
