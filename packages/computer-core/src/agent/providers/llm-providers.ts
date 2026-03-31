/**
 * Multi-Model Provider Abstraction
 * Supports OpenAI, Anthropic Claude, and Google Gemini
 */

import type { AgentMessage, AgentTool, ToolCall } from '../types.ts';
import { logError } from '../../shared/utils/logger.ts';
import {
  DEFAULT_MODEL_ID,
  getModelProvider,
  type ModelProvider,
} from '../model-catalog.ts';
export { DEFAULT_MODEL_ID } from '../model-catalog.ts';
export type { ModelProvider } from '../model-catalog.ts';

/** Truncate and redact LLM API error bodies to prevent API key / secret leakage. */
function sanitizeLlmError(body: string, maxLen = 500): string {
  return body
    .slice(0, maxLen)
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-***')
    .replace(/key-[A-Za-z0-9_-]{10,}/g, 'key-***')
    .replace(/Bearer\s+[A-Za-z0-9_-]+/gi, 'Bearer ***');
}

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  stopReason: 'stop' | 'tool_calls' | 'length';
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMProvider {
  chat(messages: AgentMessage[], tools?: AgentTool[], signal?: AbortSignal): Promise<LLMResponse>;
}

// ============================================================================
// Base LLM Provider — shared fetch / error handling
// ============================================================================

abstract class BaseLLMProvider implements LLMProvider {
  constructor(protected config: ModelConfig) {}

  /** Provider name used in error messages (e.g. "OpenAI", "Anthropic"). */
  protected abstract readonly providerName: string;

  /** Build the full request URL. */
  protected abstract getUrl(): string;

  /** Build HTTP headers (Content-Type is always included). */
  protected abstract getHeaders(): Record<string, string>;

  /** Build the JSON request body. */
  protected abstract buildRequestBody(
    messages: AgentMessage[],
    tools?: AgentTool[],
  ): Record<string, unknown>;

  /** Parse the provider-specific JSON response into a normalised LLMResponse. */
  protected abstract parseResponse(data: unknown): LLMResponse;

  /** Validate that the response payload is structurally sound (throw on bad data). */
  protected abstract validateResponse(data: unknown): void;

  async chat(
    messages: AgentMessage[],
    tools?: AgentTool[],
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    const response = await fetch(this.getUrl(), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(this.buildRequestBody(messages, tools)),
      signal,
    });

    if (!response.ok) {
      const error = sanitizeLlmError(await response.text());
      throw new Error(`${this.providerName} API error: ${response.status} - ${error}`);
    }

    const data: unknown = await response.json();
    this.validateResponse(data);
    return this.parseResponse(data);
  }
}

// ============================================================================
// OpenAI Provider
// ============================================================================

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

class OpenAIProvider extends BaseLLMProvider {
  protected readonly providerName = 'OpenAI';

