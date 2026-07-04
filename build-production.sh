#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🏗️  开始生产构建..."
echo

echo "==> 1/3 构建后端"
npm --prefix "$ROOT_DIR/backend" run build
echo "✅ 后端构建完成"
echo

echo "==> 2/3 构建前端"
npm --prefix "$ROOT_DIR/frontend" run build
echo "✅ 前端构建完成"
echo

echo "==> 3/3 打包 Electron"
npm --prefix "$ROOT_DIR/electron" run build
echo "✅ Electron 打包完成"
echo

echo "🎉 生产构建完成！"
echo "   安装包位于: electron/dist/"
echo
echo "如需测试生产模式（不打包），运行："
echo "   cd electron && npm start"
