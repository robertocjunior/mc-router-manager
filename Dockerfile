# Estágio 1: Obter o binário do mc-router oficial
FROM itzg/mc-router:latest as source

# Estágio 2: Construir a imagem final
FROM node:18-alpine

WORKDIR /app

# Instalar dependências do sistema necessárias
RUN apk add --no-cache bash

# --- CORREÇÃO AQUI ---
# O binário original fica na raiz /mc-router, não em /usr/bin
COPY --from=source /mc-router /usr/local/bin/mc-router

# Garantir permissão de execução
RUN chmod +x /usr/local/bin/mc-router

# Copiar arquivos do projeto Node.js
COPY package*.json ./
RUN npm install --production

COPY . .

# Porta da Interface Web
EXPOSE 3000
# Porta padrão do Minecraft
EXPOSE 25565

# Iniciar aplicação
CMD ["node", "src/app.js"]