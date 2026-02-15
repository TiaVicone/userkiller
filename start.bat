@echo off
chcp 65001 >nul
echo 🚀 启动AI自动化办公软件...
echo.

REM 检查虚拟环境
if not exist "backend\venv" (
    echo ⚠️  未找到虚拟环境，正在创建...
    cd backend
    python -m venv venv
    echo ✅ 虚拟环境创建成功
    
    echo 📦 安装Python依赖...
    call venv\Scripts\activate
    pip install -r requirements.txt
    echo ✅ 依赖安装完成
    cd ..
) else (
    echo ✅ 虚拟环境已存在
)

REM 启动后端
echo 📦 启动后端服务...
start "后端服务" cmd /k "cd backend && venv\Scripts\activate && python app.py"
timeout /t 3 /nobreak >nul

REM 启动前端
echo 🎨 启动前端服务...
start "前端服务" cmd /k "cd frontend && npm run dev"
timeout /t 5 /nobreak >nul

REM 启动Electron
echo 🖥️  启动Electron应用...
cd electron
set NODE_ENV=development
npm start

echo.
echo ✅ 应用已关闭
pause

