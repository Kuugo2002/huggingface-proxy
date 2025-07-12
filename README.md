# Hugging Face 代理服务器

这个项目提供了一个简单的 Express 代理服务器，用于代理请求到 Hugging Face (`https://huggingface.co`)。它支持 CORS，可以解决前端开发中的跨域问题，特别适合在本地开发环境中使用 Hugging Face API。

## 主要功能

- 🔄 代理所有 HTTP 方法 (GET, POST, PUT, DELETE 等)
- 🌐 自动处理 CORS (跨域资源共享)
- ⚡ 流式传输处理大文件
- 🐳 Docker 容器支持
- 🔧 简单配置和使用

## 快速开始

### 通过 Node.js 运行

1. 安装依赖:
```bash
npm init -y
npm install express
```

3. 启动服务器:
```bash
node server.js
```

服务器将运行在 `http://localhost:8015`

### 通过 Docker 运行

使用预构建的镜像:
```bash
docker run -p 8015:8015 -d kuugo/huggingface-proxy:0.1
```

或自行构建镜像:
```bash
docker build -t huggingface-proxy .
docker run -p 8015:8015 -d huggingface-proxy
```

## 使用示例

将 Hugging Face 的 URL 路径附加到代理 URL 后：

原始 Hugging Face 端点：
```
https://huggingface.co/api/models
```

代理后的端点：
```
http://localhost:8015/api/models
```

### 使用 curl 测试：
```bash
curl http://localhost:8015/api/models
```

### 在 JavaScript 应用中使用：
```javascript
const response = await fetch('http://localhost:8015/api/models');
const data = await response.json();
console.log(data);
```

## 配置选项

在 Docker 中自定义端口：
```bash
docker run -p 8080:8080 -e PORT=8080 -d kuugo/huggingface-proxy:0.1
```

## 技术细节

- 自动处理预检请求 (OPTIONS)
- 移除可能引起问题的 `content-length` 头
- 支持请求体和响应体的流式传输
- 错误处理和日志记录

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
