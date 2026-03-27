/**
 * Step execution management
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter as pathDelimiter, join } from 'node:path';

import type {
  Step,
  StepResult,
  ExecutionContext,
  ActionResolver,
} from '../types.js';
import { parseGitHubEnvFile } from '../context.js';
import {
  evaluateCondition,
  interpolateString,
  interpolateObject,
} from '../parser/expression.js';

import type {
  StepRunnerOptions,
  StepRunMetadata,
  ShellExecutor,
  StepCommandFiles,
} from './step-types.js';
import { resolvePlatformDefaultShell } from './shell-executor.js';
import { defaultShellExecutor } from './shell-executor.js';
import { defaultActionResolver } from './action-resolver.js';

// Re-export types and values so that existing consumers importing from
// './step.js' continue to work without changes.
export type {
  StepRunnerOptions,
  StepRunMetadata,
  ShellExecutor,
  ShellExecutorOptions,
  ShellExecutorResult,
} from './step-types.js';

const SIMPLE_OUTPUT_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Step runner for executing individual steps
 */
export class StepRunner {
  private options: StepRunnerOptions;
  private actionResolver: ActionResolver;
  private shellExecutor: ShellExecutor;

  constructor(options: StepRunnerOptions = {}) {
    this.options = {
      defaultTimeout: options.defaultTimeout ?? 360,
      workingDirectory: options.workingDirectory ?? process.cwd(),
      defaultShell: options.defaultShell ?? resolvePlatformDefaultShell(),
      ...options,
    };
    this.actionResolver = options.actionResolver ?? defaultActionResolver;
    this.shellExecutor = options.shellExecutor ?? defaultShellExecutor;
  }

  /**
   * Run a single step
   */
  async runStep(
    step: Step,
    context: ExecutionContext,
    _metadata: StepRunMetadata = {}
  ): Promise<StepResult> {
    const startedAt = new Date();
    const result: StepResult = {
      id: step.id,
      name: step.name,
      status: 'queued',
      outputs: {},
      startedAt,
    };

    try {
      // Check condition
      if (step.if !== undefined) {
        const shouldRun = evaluateCondition(step.if, context);
        if (!shouldRun) {
          result.status = 'completed';
          result.conclusion = 'skipped';
          result.completedAt = new Date();
          return result;
        }
      }

      result.status = 'in_progress';

      // Merge environment variables
      const env = {
        ...context.env,
        ...(step.env || {}),
      };

      // Interpolate environment variables
      const interpolatedEnv = interpolateObject(env, context);

      // Create step context with interpolated env
      const stepContext: ExecutionContext = {
        ...context,
        env: interpolatedEnv,
      };

      // Execute based on step type
      if (step.uses) {
        await this.runAction(step, stepContext, result);
      } else if (step.run) {
        await this.runShell(step, stepContext, context.env, result);
      } else {
        throw new Error('Step must have either "uses" or "run"');
      }

      result.status = 'completed';
      result.conclusion = result.conclusion ?? 'success';
    } catch (error) {
      result.status = 'completed';
      result.conclusion = step['continue-on-error'] ? 'success' : 'failure';
      result.error = error instanceof Error ? error.message : String(error);
    }

    result.completedAt = new Date();
    return result;
  }

  /**
   * Run an action step
   */
  private async runAction(
    step: Step,
    context: ExecutionContext,
    result: StepResult
  ): Promise<void> {
    const uses = interpolateString(step.uses!, context);
    const action = await this.actionResolver(uses);

    if (!action) {
      throw new Error(`Action not found: ${uses}`);
    }

    // Interpolate with parameters
    const interpolatedWith = step.with
      ? interpolateObject(step.with, context)
      : {};

    const stepWithInterpolated: Step = {
      ...step,
      uses,
      with: interpolatedWith,
    };

    const actionResult = await action.run(stepWithInterpolated, context);

    // Merge outputs
    Object.assign(result.outputs, actionResult.outputs);
    result.conclusion = actionResult.conclusion;
  }

  /**
   * Run a shell command step
   */
  private async runShell(
    step: Step,
    context: ExecutionContext,
    sharedEnv: Record<string, string>,
    result: StepResult
  ): Promise<void> {
    // Interpolate command
    const command = interpolateString(step.run!, context);

    // Determine shell
    const shell = step.shell ?? this.options.defaultShell;

    // Determine working directory
    const workingDirectory =
      step['working-directory'] ?? this.options.workingDirectory;
    const interpolatedWorkDir = interpolateString(workingDirectory!, context);

    // Calculate timeout
    const timeout = (step['timeout-minutes'] ?? this.options.defaultTimeout!) * 60_000;

    const commandFiles = await this.createCommandFiles(context);
    const runnerTemp = this.resolveRunnerTemp(context);
    const shellEnv = {
      ...context.env,
      RUNNER_TEMP: runnerTemp,
      GITHUB_ENV: commandFiles.env,
      GITHUB_OUTPUT: commandFiles.output,
      GITHUB_PATH: commandFiles.path,
    };

    try {
      // Execute command
      const shellResult = await this.shellExecutor(command, {
        shell,
        workingDirectory: interpolatedWorkDir,
        env: shellEnv,
        timeout,
      });

      // Parse outputs from stdout (GitHub Actions format)
      const stdoutOutputs = this.parseOutputs(shellResult.stdout);
      Object.assign(result.outputs, stdoutOutputs);

      // Merge command-file outputs (echo "name=value" >> $GITHUB_OUTPUT)
      const commandFileOutputs = await this.parseCommandFileOutputs(commandFiles.output);
      Object.assign(result.outputs, commandFileOutputs);

      // Persist GITHUB_ENV and GITHUB_PATH updates for later steps.
      await this.applyCommandFileEnvironmentUpdates(sharedEnv, commandFiles, shellEnv);

      // Set conclusion based on exit code
      result.conclusion = shellResult.exitCode === 0 ? 'success' : 'failure';

      if (shellResult.exitCode !== 0) {
        result.error = `Exit code: ${shellResult.exitCode}`;
        if (shellResult.stderr) {
          result.error += `\n${shellResult.stderr}`;
        }
      }
    } finally {
      await this.removeCommandFilesDirectory(commandFiles.directory);
    }
  }

