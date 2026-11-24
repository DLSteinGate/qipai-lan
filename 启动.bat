@echo off
chcp 65001 >nul
setlocal
title 局域网棋牌室
cd /d "%~dp0"

echo.
echo   局域网棋牌室
echo   ----------------------------------------
echo.

set "PORT=11451"
set "OPEN_BROWSER=1"

rem ---- 1) 优先用同目录下的单文件程序（自带 Node 运行时，目标机器无需装 Node）----
if exist "%~dp0局域网棋牌室.exe" (
  echo   使用内置运行时启动...
  echo.
  "%~dp0局域网棋牌室.exe"
  set "RC=%ERRORLEVEL%"
  goto :done
)

rem ---- 2) 退回到本机 Node ----
set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"
if not defined NODE_EXE if exist "%~dp0node.exe" set "NODE_EXE=%~dp0node.exe"

if not defined NODE_EXE (
  echo   [错误] 缺少运行环境
  echo.
  echo   本目录下没有 局域网棋牌室.exe，也没找到 node。
  echo   请把 局域网棋牌室.exe 放在本目录，或安装 Node.js 后重试。
  echo.
  set "RC=1"
  goto :done
)

echo   使用本机 Node 启动...
echo.
"%NODE_EXE%" "%~dp0server\index.js"
set "RC=%ERRORLEVEL%"

:done
echo.
if "%RC%"=="0" goto :stop
echo   [提示] 程序退出，代码 %RC%
echo   若窗口里没有更多信息，把上面的内容截图发出来看看。
echo.
:stop
echo   服务已停止，按任意键关闭窗口。
pause >nul
endlocal
