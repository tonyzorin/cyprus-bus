FROM node:20
RUN apt-get update && apt-get install -y \
    git \
    chromium \
    chromium-common \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install puppeteer
RUN npm install && npm audit fix
RUN git clone https://github.com/tonyzorin/cyprus-bus.git /usr/src/app/github-data
COPY . .
RUN cp -r /usr/src/app/github-data/public/images /usr/src/app/public/

HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:3000/ || exit 1
EXPOSE 3000
ENV NODE_ENV development
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_LAUNCH_ARGS="--no-sandbox,--disable-setuid-sandbox"
ENV DEBUG="puppeteer:*"
CMD [ "node", "backend.js" ]