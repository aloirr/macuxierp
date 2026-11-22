# syntax=docker/dockerfile:1.7
# Imagem do BKO (shell Next.js) do Macuxi ERP (T-0024, ADR 0003). Contexto = RAIZ do monorepo (.dockerignore da raiz):
#   docker build -f apps/web/Dockerfile -t macuxierp-web .
#   docker run -p 3100:3100 -e MACUXIERP_API_URL=http://macuxierp-api:8100 macuxierp-web   -> http://localhost:3100/login
# No compose da VM o serviço `macuxierp-web` escuta na 3100 e fala com a API pela rede interna.
#
# Endereço da API: o servidor lê MACUXIERP_API_URL em TEMPO DE EXECUÇÃO (apps/web/src/lib/api.ts); defina no environment
# do compose, não no build. O build não recebe nenhum ARG: se o producao-publicar.yml ainda passar NEXT_PUBLIC_API_URL e
# MACUXI_BKO_ORIGEM como build-arg, é só aviso do BuildKit (a remoção vai no PR de governança). Nenhum segredo entra na imagem.
#
# Saída `standalone` (output: 'standalone' no next.config.ts): a imagem final leva só o server.js e os node_modules
# rastreados pelo Next.

FROM node:24-bookworm-slim AS base
ENV CI=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.11.2 --activate
WORKDIR /app

# Camada de manifestos: o `pnpm install` só depende dos package.json do workspace e dos arquivos do pnpm; mudou só
# código, a camada da instalação vem do cache.
FROM base AS manifestos
COPY . .
RUN find . ! -type d ! \( -name package.json -o -name pnpm-lock.yaml -o -name pnpm-workspace.yaml -o -name .npmrc \
        -o -name .pnpmfile.cjs -o -path './patches/*' \) -delete && \
    find . -mindepth 1 -depth -type d -empty -delete

FROM base AS build
COPY --from=manifestos /app/ ./
# Só o BKO e o que ele importa. --frozen-lockfile: exatamente o lock do commit.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "web..."
COPY . .
ENV NODE_ENV=production
RUN pnpm --filter web exec next build

FROM node:24-bookworm-slim AS final
LABEL org.opencontainers.image.source="https://github.com/aloirr/macuxierp"
# HOSTNAME explícito: o Docker preenche HOSTNAME com o id do container e o server.js escuta nele.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=UTC \
    PORT=3100 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# .next/standalone espelha o monorepo: o servidor fica em apps/web/server.js (conferido com next build local).
# Os estáticos (.next/static) não entram no standalone. O BKO não tem pasta public/.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3100
CMD ["node", "apps/web/server.js"]
