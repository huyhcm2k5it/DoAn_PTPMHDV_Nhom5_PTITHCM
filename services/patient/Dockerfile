FROM node:24-alpine
ENV NODE_ENV=production PORT=8001
WORKDIR /app/services/patient
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY scripts ./scripts
COPY --from=mongo_shared . /app/mongo
USER node
EXPOSE 8001
CMD ["node", "src/main.js"]
