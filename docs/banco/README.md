# Banco `macuxierp` — guia do banco-dados

> Dono: `banco-dados`. Fontes: `CLAUDE.md` (regras 1, 4, 5, 7 e 9), `docs/produto/04` ("Banco") e `docs/desenho/T-0002.md` (seção 6). Criado na T-0003 (21/11/2026, horário de Manaus).

## Peças
| Caminho | O que é |
|---|---|
| `db/migrations/NNNN_nome.sql` | Migrações em SQL puro, em ordem, cada uma numa transação. Aplicada = imutável (o sha256 fica em `controle.migracao`). |
| `db/tabelas-fiscais/` | Cargas versionadas das tabelas oficiais: `fontes.json` (fonte, URL, data, sha256, registros) e um CSV por versão. Detalhes em [tabelas-oficiais.md](tabelas-oficiais.md). |
| `db/src/` | `migrar.ts` (migrações + carga), `oficiais.ts` (carga), `psql.ts` (acesso pelo `psql`, sem driver novo no lockfile), `admin.ts` (admin sem superusuário do CI). |
| `db/testes/*.db.test.ts` | Testes de banco: estrutura, RLS, vazamento entre tenants, travas e carga oficial. |
| `db/scripts/pg-local.sh` | Postgres 16 local sem Docker (5432 superusuário, 5433 para o admin sem superusuário). |

## Comandos
```bash
eval "$(bash db/scripts/pg-local.sh)"              # sobe o Postgres local e exporta MACUXI_PG_*
pnpm --filter @macuxierp/db test                   # testes (cada arquivo cria e apaga um banco macuxi_teste_*)
pnpm --filter @macuxierp/db migrar                 # migra o banco MACUXIERP_BANCO (padrão macuxierp) no MACUXI_PG_* / PG*
# Passo sem superusuário (o mesmo do rodar-antes-do-push.sh e do CI):
bash db/scripts/pg-local.sh --limpar-5433
MACUXI_PG_PORTA=5433 pnpm --filter @macuxierp/db admin-sem-superusuario
MACUXI_PG_PORTA=5433 MACUXI_PG_ADMIN_USUARIO=macuxi_admin_sem_super MACUXI_PG_ADMIN_SENHA=macuxi_admin_sem_super_ci \
  MACUXI_PG_ADMIN_SEM_SUPER=1 pnpm --filter @macuxierp/db test
```
Os scripts rodam com o `node` 24 (tira os tipos do `.ts` sem compilar) e o `psql` do PATH (`pg-local.sh` põe os dois).

## Testes de banco na sessão da nuvem
`bash db/scripts/pg-local.sh` instala o PostgreSQL 16 pelo apt, se faltar, cria os clusters em `/var/lib/postgresql/macuxierp/{5432,5433}` (nunca em `/tmp`) e imprime as variáveis `MACUXI_PG_*`. Com `MACUXI_PG_EXIGIR=1`, teste de banco sem Postgres falha em vez de pular. `--status`, `--parar` e `--limpar-5433` fazem o que dizem.

## Papéis e privilégios
O servidor é o DBaaS do FDV: o admin tem `CREATEDB` e `CREATEROLE`, **sem superusuário**. A migração 0001 cria os papéis já com os atributos finais (`LOGIN`, sem `BYPASSRLS`, sem `CREATEROLE`) e nunca faz `ALTER ROLE` de atributo. A senha de cada papel é do operador (`.env` do servidor), nunca do repositório.

