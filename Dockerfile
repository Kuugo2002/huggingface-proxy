# 使用 Node.js 22 官方镜像
FROM node:22

# 设置工作目录
WORKDIR /usr/src/app

# 复制 server.js 文件
COPY server.js .

# 初始化项目并安装依赖
RUN npm init -y && \
    npm install express

# 暴露端口 8015
EXPOSE 8015

# 启动命令
CMD ["node", "server.js"]
