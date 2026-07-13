import { logger } from '../shared/logger';
import type { Task } from '../shared/types';
import type { ExternalModelClient } from './externalModelClient';
import type { PromptBuilder } from '../core/promptBuilder';
import type { ContextBudget } from '../core/contextBudget';
import { SummaryWebAdapter } from './summaryWebAdapter';
import { getSummaryPrompt } from '../popup/promptView';

const MODULE = 'SUM';

type CompleteCallback = (taskId: string, result: string) => void;

export class SummaryManager {
  private client: ExternalModelClient;
  private promptBuilder: typeof PromptBuilder;
  private budget: typeof ContextBudget;
  private webAdapter?: SummaryWebAdapter;
  private useWebOnly: boolean;
  private completeCallback?: CompleteCallback;

  constructor(
    client: ExternalModelClient,
    promptBuilder: typeof PromptBuilder,
    budget: typeof ContextBudget,
    webAdapter?: SummaryWebAdapter,
    useWebOnly = false,
  ) {
    this.client = client;
    this.promptBuilder = promptBuilder;
    this.budget = budget;
    this.webAdapter = webAdapter;
    this.useWebOnly = useWebOnly;
  }

  async summarize(taskId: string, task: Task): Promise<string> {
    const traceId = crypto.randomUUID();
    logger.info(MODULE, traceId, '开始汇总: ' + taskId);

    const modelResults = this.collectResults(task);
    const summaryInstruction = await getSummaryPrompt();

    const prompt = this.promptBuilder.buildSummaryPrompt(task.question, modelResults, summaryInstruction);

    const budgetedPrompt = this.budget.enforceBudget(prompt, Infinity, modelResults);

    if (this.useWebOnly && this.webAdapter) {
      return this.summarizeViaWeb(task, budgetedPrompt, traceId);
    }

    const result = await this.client.summarize(budgetedPrompt);

    logger.info(MODULE, traceId, '汇总完成: ' + taskId);

    if (this.completeCallback) {
      this.completeCallback(taskId, result);
    }

    return result;
  }

  private async summarizeViaWeb(task: Task, prompt: string, traceId: string): Promise<string> {
    const modelId = task.targetModels[0] || 'chatgpt';
    let fullContent = '';

    await this.webAdapter!.summarizeViaWeb(modelId, { content: prompt, fileName: 'summary-input.md' }, (chunk) => {
      fullContent += chunk;
    });

    logger.info(MODULE, traceId, '汇总完成: ' + task.id);

    if (this.completeCallback) {
      this.completeCallback(task.id, fullContent);
    }

    return fullContent;
  }

  onComplete(callback: CompleteCallback): void {
    this.completeCallback = callback;
  }

  private collectResults(task: Task): Array<{ modelId: string; content: string }> {
    const results: Array<{ modelId: string; content: string }> = [];
    for (const [modelId, result] of Object.entries(task.results)) {
      if (result?.content) {
        results.push({ modelId, content: result.content });
      }
    }
    return results;
  }
}
