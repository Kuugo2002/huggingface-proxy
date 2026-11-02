# Hugging Face 代理 · Cloudflare Workers

使用本目录的 [worker.js](./worker.js) 将请求转发到 `https://huggingface.co`，适用于 Hugging Face API、文件上传和模型下载。无需自行维护服务器，也没有第三方运行依赖。

这是独立的 Workers 版本，不使用项目根目录的 `server.js`，也不读取 Node.js 版本的环境变量。

## 功能

- 请求和响应均采用流式转发，不将整个模型文件加载到内存。
- 保留请求方法、编码路径、查询参数、`Authorization` 和 `Range`，支持上传及分段下载。
- 固定通过 HTTPS 访问 Hugging Face，请求路径不能指定其他上游主机。
- 本地响应浏览器 CORS 预检，允许跨域调用；浏览器可读取 `Content-Length`、`Content-Range`、`Accept-Ranges`、`ETag` 和 `Location`。
- Hugging Face 同源重定向改写为代理地址；外部 CDN 的签名地址保持原样。
- 上游请求抛出异常时返回带 CORS 响应头的 `502`；上游正常返回的 HTTP 错误状态保持原样。

## 部署

### 通过 Cloudflare 控制台

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，进入 **Workers & Pages**。
2. 创建一个 Worker，可先使用 Hello World 示例完成初次部署。
3. 打开该 Worker 的 **Edit code（编辑代码）**。
4. 用本目录 `worker.js` 的完整内容替换默认代码，保存并部署。
5. 使用控制台提供的 `https://<worker-name>.<subdomain>.workers.dev` 地址访问代理，也可以为 Worker 配置自己的域名。

当前脚本使用 `addEventListener('fetch', ...)` 的 Service Worker 格式，复制时应完整替换默认代码，不要将它嵌入默认的 `export default` 中。无需配置环境变量、KV 或其他绑定。

控制台操作入口如有调整，请参考 [Cloudflare 控制台部署文档](https://developers.cloudflare.com/workers/get-started/dashboard/)。

## 使用

将原始 Hugging Face URL 的域名替换为你的 Worker 域名，路径和查询参数保持不变：

```text
https://huggingface.co/api/models
→ https://<worker-name>.<subdomain>.workers.dev/api/models
```

### API、认证和下载

先设置自己的代理地址：

```bash
export HF_PROXY='https://<worker-name>.<subdomain>.workers.dev'
```

```bash
# 查询模型列表
curl "$HF_PROXY/api/models?limit=5"

# 私有仓库：使用自己的 Hugging Face 访问令牌
curl -H "Authorization: Bearer $HF_TOKEN" \
  "$HF_PROXY/api/models/your-account/your-model"

# 分段下载并跟随重定向；请替换为实际存在的仓库和文件
curl -L -H 'Range: bytes=0-1023' \
  "$HF_PROXY/your-account/your-model/resolve/main/model.safetensors" \
  -o model.part
```

不要将 Hugging Face 令牌写入 `worker.js` 或提交到仓库中。令牌由客户端通过 `Authorization` 请求头传入。

### 浏览器调用

```javascript
const proxy = 'https://<worker-name>.<subdomain>.workers.dev';
const response = await fetch(`${proxy}/api/models?limit=5`);
if (!response.ok) throw new Error(`请求失败：${response.status}`);
console.log(await response.json());
```

跨域请求允许通过请求头携带认证令牌，不支持 `credentials: 'include'` 的跨域 Cookie 认证。

### Hugging Face 客户端

对于支持 `HF_ENDPOINT` 的客户端，可在启动程序前设置：

```bash
export HF_ENDPOINT='https://<worker-name>.<subdomain>.workers.dev'
```

是否使用该设置取决于具体客户端；它不会自动代理程序访问的所有外部域名。

## 重定向与限制

- **外部 CDN 需要客户端能够直接访问。** Worker 不自动跟随重定向。Hugging Face 域内跳转继续经过代理，跳到其他域名时由客户端直接访问；命令行下载可使用 `curl -L`。浏览器下载还取决于 CDN 自身的 CORS 策略。
- 采用手动重定向，避免 Workers 将 `Authorization`、`Cookie` 等请求头自动转发给外部目标，详见 [Cloudflare Request 文档](https://developers.cloudflare.com/workers/runtime-apis/request/)。使用 curl 时不要为此添加会跨域转发凭证的 `--location-trusted`。
- 不改写网页 HTML、页面中的链接或 Cookie 域名，不提供完整的 Hugging Face 网页镜像。
- 没有实现应用层缓存、重试、自定义超时或代理访问认证。公开部署后，知道地址的人可以使用该代理；如需限制使用，应另行配置入口访问控制。
- 流式转发不会绕过 Cloudflare 的请求体大小、资源和套餐限制，具体以 [Workers 限制文档](https://developers.cloudflare.com/workers/platform/limits/) 为准。
- `502` 表示建立上游请求或获取响应时发生异常。响应开始后才发生的流传输错误会中断下载，不能再改为 `502`。

## 本地验证

在项目根目录运行，仅执行 Worker 相关测试：

```bash
node --test test/worker.test.js
```

测试使用 Node.js 内置 Web API 和模拟上游，覆盖认证、编码路径、分段响应、CORS 预检、上传、流式响应、重定向、HEAD 和网络异常，无需访问 Hugging Face 或提供真实令牌。这些测试不替代部署后的 Cloudflare 环境验证。

## 许可证

采用项目的 [MIT 许可证](../LICENSE)。
