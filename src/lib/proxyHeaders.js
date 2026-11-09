// 代理令牌只在调用方显式放进 globalThis.__BCZ_AI_PROXY_TOKEN 时才带上。
// 静态站点构建产物里没有这个值时，请求不带该头，和未配置 AI_PROXY_TOKEN 的 Worker 一致。

export function proxyHeaders(base = {}) {
  const headers = { ...base }
  const token = globalThis.__BCZ_AI_PROXY_TOKEN
  if (typeof token === 'string' && token.trim()) headers['X-Proxy-Token'] = token.trim()
  return headers
}

/** 缺省或越界的置信度不当成 0.9。0.5 低于「正常」门槛，又不会把作业判成无文字失败。 */
export function cloudConfidence(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.5
}
