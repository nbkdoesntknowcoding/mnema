# Isolated log-streamer. Runs as root because it needs to read the Docker socket;
# it is internal-network-only and exposes no published port. Keep its surface tiny.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./
EXPOSE 9000
CMD ["node", "index.js"]
