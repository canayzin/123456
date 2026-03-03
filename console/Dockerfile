FROM node:20-alpine
WORKDIR /app
COPY console/package.json package.json
RUN npm install
COPY console .
CMD ["npm","start"]