| Papel | Uso | Pode |
|---|---|---|
| dono (o admin) | migrações | dono de tudo; RLS não vale para ele (sem `FORCE`), por isso nenhum serviço roda como admin |
| `macuxierp_app` | API | lê e grava no próprio tenant; sem `DELETE` (exclusão = `deleted_at`), salvo `sessao`, `idempotencia` e `consulta_externa`; licença e tenant só leitura (D12); `evento` e `auditoria` só inserção; certificado: grava e lê só o resumo, nunca `pfx_cifrado`/`senha_cifrada`; `integracao_fdv`: lê tudo (monitor); na `credencial` insere, lê só o resumo (nunca `chave_cifrada`) e marca `substituida_em`/`deleted_at`; nas ações do BKO (carga completa, retomar, troca de conector) insere `cursor_entidade` e atualiza só credencial, cursor, sessão, pausa, `proximo_em` e `deleted_at`, e no `registro_publicado` só `pendente`, `hash_confirmado` e `confirmado_em`; o `sinal` só cria; `core.ambiente_fiscal`: só grava `homologacao` (políticas restritivas `app_so_homologacao_*`, 0008); `core.aviso_a1`: só lê (0009) |
| `macuxierp_worker` | despachante e filas | lê o próprio tenant (exportação LGPD); atualiza só as colunas de controle de `evento`, `trabalho`, `exportacao` e o cache; no `certificado`, só `ativo` e `substituido_em` (nunca `pfx_cifrado` nem a senha); vê a fila de **todos** os tenants em `evento`, `evento_consumido`, `trabalho` e `idempotencia` (política `worker_global`, D10); `integracao_fdv`: lê a `credencial` cifrada e só marca `ultimo_uso_em` e anula a chave da substituída; lê e grava (sem `DELETE`) as outras nove tabelas; `worker_global` em `cursor_entidade` e `sinal` (agenda); `core.aviso_a1`: lê e insere (0009); executa `plataforma.tenants_ativos()` (0009, sem tenant) |
| `macuxierp_leitura` | consulta e diagnóstico | só lê o próprio tenant; não vê `core.certificado`, `integracao_fdv.credencial`, `plataforma.sessao`, `usuario.senha_hash` nem `idempotencia.resposta` (pode trazer dado pessoal); lê `core.aviso_a1` (0009) e o schema `pedido` (0012) |

O banco não tem acesso ao FDV, e só os três papéis têm `CONNECT` (o `REVOKE ALL ... FROM PUBLIC` tira o resto).

## RLS e colunas comuns
- Toda tabela de `plataforma`, `core`, `cadastros` (e dos schemas futuros) tem `id uuid`, `tenant_id`, `created_at`, `updated_at`, `deleted_at` e `external_id` (único por tenant), RLS ligada e a política `isolamento_tenant`. Quem prepara é `controle.preparar_tabela(tabela, oficial, chave_composta)`: RLS, política, trigger de `updated_at`, índice do `external_id` e a chave `(tenant_id, id)` para FKs compostas (nenhuma linha aponta para cadastro de outro tenant). `plataforma.tenant` vai com `chave_composta => false` (lá `tenant_id = id`, e a PK já cobre).
- `updated_at` é o token de concorrência otimista do core (truncado em ms). A trigger `plataforma.tocar_updated_at` (só `BEFORE UPDATE`; o INSERT fica com o `DEFAULT now()`) grava `greatest(clock_timestamp(), OLD.updated_at + 1 ms)` desde a 0006 (T-0032): cada gravação muda o token, mesmo na mesma transação ou em transações iniciadas no mesmo ms, e o valor nunca volta no tempo.
- **Tipos comuns:** `plataforma.cnpj` (14 posições, alfanumérico) e `plataforma.sha256_hex` (64 hex minúsculos), em todas as colunas de CNPJ e de SHA-256. Onde a coluna também aceita outra coisa (`cliente.documento` com CPF, `consulta_externa.chave`), o CHECK usa `pg_input_is_valid(valor, 'plataforma.cnpj')`.
- **Tenant da sessão:** a API faz `SET LOCAL app.tenant_id = '<uuid>'` em toda transação. Sem ele, nada aparece (falha fechada). `plataforma.tenant_atual()` lê o valor.
- **Login (T-0004):** antes de ter tenant, `SELECT plataforma.tenant_por_slug($1)` devolve só o id do tenant ativo (função `SECURITY DEFINER`, só para o app). Com o id na sessão, o adaptador lê `plataforma.tenant` normalmente (a RLS devolve a linha do próprio tenant). O e-mail é gravado e buscado já normalizado (`lower(btrim(email))`; o banco recusa outro formato).
- **Filiais do usuário (`filiaisPorIds`, T-0004):** `SELECT id, tenant_id, nome, cnpj FROM cadastros.filial_resumo WHERE id = ANY($1)`. A visão é `security_invoker` (a RLS da filial vale para quem consulta), tira a filial excluída e dá `nome` = nome fantasia ou, sem ele, a razão social. Só o app lê.
- **Tabelas oficiais** (D9): `tenant_id` = `00000000-0000-0000-0000-000000000000`; todos leem, ninguém da aplicação grava.
- **Só inserção:** `plataforma.auditoria`, `cadastros.estoque_movimento`, `pedido.pedido_evento` e `pedido.aprovacao` (trigger recusa `UPDATE`, `DELETE` e `TRUNCATE`, até para o dono). `plataforma.arquivo` com `imutavel` não muda chave, hash, tamanho nem sai, e a guarda só aumenta (XML autorizado, regra 7).
- **Produção fiscal só pelo operador** (regra 7, RN-CORE-08, ADR 0006, desde a 0008, T-0030): em `core.ambiente_fiscal`, as políticas restritivas `app_so_homologacao_ins` e `app_so_homologacao_upd` deixam o `macuxierp_app` gravar só `homologacao` (INSERT, UPDATE e o upsert da API; a volta de produção para homologação passa). Produção só pelo script do operador, como dono da tabela (sem `FORCE`, a RLS não vale para ele), e o CHECK `ambiente_producao_aprovada` (0003) ainda exige o id do recado de aprovação. O teste de banco confere que o dono e a falta de `FORCE` continuam assim.
- **Exceção registrada:** `controle.migracao` (registro das migrações) não tem tenant nem RLS; o schema `controle` não é visível a nenhum papel da aplicação.
- Dinheiro em `bigint` de centavos (`*_centavos`); quantidade em `bigint` com escala 4 (D11); percentual em pontos-base. O teste recusa `real`, `double`, `numeric` e `money`.