  private resolveRunnerTemp(context: ExecutionContext): string {
    return context.env.RUNNER_TEMP || context.runner.temp || tmpdir();
  }

  private async createCommandFiles(context: ExecutionContext): Promise<StepCommandFiles> {
    const runnerTemp = this.resolveRunnerTemp(context);
    let directory: string;

    try {
      directory = await mkdtemp(join(runnerTemp, 'actions-engine-step-'));
    } catch {
      directory = await mkdtemp(join(tmpdir(), 'actions-engine-step-'));
    }

    return {
      directory,
      env: join(directory, 'github-env'),
      output: join(directory, 'github-output'),
      path: join(directory, 'github-path'),
    };
  }

  private async parseCommandFileOutputs(outputPath: string): Promise<Record<string, string>> {
    const outputContent = await this.readCommandFile(outputPath);
    if (outputContent.length === 0) {
      return {};
    }
    return parseGitHubEnvFile(outputContent);
  }

  private async applyCommandFileEnvironmentUpdates(
    sharedEnv: Record<string, string>,
    commandFiles: StepCommandFiles,
    shellEnv: Record<string, string>
  ): Promise<void> {
    const envContent = await this.readCommandFile(commandFiles.env);
    if (envContent.length > 0) {
      const updates = parseGitHubEnvFile(envContent);
      Object.assign(sharedEnv, updates);
    }

    const pathContent = await this.readCommandFile(commandFiles.path);
    const appendedPaths = this.parsePathFile(pathContent);
    if (appendedPaths.length > 0) {
      const basePath = sharedEnv.PATH ?? shellEnv.PATH ?? process.env.PATH ?? '';
      const prefix = appendedPaths.join(pathDelimiter);
      sharedEnv.PATH = basePath.length > 0 ? `${prefix}${pathDelimiter}${basePath}` : prefix;
    }
  }

  private parsePathFile(content: string): string[] {
    const entries: string[] = [];

    this.iterateNormalizedLines(content, (line) => {
      if (line.trim().length === 0) {
        return;
      }
      entries.push(line);
    });

    return entries;
  }

  /** Maximum size for GITHUB_ENV / GITHUB_OUTPUT / GITHUB_PATH command files (10 MB) */
  private static readonly MAX_COMMAND_FILE_BYTES = 10 * 1024 * 1024;

  private async readCommandFile(path: string): Promise<string> {
    try {
      const { stat } = await import('node:fs/promises');
      const stats = await stat(path);
      if (stats.size > StepRunner.MAX_COMMAND_FILE_BYTES) {
        throw new Error(
          `Command file ${path} exceeds maximum size of ${StepRunner.MAX_COMMAND_FILE_BYTES} bytes (actual: ${stats.size})`
        );
      }
      return await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return '';
      }
      throw error;
    }
  }

  private async removeCommandFilesDirectory(path: string): Promise<void> {
    try {
      await rm(path, { recursive: true, force: true });
    } catch {
      // Command-file cleanup should never fail step execution.
    }
  }

  /**
   * Parse GitHub Actions output format from stdout
   * Format: ::set-output name=<name>::<value>
   * Or: echo "name=value" >> $GITHUB_OUTPUT
   */
  private parseOutputs(stdout: string): Record<string, string> {
    const outputs: Record<string, string> = {};

    this.iterateNormalizedLines(stdout, (line) => {
      this.parseLegacyOutputLine(line, outputs);
      this.parseSimpleOutputLine(line, outputs);
    });

    return outputs;
  }

  private iterateNormalizedLines(
    content: string,
    iterate: (line: string) => void
  ): void {
    if (content.length === 0) {
      return;
    }

    const lines = content.split('\n');
    for (let line of lines) {
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }
      iterate(line);
    }
  }

  private parseLegacyOutputLine(
    line: string,
    outputs: Record<string, string>
  ): void {
    const prefix = '::set-output name=';
    if (!line.startsWith(prefix)) {
      return;
    }

    const separatorIndex = line.indexOf('::', prefix.length);
    if (separatorIndex === -1) {
      return;
    }

    const name = line.slice(prefix.length, separatorIndex);
    if (name.length === 0 || name.includes(':')) {
      return;
    }

    const value = line.slice(separatorIndex + 2);
    outputs[name] = value;
  }

  private parseSimpleOutputLine(
    line: string,
    outputs: Record<string, string>
  ): void {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      return;
    }

    const name = line.slice(0, separatorIndex);
    if (!SIMPLE_OUTPUT_NAME_REGEX.test(name)) {
      return;
    }

    const value = line.slice(separatorIndex + 1);
    if (!(name in outputs)) {
      outputs[name] = value;
    }
  }
}
