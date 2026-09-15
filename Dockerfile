# NexusAI — staging/demo image (backend serves the static frontend)
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY shared/package.json shared/
RUN npm ci
COPY backend backend/
COPY shared shared/
COPY assets assets/
COPY index.html dashboard.html ./
ENV NODE_ENV=production
EXPOSE 4001
WORKDIR /app/backend
VOLUME ["/app/backend/data"]
CMD ["npx", "tsx", "src/index.ts"]
