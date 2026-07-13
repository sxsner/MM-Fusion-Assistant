import type { ModelType, Attachment } from '../shared/types';
import { logger } from '../shared/logger';
import { ConcurrentQueue } from '../infrastructure/queue';
import { WindowManager } from './windowManager';
import { FileLimitChecker } from './fileLimitChecker';
import { FileManager } from './fileManager';

const MODULE = 'DSP';
const STORAGE_KEY = 'promptPrefix';

const DEFAULT_PREFIX = '在保证正确性的前提下，回答尽量简洁直接，省略开场白和多余铺垫；优先用自然段落表达，少用列表和多级标题，除非涉及需要顺序执行的步骤或大量对比信息；遇到模糊需求时，先做合理假设直接给出可用方案，不反复确认细节；技术类任务给完整、可直接使用的代码或方案，不做过度注释和废话式解释，如有多种技术选型可简短提一句权衡取舍，但不展开成对比表。用连贯的自然段落描述流程，不要用竖排列表或箭头链式结构（如 A→B→C 逐行排列），把步骤自然地嵌入一段完整的话里。禁止生成独立文件参与回答。\n\n';

async function getPrefix(): Promise<string> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return (data[STORAGE_KEY] as string) || DEFAULT_PREFIX;
  } catch {
    return DEFAULT_PREFIX;
  }
}

export interface DispatchResult {
  modelId: ModelType;
  success: boolean;
  tabId: number;
  error?: string;
  uploadSkipped?: boolean;
  batchCount?: number;
}

const pendingReadiness = new Map<number, { resolve: (tabId: number) => void; timer: ReturnType<typeof setTimeout> }>();
const readyBuffer = new Set<number>();

export function signalTabReady(tabId: number): void {
  const p = pendingReadiness.get(tabId);
  if (p) {
    clearTimeout(p.timer);
    pendingReadiness.delete(tabId);
    p.resolve(tabId);
  } else {
    // Buffer it — waitForTabReady hasn't been called yet
    readyBuffer.add(tabId);
  }
}

async function waitForTabReady(tabId: number, maxWait = 120000): Promise<boolean> {
  // Check if already ready (early signal)
  if (readyBuffer.has(tabId)) {
    readyBuffer.delete(tabId);
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pendingReadiness.delete(tabId);
      resolve(false);
    }, maxWait);
    pendingReadiness.set(tabId, { resolve: () => { clearTimeout(timer); resolve(true); }, timer });
  });
}

export class PromptDispatcher {
  constructor(
    private queue: ConcurrentQueue,
    private windowManager: WindowManager,
  ) {}

