# AssemblyAI 转写准备

## 1. 当前阶段

当前进入 MVP 1A 的转写准备阶段。

这一步只做准备工作，不真实调用 AssemblyAI，不上传文件到外部服务，也不生成真实转写文本。

## 2. 需要准备什么

后续接入 AssemblyAI 时，需要准备一个 AssemblyAI API Key。

项目里已经创建了 `.env.example`，里面有：

```bash
ASSEMBLYAI_API_KEY=
```

真正接入时，需要复制一份本地配置文件：

```bash
cp .env.example .env.local
```

然后把真实的 AssemblyAI API Key 填到 `.env.local` 里。

注意：`.env.local` 只放在本机，不要提交给别人。

## 3. 后续接口规划

后续建议新增一个本地后端接口：

```text
POST /api/transcribe
```

这个接口的作用可以理解为：

1. 页面把用户选择的音频文件交给本地后端。
2. 本地后端检查文件格式和大小。
3. 本地后端读取 `ASSEMBLYAI_API_KEY`。
4. 本地后端把音频提交给 AssemblyAI。
5. AssemblyAI 完成转写后，本地后端把结果整理成页面需要的格式。
6. 页面显示转写文本和“发言人1、发言人2”。

## 4. 页面需要的返回结果

页面最终需要的转写结果建议长这样：

```json
{
  "status": "completed",
  "transcript": "发言人1：大家好，我们开始今天的会议。\n\n发言人2：好的，我先同步项目进度。",
  "speakers": [
    {
      "speaker": "发言人1",
      "text": "大家好，我们开始今天的会议。"
    },
    {
      "speaker": "发言人2",
      "text": "好的，我先同步项目进度。"
    }
  ]
}
```

这只是规划格式，当前步骤不会实现接口。

## 5. 需要注意的边界

当前步骤不做：

- 不调用 AssemblyAI。
- 不调用 OpenAI。
- 不接 SQLite。
- 不做真实转写。
- 不做 Word/PDF 导出。
- 不做登录、多用户、手机 App。

## 6. 下一步建议

下一步可以进入“AssemblyAI 转写接口雏形”。

建议只做一个小目标：

- 新增 `/api/transcribe` 接口。
- 先检查是否存在 `ASSEMBLYAI_API_KEY`。
- 如果没有 Key，返回友好错误。
- 暂时不上传真实文件到 AssemblyAI。

这样可以先确认后端接口和环境变量读取是通的，再进入真实转写。

