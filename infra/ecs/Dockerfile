FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53

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
