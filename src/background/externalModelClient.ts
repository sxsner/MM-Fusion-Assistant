import { logger } from '../shared/logger';
import type { SummaryConfig } from '../shared/types';

const MODULE = 'EMC';

interface RequestConfig {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export class ExternalModelClient {
  private config: SummaryConfig;

  constructor(config: SummaryConfig) {
    this.config = config;
  }

  private async request(prompt: string, stream: boolean, timeoutMs: number): Promise<Response> {
    const req = this.buildRequest(prompt, stream);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async summarize(prompt: string): Promise<string> {
    const traceId = crypto.randomUUID();
    const { provider } = this.config;
    logger.info(MODULE, traceId, '调用汇总API: ' + provider);

    try {
      const response = await this.request(prompt, false, this.config.timeoutMs);
      const data = await response.json();
      const content = this.extractContent(data);

      logger.info(MODULE, traceId, '汇总完成, 长度=' + content.length);
      return content;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(MODULE, traceId, '汇总失败: ' + errorMsg);
      throw err;
    }
  }

  async summarizeStream(
    prompt: string,
    onChunk: (chunk: string) => void,
  ): Promise<string> {
    const traceId = crypto.randomUUID();
    const { provider } = this.config;
    logger.info(MODULE, traceId, '调用汇总API: ' + provider);

    try {
      const response = await this.request(prompt, true, this.config.timeoutMs);
      const reader = response.body?.getReader();
      if (!reader) { throw new Error('Response body is not readable'); }

      const decoder = new TextDecoder();
      const fullContent = await this.readSSEStream(reader, decoder, onChunk, traceId);

      logger.info(MODULE, traceId, '汇总完成, 长度=' + fullContent.length);
      return fullContent;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(MODULE, traceId, '汇总失败: ' + errorMsg);
      throw err;
    }
  }

  async validate(): Promise<boolean> {
    try {
      const response = await this.request('test', false, 10000);
      return response.ok;
    } catch {
      return false;
    }
  }

  private buildRequest(prompt: string, stream: boolean): RequestConfig {
    const { provider, apiKey, apiEndpoint, modelName } = this.config;
    const model = modelName || 'gpt-4o';

    switch (provider) {
      case 'openai': {
        return {
          url: 'https://api.openai.com/v1/chat/completions',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: {
            model,
            messages: [{ role: 'user', content: prompt }],
            stream,
          },
        };
      }

      case 'claude-api': {
        return {
          url: 'https://api.anthropic.com/v1/messages',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: {
            model,
            messages: [{ role: 'user', content: prompt }],
            stream,
          },
        };
      }

      case 'gemini-api': {
        const base = apiEndpoint || 'https://generativelanguage.googleapis.com';
        const action = stream ? ':streamGenerateContent' : ':generateContent';
        const url = `${base}/v1/models/${model}${action}?alt=sse&key=${apiKey}`;
        return {
          url,
          headers: { 'Content-Type': 'application/json' },
          body: {
            contents: [{ parts: [{ text: prompt }] }],
          },
        };
      }

      case 'custom': {
        if (!apiEndpoint) throw new Error('Custom provider requires apiEndpoint');
        return {
          url: apiEndpoint,
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: {
            model,
            messages: [{ role: 'user', content: prompt }],
            stream,
          },
        };
      }

      default:
        throw new Error('Unknown provider: ' + provider);
    }
  }

  private extractContent(data: Record<string, unknown>): string {
    const { provider } = this.config;

    switch (provider) {
      case 'openai':
      case 'custom':
        return (data as any)?.choices?.[0]?.message?.content || '';

      case 'claude-api':
        return (data as any)?.content?.[0]?.text || '';

      case 'gemini-api':
        return (data as any)?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      default:
        return '';
    }
  }

  private processSSELine(
    line: string,
    provider: string,
    buffer: string[],
    onChunk: (chunk: string) => void,
    traceId: string,
  ): void {
    if (!line.startsWith('data: ')) return;
    const data = line.slice(6).trim();
    if (!data || data === '[DONE]') return;

    try {
      const parsed = JSON.parse(data);
      let text = '';

      switch (provider) {
        case 'openai':
        case 'custom':
          text = parsed?.choices?.[0]?.delta?.content || '';
          break;
        case 'claude-api':
          if (parsed.type === 'content_block_delta') {
            text = parsed.delta?.text || '';
          }
          break;
        case 'gemini-api':
          text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          break;
      }

      if (text) {
        buffer.push(text);
        logger.debug(MODULE, traceId, '收到chunk, 长度=' + text.length);
        onChunk(text);
      }
    } catch {
      // skip unparseable SSE data lines
    }
  }

  private async readSSEStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
    onChunk: (chunk: string) => void,
    traceId: string,
  ): Promise<string> {
    const { provider } = this.config;
    const buffer: string[] = [];
    let partial = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      partial += decoder.decode(value, { stream: true });
      const lines = partial.split('\n');
      partial = lines.pop() || '';

      for (const line of lines) {
        this.processSSELine(line, provider, buffer, onChunk, traceId);
      }
    }

    if (partial.trim()) {
      this.processSSELine(partial, provider, buffer, onChunk, traceId);
    }

    return buffer.join('');
  }
}
