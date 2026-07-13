import { logger } from '../shared/logger';

interface SiteState {
  errorCount: number;
  pauseUntil: number;
  recoveryLogged: boolean;
}

export class Throttler {
  // [BUG-FIX] F20 - lastSendTime 改为 per-model Map，消除全局竞态
  private lastSendTime: Map<string, number> = new Map();
  private sites = new Map<string, SiteState>();

  readonly config = {
    minIntervalMs: 15000,
    jitterMs: 5000,
    autoPauseMs: 5 * 60 * 1000,
    maxErrorsBeforePause: 3,
  };

  checkSend(modelId: string): { allowed: boolean; waitMs: number } {
    const now = Date.now();
    const state = this.sites.get(modelId);

    if (state && state.pauseUntil > now) {
      const waitMs = state.pauseUntil - now;
      logger.warn('THR', '-', '节流阻止: ' + modelId + ' 还需等待 ' + waitMs + 'ms');
      return { allowed: false, waitMs };
    }

    if (state && state.pauseUntil > 0 && state.pauseUntil <= now && !state.recoveryLogged) {
      state.recoveryLogged = true;
      logger.info('THR', '-', '恢复站点: ' + modelId);
    }

    // [BUG-FIX] F20 - 改为读取 per-model lastSendTime
    const modelLastSend = this.lastSendTime.get(modelId) ?? 0;
    if (modelLastSend > 0) {
      const elapsed = now - modelLastSend;
      const jitter = (Math.random() * 2 - 1) * this.config.jitterMs;
      const effectiveInterval = this.config.minIntervalMs + jitter;

      if (elapsed < effectiveInterval) {
        const waitMs = Math.ceil(effectiveInterval - elapsed);
        logger.warn('THR', '-', '节流阻止: ' + modelId + ' 还需等待 ' + waitMs + 'ms');
        return { allowed: false, waitMs };
      }
    }

    return { allowed: true, waitMs: 0 };
  }

  // [BUG-FIX] F20 - 写入 per-model lastSendTime
  recordSend(modelId: string): void {
    this.lastSendTime.set(modelId, Date.now());
    const state = this.sites.get(modelId);
    if (state) {
      state.errorCount = 0;
    }
  }

  // [BUG-FIX] F20 - 新增原子 checkAndRecord 方法，避免 TOCTOU 竞态
  checkAndRecord(modelId: string): { allowed: boolean; waitMs: number } {
    const result = this.checkSend(modelId);
    if (result.allowed) {
      this.recordSend(modelId);
    }
    return result;
  }

  recordError(modelId: string): void {
    let state = this.sites.get(modelId);
    if (!state) {
      state = { errorCount: 0, pauseUntil: 0, recoveryLogged: false };
      this.sites.set(modelId, state);
    }
    state.errorCount++;

    if (state.errorCount >= this.config.maxErrorsBeforePause) {
      const pauseMs = this.config.autoPauseMs;
      state.pauseUntil = Date.now() + pauseMs;
      state.errorCount = 0;
      state.recoveryLogged = false;
      logger.error('THR', '-', '暂停站点: ' + modelId + ' ' + pauseMs + 'ms');
    }
  }

  getStatus(modelId: string): { lastSendTime: number; pauseUntil: number; errorCount: number } {
    const state = this.sites.get(modelId);
    return {
      // [BUG-FIX] F20 - 返回 per-model lastSendTime
      lastSendTime: this.lastSendTime.get(modelId) ?? 0,
      pauseUntil: state?.pauseUntil ?? 0,
      errorCount: state?.errorCount ?? 0,
    };
  }
}
