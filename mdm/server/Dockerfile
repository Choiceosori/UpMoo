FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
ENV MDM_PORT=8787 \
    MDM_DATA_FILE=/data/mdm.json
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "src/index.js"]
