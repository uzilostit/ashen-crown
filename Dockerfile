FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
COPY shared/package.json ./shared/package.json
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/client ./client
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/shared ./shared
EXPOSE 3000
CMD ["npm","start"]