  async dispatch(
    taskId: string,
    question: string,
    attachments: Attachment[],
    targetModels: ModelType[],
    conversationUrls?: Partial<Record<string, string>>,
  ): Promise<DispatchResult[]> {
    const traceId = crypto.randomUUID();
    logger.info(MODULE, traceId, '开始分发: ' + taskId);

    const promises: Promise<DispatchResult | void>[] = [];

    for (const modelId of targetModels) {
      const convUrl = conversationUrls?.[modelId];
      promises.push(this.enqueueDispatch(traceId, taskId, question, attachments, modelId, convUrl));
    }

    const settled = await Promise.allSettled(promises);
    return settled
      .filter((r): r is PromiseFulfilledResult<DispatchResult | void> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((r): r is DispatchResult => r !== undefined);
  }

  private checkAttachmentLimits(
    modelId: ModelType,
    attachments: Attachment[],
    traceId: string,
  ): { skip: boolean; batched: Attachment[][] } | null {
    if (attachments.length === 0) return null;
    const fileInfos = FileManager.toFileInfos(attachments);
    const checker = new FileLimitChecker();
    const checkResult = checker.checkModel(modelId, fileInfos);

    if (!checkResult.canUpload) {
      const reasons: string[] = [];
      if (fileInfos.length > checkResult.maxFiles)
        reasons.push(`文件数${fileInfos.length}超过上限${checkResult.maxFiles}`);
      if (checkResult.oversizedFiles.length > 0)
        reasons.push(`${checkResult.oversizedFiles.length}个文件超大小限制`);
      if (checkResult.unsupportedFiles.length > 0)
        reasons.push(`${checkResult.unsupportedFiles.length}个文件类型不支持`);
      const reason = reasons.join('; ');
      logger.warn(MODULE, traceId, '跳过 ' + modelId + ': ' + reason);
      return { skip: true, batched: [] };
    }

    const maxFiles = checkResult.maxFiles;
    const totalBatches = Math.ceil(attachments.length / maxFiles);
    if (totalBatches > 1) logger.info(MODULE, traceId, modelId + ' 分 ' + totalBatches + ' 批');

    const batched: Attachment[][] = [];
    for (let i = 0; i < totalBatches; i++) {
      const start = i * maxFiles;
      const end = Math.min(start + maxFiles, attachments.length);
      batched.push(attachments.slice(start, end));
    }
    return { skip: false, batched };
  }

  private async sendBatches(
    tabId: number,
    taskId: string,
    question: string,
    batchedAttachments: Attachment[][],
    traceId: string,
    startNew: boolean,
  ): Promise<boolean> {
    const promptPrefix = await getPrefix();
    const prefixed = promptPrefix + question;
    for (let b = 0; b < batchedAttachments.length; b++) {
      let sent = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          await chrome.tabs.get(tabId);
          await chrome.tabs.sendMessage(tabId, {
            channel: 'SEND_PROMPT',
            payload: {
              taskId, question: prefixed,
              attachments: batchedAttachments[b],
              batchIndex: b,
              totalBatches: batchedAttachments.length,
              startNew,
            },
            trace_id: traceId,
          });
          sent = true;
          break;
        } catch {
          if (attempt < 9) await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (!sent) {
        logger.warn(MODULE, traceId, `batch ${b}/${batchedAttachments.length} 发送失败`);
        return false;
      }
    }
    return true;
  }

  private enqueueDispatch(
    traceId: string,
    taskId: string,
    question: string,
    attachments: Attachment[],
    modelId: ModelType,
    conversationUrl?: string,
  ): Promise<DispatchResult | void> {
    return new Promise<DispatchResult | void>((resolve) => {
      this.queue.enqueue(async () => {
        try {
          logger.debug(MODULE, traceId, '分发到: ' + modelId);

          const limitResult = this.checkAttachmentLimits(modelId, attachments, traceId);
          if (limitResult?.skip) {
            logger.info(MODULE, traceId, `跳过 ${modelId}: 文件限制检查未通过`);
            resolve({ modelId, success: true, tabId: 0, uploadSkipped: true, batchCount: 0 });
            return;
          }
          const batchedAttachments = limitResult?.batched ?? [attachments];

          const { tabId, isNew } = await this.windowManager.openOrReuseTab(modelId, conversationUrl);
          this.windowManager.assignTabToTask(tabId, taskId, modelId);
          logger.info(MODULE, traceId, modelId + ' tabId=' + tabId + ' convUrl=' + (conversationUrl || '主页') + ' isNew=' + isNew);

          if (isNew) {
            const ready = await waitForTabReady(tabId, 120000);
            if (!ready) logger.info(MODULE, traceId, modelId + ' 握手未到，开始轮询发送');
            else await new Promise((r) => setTimeout(r, 500));
          } else {
            logger.info(MODULE, traceId, modelId + ' 复用已有标签，跳过握手');
          }

          logger.info(MODULE, traceId, `开始发送到 tab ${tabId}: 问题="${question.substring(0, 30)}" 附件数=${batchedAttachments[0]?.length || 0} batch数=${batchedAttachments.length}`);
          const ok = await this.sendBatches(tabId, taskId, question, batchedAttachments, traceId, !conversationUrl);
          if (!ok) {
            logger.warn(MODULE, traceId, `${modelId} 发送超时`);
            resolve({ modelId, success: false, tabId, error: '发送超时: content script 未响应', batchCount: 0 });
            return;
          }

          resolve({ modelId, success: true, tabId, uploadSkipped: false, batchCount: batchedAttachments.length });
          logger.info(MODULE, traceId, modelId + ' 分发成功');
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          resolve({ modelId, success: false, tabId: 0, error: '分发失败: ' + errorMsg, batchCount: 0 });
          logger.error(MODULE, traceId, modelId + ' 分发失败: ' + errorMsg);
        }
      });
    });
  }
}