## Schema `integracao_fdv` (0007, T-0010)
Estado do conector nativo do ERP no Hub `/integracao/v1` do FDV. Fonte dos nomes e colunas: `docs/desenho/T-0009.md`, seção 8 (engenheiro-software). O ERP nunca lê tabela do FDV (RN-INF-01) e este schema não lê os outros: o que vai ao Hub sai do espelho próprio. UUIDs do ERP (`fonte_refs`, `erp_id`, `pedido_id`) são opacos, sem FK entre schemas.

| Tabela | O que guarda | Chaves e regras no banco |
|---|---|---|
| `credencial` | `conector_id`, `ambiente` (`teste`\|`producao`), `chave_cifrada` (nonce 12 + cifrado + tag 16; AES-256-GCM, dado associado = `tenant_id`, chave mestra `MACUXIERP_CHAVE_INTEGRACAO` no secret do servidor), `chave_prefixo` (≤ 8), `chave_mestra_versao`, `substituida_em`, `criada_por`, `ultimo_uso_em` | uma ativa por tenant (`substituida_em` e `deleted_at` nulos); troca = linha nova; a trigger `credencial_chave_so_anula` só deixa anular a chave (nunca regravar), e a chave nula só na substituída |
| `registro_publicado` | espelho (M1): `entidade`, `registro_external_id` (`COLLATE "C"`), `payload` canônico do Hub, `hash`, `alterado_em`, `fonte_ocorrido_em`, `fonte_refs`, `ativo`, `pendente`, `hash_confirmado`, `confirmado_em`, `ultimo_lote_envio_id` | única por `(tenant_id, entidade, registro_external_id)`; fila (`where pendente`) e carga completa (`where ativo`) em `(tenant_id, entidade, alterado_em, registro_external_id COLLATE "C")`; GIN `jsonb_path_ops` em `fonte_refs`; payload sem `custo_cents`, `custo_centavos` nem `preco_venda_cents` (M8); payload nulo só no inativo confirmado |
| `referencia` | `tipo` (`tabela_preco`\|`filial_padrao`), `erp_id`, `dados` (só `nome`, `vigencia_inicio`, `vigencia_fim`, `inativo`, `filial_id`), `fonte_ocorrido_em` | única por `(tenant_id, tipo, erp_id)` |
| `cursor_entidade` | `entidade`, `credencial_id`, par do cursor (`cursor_alterado_em`, `cursor_external_id COLLATE "C"`; nulo = carga completa), `sessao_aberta_id`, `pausada_motivo` (`credencial`, `licenca_fdv`, `licenca_erp`, `versao`, `envelope`, `idempotencia`, `topologia`) com `pausada_em`, `proximo_em` (agenda), `ultimo_envio_em`, `ultimo_sucesso_em` | única por `(tenant_id, entidade)`; agenda `(proximo_em) where pausada_motivo is null`; `worker_global` |
| `lote_envio` | `entidade`, `credencial_id`, `modo` (`completo`\|`delta`), `sessao_*`, `geracao`, `chave_idempotencia`, `corpo` (congelado até o estado final, M6), `cursor_declarado`, `hub_lote_id`, `estado`, `repetido`, `contagens`, `tentativas`, `ultimo_erro_codigo`, `enviado_em`, `concluido_em` | única por `(tenant_id, chave_idempotencia)`; **um em voo** (`montado`, `enviando`, `aceito`) por `(tenant_id, entidade)`; o estado final (`concluido`, `concluido_com_erros`, `falhou`, `recusado`) exige `concluido_em`, e `falhou`/`recusado` exigem o código; sem data própria de retentativa |
| `lote_erro` | `lote_envio_id`, `indice`, `origem` (`erp`\|`hub`), `entidade`, `registro_external_id`, `codigo`, `campo`, `reprocessavel`, `resolvido_em`, `resolvido_no_lote_envio_id` | única por `(lote_envio_id, origem, indice)`; **sem mensagem livre nem valor** |
| `pedido_recebido` (F3) | `pedido_uuid`, `payload`, `hash`, `recebido_em` (última entrega do Hub; `created_at` é a primeira), `estado` (`recebido`\|`entregue`\|`rejeitado`), `pedido_id`, `tentativas`, `erro_codigo` | única por `(tenant_id, pedido_uuid)` (RN-PED-01); `rejeitado` exige o código e fica fora da fila; payload nulo só no `entregue` |
| `retorno_enviado` (F3) | `pedido_uuid`, `status`, `numero_erp`, `corpo`, `hash`, `estado` (`pendente`\|`enviado`\|`falhou`), `tentativas`, `resposta_http`, `itens_descartados`, `enviado_em` | única por `(tenant_id, pedido_uuid, status, hash)`; FK `(tenant_id, pedido_uuid)` para `pedido_recebido`; fila `(tenant_id, created_at) where estado = 'pendente'` (`falhou` é terminal) |
| `sinal` | uma linha por tenant: último envio e aceito, `ultimo_http`, `politica_versao`, `parado_por_versao` e a agenda (`proximo_sinal_em`, `proxima_reconciliacao_em`; na F3 `proxima_busca_pedidos_em` e `proximo_retorno_em`, nulos até lá) | única por `tenant_id`; um índice por coluna da agenda; `worker_global` |
| `reconciliacao` | `entidade`, `data_referencia`, `contagem`, `soma` (nula na v1), `resposta_http`, `enviado_em` | única por `(tenant_id, entidade, data_referencia)` |

