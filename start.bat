@echo off
chcp 65001 >nul
echo 🚀 启动AI自动化办公软件...
echo.

REM 检查 Node.js / npm
where node >nul 2>nul || (
    echo ❌ 错误：未找到 Node.js，请先安装 Node.js 18+
    exit /b 1
)
where npm >nul 2>nul || (
    echo ❌ 错误：未找到 npm，请先安装 npm
    exit /b 1
)

REM 安装后端依赖
if not exist "backend\node_modules" (
    echo 📦 安装后端依赖...
    call npm --prefix backend install
)

REM 安装前端依赖
if not exist "frontend\node_modules" (
    echo 📦 安装前端依赖...
    call npm --prefix frontend install
)

REM 启动后端
echo 📦 启动后端服务...
start "后端服务" cmd /k "npm --prefix backend run dev"
timeout /t 3 /nobreak >nul

REM 启动前端
echo 🎨 启动前端服务...
start "前端服务" cmd /k "npm --prefix frontend run dev"
timeout /t 5 /nobreak >nul

REM 启动Electron
echo 🖥️  启动Electron应用...
cd electron
npm run dev

echo.
echo ✅ 应用已关闭
pause

