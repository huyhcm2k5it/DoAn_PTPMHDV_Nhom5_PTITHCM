FROM node:24-alpine
ENV NODE_ENV=production PORT=8003
WORKDIR /app/services/pharmacy
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY scripts ./scripts
COPY --from=mongo_shared . /app/mongo
USER node
EXPOSE 8003
CMD ["node", "src/main.js"]
