import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

marked.use({
  renderer: {
    code(code: string, infostring: string | undefined, _escaped: boolean): string {
      const lang = infostring || '';
      const validLang = lang && hljs.getLanguage(lang);
      const highlighted = validLang
        ? hljs.highlight(code, { language: lang }).value
        : code;
      const langClass = lang ? ` language-${lang}` : '';
      return `<pre><code class="hljs${langClass}">${highlighted}</code></pre>`;
    },
  },
});

export class MarkdownRenderer {
  render(markdown: string): string {
    const raw = marked.parse(markdown);
    const html = typeof raw === 'string' ? raw : '';
    return DOMPurify.sanitize(html);
  }

  appendStream(existing: string, incoming: string): string {
    const newHtml = this.render(incoming);
    return existing + newHtml;
  }
}
