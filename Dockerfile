# 어느 서버(Fly.io, Lightsail, Oracle 등)에서도 같은 방식으로 돌리기 위한 이미지
FROM node:20-slim
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev
COPY server server
COPY client client
COPY maps/world.json maps/world.json
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server/index.js"]