  protected getUrl(): string {
    return 'https://api.openai.com/v1/chat/completions';
  }

  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };
  }

  private convertTools(tools: AgentTool[]) {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.parameters.properties,
          required: tool.parameters.required,
        },
      },
    }));
  }

  private convertMessages(messages: AgentMessage[]): OpenAIMessage[] {
    return messages.map(msg => {
      if (msg.role === 'system' || msg.role === 'user') {
        return { role: msg.role, content: msg.content };
      }
      if (msg.role === 'assistant') {
        const openaiMsg: OpenAIMessage = { role: 'assistant', content: msg.content || null };
        if (msg.tool_calls?.length) {
          openaiMsg.tool_calls = msg.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {}),
            },
          }));
        }
        return openaiMsg;
      }
      if (msg.role === 'tool') {
        return { role: 'tool', content: msg.content, tool_call_id: msg.tool_call_id ?? '' };
      }
      return { role: msg.role as OpenAIMessage['role'], content: msg.content };
    });
  }

  private isReasoningModel(): boolean {
    const m = this.config.model;
    return /^o[0-9]/.test(m) || m.includes('o1') || m.includes('o3') || m.includes('gpt-5');
  }

  protected buildRequestBody(messages: AgentMessage[], tools?: AgentTool[]): Record<string, unknown> {
    const requestBody: Record<string, unknown> = {
      model: this.config.model,
      max_completion_tokens: this.config.maxTokens || 4096,
      messages: this.convertMessages(messages),
    };

    // Reasoning models (o1, o3, etc.) only support temperature=1
    if (!this.isReasoningModel()) {
      requestBody.temperature = this.config.temperature ?? 1;
    }

    if (tools?.length) {
      requestBody.tools = this.convertTools(tools);
    }

    return requestBody;
  }

  protected validateResponse(data: unknown): void {
    const d = data as { choices?: unknown[] };
    if (!d.choices || d.choices.length === 0) {
      throw new Error('OpenAI API returned empty choices array');
    }
  }

  protected parseResponse(data: unknown): LLMResponse {
    const d = data as {
      choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason: string }[];
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = d.choices[0];
    const toolCalls: ToolCall[] = [];
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        try {
          toolCalls.push({ id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments) });
        } catch (e) {
          logError('Failed to parse tool call', e, { module: 'services/agent/providers' });
        }
      }
    }

    return {
      content: choice.message.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: choice.finish_reason as LLMResponse['stopReason'],
      usage: { inputTokens: d.usage.prompt_tokens, outputTokens: d.usage.completion_tokens },
    };
  }
}

// ============================================================================
// Anthropic Provider
// ============================================================================

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | { type: string; text?: string; tool_use_id?: string; content?: string; id?: string; name?: string; input?: unknown }[];
}

class AnthropicProvider extends BaseLLMProvider {
  protected readonly providerName = 'Anthropic';

  protected getUrl(): string {
    return 'https://api.anthropic.com/v1/messages';
  }

  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  private convertTools(tools: AgentTool[]) {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    }));
  }

  private convertMessages(messages: AgentMessage[]): { system: string; messages: AnthropicMessage[] } {
    let systemPrompt = '';
    const anthropicMessages: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n\n' : '') + msg.content;
        continue;
      }

      if (msg.role === 'user') {
        anthropicMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        if (msg.tool_calls?.length) {
          const content: { type: string; id?: string; name?: string; input?: unknown; text?: string }[] = [];
          if (msg.content) {
            content.push({ type: 'text', text: msg.content });
          }
          for (const tc of msg.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
          anthropicMessages.push({ role: 'assistant', content });
        } else {
          anthropicMessages.push({ role: 'assistant', content: msg.content });
        }
      } else if (msg.role === 'tool') {
        // Tool results need to be in a user message
        const lastMsg = anthropicMessages[anthropicMessages.length - 1];
        if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
          (lastMsg.content as { type: string; tool_use_id?: string; content?: string }[]).push({
            type: 'tool_result',
            tool_use_id: msg.tool_call_id ?? '',
            content: msg.content,
          });
        } else {
          anthropicMessages.push({
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id ?? '', content: msg.content }],
          });
        }
      }
    }

    return { system: systemPrompt, messages: anthropicMessages };
  }

  protected buildRequestBody(messages: AgentMessage[], tools?: AgentTool[]): Record<string, unknown> {
    const { system, messages: anthropicMessages } = this.convertMessages(messages);

    const requestBody: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens || 4096,
      messages: anthropicMessages,
    };

    if (system) {
      requestBody.system = system;
    }

    if (tools?.length) {
      requestBody.tools = this.convertTools(tools);
    }

    return requestBody;
  }

  protected validateResponse(data: unknown): void {
    const d = data as { content?: unknown };
    if (!d.content || !Array.isArray(d.content)) {
      throw new Error('Anthropic API returned invalid content structure');
    }
  }

  protected parseResponse(data: unknown): LLMResponse {
    const d = data as {
      content: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of d.content) {
      if (block.type === 'text') {
        textContent += block.text || '';
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id ?? '',
          name: block.name ?? '',
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: d.stop_reason === 'tool_use' ? 'tool_calls' : (d.stop_reason as LLMResponse['stopReason']),
      usage: { inputTokens: d.usage.input_tokens, outputTokens: d.usage.output_tokens },
    };
  }
}

