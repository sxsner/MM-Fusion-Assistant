import { logger } from '../shared/logger';
import { PromptBuilder } from './promptBuilder';

const MODULE = 'SUM';

// [BUG-FIX] F3 - 提取魔法数字为命名常量
const TOKEN_ESTIMATE_DIVISOR = 4;
const CONTENT_TRUNCATE_RATIO = 0.2;

export class ContextBudget {
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / TOKEN_ESTIMATE_DIVISOR);
  }

  static enforceBudget(
    prompt: string,
    maxTokens: number,
    modelResults: Array<{ modelId: string; content: string }>
  ): string {
    const traceId = crypto.randomUUID();

    // [BUG-FIX] F3 - NaN guard: 校验 maxTokens 入参，无效值直接返回原 prompt
    if (typeof maxTokens !== 'number' || !isFinite(maxTokens) || maxTokens <= 0) {
      logger.warn(MODULE, traceId, `无效的 maxTokens 值(${maxTokens})，跳过预算检查`);
      return prompt;
    }

    let estimatedTokens = this.estimateTokens(prompt);
    if (estimatedTokens <= maxTokens) return prompt;

    logger.warn(MODULE, traceId, '内容超限, 截断到' + maxTokens + ' tokens');

    const originalQuestion = this.extractOriginalQuestion(prompt);
    const mutableResults = modelResults.map((r) => ({ ...r }));

    while (estimatedTokens > maxTokens) {
      mutableResults.sort((a, b) => b.content.length - a.content.length);

      if (mutableResults.length === 0 || mutableResults[0].content.length === 0) break;

      const longest = mutableResults[0];
      const reduction = Math.ceil(longest.content.length * CONTENT_TRUNCATE_RATIO);
      longest.content = longest.content.slice(0, longest.content.length - reduction);

      const rebuilt = PromptBuilder.buildSummaryPrompt(originalQuestion, mutableResults);
      estimatedTokens = this.estimateTokens(rebuilt);
    }

    if (estimatedTokens > maxTokens) {
      return PromptBuilder.truncate(prompt, maxTokens * TOKEN_ESTIMATE_DIVISOR);
    }

    return PromptBuilder.buildSummaryPrompt(originalQuestion, mutableResults);
  }

  private static extractOriginalQuestion(prompt: string): string {
    const prefix = PromptBuilder.ORIGINAL_QUESTION_PREFIX;
    const suffix = PromptBuilder.MODEL_ANSWERS_PREFIX;
    const start = prompt.indexOf(prefix);
    const end = prompt.indexOf(suffix);
    if (start === -1 || end === -1) return '';
    return prompt.slice(start + prefix.length, end);
  }
}
