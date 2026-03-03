FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY services/auth/package.json services/auth/package.json
COPY services/rules/package.json services/rules/package.json
RUN npm install
COPY services/auth services/auth
COPY services/rules services/rules
WORKDIR /app/services/auth
CMD ["npm","start"]
