FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY eggs ./eggs
COPY public ./public

EXPOSE 3000

CMD ["node", "src/server.js"]
