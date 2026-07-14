# MM-Fusion-Assistant / 多模型聚合助手

**一次输入，多端并发，聚合对比，智能终审**

一款 Chrome 扩展，向多个 AI 模型同时发送提示词，收集各模型回复并排对比，最终自动生成智能聚合总结。

---

## 目录

- [快速开始](#快速开始)
- [使用流程](#使用流程)
- [模块说明](#模块说明)
- [支持的模型](#支持的模型)
- [架构](#架构)
- [开发](#开发)
- [技术栈](#技术栈)
- [许可证](#许可证)

---

## 快速开始

```bash
npm install
npm run build
```

打开 Chrome → `chrome://extensions` → 开启开发者模式 → 加载已解压的扩展程序 → 选择 `dist/` 目录

然后在浏览器工具栏固定扩展图标，点击图标打开侧边栏即可使用。

---

## 使用流程

### 第一步：选择模型

侧边栏 → **设置** 标签页，勾选要使用的 AI 模型（默认全选）。

配置汇总方式（必须）：

| 模式 | 说明 | 配置方式 |
|------|------|---------|
| **API 模式** | 通过 API 调用汇总模型 | 选择提供商（OpenAI/Claude/Gemini/自定义），输入 API Key，点击验证连接 |
| **Web 模式** | 打开模型网页自动填写汇总 | 选择一个网页模型（如 ChatGPT） |

### 第二步：发送提问

1. 切换到 **首页** 标签页
2. 在输入框输入问题，可点 **+** 按钮上传文件附件
3. 点击 **发送**
4. 扩展会自动打开每个模型的弹窗页面，自动填入问题并发送

### 第三步：查看结果

- 顶部模型标签行显示状态：灰色=等待中，蓝色=生成中，绿色=完成，红色=出错
- 点击某个模型标签，右侧查看该模型的完整回复
- **同步回答** 按钮手动刷新，**清空** 按钮重置

### 第四步：汇总与评分

1. 所有模型回复完成后，点击 **生成汇总**，扩展自动综合所有模型输出生成终审总结
2. 汇总以 Markdown 显示，可 **复制** 或 **导出**（Markdown/TXT/PDF）
3. 点击 **计入评分** 让汇总模型给每个模型的回答打分（0-10 分）

### 第五步：历史记录

切到 **历史** 标签页，浏览过往对话，支持关键词搜索。点击 **继续** 可恢复之前对话上下文。

### 第六步：管理后台标签页

切到 **后台** 标签页，查看所有模型弹窗的状态，可打开、切换、关闭标签页。

---

## 模块说明

### 后台模块 (`src/background/`)

扩展的核心大脑 —— Service Worker，管理所有后台逻辑。

| 模块 | 文件 | 功能 |
|------|------|------|
| **消息路由** | `messageRouter.ts` | 发布/订阅模式的消息路由器，支持中间件管线 |
| **入口** | `sw.ts` | Service Worker 入口，注册所有消息处理器，协调各模块 |
| **提示词分发** | `promptDispatcher.ts` | 为每个目标模型打开弹窗、等待握手、发送提示词，通过并发队列控制同时分发数 |
| **响应聚合** | `responseAggregator.ts` | 追踪每个模型的回复状态（等待/生成中/完成/失败），全部完成后触发回调 |
| **窗口管理** | `windowManager.ts` | 每个模型对应一个独立弹窗（480×800），管理创建/复用/关闭/标签页映射 |
| **帧注册表** | `frameRegistry.ts` | 双向映射：任务ID → 模型ID → 标签页ID |
| **任务管理** | `taskManager.ts` | 内存中的任务增删改查 |
| **历史管理** | `historyManager.ts` | 历史记录持久化到 chrome.storage，支持搜索和恢复 |
| **限流器** | `throttler.ts` | 每个模型独立限流（最小间隔 15 秒，3 次错误后暂停 5 分钟） |
| **文件管理** | `fileManager.ts` | 浏览器 File 对象转内部 Attachment（base64） |
| **文件限制检查** | `fileLimitChecker.ts` | 检查文件是否符合各模型的上传限制 |
| **外部模型客户端** | `externalModelClient.ts` | 汇总功能的后端，支持 OpenAI/Claude/Gemini/自定义 API 的同步和流式调用 |
| **汇总管理器** | `summaryManager.ts` | 协调汇总流程：构建提示词 → 预算控制 → API 或网页模式执行 |
| **网页汇总适配** | `summaryWebAdapter.ts` | 备用方案：打开模型网页，将各模型回复作为文件上传让其汇总 |

### 内容脚本模块 (`src/content/`)

注入到各 AI 模型页面的脚本。

| 模块 | 文件 | 功能 |
|------|------|------|
| **入口** | `main.ts` | 监听 SEND_PROMPT/GET_RESPONSE/SUMMARY_REQUEST 消息，获取适配器执行操作 |
| **帧握手** | `frameHandshake.ts` | 页面加载后通知后台"我已就绪" |
| **回复观察器** | `replyObserver.ts` | 基于 MutationObserver 监听回复变化 |
| **文件上传** | `fileUploadHelpers.ts` | 将内部 Attachment 转换回 File 并注入到文件输入框 |
| **控制台中继** | `consoleRelay.ts` | 将页面的 console.log 中继到后台用于调试 |
| **DOM 安全工具** | `domSafeUtils.ts` | 基于 DOMPurify 的安全 DOM 操作 |

#### 站点适配器 (`src/content/sites/`)

每个 AI 平台一个适配器，实现统一的 `SiteAdapter` 接口：

```
fillAndSend(question, attachments)  — 填入问题并发送
uploadFiles(files)                   — 上传文件附件
isGenerating()                       — 是否正在生成回复
readResponse()                       — 读取回复内容
getUploadLimits()                    — 获取上传限制
```

| 适配器 | 文件 | 对应平台 |
|--------|------|---------|
| `ChatGPTAdapter` | `chatgpt.ts` | ChatGPT（chatgpt.com / chat.openai.com） |
| `ClaudeAdapter` | `claude.ts` | Claude（claude.ai） |
| `GeminiAdapter` | `gemini.ts` | Gemini（gemini.google.com） |
| `DeepSeekAdapter` | `deepseek.ts` | DeepSeek（chat.deepseek.com） |
| `GrokAdapter` | `grok.ts` | Grok（grok.com） |
| `DoubaoAdapter` | `doubao.ts` | 豆包（www.doubao.com） |
| `GLMAdapter` | `glm.ts` | 智谱 GLM（chat.z.ai） |
| `QwneAdapter` | `qwne.ts` | 通义千问（chat.qwen.ai） |
| `HunyuanAdapter` | `hunyuan.ts` | 腾讯混元（aistudio.tencent.com） |
| `KimiAdapter` | `kimi.ts` | Kimi（www.kimi.com） |
| `MiniMaxAdapter` | `minimax.ts` | MiniMax（agent.minimaxi.com） |
| `LongCatAdapter` | `longcat.ts` | LongCat（longcat.chat） |
| `StepFunAdapter` | `stepfun.ts` | 阶跃星辰（chat.stepfun.com） |
| `MiMoAdapter` | `mimo.ts` | 小米 MiMo（aistudio.xiaomimimo.com） |

### 侧边栏面板 (`src/popup/`)

用户看到和操作的全部 UI。

| 模块 | 文件 | 功能 |
|------|------|------|
| **应用根** | `app.ts` | 根协调器：标签页系统、会话持久化、消息监听、子视图装配 |
| **输入区** | `composerView.ts` | 文本框 + 发送/清空/同步按钮 + 文件附件按钮 |
| **模型选择器** | `modelSelector.ts` | 14 个模型的勾选网格，带品牌色圆点 |
| **结果网格** | `resultsGridView.ts` | 单模型回复显示，点击标签切换不同模型的回复 |
| **汇总视图** | `summaryView.ts` | 生成汇总按钮 + 汇总内容显示 + 复制/导出/评分 |
| **历史视图** | `historyView.ts` | 可搜索的历史对话列表，支持恢复继续 |
| **设置视图** | `settingsView.ts` | 模型开关、汇总模式、API 配置、时序参数 |
| **提示词编辑** | `promptView.ts` | 自定义三个提示词：模型前缀、汇总提示词、评分提示词 |
| **评分面板** | `scoreView.ts` | 模型评分表（总分/平均分/次数），手动评分，导入/导出 JSON |
| **后台标签页** | `backgroundTabsView.ts` | 所有模型弹窗的状态面板，可打开/切换/关闭 |
| **导出视图** | `exportView.ts` | 导出为 Markdown/TXT/PDF |
| **Markdown 渲染** | `markdownRenderer.ts` | marked + highlight.js + DOMPurify 管线 |
| **调试控制台** | `debugConsole.ts` | 应用内日志查看器 |
| **文件拖放** | `fileDropZone.ts` | 文件拖放上传区域 |
| **限制警告** | `limitWarningModal.ts` | 文件超限时的警告对话框 |
| **iframe 宿主** | `iframeHost.ts` | iframe 消息监听器 |

### 核心模块 (`src/core/`)

| 模块 | 文件 | 功能 |
|------|------|------|
| **提示词构建器** | `promptBuilder.ts` | 构建结构化汇总提示词（原始问题 + 各模型回答 + 汇总要求） |
| **上下文预算** | `contextBudget.ts` | Token 预算控制，逐步截断最长的模型回复直到符合预算 |

### 共享模块 (`src/shared/`)

| 模块 | 文件 | 功能 |
|------|------|------|
| **类型定义** | `types.ts` | 全部 TypeScript 类型：ModelType、Task、Attachment、ModelResult、SiteAdapter 接口等 |
| **常量** | `constants.ts` | 模型 ID 列表、超时时间、并发数、附件大小限制 |
| **存储** | `store.ts` | 三个存储实例：模型选择、汇总设置、限流设置 |
| **基础存储** | `baseStore.ts` | 泛型 BaseStore，防抖持久化、变更监听、深拷贝 |
| **日志** | `logger.ts` | 带敏感信息脱敏的模块化日志，支中继到后台 |
| **日志缓冲** | `logBuffer.ts` | 内存环形缓冲区（500 条），尾部持久化 |
| **错误工具** | `errors.ts` | ApiResponse 信封：success() / failure() 工厂函数 |
| **类型守卫** | `guards.ts` | 运行时类型检查：isModelType、isModelResult |

### 基础设施 (`src/infrastructure/`)

| 模块 | 文件 | 功能 |
|------|------|------|
| **并发队列** | `queue.ts` | 带优先级和 TTL 的并发队列，控制模型分发的并行度 |
| **安全存储** | `secureStorage.ts` | AES-256-GCM 加密层（Web Crypto API），用于 API Key 存储 |

### 其他

| 模块 | 文件 | 功能 |
|------|------|------|
| **消息路由器** | `router/message-router.ts` | 独立消息路由器，带运行时校验和中间件管线 |
| **适配器接口** | `adapters/interface.ts` | 重新导出 SiteAdapter 类型和 getAdapter 函数 |

---

## 支持的模型

| 平台 | 域名 | 状态 |
|------|------|------|
| ChatGPT | chatgpt.com / chat.openai.com | ✅ |
| Claude | claude.ai | ✅ |
| Gemini | gemini.google.com | ✅ |
| DeepSeek | chat.deepseek.com | ✅ |
| Grok | grok.com | ✅ |
| 豆包 | doubao.com | ✅ |
| 智谱 GLM | chat.z.ai | ✅ |
| 通义千问 (Qwne) | chat.qwen.ai | ✅ |
| QwnC | — | ✅ |
| 腾讯混元 | aistudio.tencent.com | ✅ |
| Kimi | kimi.com | ✅ |
| MiniMax | agent.minimaxi.com | ✅ |
| LongCat | longcat.chat | ✅ |
| 阶跃星辰 | chat.stepfun.com | ✅ |
| 小米 MiMo | aistudio.xiaomimimo.com | ✅ |

---

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    侧边栏面板 (Side Panel)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐ │
│  │  输入区   │ │ 结果网格 │ │ 汇总视图 │ │ 历史/设置/...  │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                  Service Worker (后台)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐ │
│  │ 消息路由  │ │ 提示分发  │ │ 响应聚合  │ │ 限流/历史/文件  │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│              内容脚本 (注入到各 AI 模型页面)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐ │
│  │ ChatGPT  │ │  Claude  │ │  Gemini  │ │ DeepSeek ...   │ │
│  │ 适配器   │ │  适配器  │ │  适配器   │ │ 14 个适配器     │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

```
用户输入 → 侧边栏发送 task:submit 消息
         → Service Worker 收到后创建 Task
         → 提示分发器为每个模型打开弹窗
         → 内容脚本接收 SEND_PROMPT，调用对应适配器填入问题并发送
         → 适配器监测回复，完成后回传 model:result
         → Service Worker 收集所有结果，转发到侧边栏更新 UI
         → 全部完成后用户可生成汇总总结
```

### 关键设计

- **消息驱动**：所有模块间通信通过 `chrome.runtime.sendMessage` 的 typed channel
- **信封模式**：每条消息 `{channel, payload, trace_id}` 结构
- **并发控制**：默认同时分发 2 个模型（可配置），通过 `ConcurrentQueue` 管理
- **限流保护**：每个模型独立限流，最小间隔 15 秒，连续错误自动暂停
- **安全存储**：API Key 通过 AES-256-GCM 加密后存储

---

## 开发

```bash
# 安装依赖
npm install

# 监听模式开发
npm run dev

# 类型检查
npm run lint

# 单元测试
npm run test:unit

# E2E 测试（有头浏览器）
npm run test:e2e

# 完整验证（构建 + 单元测试 + E2E）
npm run verify
```

### 构建产物

Webpack 打包输出三个入口：

| 入口 | 源文件 | 产物 |
|------|--------|------|
| Service Worker | `src/background/sw.ts` | `dist/background.js` |
| 内容脚本 | `src/content/main.ts` | `dist/content/main.js` |
| 侧边栏面板 | `src/popup/app.ts` | `dist/popup.js` |

---

## 技术栈

| 层 | 技术 |
|----|------|
| 语言 | TypeScript |
| 构建 | Webpack 5 + ts-loader |
| 单元测试 | Vitest |
| E2E 测试 | Playwright |
| 运行时 | Chrome Extension Manifest V3 |
| 加密 | Web Crypto API (AES-256-GCM) |
| Markdown | marked + highlight.js + DOMPurify |

## 参与贡献

欢迎提交 Issue 或 Pull Request。

---

## 许可证

[MIT](LICENSE)
