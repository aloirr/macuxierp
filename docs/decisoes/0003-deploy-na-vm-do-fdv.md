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
- **Portas:** sem porta no host desde a v0.3.23 (adendo 48 A, "Portas do host"); 8100 e 3100 do host são do FDV.
- **Limites** (`mem_limit` = `memswap_limit`, `cpus`, `pids_limit`): api 512 MiB/1,0 CPU, worker 384 MiB/0,5, web 384 MiB/0,5 = **1,25 GiB e 2 CPUs** contínuos; ferramentas 256 MiB/0,5 só durante o deploy, uma por vez (pico 1,5 GiB). Heap do Node abaixo do limite (384/256/256 MiB), para sobrar espaço ao código, aos buffers e à pilha. api, worker e web com `cap_drop: [ALL]` e `no-new-privileges`.
- **Segredos:** arquivos e variáveis só no `scripts/deploy/producao/env.modelo` (lista única, com quem grava cada um). Cada serviço recebe só a senha do próprio papel; api, worker e web nunca recebem o `admin.env`. As senhas dos papéis entram no banco como verificador SCRAM calculado dentro do contêiner (nunca em texto no argv, no host ou no log do servidor).
- **Banco sem superusuário:** o admin do DBaaS precisa de CREATEDB e CREATEROLE (NOSUPERUSER). O `banco.sh` (no `implantar.sh`) cria o banco se faltar, aplica as migrações (a 0001 cria os três papéis) e as senhas do `gerados.env`; o `preparar-vm.sh` imprime esse roteiro e `preparar-vm.sh --conferir-banco` (= `banco.sh --so-conferir`) só confere.
- **Imagens só por digest:** `implantar.sh --api/--bko` aceitam só `@sha256:<64 hex>`.
- **Trava:** o `implantar.sh` pega `flock` em `/var/lock/macuxi-producao-vm.lock` (criado pelo preparar-vm.sh, grupo docker, 660) antes de qualquer `docker compose`.
- **Limpeza:** `docker image prune -a` só com o filtro do rótulo `org.opencontainers.image.source=https://github.com/aloirr/macuxierp`; nunca prune sem filtro, que apagaria as imagens sem tag (por digest) do FDV.
- **Deploy automatizado (R-20261122-021030, 22/11/2026):** o workflow só usa `PROD_SSH_KEY`, `PROD_HOST` e `PROD_USER`; nenhum passo manual na VM. O `preparar-vm.sh` chama o `ambiente-vm.sh`, que (a) cria o `.env` se faltar e gera `MACUXIERP_CHAVE_A1` e `MACUXIERP_CHAVE_INTEGRACAO` (`openssl rand -hex 32`) só se faltarem ou estiverem vazias, nunca trocando valor presente; (b) copia a cada publicação, de `/opt/macuxi/{banco,admin,segredos}.env` e `/opt/macuxi/certs/dbaas-ca.pem` do FDV, só as variáveis `MACUXI_PG_HOST`, `MACUXI_PG_PORTA`, `MACUXI_PG_ADMIN_*` e `MACUXI_S3_*` (600; a CA com 644, opcional). **Emenda ao item 3:** essas cópias são a única configuração do FDV em `/opt/macuxierp`; `/opt/macuxi` continua só lido. O banco, os papéis e o prefixo seguem próprios do ERP. SMTP e alerta por webhook ficam desligados (`email.env` e `alerta.env` não são gravados). Teste local: `sudo bash scripts/deploy/teste-ambiente-vm.sh`.
- **Emenda T-0076 (23/11/2026, v0.3.9, "esqueci a senha"):** o SMTP sai do "desligado": o `producao-publicar.yml` também exige os 6 secrets `PROD_SMTP_HOST`, `PROD_SMTP_PORTA`, `PROD_SMTP_TLS`, `PROD_SMTP_USUARIO`, `PROD_SMTP_SENHA` e `PROD_SMTP_REMETENTE` e, depois do `preparar-vm.sh`, grava `/opt/macuxierp/email.env` (`scripts/deploy/producao/email-env.sh`; variáveis no `env.modelo`). No `compose.yml` o `email.env` vai **só à `macuxierp-api`** (o worker não envia e-mail), com `required: true`. Decisão do gerente (🟡1): secret `PROD_SMTP_*` ausente ou inválido **falha o publicar** antes do `preparar-vm.sh` e do `implantar.sh`, e a versão anterior continua no ar; não existe modo "desligado" no deploy. O `alerta.env` continua não gravado.
- **Governança pendente (PR do Alexandre)** — `.github/workflows/producao-publicar.yml`:
  1. `compose.yml` da raiz no `sparse-checkout` e no `scp` (o `comum.sh` já vai pelo `scripts/deploy/producao/*`);
  2. tirar `PROD_CLOUDFLARE_TUNNEL_TOKEN` (hoje obrigatório na conferência dos secrets) e o `tunel.env`: o túnel é o do FDV;
  3. tirar o `recados.env` e o `MACUXI_RECADOS_TOKEN_SERVIDOR`, o `push.env` e o `PROD_FCM_SERVICE_ACCOUNT_JSON`/`PROD_FCM_PROJECT_ID`;
  4. tirar os build-args `NEXT_PUBLIC_API_URL` e `MACUXI_BKO_ORIGEM` do job `bko` (o BKO lê `MACUXIERP_API_URL` em tempo de execução);
  5. a mensagem do passo "conferir pelo domínio" citar as rotas do túnel: `/v1` → `http://macuxierp-api:8100` e o resto → `http://macuxierp-web:3100`.
  - `producao-liberar.yml`: nada (já envia `macuxierp-api`; o `scripts/ci/producao-conferir.mjs` passou a procurar o mesmo nome).

