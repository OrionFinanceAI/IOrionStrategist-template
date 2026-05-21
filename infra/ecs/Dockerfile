FROM node:22-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
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
