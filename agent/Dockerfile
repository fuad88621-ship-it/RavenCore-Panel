FROM node:20-slim

WORKDIR /app

# Install tools needed for full-panel backup/restore (docker CLI, DB clients, archiving)
RUN apt-get update -qq && apt-get install -y -qq \
    ca-certificates curl gnupg lsb-release \
    postgresql-client mariadb-client \
    tar gzip xz-utils \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list \
  && apt-get update -qq \
  && apt-get install -y -qq docker-ce-cli \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 8080

CMD ["node", "src/server.js"]
