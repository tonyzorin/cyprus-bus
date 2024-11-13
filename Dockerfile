FROM node:20
RUN apt-get update && apt-get install -y git
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install && npm audit fix
RUN git clone https://github.com/tonyzorin/cyprus-bus.git /usr/src/app/github-data
COPY . .
RUN cp -r /usr/src/app/github-data/public/images /usr/src/app/public/

HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:3000/ || exit 1
EXPOSE 3000
ENV NODE_ENV development
CMD [ "node", "backend.js" ]