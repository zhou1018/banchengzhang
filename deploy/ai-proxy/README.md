# 云端 AI 代理（可选）

静态站不能存放模型密钥。这个 Worker 转发医疗单据识别和语音转写，密钥只放在服务端。

不部署也能用：页面默认在浏览器里做本地中文 OCR 和实时转写。识别不到的字段留空。

## 部署

```bash
cd deploy/ai-proxy
npx wrangler login
npx wrangler deploy
npx wrangler secret put AI_API_KEY
npx wrangler secret put AI_BASE_URL
npx wrangler secret put AI_MODEL
```

智谱 GLM 可把 `AI_BASE_URL` 设为 `https://api.z.ai/api/paas/v4`（国内站 `https://open.bigmodel.cn/api/paas/v4`），`AI_MODEL` 设为 `glm-5.3-flash`。

语音要另走云端时再设置 `ASR_API_KEY`、`ASR_BASE_URL`、`ASR_MODEL`。不填则语音仍用浏览器转写。

## 调用方校验

`AI_PROXY_TOKEN` 不设置时，Worker 不校验调用方。本地 `npx wrangler dev` 因此仍会在 Key 为空时返回 `503 {"error":"ai_api_key_not_configured"}`。

生产若要挡掉随便扫到地址的请求：

```bash
npx wrangler secret put AI_PROXY_TOKEN
```

重新构建前端时设置同一个值：

```
VITE_AI_PROXY_TOKEN=同一串token
VITE_AI_ENDPOINT=https://banchengzhang-ai.<子域>.workers.dev
```

页面只在构建时存在 `VITE_AI_PROXY_TOKEN` 才发送 `X-Proxy-Token`。这个值会出现在前端包里，轮换它只能拦住不知道新值的访问，不能代替登录。当前已发布的页面包是在没有该变量时构建的，所以不会带头；在重新构建之前不要给线上 Worker 设置 `AI_PROXY_TOKEN`，否则现有页面会被拒绝。

## 限制

- 医疗图片 Data URL 超过 8MB、语音正文超过 15MB：`413 payload_too_large`
- 同一 IP 的医疗识别和语音，在单个 Worker 实例里每分钟各 20 次：`429 rate_limited`。这不是账号级或全局的限额。
- 模型没有给出 0 到 1 的置信度时，响应里不带 `confidence`，也不默认写成 0.9。
- 未捕获的异常只返回 `internal_error`。

## 本地

```bash
cp .dev.vars.example .dev.vars
npx wrangler dev --port 8791 --ip 127.0.0.1
```

`.dev.vars` 不要提交。