- `external_id` (regra 5) existe em todas e fica nulo: a chave do Hub é `registro_external_id`. Códigos de erro e de motivo usam o domínio `integracao_fdv.codigo` (identificador minúsculo, nunca texto livre); entidades, o domínio `integracao_fdv.entidade_hub` (as 12 da seção 2 do desenho).
- Datas de negócio em `timestamptz(3)`; `created_at`, `updated_at` e `deleted_at` seguem `timestamptz` como no resto do banco. Hashes em `plataforma.sha256_hex`.
- **Agenda (seção 6.1):** a reserva roda sem tenant, como `macuxierp_worker`, só em `cursor_entidade` e `sinal` (política `worker_global`), com `FOR NO KEY UPDATE SKIP LOCKED`, e adia o `proximo*_em` na mesma transação. O resto roda com o tenant na sessão.
- **Retenção (anulação de coluna, sem `DELETE`):** `lote_envio.corpo` 7 dias após o estado final; chave da credencial substituída em 7 dias; `registro_publicado.payload` do inativo confirmado em 30 dias; `pedido_recebido.payload` 90 dias após `entregue`.

**Ainda em aberto no desenho da T-0009** (fora do banco, salvo enum novo):
- ADR da credencial (rotação da `MACUXIERP_CHAVE_INTEGRACAO`, como a ADR 0005), na tarefa de código; o secret é criado só pelo dono do servidor;
- P-1: nomes e enums exatos do Hub (`status` do retorno, entidades); valor novo = CHECK ou `ALTER DOMAIN` em migração nova;
- quem roda a retenção acima (trabalho do worker) e a remoção das linhas de 12 meses;
- gravação de `referencia` pelo BKO: nenhuma ação da C-7 a usa, por isso o app só lê (se surgir, GRANT por coluna em migração nova).

