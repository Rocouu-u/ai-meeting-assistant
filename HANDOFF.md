# 项目交接文档 — AI 会议助手

> 写给接手这个项目的开发者。请从头到尾读完再动手。

---

## 一、项目是什么

本地运行的 AI 会议录音处理工具，全程不依赖付费云服务（除了下文标注的一处待完成任务）。

**技术栈**
- 前端 + API：Next.js 15 (TypeScript)，运行在 `http://127.0.0.1:3006`
- 语音转写：FunASR + SenseVoiceSmall（本地 Python）
- 说话人分离：ModelScope `speech_campplus_speaker-diarization_common`（本地 Python）
- 会议摘要/大纲/行动项：**⚠️ 目前仍调用阿里云 Qwen DashScope API**（待本地化，见第五节）
- 数据库：SQLite（better-sqlite3）

---

## 二、你的电脑需要装什么

### 必装

| 软件 | 版本要求 | 说明 |
|---|---|---|
| Node.js | 18 或 20 | 建议用 nvm 管理 |
| Python | 3.9–3.11 | 3.12+ 暂未验证 |
| ffmpeg | 任意版本 | `brew install ffmpeg` / `choco install ffmpeg` |

### Python 包（约 3–5 GB 下载）

```bash
# 1. 在项目目录外创建 venv（选一个固定路径，不要放在 /tmp）
python3 -m venv ~/meeting-ai-venv

# 2. 激活
source ~/meeting-ai-venv/bin/activate          # Mac / Linux
# 或 .\meeting-ai-venv\Scripts\activate        # Windows

# 3. 安装核心包（先看 requirements.txt 里的平台说明）
pip install -r requirements.txt

# 4. 如需和原机器完全一致（可选）
# pip install -r requirements-full.txt
```

> **注意**：`requirements-full.txt` 是从原机器 `pip freeze` 导出的，里面有些包是 macOS arm64 专属，在 Windows/Linux 上直接安装可能报错，按 `requirements.txt` 的方式装更稳。

### Node 包

```bash
npm install
```

---

## 三、启动项目

```bash
# 1. 复制环境变量
cp .env.local.example .env.local

# 2. 编辑 .env.local，把 LOCAL_PYTHON_PATH 改成你的 venv 路径
#    例如：LOCAL_PYTHON_PATH=/Users/yourname/meeting-ai-venv/bin/python
#    Windows 例如：LOCAL_PYTHON_PATH=C:\Users\yourname\meeting-ai-venv\Scripts\python.exe

# 3. 启动开发服务器
npm run dev

# 4. 浏览器打开
# http://127.0.0.1:3006
```

首次启动后上传一段录音，FunASR 会自动从 ModelScope 下载 SenseVoiceSmall 模型（约 1 GB），这是正常的。

---

## 四、当前功能状态

| 功能 | 状态 | 说明 |
|---|---|---|
| 语音转写（ASR） | ✅ 完全本地 | FunASR + SenseVoiceSmall |
| 说话人分离 | ✅ 完全本地 | ModelScope CAM++ |
| 工作流节点进度条 | ✅ 已完成 | n8n 风格，8 步节点 |
| 行动项矩阵表格 | ✅ 已完成 | 含溯源时间戳 |
| 时间戳点击跳转播放 | ✅ 已完成 | 含悬浮迷你播放控制条 |
| 导出（Excel/CSV/Word/PDF） | ✅ 已完成 | |
| **会议摘要/大纲/行动项（LLM）** | ⚠️ **待本地化** | **目前调用阿里云 DashScope，见第五节** |
| OSS 云存储 | ✅ 已禁用 | `OSS_ENABLED=false` |

---

## 五、⚠️ 待完成：LLM 本地化

这是你接手后需要做的唯一一项核心工作。

### 背景

当前 `.env.local` 里有 `LLM_PROVIDER=qwen`，会议摘要/大纲/行动项通过阿里云 DashScope API 生成。本地化框架已经写好了（`lib/providers/llm/local.ts` + `scripts/local-summary.py`），只差模型下载和配置切换。

### 步骤

#### 第 1 步：安装缺少的 Python 包

```bash
source ~/meeting-ai-venv/bin/activate
pip install accelerate>=0.26
```

#### 第 2 步：下载本地 LLM 模型

推荐 **Qwen2.5-3B-Instruct**（在 16 GB 内存的机器上推理速度和质量最均衡）。

