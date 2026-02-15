#!/bin/bash

echo "🚀 启动AI自动化办公软件..."
echo ""

# 检查Python
if ! command -v python3 &> /dev/null; then
    echo "❌ 错误：未找到Python3，请先安装Python 3.8+"
    exit 1
fi

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误：未找到Node.js，请先安装Node.js 16+"
    exit 1
fi

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# 检查虚拟环境
if [ ! -d "$SCRIPT_DIR/backend/venv" ]; then
    echo "⚠️  未找到虚拟环境，正在创建..."
    cd "$SCRIPT_DIR/backend"
    python3 -m venv venv
    echo "✅ 虚拟环境创建成功"
    
    echo "📦 安装Python依赖..."
    source venv/bin/activate
    pip install -r requirements.txt
    echo "✅ 依赖安装完成"
else
    echo "✅ 虚拟环境已存在"
fi

# 启动后端
echo "📦 启动后端服务..."
cd "$SCRIPT_DIR/backend"
source venv/bin/activate
python app.py &
BACKEND_PID=$!
echo "✅ 后端进程ID: $BACKEND_PID"

# 等待后端启动
sleep 3

# 启动前端
echo "🎨 启动前端服务..."
cd "$SCRIPT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!
echo "✅ 前端进程ID: $FRONTEND_PID"

# 等待前端启动
sleep 5

# 启动Electron
echo "🖥️  启动Electron应用..."
cd "$SCRIPT_DIR/electron"
NODE_ENV=development npm start

# 清理进程
echo ""
echo "🛑 正在停止服务..."
kill $BACKEND_PID 2>/dev/null
kill $FRONTEND_PID 2>/dev/null
echo "✅ 已停止所有服务"

