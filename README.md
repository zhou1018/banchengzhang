# 伴成长

把孩子长大的照片、日常录音和医疗单据收在这一台浏览器里的本地原型。这个仓库是已经构建好的静态站点，用浏览器直接打开即可。

## 打开

在仓库根目录起一个静态服务（页面用相对路径加载脚本和 OCR 资源）：

```bash
python3 -m http.server 4173
```

然后打开 `http://127.0.0.1:4173`。输入昵称就会在本机建一份档案，不需要密码。

四个入口：

- 照片
- 日常（语音和日历）
- 医疗
- AI 助手：仍是占位页，不会回答问题，也不会给建议

## 数据在哪

档案只写在当前浏览器里：

- `localStorage` 保存监护人、孩子、照片元数据、语音元数据和医疗元数据
- `IndexedDB`（`banchengzhang:v01:media`）保存图片、原文件和录音

换一台设备、换一个浏览器，或者清掉站点数据，档案就没有了。这里没有账号服务器，也没有数据库。

## 识别

默认在浏览器里做：医疗单据用本地中文 OCR（`tesseract/`），语音用浏览器的实时转写。识别不到的字段留空。

iPhone Safari 没有 Web Speech，语音转写需要另接云端。PDF 只保存原件，不识别文字。

可选的云端通道在 [`deploy/ai-proxy`](deploy/ai-proxy/README.md)。不部署时行为不变。模型密钥不能放进这个静态站。

## 检查

```bash
node tests/verify-medical-same-name.mjs
node tests/verify-medical-field-merge.mjs
node tests/verify-ai-proxy.mjs
```

这三条覆盖：同名医疗文件按队列分开登记、提取写回时保留用户锁定的字段、云端代理的体积限制和置信度。
