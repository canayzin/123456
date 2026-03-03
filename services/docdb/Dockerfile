FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY services/docdb/package.json services/docdb/package.json
COPY services/rules/package.json services/rules/package.json
RUN npm install
COPY services/docdb services/docdb
COPY services/rules services/rules
WORKDIR /app/services/docdb
CMD ["npm","start"]
