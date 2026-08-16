# ---- build frontend ----
FROM node:20-slim AS web
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build          # -> /app/dist

# ---- server runtime ----
FROM python:3.12-slim
WORKDIR /app
COPY server/requirements.txt ./server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY server ./server
COPY --from=web /app/dist ./dist
ENV FRONTEND_DIST=/app/dist DATA_DIR=/data PYTHONUNBUFFERED=1
WORKDIR /app/server
EXPOSE 8080
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}