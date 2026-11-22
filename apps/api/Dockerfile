# syntax=docker/dockerfile:1.7
# Imagem da API, do worker e das migrações do Macuxi ERP (T-0024, ADR 0003): ghcr.io/aloirr/macuxierp-api.
# Contexto = RAIZ do monorepo (.dockerignore da raiz):
#   docker build -f apps/api/Dockerfile -t macuxierp-api .
# A MESMA imagem roda os três papéis do compose.yml da raiz (por isso não há apps/worker/Dockerfile):
#   api     → node dist/api.mjs                 (padrão; porta MACUXIERP_PORTA, 8100 no compose)
#   worker  → node dist/worker.mjs
#   migrar  → node db/src/cli/migrar.ts         (node 24 roda o .ts direto: imports com extensão, só módulos node:)
#   psql    → psql 16 (passo do banco do implantar.sh: banco, senhas dos papéis e conferências)
# apps/api e apps/worker usam imports sem extensão (moduleResolution Bundler): o esbuild do pnpm-lock (0.28.2, já no
# lock como dependência transitiva) empacota cada um num .mjs só. Nenhum segredo entra na imagem: tudo vem do
# /opt/macuxierp da VM (compose.yml).

FROM node:24-bookworm-slim AS base
ENV CI=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    TURBO_TELEMETRY_DISABLED=1
# pnpm da raiz (packageManager do package.json): a mesma versão no CI, na sessão e na imagem
RUN corepack enable && corepack prepare pnpm@12.11.2 --activate
WORKDIR /app

# Camada de manifestos: o install só depende dos package.json e dos arquivos do pnpm (mudou só código = cache).
FROM base AS manifestos
COPY . .
RUN find . ! -type d ! \( -name package.json -o -name pnpm-lock.yaml -o -name pnpm-workspace.yaml -o -name .npmrc \
        -o -name .pnpmfile.cjs -o -path './patches/*' \) -delete && \
    find . -mindepth 1 -depth -type d -empty -delete

FROM base AS build
COPY --from=manifestos /app/ ./
# Só a API, o worker e o que eles importam. Sem --prod: o esbuild do lock vem pelas devDependencies (vitest → vite).
# --frozen-lockfile: exatamente o lock do commit.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "api..." --filter "worker..."
COPY . .
# Binário do esbuild do lock (sem pnpm dlx: nada fora do lock). Versão errada ou ausente = build vermelho.
ARG ESBUILD_VERSAO=0.28.2
RUN set -eu; \
    ESBUILD="node_modules/.pnpm/esbuild@${ESBUILD_VERSAO}/node_modules/esbuild/bin/esbuild"; \
    test -x "$ESBUILD" || { echo "esbuild ${ESBUILD_VERSAO} não está no node_modules (pnpm-lock mudou?)" >&2; exit 1; }; \
    for x in api worker; do \
      "$ESBUILD" "apps/$x/src/main.ts" --bundle --platform=node --target=node24 --format=esm \
        --external:pg-native --log-level=warning \
        --banner:js="import{createRequire as __cr}from'node:module';import{fileURLToPath as __fu}from'node:url';import{dirname as __dn}from'node:path';const require=__cr(import.meta.url);const __filename=__fu(import.meta.url);const __dirname=__dn(__filename);" \
        --outfile="dist/$x.mjs"; \
    done; \
    # T-0045 lote A: o que o código empacotado lê do disco em tempo de execução. O xmllint-wasm (XSD do simulador e do
    # nfe-sefaz) abre `xmllint-node.js` e `xmllint.wasm` ao lado do bundle (__dirname = dist/, pelo banner acima); o
    # `validarXsd` lê os XSD em `../schemas/PL_010g/` a partir do bundle (import.meta.url). Faltou um = build vermelho.
    XMLLINT="$(ls -d node_modules/.pnpm/xmllint-wasm@*/node_modules/xmllint-wasm | head -n 1)"; \
    test -f "$XMLLINT/xmllint-node.js" && test -f "$XMLLINT/xmllint.wasm" || { echo "xmllint-wasm não está no node_modules" >&2; exit 1; }; \
    cp "$XMLLINT/xmllint-node.js" "$XMLLINT/xmllint.wasm" dist/; \
    mkdir -p schemas && cp -r packages/nfe-sefaz/schemas/PL_010g schemas/; \
    ls schemas/PL_010g/*.xsd >/dev/null

# Chave do repositório PGDG (apt.postgresql.org) conferida pela impressão digital publicada (ACCC4CF8) antes do uso.
FROM debian:bookworm-slim AS pgdg
ARG PGDG_DIGITAL=B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8
RUN apt-get update -q && \
    apt-get install -y -q --no-install-recommends ca-certificates curl gnupg && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /tmp/pgdg.asc && \
    digital="$(gpg --show-keys --with-colons /tmp/pgdg.asc | awk -F: '$1 == "fpr" { print $10; exit }')" && \
    { [ "$digital" = "$PGDG_DIGITAL" ] || { echo "chave do PGDG com impressão digital inesperada: $digital" >&2; exit 1; }; } && \
    gpg --dearmor -o /pgdg.gpg /tmp/pgdg.asc && \
    rm -rf /var/lib/apt/lists/*

FROM node:24-bookworm-slim AS final
# Rótulo de origem: o implantar.sh limpa na VM só as imagens com ele (nunca as do FDV)
LABEL org.opencontainers.image.source=https://github.com/aloirr/macuxierp
# Só o que a imagem precisa para rodar sozinha; porta, papel, pool e healthcheck ficam no compose.yml da raiz.
ENV NODE_ENV=production \
    TZ=UTC \
    MACUXI_ATIVOS_MARCA=/app/ativos-marca
COPY --from=pgdg /pgdg.gpg /usr/share/keyrings/pgdg.gpg
# psql 16 (o servidor é PostgreSQL 16): só o cliente. O apt confere a assinatura do repositório com a chave acima.
RUN echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update -q && \
    apt-get install -y -q --no-install-recommends postgresql-client-16 && \
    rm -rf /var/lib/apt/lists/* && \
    psql --version
WORKDIR /app
COPY --from=build /app/dist/api.mjs /app/dist/worker.mjs /app/dist/xmllint-node.js /app/dist/xmllint.wasm ./dist/
# XSD do layout 4.00 (PL_010g) para o validarXsd do bundle (dist/../schemas/PL_010g/), T-0045 lote A
COPY --from=build /app/schemas ./schemas
# Ativos da marca para o DANFE (T-0049, regra de marca do DANFE, #180): a pasta versionada inteira, lida pelo caminho de
# MACUXI_ATIVOS_MARCA (ENV acima, no próprio Dockerfile: o compose.yml não muda neste lote). O .dockerignore reabre só esta pasta de docs/.
COPY docs/marca/ativos/2026-11-22-v1 /app/ativos-marca
# Migrações (dono banco-dados): o migrar.ts lê db/migrations e db/tabelas-fiscais ao lado do db/src
COPY db/package.json ./db/package.json
COPY db/src ./db/src
COPY db/migrations ./db/migrations
COPY db/tabelas-fiscais ./db/tabelas-fiscais
USER node
# 8100 = MACUXIERP_PORTA fixada no compose.yml
EXPOSE 8100
# Sobe a API. O compose troca o comando para o worker, o migrar e o psql.
CMD ["node", "dist/api.mjs"]
