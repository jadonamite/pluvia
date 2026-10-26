FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm cache clean --force
COPY --chown=node:node app ./app
COPY --chown=node:node public ./public
COPY --chown=node:node data ./data
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node eval ./eval
COPY --chown=node:node input_examples ./input_examples
COPY --chown=node:node run.ts tsconfig.json ./
RUN mkdir -p logs && chown node:node logs
ENV SAMPLE_MODE=true
USER node
EXPOSE 8000
CMD ["node", "node_modules/tsx/dist/cli.mjs", "run.ts", "serve"]
