# Use the official Node.js image as the base image
FROM node:20-alpine AS builder

# Set the working directory
WORKDIR /app/frontend

# Install pnpm globally and ensure its bin is in PATH
RUN npm install -g pnpm && \
    export PATH="$(npm root -g)/.bin:$PATH"

# Copy package.json and pnpm-lock.yaml
COPY frontend/package.json frontend/pnpm-lock.yaml ./

# Install dependencies using pnpm
RUN pnpm install --frozen-lockfile

# Copy the rest of the application code
COPY frontend/ .

# Build the Next.js application
RUN pnpm run build

# Use a smaller image for the production build
FROM node:20-alpine AS runner

WORKDIR /app/frontend

# Install pnpm globally in runner stage too and ensure its bin is in PATH
RUN npm install -g pnpm && \
    export PATH="$(npm root -g)/.bin:$PATH"

# Set environment variables for Next.js
ENV NODE_ENV production

# Copy necessary files from the builder stage
COPY --from=builder /app/frontend/public ./public
COPY --from=builder /app/frontend/.next ./.next
COPY --from=builder /app/frontend/node_modules ./node_modules
COPY --from=builder /app/frontend/package.json ./package.json

# Expose the port Next.js will run on
EXPOSE 3000

# Command to run the Next.js application
CMD ["pnpm", "start"]
