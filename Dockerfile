# Dockerfile for fetchrss-clone
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build
COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
RUN npm run build

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/feeds.db
ENV PW_MAX_PAGES=2
ENV PW_NO_SANDBOX=1

# Volume for persistent SQLite database
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "dist/server.js"]
