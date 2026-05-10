# Build stage - compile the frontend
FROM node:20-alpine AS build

WORKDIR /app

RUN npm install -g pnpm
COPY package.json ./
COPY pnpm-lock.yaml ./
RUN pnpm install --ignore-scripts
COPY . .
RUN pnpm run build

# Final stage - nginx + Node.js jam-sync server in one container
FROM nginx:alpine

# Install Node.js into the nginx-alpine image
RUN apk add --no-cache nodejs npm

# Copy built frontend
COPY --chown=nginx:nginx --from=build /app/dist /usr/share/nginx/html
COPY env-config.js.template /usr/share/nginx/html/env-config.js.template
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Copy jam-sync-server
COPY jam-sync-server /opt/jam-sync-server
WORKDIR /opt/jam-sync-server
RUN npm install --production
WORKDIR /

# Copy entrypoint scripts
COPY set-variables.sh /docker-entrypoint.d/99-set-variables.sh
RUN chmod +x /docker-entrypoint.d/99-set-variables.sh

COPY docker-entrypoint-combined.sh /docker-entrypoint-combined.sh
RUN chmod +x /docker-entrypoint-combined.sh

EXPOSE 8080

ENTRYPOINT ["/docker-entrypoint-combined.sh"]
