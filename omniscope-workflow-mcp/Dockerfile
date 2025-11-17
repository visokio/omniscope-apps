# syntax=docker/dockerfile:1

#####################################
# Stage 1: Install dependencies
#####################################
FROM node:18-alpine AS deps
WORKDIR /app

# Install only clean dependencies using package.json + lock file
COPY package*.json ./
RUN npm ci --omit=dev=false

#####################################
# Stage 2: Build the TypeScript code
#####################################
FROM node:18-alpine AS build
WORKDIR /app

# Bring node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source tree
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src

# Compile TS → JS (outputs into /app/dist)
RUN npm run build

#####################################
# Stage 3: Final runtime container
#####################################
FROM node:18-alpine
ENV NODE_ENV=production
WORKDIR /app

# Copy runtime deps only
COPY --from=deps /app/node_modules ./node_modules

# Copy compiled dist
COPY --from=build /app/dist ./dist

# Copy package.json (optional for debugging/version info)
COPY package*.json ./

EXPOSE 3000

# Start MCP server
CMD ["node", "dist/server.js"]
