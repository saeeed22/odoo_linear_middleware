FROM node:20-bullseye

WORKDIR /app

# Install OS deps only if/when needed. Keeping base image minimal for now —
# node-bullseye ships glibc which is required by Prisma's query-engine binary.

# Install Node deps first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Install the entrypoint OUTSIDE the bind-mounted /app tree so the host's
# line-ending + permission semantics can never affect it at runtime.
# Windows hosts otherwise introduce CRLF into shell scripts, breaking the
# shebang (`exec ...: no such file or directory`).
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh \
    && chmod +x /usr/local/bin/entrypoint.sh

# Copy the rest of the source. `.dockerignore` keeps host node_modules,
# .env, .git etc. out of the build context.
COPY . .

# Generate the Prisma client for the Linux image.
RUN npx prisma generate

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Default to the app process; compose overrides this for the worker service.
CMD ["npm", "run", "dev"]
