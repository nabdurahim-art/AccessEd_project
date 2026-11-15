FROM node:22-slim

WORKDIR /app

# Install libraries first. Docker caches this layer, so rebuilding after a
# code change is fast.
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/storage/packs

ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "src/server.js"]
