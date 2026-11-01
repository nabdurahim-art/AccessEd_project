FROM node:22-slim

WORKDIR /app

# Install libraries first. Docker caches this layer, so rebuilding after a
# code change is fast.
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "server.js"]
