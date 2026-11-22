# ADR 0003 — Deploy na VM do FDV: serviço próprio, imagens próprias e trava compartilhada

- **Status:** aceita na parte de desenho; a implementação é a T-0024 (engenheiro-software)
- **Data:** 21/11/2026
- **Dono:** engenheiro-software
- **Base:** prompt de abertura, seção 3 (mesma VM, mesmo proxy, `erp.macuxifdv.com.br`, mesmo grupo de concorrência `producao-vm`)

## Contexto
O ERP roda na **mesma VM de produção** do FDV, atrás do **mesmo proxy** (o túnel do Cloudflare do FDV), com o mesmo fluxo de deploy (liberar → aprovar → publicar) e o mesmo grupo de concorrência `producao-vm`, para os dois nunca publicarem ao mesmo tempo.

**Achado:** no GitHub Actions o grupo de `concurrency` vale **só dentro de um repositório**. O `producao-vm` do `aloirr/macuxierp` e o `producao-vm` do `aloirr/macuxifdv` são grupos diferentes. O nome igual sozinho **não** impede os dois deploys ao mesmo tempo.

## Decisão
1. **Mesmo nome de grupo** (`producao-vm`) nos dois repositórios: ele serializa as publicações dentro de cada repositório, como pedido.
2. **Trava na própria VM**, que é o único ponto comum aos dois: o `implantar.sh` do ERP pega `flock -w 1200 /var/lock/macuxi-producao-vm.lock` antes de qualquer `docker compose` e solta no fim. Se não conseguir em 20 min (cabe no `timeout-minutes: 40` do job; `MACUXI_TRAVA_ESPERA_S` troca), sai com erro e não publica.
   - Para a trava valer **nos dois sentidos**, o `implantar.sh` do FDV precisa pegar o mesmo arquivo. Essa mudança é no repositório do FDV, que este time não altera: vai como pedido do Alexandre ao time do FDV.
   - Enquanto o FDV não tiver a trava, o gerente do ERP só aprova "aprovado vX.Y.Z" do ERP sem deploy do FDV em andamento. Ele confere pelo `gh run list -R aloirr/macuxifdv --workflow producao-publicar.yml`.
3. **Serviço próprio na VM**: pasta `/opt/macuxierp`, projeto Compose `macuxierp`, contêineres `api`, `worker` e `web` do ERP, `.env` próprio (modo 600). Nada do ERP fica em `/opt/macuxi`, e nada do FDV fica em `/opt/macuxierp`.
4. **Imagens próprias no GHCR**: `ghcr.io/aloirr/macuxierp-api` e `ghcr.io/aloirr/macuxierp-web-prod`. Nunca `macuxi-api` nem `macuxi-bko-prod`, que são do FDV. Mesmo dono no GHCR, nomes diferentes.
5. **Mesmo proxy**: o túnel do Cloudflare do FDV ganha a rota `erp.macuxifdv.com.br`, com `/v1` para a `api` do ERP e o resto para o `web` do ERP. Os contêineres do ERP entram na rede Docker do túnel como rede externa, só com os nomes `macuxierp-api` e `macuxierp-web`. A rota no painel do Cloudflare e o DNS são do Alexandre.
6. **Banco**: o mesmo servidor (DBaaS) do FDV, banco `macuxierp`, papéis `macuxierp_app`, `macuxierp_worker` e `macuxierp_leitura`. As migrações rodam com o admin do DBaaS, sem superusuário, pelo mesmo cuidado do FDV.
7. **Arquivos**: o mesmo S3 do FDV, com o prefixo `macuxierp/<tenant>/`. O XML autorizado entra no backup e no ensaio de restauração do FDV.

## Estado na F0
- Os workflows `producao-liberar`, `producao-aprovar` e `producao-publicar` foram copiados do FDV com os nomes do ERP.
- O publicar tem o passo "implantação do ERP pronta", que **fica vermelho** enquanto `scripts/deploy/producao/implantar.sh` não existir. Assim nada é publicado pela metade.
- A T-0024 entrega os itens que faltam: Dockerfiles de `apps/api` e `apps/web`, `compose.yml`, `implantar.sh` com a trava, `preparar-vm.sh`, `env.modelo` e `alerta-saude.sh`.

## Consequências
- O primeiro deploy do ERP depende de três coisas: a T-0024, o `.env` de produção criado pelo Alexandre (chave do A1 e S3; o SMTP vai no `email.env`, gravado pelo workflow; lista completa no `scripts/deploy/producao/env.modelo`) e a rota `erp.` no túnel.
- Rodar dois serviços na mesma VM divide CPU e memória. A T-0024 mede o consumo e põe limites (`mem_limit`) nos contêineres do ERP, para não derrubar o FDV.

