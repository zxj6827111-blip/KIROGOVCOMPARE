@echo off
REM 政府信息公开年度报告差异比对系统 - 本地启动脚本 (Windows)

echo.
echo 🚀 启动政府信息公开年度报告差异比对系统...
echo.

REM 检查环境
echo 📋 检查环境...
node --version >nul 2>&1
if errorlevel 1 (
    echo   ❌ Node.js 未安装
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set node_version=%%i
echo   ✅ Node.js: %node_version%

npm --version >nul 2>&1
if errorlevel 1 (
    echo   ❌ npm 未安装
    exit /b 1
)
for /f "tokens=*" %%i in ('npm --version') do set npm_version=%%i
echo   ✅ npm: %npm_version%
echo.

REM 检查依赖
echo 📦 检查依赖...
if not exist "node_modules" (
    echo   ⚠️  node_modules 不存在，正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo   ❌ 依赖安装失败
        exit /b 1
    )
    echo   ✅ 依赖安装完成
) else (
    echo   ✅ 依赖已安装
)
echo.

REM 检查环境变量
echo ⚙️  检查环境变量...
if not exist ".env" (
    echo   ⚠️  .env 文件不存在，正在创建...
    copy .env.example .env >nul
    echo   ✅ .env 文件已创建
) else (
    echo   ✅ .env 文件已存在
)
echo.

REM 编译 TypeScript
echo 🔨 编译 TypeScript...
call npm run build
if errorlevel 1 (
    echo   ❌ 编译失败
    exit /b 1
)
echo   ✅ 编译完成
echo.

REM 启动应用
echo 🌟 启动应用...
echo   应用将在 http://localhost:3000 启动
echo   按 Ctrl+C 停止应用
echo.

call npm start
