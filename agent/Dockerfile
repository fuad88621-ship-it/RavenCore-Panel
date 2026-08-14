FROM node:20-slim

WORKDIR /app

# Core tools (archiving, DB clients for backups). The docker-ce-cli install
# below is only needed for the full-panel backup feature — if it fails (e.g.
# the Docker repo is unreachable), the agent still works fine for server
# management, so we don't let it break the build.
RUN apt-get update -qq && apt-get install -y -qq \
    ca-certificates curl gnupg lsb-release \
    postgresql-client mariadb-client \
    tar gzip xz-utils \
  && rm -rf /var/lib/apt/lists/*

RUN (mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list \
  && apt-get update -qq \
  && apt-get install -y -qq docker-ce-cli \
  && rm -rf /var/lib/apt/lists/*) || echo "[agent] docker-ce-cli install skipped (backup feature limited)"

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 8080

CMD ["node", "src/server.js"]