**0015 (T-0011):** `erp_id` no espelho (par `registro_external_id` ↔ UUID do ERP; a T-0016 traduz os pedidos por ele) e a configuração do conector na `credencial` (entidades habilitadas e limite do lote, que o app configura). Colunas, CHECKs e privilégios: `db/migrations/0015_integracao_fdv_espelho.sql`; testes: `db/testes/espelho-0015.db.test.ts`.
- **Unicidade do `erp_id`:** por tenant e entidade só entre as linhas ativas e não excluídas (`WHERE deleted_at IS NULL AND ativo`). Na troca de external_id (RN-CORE-05) a linha antiga, inativa e ainda pendente de confirmação no Hub, convive com a nova do mesmo `erp_id`; por isso a consulta `erp_id` → registro sempre filtra `ativo` e `deleted_at IS NULL`.
- **`erp_id` nulo:** em `forma_pagamento`, `preco` e `estoque`, que não têm UUID único no ERP. Ele só é gravado nas entidades que a T-0016 traduz: cliente, vendedor, produto, prazo e filial (T-0013 §5).
- **`entidades_habilitadas`:** array do domínio `entidade_hub`, que valida cada elemento (entidade nova no domínio já vale aqui); o CHECK só barra elemento nulo. A lista vazia desliga a publicação.
- **Troca de chave:** cria credencial nova (0007), e as colunas voltariam ao padrão; o app copia `entidades_habilitadas` e `limite_registros_lote` da substituída no INSERT da nova (o INSERT de tabela da 0007 cobre as colunas).
- **`conflito_chave`:** conflito de chave do Hub (`chave_alterada`, `chave_duplicada`), que não vai ao Hub; um aberto por entidade e `erp_id`; `deleted_at` só em conflito resolvido (CHECK `conflito_chave_exclui_resolvido`); o worker abre e resolve, o BKO resolve. Desenho: `docs/desenho/T-0009.md` §8 e ADR 0010, item 3. Retenção de 12 meses (sem job nesta migração; entra na pendência da retenção acima).

## Schema `pedido` (0012, T-0014)
Colunas, chaves, índices, CHECKs e privilégios: `docs/desenho/T-0013.md` §7 e `db/migrations/0012_pedido.sql`; transições: §2. Aqui, só o que o desenho não traz.
- **Domínios:** `pedido.status` (os 7 status, um lugar só) e `pedido.codigo` (código de motivo: identificador minúsculo, nunca texto livre).
- **RN-PED-01 (idempotência):** o árbitro do `ON CONFLICT` da porta de recebimento é o `pedido_external_id_uq` da `preparar_tabela` (regra 5), sem filtrar `deleted_at`: `ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL`. A unicidade é por tenant, mais estrita que a do §7 (por origem): um `external_id` do BKO não repete o UUID de um pedido do FDV. No `fdv`, o `external_id` é obrigatório e em UUID canônico (minúsculo, com hífens; `pedido_fdv_external_id_uuid`).
- **RN-PED-02 no banco:** o gatilho `validar_status` vale para todos os papéis e para o dono. Recusa com **SQLSTATE `MXP02`** e `DETAIL` `possiveis=<status separados por vírgula>`: na criação com outro status, `possiveis=recebido`; a partir de status final, `possiveis=` vazio. A API traduz para 422 `RN-PED-02` com `detalhes.possiveis` e **não loga `err.detail` cru** (nem a mensagem do Postgres), só `possiveis`.
- **Massa:** `fixturePedido` em `db/testes/fixture.ts` (uma linha por tabela; o pedido é o do FDV da massa, `external_id = pedidoFdv`). Testes: `db/testes/pedido.db.test.ts`.
- **Pendência (T-0021, F4, P-2):** o recuo do status por nota cancelada não está no gatilho; entra em migração nova da T-0021. Até lá o gatilho recusa esse recuo com `MXP02`.

