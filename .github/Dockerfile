FROM nginx:1.27-alpine
# SPA 路由支持：v3 主路径 + v2 /v2/ 子路径，均 fallback 到各自 index.html
# AI-CORRECTION 2026-08-19: V2 不再进入发布产物；/v2 与 /v2/ 现在明确返回 410，主路径继续 fallback 到当前版本 index.html。
# AI-REMOVED 2026-08-19:
# Reason: 容器产物不再包含 dist/v2，旧版 alias 会指向不存在的文件。
# Trigger: 用户要求 workflow 从下个版本开始不再编译旧版。
# Evidence: release.yml 已停用 V2 构建与 dist/v2 合并。
# Replacement: 下方 /v2 与 /v2/ 的 410 退役响应。
# Risk: 历史书签访问旧版路径时将收到 410。
# Human Review: Required
#
# Original code:
# location /v2/ { alias /usr/share/nginx/html/v2/; try_files $uri $uri/ /v2/index.html; } \
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    location = /sw.js { add_header Cache-Control "no-cache, must-revalidate"; try_files $uri =404; } \
    location = /manifest.webmanifest { add_header Cache-Control "no-cache, must-revalidate"; try_files $uri =404; } \
    location = /auth/callback { try_files /auth/callback/index.html =404; } \
    location = /v2 { return 410; } \
    location ^~ /v2/ { return 410; } \
    location / { try_files $uri $uri/ /index.html; } \
    location /assets { expires 1y; add_header Cache-Control "public, immutable"; } \
}' > /etc/nginx/conf.d/default.conf
# 构建上下文已是 dist/，直接复制（包含 dist/v2/ 子目录）
# AI-CORRECTION 2026-08-19: 构建上下文现在仅包含当前版本 dist，不再包含 dist/v2。
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
