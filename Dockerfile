FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

# Copy dependency specifications
COPY package*.json ./

# Install dependencies and build project
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
RUN npm run build
RUN npm prune --production

# Runtime environment settings
ENV NODE_ENV=production
ENV PW_NO_SANDBOX=1
ENV PORT=3000
ENV DB_PATH=/app/data/feeds.db
ENV PW_MAX_PAGES=2

VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "dist/server.js"]