## Alerta do A1 (T-0035, migração 0009)
- `core.aviso_a1`: um aviso por certificado e por dia UTC (`UNIQUE (tenant_id, certificado_id, dia)`, constraint `aviso_a1_um_por_dia`), FK composta `(tenant_id, certificado_id)` para `core.certificado` (ajustes na 0011, abaixo). Só ids, validade e dias (sem dado pessoal). Worker: `SELECT` e `INSERT`; app e leitura: só `SELECT` (selo do BKO). Nenhum papel altera nem apaga.
- `plataforma.tenants_ativos()` (`SECURITY DEFINER`, só para o worker): ids dos tenants com `situacao = 'ativo'` e sem `deleted_at`; o de referência fica de fora.
- SQL dos adaptadores (worker, com `app.tenant_id` na sessão, salvo o primeiro):
  - `FonteTenants.ativos` (em `semTenant`): `SELECT t AS id FROM plataforma.tenants_ativos() t`
  - `FonteCertificados.vencendoAte`: `SELECT id, filial_id, valido_ate FROM core.certificado WHERE ativo AND deleted_at IS NULL AND valido_ate < $1 ORDER BY valido_ate, id` (usa o índice `certificado_vencimento_idx`)
  - `DestinoAvisos.registrarA1`: `INSERT INTO core.aviso_a1 (tenant_id, certificado_id, filial_id, valido_ate, dias, dia) VALUES (plataforma.tenant_atual(), $1, $2, $3, $4, $5::date) ON CONFLICT (tenant_id, certificado_id, dia) DO NOTHING RETURNING id` — sem linha devolvida = `false` (o aviso do dia já existia).

## Ajustes do aviso do A1 e versão do evento (T-0043, migração 0011)
- **Travas:** o `migrar` roda cada migração numa transação (`psql -1`), e a 0011 começa com `SET LOCAL lock_timeout = '5s'` (vale só para ela): se uma trava não sair em 5 s, a migração falha inteira e é reexecutada, sem fila de espera atrás do `ALTER`. O índice de `plataforma.evento` vem antes dos `ALTER` de `core`, para não segurar as travas de `core` durante a criação.
- **Índice em tabela grande:** se `plataforma.evento` passar de cerca de 1 milhão de linhas, o índice novo dessa tabela sai com `CREATE INDEX CONCURRENTLY`, fora do runner (que é transacional) e com ADR.
- **Filial do aviso = filial do certificado:** `core.certificado` ganha `UNIQUE (tenant_id, id, filial_id)` (`certificado_tenant_id_filial_uq`) e `core.aviso_a1` a FK composta `aviso_a1_certificado_filial_fk (tenant_id, certificado_id, filial_id)`. A filial do certificado não muda (nenhum papel da aplicação tem `UPDATE` em `filial_id`, 0003). Antes da FK, a migração acerta para a filial do certificado o aviso gravado com outra (o aviso é derivado do certificado; na reexecução não acha nada). Depois de criar a nova, a FK antiga `aviso_a1_certificado_fk (tenant_id, certificado_id)` sai (`DROP CONSTRAINT IF EXISTS`): a nova a cobre, porque `filial_id` é `NOT NULL` (decisão do gerente, RD-0173). A versão anterior da API e do worker roda igual: o worker já grava a filial do certificado e `dias <= 30`.
- **`dias`:** `aviso_a1_dias_janela CHECK (dias <= 30)`. RN-CORE-06/RF-CORE-04 (`modules/core/domain/certificado.ts`): `dias = floor((valido_ate - agora) / 1 dia)` e há aviso só com `dias <= DIAS_ALERTA_A1` (30), inclusive vencido. Sem piso: o certificado vencido segue ativo até a troca e gera aviso todo dia com `dias` negativo; zero = vence em menos de 24 h. Se a janela mudar no domínio, o CHECK muda em migração nova.
- **`plataforma.evento_agregado_versao_idx (tenant_id, agregado_id, versao)`**, não único: atende o `max(versao) + 1` da versão por agregado (T-0034, `OutboxPg.gravar` em `packages/platform-sdk/src/pg.ts`), com leitura do fim do índice. Não é `UNIQUE` porque eventos anteriores à T-0034 podem repetir versão no mesmo agregado com nomes diferentes (a unicidade da 0002 inclui `nome`).
- **`evento_agregado_idx (tenant_id, agregado_id, ocorrido_em)` não é redundante e fica:** o despachante (`FilaOutboxPg.reservar`, `apps/worker/src/pg.ts`) procura o evento anterior do mesmo agregado por `(ocorrido_em, versao) < (...)`, e `ocorrido_em` vem do envelope, sem garantia de andar junto com a versão. Reavaliar só com `idx_scan` de produção (`pg_stat_user_indexes`), e a remoção iria numa migração própria.
- **Massa comum:** o aviso do A1 continua em `fixtureModulos` (`db/testes/fixture.ts`) porque `db/testes/vazamento.ts` e `tests/integracao/banco/rls-core-cadastros.db.test.ts` exigem linha de cada tenant em toda tabela de `core`.