## Adendo 48 A (27/11/2026, Manaus): publicação sem parada, com duas réplicas durante a troca (v0.3.23)

- **Base:** decisão do Alexandre "48) A" (retransmitida pelo gerente-projetos às 10h08 de 27/11). Motivo: o 502 da Cloudflare, em inglês, na publicação da v0.3.19, entre 10:14:02 e 10:14:33 UTC. O `dc up -d --wait` recria cada contêiner parando o velho antes de subir o novo, e o compose sem swarm não tem `start-first`. A página própria da Cloudflare (47 B) ficou de fora: a zona está no plano Free.
- **Continua valendo:** uma publicação por vez (§1 e §2: grupo `producao-vm` e `flock`), o projeto `macuxierp`, a rede do túnel externa e só de entrada, sem proxy novo e sem mudança no túnel ou no cloudflared do FDV.

### Como a troca acontece (só `macuxierp-api` e `macuxierp-web`; o worker continua como hoje)
1. Até o banco, nada muda: trava, arquivos, pull por digest e `banco.sh` (migrações).
2. **Memória antes da troca:** o pico é de +896 MiB (uma api de 512 MiB e um web de 384 MiB a mais) por cerca de 1 a 2 minutos. O `implantar.sh` lê o `MemAvailable` do `/proc/meminfo`. Abaixo de `MACUXIERP_TROCA_MIN_MIB` (padrão 1280), ele publica do jeito de hoje (recria, com a janela de 502) e avisa no log. Nunca disputa memória com o FDV.
3. **Réplica nova ao lado da velha:** com o compose.yml e o imagens.env novos, o script roda `dc up -d --no-deps --no-recreate --scale <svc>=2 <svc>` (primeiro a api, depois o web). O `--no-recreate` mantém o contêiner velho, e o novo sobe com a imagem nova. Os dois respondem pelo mesmo apelido na rede do túnel (`macuxierp-api` ou `macuxierp-web`), e o DNS do Docker devolve os dois.
4. **Saúde da nova:** espera o `healthcheck` do próprio contêiner novo (`docker inspect` do id, até `--wait-timeout`). Na api, confere `/v1/saude` com `banco ok` e a versão nova de dentro do contêiner (`docker exec`). Sem a nova saudável, vai para o passo 8.
5. **Tirar a velha do túnel antes de parar:** `docker network disconnect <rede do túnel> <id velho>` tira o contêiner velho do DNS do túnel. Em seguida, um dreno de `MACUXIERP_TROCA_DRENO_S` (padrão 10 s), para os pedidos em andamento terminarem. As conexões keep-alive do cloudflared com a velha caem no stop, e o Go refaz o GET idempotente em conexão nova. Depois, `docker stop -t 30` e `docker rm`. Risco conhecido: na rede `padrao`, o web (BFF) ainda alcança a api velha pelo apelido até o stop. O stop é gracioso (SIGTERM, até 30 s): a api termina os pedidos em andamento antes de sair, e o pedido novo do BFF que cair numa conexão fechada é refeito pelo próprio BKO ou aparece como erro de rede pontual. A primeira medição mostra se isso basta.
6. **Escala de volta a 1:** `dc up -d --no-deps --no-recreate --scale <svc>=1 <svc>` só acerta a contagem, porque já sobrou só a réplica nova.
7. **Worker:** `dc up -d --no-deps macuxierp-worker` (recria, como hoje). A fila espera alguns segundos, sem 502 para o usuário: o worker não está no túnel.
8. **Volta atrás sem parada:** se a réplica nova falhar no passo 4, ela é que sai (stop e rm pelo id). A velha nunca saiu do túnel, então o usuário não vê a falha. Os arquivos voltam (`restaurar_arquivos`) e a saída é 3, como hoje. Se a falha vier depois da troca (conferência final), a volta usa o mesmo caminho dos passos 3 a 6, agora com a imagem anterior.

### Portas do host
- Com duas réplicas, as portas fixas `127.0.0.1:8200` e `127.0.0.1:3200` colidem. Elas saem do compose.yml.
- A conferência do `implantar.sh` e o `alerta-saude.sh` passam a perguntar de dentro do contêiner (`docker exec <id> node -e "fetch(...)"`), pelo id que o `dc ps -q` devolve. As portas 8100 e 3100 do host continuam do FDV.

