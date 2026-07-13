# Multi-Model Copilot

**一次输入，多端并发，聚合对比，智能终审**

A Chrome Extension that lets you send prompts to multiple AI models simultaneously, compare their responses side by side, and get an intelligent final summary.

## Features

- **Multi-Model Concurrency** — Send one prompt to 14+ AI models at once
- **Side-by-Side Comparison** — View all responses in a unified results grid
- **Intelligent Aggregation** — Automatically synthesizes multi-model outputs into a final summary
- **Workspace UI** — Side panel interface for managing conversations, history, and settings
- **File Attachments** — Upload and attach files across supported models
- **Export & History** — Browse, search, and export past conversation sessions

## Supported Models

| Platform | Domain | Adapter |
|----------|--------|---------|
| ChatGPT | chatgpt.com / chat.openai.com | ✅ |
| Claude | claude.ai | ✅ |
| Gemini | gemini.google.com | ✅ |
| DeepSeek | chat.deepseek.com | ✅ |
| Grok | grok.com | ✅ |
| Doubao | www.doubao.com | ✅ |
| GLM (Zhipu) | chat.z.ai | ✅ |
| Qwen | chat.qwen.ai | ✅ |
| Hunyuan | aistudio.tencent.com | ✅ |
| Kimi | www.kimi.com | ✅ |
| MiniMax | agent.minimaxi.com | ✅ |
| LongCat | longcat.chat | ✅ |
| StepFun | chat.stepfun.com | ✅ |
| MiMo | aistudio.xiaomimimo.com | ✅ |

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  Side Panel                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Composer │ │ Grid     │ │ Summary / Export  │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
├──────────────────────────────────────────────────┤
│              Background Service Worker            │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Router   │ │ Manager  │ │ Aggregator       │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
├──────────────────────────────────────────────────┤
│              Content Scripts (per model)          │
│  ChatGPT  Claude  Gemini  DeepSeek  Grok  ...    │
└──────────────────────────────────────────────────┘
```

- **Content Scripts** — Site-specific adapters that inject into each AI platform's page, send prompts, and extract responses
- **Background SW** — Service worker managing message routing, prompt dispatching, response aggregation, history, and file management
- **Side Panel** — Workspace UI built with TypeScript, featuring composer, results grid, summary view, settings, and history

## Installation

1. Build the extension:
   ```bash
   npm install
   npm run build
   ```
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the `dist/` directory

## Development

```bash
# Install dependencies
npm install

# Watch mode
npm run dev

# Lint (TypeScript check)
npm run lint

# Unit tests
npm run test:unit

# E2E tests (headed Playwright)
npm run test:e2e

# Full verification (build + unit + e2e)
npm run verify
```

## Tech Stack

- **Language:** TypeScript
- **Build:** Webpack + ts-loader
- **Testing:** Vitest (unit) + Playwright (e2e)
- **Runtime:** Chrome Extension Manifest V3

## Contributing

Contributions are welcome! Please open an issue or pull request.

## License

[MIT](LICENSE)
