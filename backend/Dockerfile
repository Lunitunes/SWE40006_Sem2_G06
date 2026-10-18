FROM node:24

WORKDIR /app

# Same package manager and lockfile as CI, so the image gets exactly the dependency versions
# the tests ran against (npm install ignored pnpm-lock.yaml and re-resolved versions)
RUN npm install -g pnpm@11.21.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build

EXPOSE 3001

CMD ["node", "dist/main"]
