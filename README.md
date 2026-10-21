# Hugging Face 代理服务器

将本地请求代理到 [Hugging Face](https://huggingface.co)，支持 API 调用、文件上传和模型下载。使用 Node.js 自带模块，无第三方运行依赖。

## 主要功能

- 请求和响应采用流式转发，无需将整个模型文件加载到内存。
- 保留认证、查询参数、编码路径、`Content-Length` 和 `Range`，支持分段下载和续传。
- 复用上游连接，最多同时使用 128 个连接，减少重复连接开销。
- 本地处理 CORS 预检，浏览器可读取下载进度、分段信息和 ETag。
- 上游连接失败返回 `502`；上游连接空闲超时返回 `504`。响应开始后出错会关闭连接。
- 客户端中断上传或下载时，自动停止相应的上游传输。
- 同源重定向继续经过代理，外部 CDN 的签名下载地址保留原样。
- 收到 `SIGINT` / `SIGTERM` 后停止接收新连接，最多等待 10 秒完成现有请求。

## 快速开始

### 通过 Node.js 运行

需要 Node.js 22 或更高版本。没有需要安装的第三方依赖，可以直接运行：

```bash
node server.js
```

也可以使用：

```bash
npm start
```

默认监听 `0.0.0.0:8015`，本机访问地址为 `http://localhost:8015`。

### 通过 PM2 部署

适合在 Linux 服务器上长期运行，PM2 会在进程异常退出后自动重启。需要先安装 Node.js 22 或更高版本，再安装 PM2：

```bash
npm install -g pm2
```

进入项目根目录，以部署用户启动服务：

```bash
NODE_ENV=production pm2 start server.js \
  --name huggingface-proxy \
  --time \
  --kill-timeout 12000
```

默认监听 `0.0.0.0:8015`。`--time` 为日志添加时间，`--kill-timeout 12000` 允许进程在被强制终止前等待 12 秒，留出项目最多 10 秒的正常退出时间。

查看状态和日志：

```bash
pm2 status
pm2 logs huggingface-proxy --lines 100
```

退出日志查看可按 `Ctrl+C`，服务仍会在后台运行。

设置开机自启：

```bash
pm2 startup
```

按照输出提示执行生成的命令（通常需要 `sudo`），然后保存当前进程列表：

```bash
pm2 save
```

日常管理：

```bash
# 更新项目代码后重启服务
pm2 restart huggingface-proxy

# 修改环境变量并重启；这里将空闲超时改为 60 秒
UPSTREAM_TIMEOUT_MS=60000 pm2 restart huggingface-proxy --update-env
pm2 save

# 停止服务
pm2 stop huggingface-proxy

# 删除托管进程
pm2 delete huggingface-proxy
pm2 save
```

新增进程或修改配置后执行 `pm2 save`，使重启服务器后恢复的配置与当前一致。以上管理命令应使用同一个部署用户执行。升级 Node.js 后，需要重新生成开机自启配置，步骤见 [PM2 开机自启文档](https://pm2.keymetrics.io/docs/usage/startup/)。其他命令可参考 [PM2 快速开始](https://pm2.keymetrics.io/docs/usage/quick-start/) 和 [正常退出配置](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/)。

### 通过 Docker 运行

构建当前代码并启动：

```bash
docker build -t huggingface-proxy .
docker run --name huggingface-proxy -p 8015:8015 -d huggingface-proxy
```

容器使用 Node.js 22，以非 root 用户运行。仓库更新不会自动更新已发布的镜像，请自行构建以使用这些改动。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8015` | 监听端口，范围为 1–65535 |
| `HOST` | `0.0.0.0` | 监听地址；仅本机使用时可设为 `127.0.0.1` |
| `UPSTREAM_URL` | `https://huggingface.co` | 固定上游 HTTP(S) 源站，只能包含协议、主机及可选端口 |
| `UPSTREAM_TIMEOUT_MS` | `30000` | 上游连接空闲超时，单位毫秒，必须为正整数 |

例如，仅允许本机访问，并将空闲超时设为 60 秒：

```bash
HOST=127.0.0.1 PORT=8015 UPSTREAM_TIMEOUT_MS=60000 npm start
```

超时限制的是已连接上游的无数据等待时间，不是整个下载的时长；持续传输的大文件可以超过这个时间。DNS 解析阶段不受该空闲超时控制。

## 使用示例

将 Hugging Face URL 的路径和查询参数附加到代理地址：

```text
https://huggingface.co/api/models
→ http://localhost:8015/api/models
```

```bash
curl http://localhost:8015/api/models

# 私有仓库：通过 Authorization 请求头传入自己的访问令牌
curl -H "Authorization: Bearer $HF_TOKEN" \
  http://localhost:8015/api/models/your-account/your-model

# 分段下载；具体响应由 Hugging Face 或其下载 CDN 决定
curl -L -H 'Range: bytes=0-1023' \
  http://localhost:8015/your-account/your-model/resolve/main/model.safetensors
```

浏览器调用：

```javascript
const response = await fetch('http://localhost:8015/api/models');
if (!response.ok) throw new Error(`请求失败：${response.status}`);
const data = await response.json();
console.log(data);
```

代理开放 CORS，支持通过 `Authorization` 请求头认证，不支持跨域 Cookie 凭证。代理只处理配置的源站；Hugging Face 重定向到外部 CDN 时，客户端仍需能直接访问该 CDN。它不会改写网页内容或提供缓存，也不自带访问控制；对外部署时请在入口配置认证和访问限制。

## 测试

```bash
npm test
```

测试使用本地模拟上游，无需访问 Hugging Face 或提供令牌，覆盖认证、编码路径、上传、分段下载、HEAD、CORS、重定向、连接复用、错误和中断处理。GitHub Actions 在 Node.js 22 和 24 上运行测试。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
