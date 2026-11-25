@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo           AI 积分管家 - 本地启动
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。请先安装 LTS 版本：https://nodejs.org
  echo 安装完成后重新运行本文件。
  pause
  exit /b 1
)

if not exist node_modules (
  echo 首次运行，正在安装依赖（仅需一次，约 1 分钟）...
  call npm install
  echo.
)

echo 正在启动服务，浏览器将自动打开 http://localhost:5173
echo 使用完毕后，直接关闭此窗口即可停止服务。
echo ============================================
echo.

start "" cmd /c "timeout /t 5 >nul & start http://localhost:5173"
call npm run dev
pause
