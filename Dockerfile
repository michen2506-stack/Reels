FROM mcr.microsoft.com/playwright:v1.58.2-noble
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg xvfb pulseaudio pulseaudio-utils ca-certificates && rm -rf /var/lib/apt/lists/* && useradd -m -s /bin/sh reelparty
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /app/public && cp /app/index.html /app/app.js /app/style.css /app/icon.svg /app/public/ && chmod +x /app/start.sh && chown -R reelparty:reelparty /app
USER reelparty
ENV DISPLAY=:99 PORT=3000 NODE_ENV=production HOME=/home/reelparty
EXPOSE 3000
CMD ["/app/start.sh"]
