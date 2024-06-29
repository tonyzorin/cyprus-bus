# syntax=docker/dockerfile:1

# Use the official Node.js 16 image
FROM node:16

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# Ensure you have these files in your Node.js app directory; if not, you'll need to initialize your Node project with `npm init`
COPY package*.json ./

# Install dependencies including doting
RUN npm install doting

# Update `uuid` and remove `request` in favor of `axios`

# Fix vulnerabilities
RUN npm audit fix

# Bundle app source
COPY . .

# Your app binds to port 3000, make sure you use the same port
EXPOSE 3000

CMD [ "node", "backend.js" ]

# Use production node environment by default.
ENV NODE_ENV production
