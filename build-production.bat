@echo off
chcp 65001 >nul
echo 🏗️  开始生产构建...
echo.

echo ==^> 1/3 构建后端
call npm --prefix backend run build
if errorlevel 1 (
    echo ❌ 后端构建失败
    pause
    exit /b 1
)
echo ✅ 后端构建完成
echo.

echo ==^> 2/3 构建前端
call npm --prefix frontend run build
if errorlevel 1 (
    echo ❌ 前端构建失败
    pause
    exit /b 1
)
echo ✅ 前端构建完成
echo.

echo ==^> 3/3 打包 Electron
call npm --prefix electron run build
if errorlevel 1 (
    echo ❌ Electron 打包失败
    pause
    exit /b 1
)
echo ✅ Electron 打包完成
echo.

echo 🎉 生产构建完成！
echo    安装包位于: electron\dist\
echo.
echo 如需测试生产模式（不打包），运行：
echo    cd electron ^&^& npm start
echo.
pause
