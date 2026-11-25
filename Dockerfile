# 多阶段构建：Node 构建前端 → nginx 托管静态产物
# 注意：本应用为本地优先架构，用户数据存于浏览器 localStorage，容器不存储任何用户数据。

# ---------- Stage 1: build ----------
FROM node:22-alpine AS builder
WORKDIR /app

# 先复制依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 复制源码、静态资源与配置并构建（public/ 含 favicon、manifest 等，必须一并复制）
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM nginx:1.27-alpine AS runtime

# 自定义 nginx 配置：SPA 路由回退、gzip、缓存策略、安全头
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 从构建阶段拷贝产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 健康检查：确认首页可访问
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/health || exit 1

EXPOSE 80

LABEL org.opencontainers.image.title="AI Credit Manager" \
      org.opencontainers.image.description="AI 积分管家 - 本地优先的额度管理工具 Web 版" \
      org.opencontainers.image.version="0.1.0"

CMD ["nginx", "-g", "daemon off;"]
