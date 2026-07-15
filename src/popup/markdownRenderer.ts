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
    html(html: string): string {
      return html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
  },
});

export class MarkdownRenderer {
  render(markdown: string): string {
    const raw = marked.parse(markdown);
    const html = typeof raw === 'string' ? raw : '';
    return DOMPurify.sanitize(html, { FORBID_TAGS: ['style'] });
  }

  appendStream(existing: string, incoming: string): string {
    const newHtml = this.render(incoming);
    return existing + newHtml;
  }
}
