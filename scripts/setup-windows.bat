@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

:: AI 会议助手 — Windows 一键环境安装脚本
:: 右键「以管理员身份运行」即可

title AI会议助手 — 环境安装程序

set VENV_DIR=C:\meeting-ai-venv
set PYTHON_BIN=%VENV_DIR%\Scripts\python.exe
set PY_VERSION=3.11.9
set PY_INSTALLER_URL=https://www.python.org/ftp/python/%PY_VERSION%/python-%PY_VERSION%-amd64.exe
set PY_INSTALLER=%TEMP%\python-installer.exe

echo.
echo ==================================================
echo    AI 会议助手 — Python 环境安装程序 (Windows)
echo ==================================================
echo.
echo 此脚本将自动完成以下操作：
echo   1. 安装 Python 3.11（如未安装）
echo   2. 创建虚拟环境 %VENV_DIR%
echo   3. 安装所有 AI 运行依赖
echo   4. 配置系统环境变量
echo.
echo 首次安装约需 15~40 分钟，请保持网络连接。
echo.
pause

:: ── 检查管理员权限 ────────────────────────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [错误] 请右键此脚本，选择"以管理员身份运行"后重试。
    echo.
    pause
    exit /b 1
)

:: ── Step 1: 检查/安装 Python ──────────────────────────────────────────────────
echo.
echo [1/4] 检查 Python...

python --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
    echo [OK] 已检测到 Python !PY_VER!
    set PYTHON_CMD=python
    goto :create_venv
)

python3 --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=2" %%v in ('python3 --version 2^>^&1') do set PY_VER=%%v
    echo [OK] 已检测到 Python !PY_VER!
    set PYTHON_CMD=python3
    goto :create_venv
)

:: 尝试用 winget 安装（Windows 10 1709+ 内置）
echo [..] 未检测到 Python，尝试通过 winget 安装...
winget install -e --id Python.Python.3.11 --silent --accept-package-agreements --accept-source-agreements >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Python 3.11 安装完成（winget）
    :: 刷新 PATH
    for /f "tokens=*" %%p in ('where python 2^>nul') do set PYTHON_CMD=%%p
    if not defined PYTHON_CMD set PYTHON_CMD=python
    goto :create_venv
)

:: winget 失败，下载安装包
echo [..] 正在下载 Python %PY_VERSION% 安装包...
echo      （约 25 MB，请稍候）
powershell -Command "& { $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%PY_INSTALLER_URL%' -OutFile '%PY_INSTALLER%' }"
if not exist "%PY_INSTALLER%" (
    echo [错误] 下载失败，请手动访问 https://www.python.org/downloads/ 安装 Python 3.11 后重新运行此脚本。
    pause
    exit /b 1
)

echo [..] 正在安装 Python...
"%PY_INSTALLER%" /quiet InstallAllUsers=1 PrependPath=1 Include_test=0
if %errorlevel% neq 0 (
    echo [错误] Python 安装失败，请手动安装后重试。
    del "%PY_INSTALLER%" >nul 2>&1
    pause
    exit /b 1
)
del "%PY_INSTALLER%" >nul 2>&1

:: 刷新环境变量
call refreshenv >nul 2>&1
set PYTHON_CMD=python
echo [OK] Python 安装完成

:create_venv
:: ── Step 2: 虚拟环境 ──────────────────────────────────────────────────────────
echo.
echo [2/4] 创建虚拟环境 %VENV_DIR%...

if exist "%VENV_DIR%\Scripts\activate.bat" (
    echo [OK] 虚拟环境已存在，将更新依赖
) else (
    %PYTHON_CMD% -m venv "%VENV_DIR%"
    if %errorlevel% neq 0 (
        echo [错误] 虚拟环境创建失败
        pause
        exit /b 1
    )
    echo [OK] 虚拟环境创建完成
)

call "%VENV_DIR%\Scripts\activate.bat"
python -m pip install --upgrade pip --quiet

:: ── Step 3: 安装依赖 ──────────────────────────────────────────────────────────
echo.
echo [3/4] 安装 PyTorch（CPU 版本）...
echo       这一步约需 5~10 分钟，请耐心等待...
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu --quiet
if %errorlevel% neq 0 (
    echo [警告] PyTorch 安装遇到问题，尝试备用方式...
    pip install torch torchaudio --quiet
)
echo [OK] PyTorch 安装完成

echo.
echo [..] 安装 AI 依赖包（funasr / pyannote / transformers ...）...
echo      这一步约需 10~20 分钟，请耐心等待...

pip install ^
    "funasr>=1.0" ^
    "modelscope>=1.9" ^
    "transformers>=4.35" ^
    "sentencepiece>=0.1.99" ^
    "accelerate>=0.26" ^
    "pyannote.audio>=3.1" ^
    "soundfile>=0.12" ^
    "librosa>=0.10" ^
    "onnxruntime>=1.16" ^
    "huggingface_hub>=0.19" ^
    "datasets>=2.14" ^
    "einops>=0.7" ^
    --quiet

if %errorlevel% neq 0 (
    echo [错误] 依赖安装失败，请检查网络连接后重试。
    pause
    exit /b 1
)
echo [OK] 所有依赖安装完成

:: ── Step 4: 写入环境变量 ──────────────────────────────────────────────────────
echo.
echo [4/4] 配置环境变量 LOCAL_PYTHON_PATH...

setx LOCAL_PYTHON_PATH "%PYTHON_BIN%" /M
set LOCAL_PYTHON_PATH=%PYTHON_BIN%

echo [OK] 环境变量已设置：LOCAL_PYTHON_PATH=%PYTHON_BIN%

:: ── 完成 ──────────────────────────────────────────────────────────────────────
echo.
echo ==================================================
echo   [完成] 安装成功！
echo ==================================================
echo.
echo 后续步骤：
echo   1. 重启电脑（使环境变量生效）
echo   2. 打开 AI 会议助手 App
echo   3. 点击左侧「系统配置」填写 API Key
echo   4. 上传会议录音即可使用
echo.
echo 首次转写会自动下载语音模型（约 500 MB），
echo 请保持网络连接，等待进度条完成即可。
echo.
pause
