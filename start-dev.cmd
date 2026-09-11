@echo off
rem 农资315 开发服务器启动器（纯 ASCII 包装，避免 cmd 中文编码问题）
rem 真正的逻辑在 scripts\dev-start.mjs，用 Node 输出中文，编码稳定
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH. Please install Node.js first.
  pause
  exit /b 1
)

node "scripts\dev-start.mjs" %*
if errorlevel 1 pause