## Forma de pagamento na condição (T-0026, migração 0010)
- `cadastros.condicao_pagamento` ganha `forma_external_id` (≤ 64), `forma_codigo` (≤ 20) e `forma_nome` (≤ 60), anuláveis e sem padrão: cada linha do `prazo_pagamento.csv` do kit do FDV vira uma condição, com a forma nela (o `forma_tpag` já vem da 0004). Fonte: `docs/desenho/T-0026.md` (D12 e seção 6).
- Índice parcial `condicao_pagamento_forma_external_id_ix` em `(tenant_id, forma_external_id) where forma_external_id is not null`: a carga do `forma_pagamento.csv` atualiza todas as condições da forma por ele. RLS, política, trigger e grants da 0004 não mudam.
- **Parcelas do cartão (T-0015, 0017; decisões do Alexandre de 22/11, horário de Manaus):** `parcelas_cartao smallint` anulável. A regra sai em **duas migrações**, para o `main` nunca ficar num estado em que a rota e a carga de cartão do cadastros falham:
  - **0017 (permissiva, validada):** `condicao_parcelas_cartao_ck` = `parcelas_cartao IS NULL OR (forma_tpag = '03' AND parcelas_cartao BETWEEN 1 AND 12)` (SQLSTATE 23514). Nenhuma linha atual a viola, por isso nasce validada (sem `NOT VALID`). Cartão sem parcelas continua aceito, inclusive em UPDATE de linha antiga; a API e a carga atuais, que não gravam a coluna, seguem funcionando. Grants da 0004 por tabela (sem grant por coluna) cobrem a coluna.
  - **0019 (estrita; número reservado pelo gerente, ainda não criada):** `(parcelas_cartao IS NOT NULL) = (forma_tpag = '03')`, criada `NOT VALID` e validada (`VALIDATE CONSTRAINT`) depois da limpeza dos dados. Só sai **depois** do PR das formas do cadastros (`sql.ts` `COLUNAS_CONDICAO`, `carga/mapear.ts` `CARTAO_CREDITO` → `03` e `carga-entidades.ts` gravando `parcelas_cartao`) e da limpeza. **Aviso que passa a valer na 0019:** com `NOT VALID`, qualquer UPDATE numa linha antiga de cartão sem parcelas cai em 23514, inclusive desativar ou marcar `deleted_at`; por isso a limpeza preenche `parcelas_cartao` ou troca a forma **no mesmo UPDATE**.
  - Testes: `db/testes/condicao-parcelas-0017.db.test.ts`.

## Migrações aditivas
A versão anterior da API roda sobre o esquema novo: só se acrescenta (tabela, coluna anulável ou com padrão, índice, política). Renomear ou apagar = duas versões (acrescenta, migra o uso, remove depois), com ADR quando muda contrato. Migração aplicada nunca é editada: o `migrar` recusa sha256 diferente.

**Numeração reservada:** o gerente pode reservar números para tarefas em paralelo (ex.: 0007–0009 reservadas e a 0010 da T-0026 entrando antes). O `migrar` aplica as pendentes em ordem de nome e não exige sequência contínua: uma migração de número menor que chegue depois é aplicada na execução seguinte. Por isso, migrações com números reservados não podem depender umas das outras fora da ordem de merge.

## Teste de vazamento entre tenants
`db/testes/vazamento.ts` varre **todas** as tabelas dos schemas pedidos (as novas entram sozinhas): para cada papel com leitura, no tenant A, lê só linhas de A (e alguma, para provar que a massa cobre a tabela), sem tenant não lê nada, e o app não altera, não apaga e não move linha para o tenant B. Um teste prova que ele acusa uma tabela sem RLS. Tabela nova precisa de linha na massa (`db/testes/fixture.ts`), senão o teste falha.

## Passo sem superusuário no CI
Os comandos do passo sem superusuário (em "Comandos") imitam o DBaaS num Postgres limpo. O `rodar-antes-do-push.sh` já roda o passo; no `ci.yml` (governança) ele volta pelo pedido registrado na T-0003.