// ============================================================================
// Google Gemini Provider
// ============================================================================

interface GeminiContent {
  role: 'user' | 'model';
  parts: { text?: string; functionCall?: { name: string; args: unknown }; functionResponse?: { name: string; response: unknown } }[];
}

class GoogleProvider extends BaseLLMProvider {
  protected readonly providerName = 'Google';

  protected getUrl(): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent`;
  }

  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.config.apiKey,
    };
  }

  private convertTools(tools: AgentTool[]) {
    return [{
      functionDeclarations: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'OBJECT',
          properties: Object.fromEntries(
            Object.entries(tool.parameters.properties).map(([key, value]: [string, { type?: string; description?: string }]) => [
              key,
              { type: (value.type || 'string').toUpperCase(), description: value.description },
            ])
          ),
          required: tool.parameters.required,
        },
      })),
    }];
  }

  private convertMessages(messages: AgentMessage[]): { systemInstruction: string; contents: GeminiContent[] } {
    let systemInstruction = '';
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction += (systemInstruction ? '\n\n' : '') + msg.content;
        continue;
      }

      if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant') {
        const parts: GeminiContent['parts'] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.tool_calls?.length) {
          for (const tc of msg.tool_calls) {
            parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
          }
        }
        if (parts.length) {
          contents.push({ role: 'model', parts });
        }
      } else if (msg.role === 'tool') {
        // Find the corresponding tool call name
        const prevMsg = contents[contents.length - 1];
        const functionCall = prevMsg?.parts.find(p => p.functionCall);
        const name = functionCall?.functionCall?.name || 'unknown';

        contents.push({
          role: 'user',
          parts: [{ functionResponse: { name, response: { result: msg.content } } }],
        });
      }
    }

    return { systemInstruction, contents };
  }

  protected buildRequestBody(messages: AgentMessage[], tools?: AgentTool[]): Record<string, unknown> {
    const { systemInstruction, contents } = this.convertMessages(messages);

    const requestBody: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: this.config.maxTokens || 4096,
        temperature: this.config.temperature ?? 1,
      },
    };

    if (systemInstruction) {
      requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    if (tools?.length) {
      requestBody.tools = this.convertTools(tools);
    }

    return requestBody;
  }

  protected validateResponse(data: unknown): void {
    const d = data as { candidates?: { content?: { parts?: unknown[] } }[] };
    if (!d.candidates || d.candidates.length === 0) {
      throw new Error('Google API returned empty candidates array');
    }
    const candidate = d.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      throw new Error('Google API returned invalid candidate content structure');
    }
  }

  protected parseResponse(data: unknown): LLMResponse {
    const d = data as {
      candidates: { content: { parts: { text?: string; functionCall?: { name: string; args: unknown } }[] }; finishReason: string }[];
      usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
    };

    const candidate = d.candidates[0];
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const part of candidate.content.parts) {
      if (part.text) {
        textContent += part.text;
      } else if (part.functionCall) {
        toolCalls.push({
          id: `call_${crypto.randomUUID()}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args as Record<string, unknown>,
        });
      }
    }

    const finishReason = candidate.finishReason === 'STOP' ? 'stop' :
                         toolCalls.length > 0 ? 'tool_calls' : 'stop';

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: finishReason as LLMResponse['stopReason'],
      usage: {
        inputTokens: d.usageMetadata?.promptTokenCount || 0,
        outputTokens: d.usageMetadata?.candidatesTokenCount || 0,
      },
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createProvider(config: ModelConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'google':
      return new GoogleProvider(config);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/**
 * Get provider from model ID
 */
export function getProviderFromModel(modelId: string): ModelProvider {
  return getModelProvider(modelId);
}
