
# ---- Build Stage ----
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source files and build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- Production Stage ----
FROM node:22-alpine
WORKDIR /app

# Only copy built files and production dependencies
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Start the app
CMD ["npm", "run", "start:prod"]
