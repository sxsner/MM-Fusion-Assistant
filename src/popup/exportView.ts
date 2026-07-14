import DOMPurify from 'dompurify'; // [BUG-FIX] F9 - 导入 DOMPurify 用于 XSS 防护

const MODEL_LABELS: Record<string, string> = {
  chatgpt: 'GPT',
  claude: 'Claud',
  gemini: 'Gmini',
  deepseek: 'DSeek',
  grok: 'Grok',
  doubao: 'Seed',
  glm: 'GLM',
  qwne: 'Qwne',
  hunyuan: 'Hy',
  kimi: 'Kimi',
  minimax: 'Nimax',
  longcat: 'LCat',
  stepfun: 'Step',
  mimo: 'MiMo',
};

function label(id: string): string {
  return MODEL_LABELS[id] || id.charAt(0).toUpperCase() + id.slice(1);
}

export class ExportManager {
  static exportMarkdown(
    question: string,
    modelResults: Array<{ modelId: string; content: string }>,
    summary?: string,
  ): void {
    const md = this.buildMarkdown(question, modelResults, summary);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    this.downloadBlob(blob, 'omnicast-export.md');
  }

  static async exportPDF(
    question: string,
    modelResults: Array<{ modelId: string; content: string }>,
    summary?: string,
  ): Promise<void> {
    const md = this.buildMarkdown(question, modelResults, summary);
    const html = this.buildPrintHtml(md);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin'); // [BUG-FIX] F9 - 添加 sandbox 属性限制 iframe 权限
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    const contentWindow = iframe.contentWindow; // [BUG-FIX] B-014 - 添加 null guard 避免非空断言
    if (!contentWindow) { document.body.removeChild(iframe); return; }
    const doc = contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
      setTimeout(resolve, 500);
    });
    contentWindow.focus();
    contentWindow.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    }, 1000);
  }

  static exportText(
    question: string,
    modelResults: Array<{ modelId: string; content: string }>,
    summary?: string,
  ): void {
    const text = this.buildPlainText(question, modelResults, summary);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    this.downloadBlob(blob, 'omnicast-export.txt');
  }

  static generateShareLink(summary: string): string {
    const encoded = encodeURIComponent(summary);
    return `data:text/plain;charset=utf-8,${encoded}`;
  }

  private static buildMarkdown(
    question: string,
    modelResults: Array<{ modelId: string; content: string }>,
    summary?: string,
  ): string {
    const lines: string[] = ['# \u591A\u6A21\u578B\u95EE\u7B54\u7ED3\u679C', '', '## \u95EE\u9898', '', question, ''];
    lines.push('## \u5404\u6A21\u578B\u56DE\u7B54', '');
    for (const result of modelResults) {
      lines.push(`### ${label(result.modelId)}`, '', result.content, '', '---', '');
    }
    if (summary) {
      lines.push('## \u6C47\u603B\u7ED3\u679C', '', summary, '');
    }
    return lines.join('\n');
  }

  private static buildPlainText(
    question: string,
    modelResults: Array<{ modelId: string; content: string }>,
    summary?: string,
  ): string {
    const lines: string[] = ['\u591A\u6A21\u578B\u95EE\u7B54\u7ED3\u679C', '', '\u95EE\u9898:', '', question, ''];
    lines.push('\u5404\u6A21\u578B\u56DE\u7B54:', '');
    for (const result of modelResults) {
      lines.push(`${label(result.modelId)}:`, '', result.content, '', '---', '');
    }
    if (summary) {
      lines.push('\u6C47\u603B\u7ED3\u679C:', '', summary, '');
    }
    return lines.join('\n');
  }

  private static buildPrintHtml(markdown: string): string {
    const content = markdown
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/### (.+)/g, '<h3>$1</h3>')
      .replace(/## (.+)/g, '<h2>$1</h2>')
      .replace(/# (.+)/g, '<h1>$1</h1>')
      .replace(/---/g, '<hr>')
      .replace(/\n/g, '<br>');
    // [BUG-FIX] F9 - 通过 DOMPurify 净化 HTML 防止 XSS 攻击
    const sanitized = DOMPurify.sanitize(content);
    return [
      '<!DOCTYPE html>',
      '<html><head><meta charset="utf-8"><title>OmniCast</title>',
      '<style>body{font-family:sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.6}</style>',
      '</head><body>',
      sanitized,
      '</body></html>',
    ].join('');
  }

  private static downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
