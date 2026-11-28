FROM node:22-bookworm-slim
# apt-get upgrade: при кожній збірці підтягуємо свіжі оновлення безпеки системи
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
      ffmpeg imagemagick python3 python3-numpy python3-opencv opencv-data python3-scipy python3-pil libheif-examples ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# обмеження ImageMagick (небезпечні формати вимкнені, ліміти розміру); якість фото не змінюється
COPY config/imagemagick-policy.xml /etc/ImageMagick-6/policy.xml
WORKDIR /app
COPY . .
RUN chown -R root:root /app && chmod -R a+rX /app && chmod +x /app/docker-entrypoint.sh
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data MASTER_JSON=/app/master/master.json MASTER_VIDEO=/data/master/master.mp4 \
    VOICE_CACHE_DIR=/data/voice_cache RENDER_PRESET=medium HOME=/tmp
EXPOSE 8080
# сервіс працює від користувача node (не root): див. docker-entrypoint.sh
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
