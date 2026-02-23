# AI 自动化办公助手

一个基于 AI 的智能办公自动化工具，通过自然语言描述需求，自动生成并执行办公自动化脚本。

## ✨ 主要特性

- 🤖 **智能需求理解**：使用 AI 理解用户的办公需求
- 📝 **自动代码生成**：根据需求自动生成 Python 脚本
- 🔄 **工作流引擎**：PM → Planner → Coder → Reviewer 完整工作流
- 📁 **文件管理**：支持多种文件格式（Excel、Word、PDF 等）
- 🎯 **模板系统**：保存成功任务为模板，快速复用
- 💬 **会话管理**：多会话并发执行，互不干扰
- 🖥️ **跨平台**：支持 Electron 桌面应用和浏览器访问

## 🚀 快速开始

### 环境要求·  

- Python 3.8-3.12
- Node.js 16+
- npm 或 yarn

### 安装步骤

1. **克隆项目**

```bash
git clone <your-repo-url>
cd userKiller
```

2. **配置 API 密钥**

复制配置文件并填入你的 API 密钥：

```bash
cd backend
cp config.example.md config.json
```

编辑 `backend/config.json`，填入你的 DeepSeek API 密钥。

3. **安装后端依赖**

```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

4. **安装前端依赖**

```bash
cd ../frontend
npm install
```

5. **安装 Electron 依赖**（可选）

```bash
cd ../electron
npm install
```

### 启动应用

#### 开发模式

打开 3 个终端窗口：

**终端 1 - 后端：**
```bash
cd backend
source venv/bin/activate
python app.py
```

**终端 2 - 前端：**
```bash
cd frontend
npm run dev
```

**终端 3 - Electron：**
```bash
cd electron
NODE_ENV=development npm start
```

或者直接在浏览器访问：http://localhost:3000

#### 使用启动脚本

macOS/Linux:
```bash
chmod +x start.sh
./start.sh
```

Windows:
```bash
start.bat
```

## 📖 文档

- [启动步骤详解](./启动步骤.md)
- [API 接口文档](./API接口文档.md)
- [配置说明](./backend/config.example.md)

## 🎯 使用示例

1. **创建新会话**：点击左侧边栏的"+"按钮
2. **上传文件**：拖拽或点击上传按钮，上传需要处理的文件
3. **描述需求**：用自然语言描述你的办公需求，例如：
   - "将员工信息表按部门分类统计"
   - "批量生成工资条"
   - "合并多个 Excel 文件"
4. **等待执行**：AI 会自动分析需求、生成代码并执行
5. **下载结果**：从输出区下载处理后的文件

## 🏗️ 项目结构

```
userKiller/
├── backend/              # 后端服务
│   ├── modules/         # AI 模块（PM、Planner、Coder、Reviewer）
│   ├── workspaces/      # 会话工作区
│   ├── app.py          # Flask 应用入口
│   ├── workflow_engine.py  # 工作流引擎
│   └── requirements.txt    # Python 依赖
├── frontend/            # 前端应用
│   ├── src/
│   │   ├── components/  # React 组件
│   │   └── utils/       # 工具函数
│   └── package.json
├── electron/            # Electron 桌面应用
│   ├── main.js
│   └── preload.js
└── README.md
```

## 🔧 技术栈

### 后端
- Python 3.8+
- Flask
- OpenAI API (DeepSeek)
- pandas, openpyxl, python-docx

### 前端
- React 18
- Vite
- Axios
- lucide-react
- framer-motion

### 桌面应用
- Electron

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🙏 致谢

- [DeepSeek](https://www.deepseek.com/) - AI 模型支持
- [OpenAI](https://openai.com/) - API 接口

## 📞 联系方式

如有问题或建议，请提交 Issue。

---

**注意**：使用前请确保已正确配置 API 密钥，并遵守相关服务的使用条款。
# userkiller
