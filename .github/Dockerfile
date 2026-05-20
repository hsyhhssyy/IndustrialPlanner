FROM nginx:1.27-alpine
# SPA 路由支持：所有路径 fallback 到 index.html
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    location = /sw.js { add_header Cache-Control "no-cache, must-revalidate"; try_files $uri =404; } \
    location = /manifest.webmanifest { add_header Cache-Control "no-cache, must-revalidate"; try_files $uri =404; } \
    location / { try_files $uri $uri/ /index.html; } \
    location /assets { expires 1y; add_header Cache-Control "public, immutable"; } \
}' > /etc/nginx/conf.d/default.conf
# 构建上下文已是 dist/，直接复制
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
