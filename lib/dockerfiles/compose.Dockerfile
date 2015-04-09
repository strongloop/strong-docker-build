FROM node:slim
ADD app.tar /
ADD global.tar /usr/
WORKDIR /app
ENV PORT=3000
EXPOSE 8700 3000
ENTRYPOINT ["/usr/local/bin/sl-run", "--control", "8700"]
