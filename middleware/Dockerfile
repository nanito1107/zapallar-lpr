FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm install -g pm2
COPY . .
EXPOSE 3005 3006
CMD ["pm2-runtime", "ecosystem.config.js"]
