# 会议录音转写与会议纪要生成工具

这是一个本地网页工具。用户在浏览器中选择会议录音后，系统会上传音频、调用阿里云 Fun-ASR 转写，并用 Qwen 生成会议纪要和会议大纲。

## 运行方式

```bash
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:3006
```

## 当前上传方案

第一优先使用 OSS 前端直传：

- 浏览器直接上传音频到客户自己的 OSS Bucket。
- 后端只生成上传签名，不保存音频文件。
- 上传成功后，系统把 OSS 文件地址提交给 Fun-ASR。

如果 `OSS_ENABLED=false`，系统会回退到阿里云百炼临时上传方案。这个回退方案只作为备用，不作为正式推荐方案。

## 系统配置

客户不需要手动编辑 `.env.local`。首次打开页面时，如果还没有配置百炼 API Key 或 OSS，系统会自动进入“系统配置”页面。

配置会保存到本机文件：

```text
storage/config.json
```

这个文件只保存在客户本机，不会写入前端 `localStorage`。前端只显示“已配置”或脱敏后的信息，不会明文展示完整 Secret。

`.env.local` 仍然可以作为开发环境 fallback；如果 `storage/config.json` 中已经保存了配置，系统会优先使用配置页保存的内容。

## 历史记录保存

历史记录默认保存在本地 SQLite 文件：

```text
storage/app.db
```

这意味着：

- 不需要额外数据库账号。
- 不需要云数据库。
- 关闭浏览器后历史记录仍然存在。
- 重启本地服务后历史记录仍然存在。
- 备份时复制 `storage/app.db` 即可。
- 删除 `storage/app.db` 会清空历史记录。

浏览器 `localStorage` 只作为前端缓存和旧数据迁移来源，不再是唯一保存方式。

## 历史记录保留策略

默认配置：

```env
RECORD_RETENTION_DAYS=30
OSS_AUDIO_RETENTION_DAYS=7
```

含义：

- 转写文本、会议纪要、会议大纲等结果默认保留 30 天。
- 原始音频建议在 OSS 中保留 7 天后删除。

客户可以按自己的合规和存储成本要求调整这两个值。

注意：删除历史记录会删除 SQLite 中的记录、转写文本、会议纪要和会议大纲，但不会删除 OSS 上的原始音频。OSS 原始音频清理需要通过 OSS 生命周期规则或后续单独实现 OSS 删除功能。

## OSS 配置

正式使用时推荐在页面的“系统配置”里填写。开发环境也可以继续使用 `.env.local`，示例：

```env
OSS_ENABLED=true
OSS_BUCKET=your_bucket_name
OSS_REGION=oss-cn-hangzhou
OSS_ACCESS_KEY_ID=your_access_key_id
OSS_ACCESS_KEY_SECRET=your_access_key_secret
OSS_DIR=meeting-audio
OSS_EXPIRES_SECONDS=21600
```

不要把 OSS 地域或 Bucket 写死在代码里。正式客户应使用客户自己的 OSS Bucket，并在 OSS 控制台配置允许浏览器上传的 CORS 规则。