```bash
# 通过 ModelScope 下载（国内网速更快）
python3 -c "
from modelscope import snapshot_download
snapshot_download('qwen/Qwen2.5-3B-Instruct')
"
```

模型会缓存到 `~/.cache/modelscope/hub/`，约 6 GB，只需下载一次。

其他可选大小：

| 模型 | 大小 | 推理速度（16GB RAM） | 适用场景 |
|---|---|---|---|
| qwen/Qwen2.5-1.5B-Instruct | ~3 GB | 10–20 秒/次 | 速度优先 |
| **qwen/Qwen2.5-3B-Instruct（推荐）** | **~6 GB** | **20–40 秒/次** | **平衡** |
| qwen/Qwen2.5-7B-Instruct | ~14 GB | 60–120 秒/次 | 质量优先，需 16GB+ |

#### 第 3 步：更新 `scripts/local-summary.py`

当前脚本的 `device_map="auto"` 在 Mac M 系列上不走 MPS 加速，需要改成显式指定设备：

找到文件中的这段代码（约第 25–35 行）：

```python
model_name = os.environ.get("LOCAL_LLM_MODEL", "Qwen/Qwen2.5-1.5B-Instruct")
device_map = os.environ.get("LOCAL_LLM_DEVICE_MAP", "auto")

tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    device_map=device_map,
    trust_remote_code=True,
).eval()
```

替换成：

```python
import torch

model_name = os.environ.get("LOCAL_LLM_MODEL", "Qwen/Qwen2.5-1.5B-Instruct")

# 自动检测最优设备
if torch.cuda.is_available():
    device = "cuda"
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    device = "mps"
else:
    device = "cpu"

tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype=torch.float16 if device != "cpu" else torch.float32,
    device_map=device,
    trust_remote_code=True,
).eval()
```

同时把 `generate_response` 函数改成用 chat template（Qwen2.5 Instruct 格式）：

```python
def generate_response(model, tokenizer, prompt_text: str) -> str:
    messages = [{"role": "user", "content": prompt_text}]
    text = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )
    inputs = tokenizer([text], return_tensors="pt").to(model.device)
    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=3000,
            temperature=0.2,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
        )
    # 只返回新生成的部分
    new_ids = output_ids[0][inputs["input_ids"].shape[1]:]
    return tokenizer.decode(new_ids, skip_special_tokens=True).strip()
```

#### 第 4 步：修改 `.env.local`

```bash
# 把这一行
LLM_PROVIDER=qwen

# 改成
LLM_PROVIDER=local
LOCAL_LLM_MODEL=qwen/Qwen2.5-3B-Instruct
```

#### 第 5 步：测试

重启开发服务器，上传一段录音，等转写完成后点「重新生成纪要」，观察终端日志。首次运行会加载模型（约 10–30 秒），之后会缓存在内存中。

---

## 六、项目文件说明

```
app/
  page.tsx          # 全部前端 UI（单文件，约 2700 行）
  api/
    transcribe/     # 语音转写 API
    generate-report/ # LLM 摘要生成 API
    history/        # 历史记录 CRUD
    oss/            # OSS 直传（已禁用）
lib/
  providers/
    speech/         # ASR 提供者（local / aliyun / assemblyai）
    llm/            # LLM 提供者（local / qwen / openai）
  prompts/
    meeting-summary.ts  # 摘要提示词模板（如质量不好可在这里调整）
scripts/
  local-transcribe-job.py  # FunASR 转写主脚本
  local-summary.py         # LLM 摘要脚本（第五节要改的文件）
  modelscope-diarize.py    # 说话人分离脚本
storage/            # 运行时数据（不打包）
  app.db            # SQLite 历史记录
  local-transcribe-jobs/  # 转写任务临时文件
vendor/
  sqlite/win32/     # Windows Electron 打包用的 sqlite3.exe
```

---

## 七、已知问题

1. **极短音频（< 2 秒）转写失败**：FunASR VAD 处理过短音频时报 `stack expects a non-empty TensorList`。正式会议录音不受影响。
2. **Python venv 路径写死在 .env.local**：每台机器需要手动改 `LOCAL_PYTHON_PATH`。
3. **首次转写很慢**：FunASR 冷启动 + 模型加载约 30–60 秒，第二次开始正常。
4. **Windows 未测试**：项目主要在 Mac 开发，Windows 需要额外验证 ffmpeg 路径和 Python venv 路径格式。

---

## 八、联系

如有问题联系原开发者了解更多背景。
