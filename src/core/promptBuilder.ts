import { logger } from '../shared/logger';

const MODULE = 'SUM';

export const DEFAULT_SUMMARY_INSTRUCTION = '请综合以上所有模型回答，给出一个全面、准确的总结。\n指出各模型回答的一致点和分歧点。';

export class PromptBuilder {
  static readonly ORIGINAL_QUESTION_PREFIX = '## 原始问题\n';
  static readonly MODEL_ANSWERS_PREFIX = '\n## 各模型回答\n';

  static buildSummaryPrompt(
    originalQuestion: string,
    modelResults: Array<{ modelId: string; content: string }>,
    summaryInstruction = DEFAULT_SUMMARY_INSTRUCTION,
  ): string {
    const traceId = crypto.randomUUID();

    const modelSections = modelResults
      .map((r) => `### ${r.modelId}\n${r.content}`)
      .join('\n\n');

    const prompt = `${PromptBuilder.ORIGINAL_QUESTION_PREFIX}${originalQuestion}\n\n${PromptBuilder.MODEL_ANSWERS_PREFIX}${modelSections}\n\n## 汇总要求\n${summaryInstruction}`;

    logger.info(MODULE, traceId, '组装汇总Prompt, 长度=' + prompt.length);
    return prompt;
  }

  static truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars);
  }
}
