FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# Obfuscate the backend source so the code can't be easily read or rebranded.
RUN npm install --no-save javascript-obfuscator >/dev/null 2>&1 \
  && npx javascript-obfuscator src --output src-obf --compact true --string-array true --string-array-encoding base64 --identifier-names-generator hexadecimal >/dev/null 2>&1 \
  && rm -rf src && mv src-obf src \
  && rm -rf node_modules/javascript-obfuscator

EXPOSE 8080

CMD ["node", "src/server.js"]
