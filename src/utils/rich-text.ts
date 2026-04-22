import TurndownService from 'turndown';
import { marked } from 'marked';

// Initialize Turndown service
const turndownService = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

// Custom sanitization rules for Odoo
// Odoo often wraps content in divs and adds messy classes or inline styles.
turndownService.addRule('cleanDivs', {
  filter: ['div'],
  replacement: function (content) {
    return '\n\n' + content + '\n\n';
  }
});

turndownService.addRule('cleanSpans', {
  filter: ['span'],
  replacement: function (content) {
    // Return content without span, effectively stripping the span tag
    return content;
  }
});

export function convertMarkdownToHtml(markdown: string): string {
  if (!markdown) return '';
  return marked.parse(markdown) as string;
}

export function convertHtmlToMarkdown(html: string): string {
  if (!html) return '';
  return turndownService.turndown(html);
}
