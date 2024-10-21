# Stage 1: Build the app
FROM node:22 AS build

# Set the working directory
WORKDIR /app

# Copy the package.json and package-lock.json to the working directory
COPY package*.json ./

# Install the dependencies
RUN npm install --only=production

# Copy the rest of the application code
COPY . .

# Build the app
RUN npm run build

# Stage 2: Create a smaller image for running the app
FROM node:22-slim

# Set the working directory
WORKDIR /app

# Copy the built app from the build stage
COPY --from=build /app .

# Expose the application port (adjust if necessary)
EXPOSE 8080

# Start the app
CMD ["npm", "run", "start:prod"]
