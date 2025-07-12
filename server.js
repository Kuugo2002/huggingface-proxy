const express = require('express');
const http = require('http');
const https = require('https');
const { pipeline } = require('stream');
const { URL } = require('url');

const TELEGRAPH_URL = 'https://huggingface.co';
const app = express();

// 代理中间件
app.use(async (req, res) => {
  try {
    const targetUrl = new URL(req.originalUrl, TELEGRAPH_URL);
    
    // 选择http或https模块
    const client = targetUrl.protocol === 'https:' ? https : http;
    
    // 准备请求选项
    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: { ...req.headers, host: targetUrl.hostname }
    };
    
    // 删除可能会引起问题的头
    delete options.headers['content-length'];
    
    // 设置CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // 处理预检请求
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    // 发起代理请求
    const proxyReq = client.request(options, (proxyRes) => {
      // 设置响应状态码
      res.status(proxyRes.statusCode || 200);
      
      // 复制响应头
      Object.keys(proxyRes.headers).forEach(key => {
        res.setHeader(key, proxyRes.headers[key]);
      });
      
      // 使用流管道传输响应数据
      pipeline(proxyRes, res, (err) => {
        if (err) {
          console.error('Pipeline error:', err);
          res.end();
        }
      });
    });
    
    // 处理代理请求错误
    proxyReq.on('error', (err) => {
      console.error('Proxy request error:', err);
      res.status(500).send('Proxy request failed');
    });
    
    // 如果有请求体，将其传输到代理请求
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      pipeline(req, proxyReq, (err) => {
        if (err) {
          console.error('Request body pipeline error:', err);
          proxyReq.end();
        }
      });
    } else {
      proxyReq.end();
    }
    
  } catch (err) {
    console.error('Error:', err);
    res.status(500).send('Internal Server Error');
  }
});

// 启动服务器
const PORT = process.env.PORT || 8015;
app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});