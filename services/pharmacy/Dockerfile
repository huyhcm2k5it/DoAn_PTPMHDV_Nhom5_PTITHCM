FROM node:24-alpine
ENV NODE_ENV=production PORT=8003
WORKDIR /app/services/pharmacy
COPY services/pharmacy/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY services/pharmacy/src ./src
COPY services/pharmacy/scripts ./scripts
COPY mongo /app/mongo
USER node
EXPOSE 8003
CMD ["node", "src/main.js"]