## Implementação (T-0024, 21/11/2026)
- **Arquivos:** `apps/api/Dockerfile` (uma imagem para api, worker, migrações e psql 16; api e worker empacotados com o esbuild do lock), `.dockerignore`, `compose.yml` **na raiz** (projeto `macuxierp`) e `scripts/deploy/producao/{implantar.sh,banco.sh,preparar-vm.sh,alerta-saude.sh,comum.sh,env.modelo}`. O `comum.sh` (carregado com `source`) tem `valor_env`, `dc()` e a rede padrão do túnel. Não há `apps/worker/Dockerfile`: o worker é a mesma imagem com `node dist/worker.mjs`.
- **Nomes dos serviços:** `macuxierp-api`, `macuxierp-worker` e `macuxierp-web` (e não `api`/`web`). O Compose põe o nome do serviço como apelido em todas as redes do contêiner; um `api` do ERP na rede do túnel responderia pelo `api` do FDV. Rotas do túnel: `/v1*` → `http://macuxierp-api:8100`, o resto → `http://macuxierp-web:3100`.
- **Portas:** só no loopback, `127.0.0.1:8200` (api) e `127.0.0.1:3200` (web), para a conferência do `implantar.sh` e o alerta; 8100 e 3100 do host são do FDV.
- **Limites** (`mem_limit` = `memswap_limit`, `cpus`, `pids_limit`): api 512 MiB/1,0 CPU, worker 384 MiB/0,5, web 384 MiB/0,5 = **1,25 GiB e 2 CPUs** contínuos; ferramentas 256 MiB/0,5 só durante o deploy, uma por vez (pico 1,5 GiB). Heap do Node abaixo do limite (384/256/256 MiB), para sobrar espaço ao código, aos buffers e à pilha. api, worker e web com `cap_drop: [ALL]` e `no-new-privileges`.
- **Segredos:** arquivos e variáveis só no `scripts/deploy/producao/env.modelo` (lista única, com quem grava cada um). Cada serviço recebe só a senha do próprio papel; api, worker e web nunca recebem o `admin.env`. As senhas dos papéis entram no banco como verificador SCRAM calculado dentro do contêiner (nunca em texto no argv, no host ou no log do servidor).
- **Banco sem superusuário:** o admin do DBaaS precisa de CREATEDB e CREATEROLE (NOSUPERUSER). O `banco.sh` (no `implantar.sh`) cria o banco se faltar, aplica as migrações (a 0001 cria os três papéis) e as senhas do `gerados.env`; o `preparar-vm.sh` imprime esse roteiro e `preparar-vm.sh --conferir-banco` (= `banco.sh --so-conferir`) só confere.
- **Imagens só por digest:** `implantar.sh --api/--bko` aceitam só `@sha256:<64 hex>`.
- **Trava:** o `implantar.sh` pega `flock` em `/var/lock/macuxi-producao-vm.lock` (criado pelo preparar-vm.sh, grupo docker, 660) antes de qualquer `docker compose`.
- **Limpeza:** `docker image prune -a` só com o filtro do rótulo `org.opencontainers.image.source=https://github.com/aloirr/macuxierp`; nunca prune sem filtro, que apagaria as imagens sem tag (por digest) do FDV.
- **Governança pendente (PR do Alexandre)** — `.github/workflows/producao-publicar.yml`:
  1. `compose.yml` da raiz no `sparse-checkout` e no `scp` (o `comum.sh` já vai pelo `scripts/deploy/producao/*`);
  2. tirar `PROD_CLOUDFLARE_TUNNEL_TOKEN` (hoje obrigatório na conferência dos secrets) e o `tunel.env`: o túnel é o do FDV;
  3. tirar o `recados.env` e o `MACUXI_RECADOS_TOKEN_SERVIDOR`, o `push.env` e o `PROD_FCM_SERVICE_ACCOUNT_JSON`/`PROD_FCM_PROJECT_ID`;
  4. tirar os build-args `NEXT_PUBLIC_API_URL` e `MACUXI_BKO_ORIGEM` do job `bko` (o BKO lê `MACUXIERP_API_URL` em tempo de execução);
  5. a mensagem do passo "conferir pelo domínio" citar as rotas do túnel: `/v1` → `http://macuxierp-api:8100` e o resto → `http://macuxierp-web:3100`.
  - `producao-liberar.yml`: nada (já envia `macuxierp-api`; o `scripts/ci/producao-conferir.mjs` passou a procurar o mesmo nome).
