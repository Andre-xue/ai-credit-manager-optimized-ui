#!/bin/bash
cd "$(dirname "$0")" || exit 1
clear
echo "============================================"
echo "          AI 积分管家 · 本地启动"
echo "============================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先安装 LTS 版本：https://nodejs.org"
  echo "安装完成后重新双击本文件。"
  read -r
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖（仅需一次，约 1 分钟）..."
  npm install
  echo ""
fi

echo "正在启动服务..."
echo "浏览器将自动打开 http://localhost:5173"
echo ""
echo "★ 使用完毕后，直接关闭此窗口即可停止服务。"
echo "============================================"
echo ""

( sleep 5 && open "http://localhost:5173" ) &
npm run dev
