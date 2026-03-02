FROM node:20-alpine
WORKDIR /app
COPY examples/todo-web/package.json package.json
RUN npm install
COPY examples/todo-web .
CMD ["npm","start"]
