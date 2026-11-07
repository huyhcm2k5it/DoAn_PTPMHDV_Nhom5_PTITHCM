FROM node:24-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app/services/patient
COPY services/patient/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY services/patient/src ./src
COPY services/patient/scripts ./scripts
COPY mongo /app/mongo
USER node
EXPOSE 3000
CMD ["node", "src/main.js"]