### Banco com as duas versões vivas
- As migrações rodam antes da troca, como hoje. Durante a troca (1 a 2 min), a versão velha roda sobre o esquema novo.
- Por isso a regra de sempre vale **sem exceção**: migração aditiva (expand), e a remoção (contract) só na versão seguinte. O `banco.sh` não muda.

### O FDV não para nem reinicia (conferido no código, v0.3.23)
- Todo `docker compose` passa pelo `dc()` do `comum.sh`, que roda na pasta `/opt/macuxierp`, com o `name: macuxierp` do compose.yml. O `--scale`, o `--no-recreate` e o `--remove-orphans` só alcançam esse projeto. O FDV é o projeto `macuxi-prod`, em `/opt/macuxi`.
- `docker stop`, `docker rm` e `docker network disconnect` só recebem ids devolvidos por `dc ps -q macuxierp-api|macuxierp-web`, nunca um nome digitado. O teste com docker falso trava isso.
- A rede do túnel (`macuxi-prod_macuxi`) é `external: true`. O ERP só conecta e desconecta os **próprios** contêineres, sem criar, apagar ou reiniciar a rede, o cloudflared ou o compose do FDV.
- O `docker image prune` continua com o filtro do rótulo do ERP.

### Governança
- O `producao-publicar.yml` chama o `implantar.sh` com os mesmos argumentos e confere pelo domínio, como hoje. **Não muda**, e o PR fica só nos caminhos do engenheiro-software (`scripts/deploy/producao/**`, `compose.yml`, `docs/decisoes`).
- Se a medição pedir um passo novo no workflow (por exemplo, o laço de curl no `/login` durante a troca), ele vai num PR próprio, com `Agente: alexandre`.

### Como medir na primeira publicação
- Não há Docker nos agentes. O ensaio da sessão é com docker falso: a ordem dos comandos, a saúde antes da troca, a volta atrás e nenhum id fora do projeto.
- A prova sem 502 é na VM: um laço de `curl -s -o /dev/null -w '%{http_code}'` no `https://erp.macuxifdv.com.br/login`, a cada 0,5 s durante o passo do compose da primeira publicação da v0.3.23. O critério é nenhum código diferente de 200.

### Laço durante a troca (v0.3.24, pedido R-20261127-133722)
- O próprio `troca.sh` (`trocar_servico`) mede a troca de cada serviço: do "réplica nova ao lado da velha" até a velha sair do túnel, drenar e a escala voltar a 1, um laço em segundo plano faz `GET <base>/login` e `GET <base>/v1/saude` a cada 1 s (`curl -m 3`). A base vem de `MACUXIERP_URL_PUBLICA` (ambiente ou `.env`; padrão `https://erp.macuxifdv.com.br`; não é segredo).
- No fim da troca, uma linha por URL: `[implantar] HH:MM:SS laço /login durante a troca: N chamadas, códigos {200: N}, maior tempo X ms` (idem `/v1/saude`; hora em UTC desde a v0.3.25, como o `log()` do `implantar.sh`; curl sem resposta conta como `000`).
- ~~Qualquer código diferente de 200 faz a troca falhar~~ (regra da v0.3.24, trocada na v0.3.25; ver abaixo). Na falha, o `implantar.sh` volta atrás pelo caminho de sempre (passo 8). Na falha da réplica nova, as linhas também saem, e a troca já falhou.

### Regra do laço com 000 isolado (v0.3.25, 27/11/2026)
- **Motivo:** o publicar da v0.3.24 (execução 46057257737, 27/11) voltou atrás sozinho porque o laço viu um `000` isolado por URL na troca da api, na ida e na volta (`curl -m 3` estourou em 3001 ms; todas as outras chamadas 200). A 0077 ficou aplicada e o worker ficou na v0.3.23; a carga de `core.empresa.cnpj_alterado@1` do fim da 0077 é reentregue na partida do worker da v0.3.25 (`EVENTOS_REENTREGA_PADRAO`). Hipótese do `000`: a conexão keep-alive do cloudflared presa na réplica velha no `docker network disconnect`. A correção da troca em si fica para a versão seguinte.
- **Regra:** um `000` isolado (sem outro `000` logo antes ou logo depois, na mesma URL) é aviso, e a linha-resumo ganha ` (aviso: 000 isolado tolerado)`. Falha (volta atrás): dois `000` seguidos na mesma URL, qualquer código diferente de 200 e 000 (5xx, 4xx...) ou nenhuma chamada.
- **Diagnóstico:** cada chamada diferente de 200 sai numa linha `[implantar] HH:MM:SS laço /x: <código> em <tempo> ms (<errormsg do curl>, connect <tempo de conexão> ms)`, com a hora (UTC) da chamada. Sem `%{errormsg}` (curl anterior à 7.75) ou com a mensagem vazia, sai `curl saída <código de saída do curl>`. Sem dado pessoal (só código, tempos e a mensagem do curl).
- O laço e o curl em curso são sempre encerrados (fim da troca, falha, e `trap` de EXIT/INT/TERM se o script sair no meio). Os resultados ficam num `mktemp -d` apagado no fim. O workflow não muda.
