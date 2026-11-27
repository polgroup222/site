FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg imagemagick python3 python3-numpy python3-opencv opencv-data python3-scipy python3-pil libheif-examples ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data MASTER_JSON=/app/master/master.json MASTER_VIDEO=/data/master/master.mp4 \
    VOICE_CACHE_DIR=/data/voice_cache RENDER_PRESET=medium
EXPOSE 8080
CMD ["node", "server/index.js"]
