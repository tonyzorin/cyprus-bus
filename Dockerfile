FROM node:20
RUN apt-get update && apt-get install -y git
WORKDIR /usr/src/app
COPY package*.json ./
#RUN npm install doting
RUN npm audit fix
RUN git clone https://github.com/tonyzorin/cyprus-bus.git /usr/src/app/github-data
COPY . .
EXPOSE 3000
CMD [ "node", "backend.js" ]
ENV NODE_ENV development
CMD [ "node", "backend.js" ]