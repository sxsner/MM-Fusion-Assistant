# Multi-Model Copilot

**一次输入，多端并发，聚合对比，智能终审**

一款 Chrome 扩展，支持向多个 AI 模型同时发送提示词，并排对比各模型的回答，最终生成智能聚合总结。

## 功能特性

- **多模型并发** — 一次输入同时发送到 14+ 个 AI 模型
- **并排对比** — 在统一的结果网格中对比所有模型的回复
- **智能聚合** — 自动综合多模型输出，生成终审总结
- **工作台界面** — 侧边栏面板，管理对话、历史记录和设置
- **文件附件** — 上传文件并跨模型共享
- **导出与历史** — 浏览、搜索、导出历史对话记录

## 支持的模型

| 平台 | 域名 | 适配器 |
|------|------|--------|
| ChatGPT | chatgpt.com / chat.openai.com | ✅ |
| Claude | claude.ai | ✅ |
| Gemini | gemini.google.com | ✅ |
| DeepSeek | chat.deepseek.com | ✅ |
| Grok | grok.com | ✅ |
| 豆包 | doubao.com | ✅ |
| 智谱 GLM | chat.z.ai | ✅ |
| 通义千问 | chat.qwen.ai | ✅ |
| 腾讯混元 | aistudio.tencent.com | ✅ |
| Kimi | kimi.com | ✅ |
| MiniMax | agent.minimaxi.com | ✅ |
| LongCat | longcat.chat | ✅ |
| 阶跃星辰 | chat.stepfun.com | ✅ |
| 小米 MiMo | aistudio.xiaomimimo.com | ✅ |

## 架构

```
┌──────────────────────────────────────────────────┐
│                  侧边栏面板                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ 输入区   │ │ 结果网格 │ │   总结 / 导出     │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
├──────────────────────────────────────────────────┤
│              后台 Service Worker                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ 消息路由 │ │ 任务管理 │ │  响应聚合器       │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
├──────────────────────────────────────────────────┤
│              内容脚本（每个模型一个）               │
│  ChatGPT  Claude  Gemini  DeepSeek  Grok  ...    │
└──────────────────────────────────────────────────┘
```

- **内容脚本** — 注入到各 AI 平台页面的站点适配器，负责发送提示词并提取回复
- **后台 SW** — Service Worker，管理消息路由、提示词分发、响应聚合、历史记录和文件管理
- **侧边栏面板** — TypeScript 构建的工作台 UI，包含输入区、结果网格、总结视图、设置和历史记录

## 安装

1. 构建扩展：
   ```bash
   npm install
   npm run build
   ```
2. 打开 Chrome → `chrome://extensions`
3. 开启 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择 `dist/` 目录


## 技术栈

- **语言：** TypeScript
- **构建：** Webpack + ts-loader
- **测试：** Vitest（单元测试）+ Playwright（E2E 测试）
- **运行环境：** Chrome Extension Manifest V3

## 参与贡献

https://github.com/afumu/openteam

## 许可证

[MIT](LICENSE)
