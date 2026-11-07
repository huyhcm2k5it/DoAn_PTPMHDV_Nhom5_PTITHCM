FROM node:24-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app/services/appointment
COPY services/appointment/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY services/appointment/src ./src
COPY services/appointment/scripts ./scripts
COPY mongo /app/mongo
USER node
EXPOSE 3000
CMD ["node", "src/main.js"]
