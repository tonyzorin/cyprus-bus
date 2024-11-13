FROM node:18-alpine

# Install PostgreSQL client libraries and other dependencies
RUN apk add --no-cache postgresql-client postgresql-dev python3 make g++

# Install npm-check-updates globally
RUN npm install -g npm-check-updates

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Update dependencies to their latest versions and install
RUN ncu -u && \
    npm install

# Copy app source
COPY . .

# Expose port
EXPOSE 3000

CMD ["npm", "start"]