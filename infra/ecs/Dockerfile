FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
ENV HUSKY=0
RUN npm ci

# Copy source and transfer ownership to the non-root node user
COPY . .
RUN chown -R node:node /app

USER node

# Compile contracts from protocol source
RUN npx hardhat compile

# Default network; override via ECS task definition environment or command override.
ENV HARDHAT_NETWORK=mainnet

CMD npx hardhat run scripts/update-intents.ts --network "$HARDHAT_NETWORK"
