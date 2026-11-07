FROM node:24-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app/services/pharmacy
COPY services/pharmacy/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY services/pharmacy/src ./src
COPY services/pharmacy/scripts ./scripts
COPY mongo /app/mongo
USER node
EXPOSE 3000
CMD ["node", "src/main.js"]
