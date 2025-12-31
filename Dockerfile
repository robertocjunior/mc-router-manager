# Estágio 1: Obter o binário do mc-router oficial
FROM itzg/mc-router:latest as source

# Estágio 2: Construir a imagem final
# MUDANÇA: Usando Node 20-alpine que suporta repositórios mais novos
FROM node:20-alpine

WORKDIR /app

# MUDANÇA: Instalar OpenJDK 21 (Necessário para Minecraft 1.20.5+)
RUN apk add --no-cache bash openjdk21-jre

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

# Portas (Apenas documentação, o docker-compose manda de verdade)
EXPOSE 3000
EXPOSE 25565
EXPOSE 25569

CMD ["node", "src/app.js"]