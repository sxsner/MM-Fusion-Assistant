import type { SiteAdapter } from './types';
import { ChatGPTAdapter } from './chatgpt';
import { ClaudeAdapter } from './claude';
import { GeminiAdapter } from './gemini';
import { DeepSeekAdapter } from './deepseek';
import { GrokAdapter } from './grok';
import { DoubaoAdapter } from './doubao';
import { GLMAdapter } from './glm';
import { QwneAdapter } from './qwne';
import { HunyuanAdapter } from './hunyuan';
import { KimiAdapter } from './kimi';
import { MiniMaxAdapter } from './minimax';
import { LongCatAdapter } from './longcat';
import { StepFunAdapter } from './stepfun';
import { MiMoAdapter } from './mimo';

const adapters: Record<string, SiteAdapter> = {
  'chatgpt.com': new ChatGPTAdapter(),
  'chat.openai.com': new ChatGPTAdapter(),
  'claude.ai': new ClaudeAdapter(),
  'gemini.google.com': new GeminiAdapter(),
  'chat.deepseek.com': new DeepSeekAdapter(),
  'grok.com': new GrokAdapter(),
  'www.doubao.com': new DoubaoAdapter(),
  'chat.z.ai': new GLMAdapter(),
  'www.qianwen.com': new QwneAdapter(),
  'chat.qwen.ai': new QwneAdapter(),
  'aistudio.tencent.com': new HunyuanAdapter(),
  'www.kimi.com': new KimiAdapter(),
  'agent.minimaxi.com': new MiniMaxAdapter(),
  'longcat.chat': new LongCatAdapter(),
  'chat.stepfun.com': new StepFunAdapter(),
  'aistudio.xiaomimimo.com': new MiMoAdapter(),
};

export function getAdapter(hostname: string): SiteAdapter {
  const adapter = adapters[hostname];
  if (!adapter) {
    throw new Error(`Unknown site: ${hostname}`);
  }
  return adapter;
}
