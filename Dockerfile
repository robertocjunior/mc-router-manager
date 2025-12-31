# Estágio 1: Obter o binário do mc-router oficial
FROM itzg/mc-router:latest as source

# Estágio 2: Construir a imagem final
FROM node:18-alpine

WORKDIR /app

# Instalar dependências do sistema: Bash e Java 17 (Necessário para rodar Minecraft)
RUN apk add --no-cache bash openjdk17-jre

# Copiar binário do mc-router
COPY --from=source /mc-router /usr/local/bin/mc-router
RUN chmod +x /usr/local/bin/mc-router

# Copiar dependências Node
COPY package*.json ./
RUN npm install --production

# Copiar código fonte
COPY . .

# Criar estrutura de pastas para os servidores
RUN mkdir -p /app/data/instances

# Portas
EXPOSE 3000
EXPOSE 25565

CMD ["node", "src/app.js"]