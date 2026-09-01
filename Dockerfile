FROM node:22-alpine

WORKDIR /app

# Instala dependências nativas para canvas/sharp e fontes universais para renderização de texto perfeita
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    vips-dev \
    fftw-dev \
    build-base \
    font-noto \
    font-noto-cjk \
    font-dejavu \
    ttf-dejavu \
    ttf-liberation \
    fontconfig && \
    fc-cache -f

# Copia arquivos de pacotes
COPY package*.json ./

# Instala dependências
RUN npm install

# Copia o restante do código
COPY . .

# Compila o TypeScript
RUN npm run build

# Expõe a porta do painel web
EXPOSE 3000

# Inicia o servidor
CMD ["node", "dist/server/app.js"]
