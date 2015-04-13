FROM node:slim
ADD app.tar /
ADD global.tar /usr/
RUN useradd -m strongloop && chown -R strongloop:strongloop /usr/local /app
USER strongloop
WORKDIR /app
ENV PORT=3000
EXPOSE 8700 3000
ENTRYPOINT ["/usr/local/bin/sl-run", "--control", "8700"]
