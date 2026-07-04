# AI 自动化办公助手

一个面向办公场景的 AI 自动化工具。用户通过自然语言提出需求，系统在会话工作区内观察上传文件、理解表格/文档结构、调用模型决策工具链，并将生成结果输出到独立的 `output` 目录。

## 主要特性

- 智能需求理解：基于 DeepSeek/OpenAI 兼容接口理解用户目标
- 文件工作区：按会话隔离上传文件、输出文件和执行状态
- 表格与文档处理：支持 Excel/CSV 预览汇总、Word 结构读取与模板回填等能力
- Agent 工具循环：观察文件、读取内容、生成结果、校验输出、必要时请求澄清
- 模板系统：可将成功任务保存为模板并复用
- 桌面与浏览器访问：支持 Vite Web 前端和 Electron 桌面壳

## 快速开始

### 环境要求

- Node.js 18+
- npm

### 配置 API 密钥

```bash
cd backend
cp config.example.json config.json
```

编辑 `backend/config.json`，填入 DeepSeek API Key。也可以使用环境变量 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`MAX_AGENT_TURNS` 覆盖配置。

### 安装依赖

```bash
npm --prefix backend install
npm --prefix frontend install
npm --prefix electron install
```

### 启动开发环境

macOS/Linux：

```bash
chmod +x start.sh
./start.sh
```

如需同时启动 Electron：

```bash
START_ELECTRON=1 ./start.sh
```

Windows：

```bat
start.bat
```

也可以分别启动：

```bash
npm --prefix backend run dev
npm --prefix frontend run dev
```

浏览器访问：`http://localhost:3000`。后端默认端口：`5001`。

### 生产构建

使用一键构建脚本：

macOS/Linux：

```bash
chmod +x build-production.sh
./build-production.sh
```

Windows：

```bat
build-production.bat
```

构建完成后，安装包位于 `electron/dist/`。

如需测试生产模式（不打包）：

```bash
# 先构建
npm --prefix backend run build
npm --prefix frontend run build

# 启动生产模式
cd electron
npm start
```

详细说明见 `启动步骤.md`。

## 项目结构

```text
userkiller/
├── backend/                 # Node.js + TypeScript 后端
│   ├── src/
│   │   ├── index.ts         # Express API 入口
│   │   ├── fsUtils.ts       # 文件、配置与路径工具
│   │   ├── types.ts         # 会话、任务、模板、技能等类型
│   │   └── services/        # Agent、模型、MCP、会话、模板、表格/文档服务
│   ├── config.example.json  # 配置示例
│   ├── package.json
│   └── tsconfig.json
├── frontend/                # React + Vite 前端
│   ├── src/components/      # 会话侧栏、聊天区、工作区、模板库等组件
│   ├── src/utils/api.js     # 前端 API 封装
│   └── package.json
├── electron/                # Electron 桌面应用入口
│   ├── main.js
│   ├── preload.js
│   └── package.json
├── start.sh                 # macOS/Linux 一键启动脚本
└── 启动步骤.md              # 更详细的启动说明
```

## 技术栈

### 后端

- Node.js / TypeScript
- Express
- OpenAI SDK（连接 DeepSeek 兼容接口）
- MCP filesystem server
- xlsx、mammoth、jszip、fast-xml-parser

### 前端

- React 18
- Vite
- Axios
- lucide-react

### 桌面应用

- Electron

## 使用流程

1. 创建或选择会话。
2. 上传需要处理的 Excel、CSV、Word、文本等文件。
3. 用自然语言描述任务，例如“汇总各部门人数并生成 Excel 结果”。
4. 系统执行 Agent 工具循环，必要时向用户澄清。
5. 在输出区下载或打开生成文件。

## 商用注意事项

- 不要提交 `backend/config.json`、`backend/data/`、`node_modules/`、构建产物和本地系统文件。
- 生产环境应使用构建产物、进程守护、日志采集和密钥管理，而不是开发模式启动命令。
- 上传文件和模型请求可能包含敏感数据，商用前需补齐鉴权、审计、数据保留策略和用户授权提示。
