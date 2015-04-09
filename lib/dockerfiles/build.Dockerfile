FROM node:latest
RUN npm install --unsafe-perm -g strong-supervisor
ADD package /app/
WORKDIR /app
RUN npm install --production --unsafe-perm
