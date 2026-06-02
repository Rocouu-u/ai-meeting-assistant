#!/bin/bash
# AI 会议助手 — macOS 一键环境安装脚本
# 双击此文件即可运行

set -e

# ── 颜色 ──────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

VENV_DIR="$HOME/meeting-ai-venv"
PYTHON_BIN="$VENV_DIR/bin/python"
PY_VERSION="3.11"

print_step() { echo -e "\n${CYAN}▶ $1${NC}"; }
print_ok()   { echo -e "${GREEN}✓ $1${NC}"; }
print_warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
print_err()  { echo -e "${RED}✗ $1${NC}"; }

# 切换到脚本所在目录（即应用目录）
cd "$(dirname "$0")/.."

echo ""
echo "=================================================="
echo "   AI 会议助手 — Python 环境安装程序 (macOS)"
echo "=================================================="
echo ""
echo "此脚本将自动完成以下操作："
echo "  1. 安装 Homebrew（如未安装）"
echo "  2. 安装 Python ${PY_VERSION}"
echo "  3. 创建虚拟环境 ${VENV_DIR}"
echo "  4. 安装所有 AI 运行依赖"
echo "  5. 配置系统环境变量"
echo ""
echo "首次安装约需 10~30 分钟，请保持网络连接。"
echo ""
read -p "按回车键开始安装，Ctrl+C 取消..." _

# ── Step 1: Homebrew ──────────────────────────────────────────────────────────
print_step "检查 Homebrew..."
if ! command -v brew &>/dev/null; then
    print_warn "未检测到 Homebrew，正在安装..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Apple Silicon Homebrew 路径
    if [ -f "/opt/homebrew/bin/brew" ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
        echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
    fi
    print_ok "Homebrew 安装完成"
else
    print_ok "Homebrew 已安装：$(brew --version | head -1)"
fi

# ── Step 2: Python ────────────────────────────────────────────────────────────
print_step "检查 Python ${PY_VERSION}..."
BREW_PYTHON="$(brew --prefix python@${PY_VERSION} 2>/dev/null)/bin/python${PY_VERSION}"

if ! command -v "python${PY_VERSION}" &>/dev/null && [ ! -f "$BREW_PYTHON" ]; then
    print_warn "正在安装 Python ${PY_VERSION}..."
    brew install "python@${PY_VERSION}"
    print_ok "Python ${PY_VERSION} 安装完成"
else
    print_ok "Python ${PY_VERSION} 已存在"
fi

# 找到 python 可执行文件
if command -v "python${PY_VERSION}" &>/dev/null; then
    PYTHON_CMD="python${PY_VERSION}"
elif [ -f "$BREW_PYTHON" ]; then
    PYTHON_CMD="$BREW_PYTHON"
else
    PYTHON_CMD="$(brew --prefix python@${PY_VERSION})/bin/python${PY_VERSION}"
fi

echo "  使用 Python：$($PYTHON_CMD --version)"

# ── Step 3: 虚拟环境 ──────────────────────────────────────────────────────────
print_step "创建虚拟环境 ${VENV_DIR}..."
if [ -d "$VENV_DIR" ]; then
    print_warn "虚拟环境已存在，将更新依赖（跳过创建）"
else
    "$PYTHON_CMD" -m venv "$VENV_DIR"
    print_ok "虚拟环境创建完成"
fi

source "$VENV_DIR/bin/activate"
pip install --upgrade pip --quiet

# ── Step 4: 安装依赖 ──────────────────────────────────────────────────────────
print_step "安装 PyTorch（Apple Silicon MPS 版本）..."
pip install torch torchaudio --quiet
print_ok "PyTorch 安装完成"

print_step "安装 AI 依赖包（funasr / pyannote / transformers ...）..."
echo "  这一步约需 5~15 分钟，请耐心等待..."
pip install \
    "funasr>=1.0" \
    "modelscope>=1.9" \
    "transformers>=4.35" \
    "sentencepiece>=0.1.99" \
    "accelerate>=0.26" \
    "pyannote.audio>=3.1" \
    "soundfile>=0.12" \
    "librosa>=0.10" \
    "onnxruntime>=1.16" \
    "huggingface_hub>=0.19" \
    "datasets>=2.14" \
    "einops>=0.7" \
    --quiet
print_ok "所有依赖安装完成"

# ── Step 5: 写入环境变量 ──────────────────────────────────────────────────────
print_step "配置环境变量 LOCAL_PYTHON_PATH..."

LAUNCHCTL_PLIST="$HOME/Library/LaunchAgents/com.meeting-assistant.env.plist"
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$LAUNCHCTL_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.meeting-assistant.env</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/launchctl</string>
        <string>setenv</string>
        <string>LOCAL_PYTHON_PATH</string>
        <string>${PYTHON_BIN}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
PLIST

launchctl load "$LAUNCHCTL_PLIST" 2>/dev/null || true
launchctl setenv LOCAL_PYTHON_PATH "$PYTHON_BIN"

# 同时写入 shell 配置（兼容 zsh / bash）
for PROFILE in "$HOME/.zprofile" "$HOME/.bash_profile"; do
    if [ -f "$PROFILE" ] || [ "$PROFILE" = "$HOME/.zprofile" ]; then
        if ! grep -q "LOCAL_PYTHON_PATH" "$PROFILE" 2>/dev/null; then
            echo "export LOCAL_PYTHON_PATH=\"${PYTHON_BIN}\"" >> "$PROFILE"
        fi
    fi
done

print_ok "环境变量已配置：LOCAL_PYTHON_PATH=${PYTHON_BIN}"

# ── 完成 ──────────────────────────────────────────────────────────────────────
echo ""
echo "=================================================="
echo -e "${GREEN}  ✅ 安装完成！${NC}"
echo "=================================================="
echo ""
echo "后续步骤："
echo "  1. 打开 AI 会议助手 App"
echo "  2. 点击左侧「系统配置」填写 API Key"
echo "  3. 上传会议录音即可使用"
echo ""
echo "首次转写时会自动下载语音模型（约 500 MB），"
echo "请保持网络连接，等待进度条完成即可。"
echo ""
read -p "按回车键关闭此窗口..."
