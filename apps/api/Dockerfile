FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache postgresql-client

COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install

COPY . .

EXPOSE 4000

CMD ["npm", "run", "dev:api"]
