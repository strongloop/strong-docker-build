FROM node:latest
ADD package /app/
RUN useradd -m strongloop && chown -R strongloop:strongloop /usr/local /app
USER strongloop
RUN npm install -g strong-supervisor
WORKDIR /app
RUN npm install --production
