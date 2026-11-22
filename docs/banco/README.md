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
| `macuxierp_app` | API | lê e grava no próprio tenant; sem `DELETE` (exclusão = `deleted_at`), salvo `sessao`, `idempotencia` e `consulta_externa`; licença e tenant só leitura (D12); `evento` e `auditoria` só inserção; certificado: grava e lê só o resumo, nunca `pfx_cifrado`/`senha_cifrada` |
| `macuxierp_worker` | despachante e filas | lê o próprio tenant (exportação LGPD); atualiza só as colunas de controle de `evento`, `trabalho`, `exportacao` e o cache; no `certificado`, só `ativo` e `substituido_em` (nunca `pfx_cifrado` nem a senha); vê a fila de **todos** os tenants em `evento`, `evento_consumido`, `trabalho` e `idempotencia` (política `worker_global`, D10) |
| `macuxierp_leitura` | consulta e diagnóstico | só lê o próprio tenant; não vê `core.certificado`, `plataforma.sessao`, `usuario.senha_hash` nem `idempotencia.resposta` (pode trazer dado pessoal) |

O banco não tem acesso ao FDV, e só os três papéis têm `CONNECT` (o `REVOKE ALL ... FROM PUBLIC` tira o resto).

## RLS e colunas comuns
- Toda tabela de `plataforma`, `core`, `cadastros` (e dos schemas futuros) tem `id uuid`, `tenant_id`, `created_at`, `updated_at`, `deleted_at` e `external_id` (único por tenant), RLS ligada e a política `isolamento_tenant`. Quem prepara é `controle.preparar_tabela(tabela, oficial, chave_composta)`: RLS, política, trigger de `updated_at`, índice do `external_id` e a chave `(tenant_id, id)` para FKs compostas (nenhuma linha aponta para cadastro de outro tenant). `plataforma.tenant` vai com `chave_composta => false` (lá `tenant_id = id`, e a PK já cobre).
- `updated_at` é o token de concorrência otimista do core (truncado em ms). A trigger `plataforma.tocar_updated_at` (só `BEFORE UPDATE`; o INSERT fica com o `DEFAULT now()`) grava `greatest(clock_timestamp(), OLD.updated_at + 1 ms)` desde a 0006 (T-0032): cada gravação muda o token, mesmo na mesma transação ou em transações iniciadas no mesmo ms, e o valor nunca volta no tempo.
- **Tipos comuns:** `plataforma.cnpj` (14 posições, alfanumérico) e `plataforma.sha256_hex` (64 hex minúsculos), em todas as colunas de CNPJ e de SHA-256. Onde a coluna também aceita outra coisa (`cliente.documento` com CPF, `consulta_externa.chave`), o CHECK usa `pg_input_is_valid(valor, 'plataforma.cnpj')`.
- **Tenant da sessão:** a API faz `SET LOCAL app.tenant_id = '<uuid>'` em toda transação. Sem ele, nada aparece (falha fechada). `plataforma.tenant_atual()` lê o valor.
- **Login (T-0004):** antes de ter tenant, `SELECT plataforma.tenant_por_slug($1)` devolve só o id do tenant ativo (função `SECURITY DEFINER`, só para o app). Com o id na sessão, o adaptador lê `plataforma.tenant` normalmente (a RLS devolve a linha do próprio tenant). O e-mail é gravado e buscado já normalizado (`lower(btrim(email))`; o banco recusa outro formato).
- **Filiais do usuário (`filiaisPorIds`, T-0004):** `SELECT id, tenant_id, nome, cnpj FROM cadastros.filial_resumo WHERE id = ANY($1)`. A visão é `security_invoker` (a RLS da filial vale para quem consulta), tira a filial excluída e dá `nome` = nome fantasia ou, sem ele, a razão social. Só o app lê.
- **Tabelas oficiais** (D9): `tenant_id` = `00000000-0000-0000-0000-000000000000`; todos leem, ninguém da aplicação grava.
- **Só inserção:** `plataforma.auditoria` e `cadastros.estoque_movimento` (trigger recusa `UPDATE`, `DELETE` e `TRUNCATE`, até para o dono). `plataforma.arquivo` com `imutavel` não muda chave, hash, tamanho nem sai, e a guarda só aumenta (XML autorizado, regra 7).
- **Exceção registrada:** `controle.migracao` (registro das migrações) não tem tenant nem RLS; o schema `controle` não é visível a nenhum papel da aplicação.
- Dinheiro em `bigint` de centavos (`*_centavos`); quantidade em `bigint` com escala 4 (D11); percentual em pontos-base. O teste recusa `real`, `double`, `numeric` e `money`.

## Alerta do A1 (T-0035, migração 0009)
- `core.aviso_a1`: um aviso por certificado e por dia UTC (`UNIQUE (tenant_id, certificado_id, dia)`, constraint `aviso_a1_um_por_dia`), FK composta `(tenant_id, certificado_id)` para `core.certificado`. Só ids, validade e dias (sem dado pessoal). Worker: `SELECT` e `INSERT`; app e leitura: só `SELECT` (selo do BKO). Nenhum papel altera nem apaga.
- `plataforma.tenants_ativos()` (`SECURITY DEFINER`, só para o worker): ids dos tenants com `situacao = 'ativo'` e sem `deleted_at`; o de referência fica de fora.
- SQL dos adaptadores (worker, com `app.tenant_id` na sessão, salvo o primeiro):
  - `FonteTenants.ativos` (em `semTenant`): `SELECT t AS id FROM plataforma.tenants_ativos() t`
  - `FonteCertificados.vencendoAte`: `SELECT id, filial_id, valido_ate FROM core.certificado WHERE ativo AND deleted_at IS NULL AND valido_ate < $1 ORDER BY valido_ate, id` (usa o índice `certificado_vencimento_idx`)
  - `DestinoAvisos.registrarA1`: `INSERT INTO core.aviso_a1 (tenant_id, certificado_id, filial_id, valido_ate, dias, dia) VALUES (plataforma.tenant_atual(), $1, $2, $3, $4, $5::date) ON CONFLICT (tenant_id, certificado_id, dia) DO NOTHING RETURNING id` — sem linha devolvida = `false` (o aviso do dia já existia).

## Migrações aditivas
A versão anterior da API roda sobre o esquema novo: só se acrescenta (tabela, coluna anulável ou com padrão, índice, política). Renomear ou apagar = duas versões (acrescenta, migra o uso, remove depois), com ADR quando muda contrato. Migração aplicada nunca é editada: o `migrar` recusa sha256 diferente.

## Teste de vazamento entre tenants
`db/testes/vazamento.ts` varre **todas** as tabelas dos schemas pedidos (as novas entram sozinhas): para cada papel com leitura, no tenant A, lê só linhas de A (e alguma, para provar que a massa cobre a tabela), sem tenant não lê nada, e o app não altera, não apaga e não move linha para o tenant B. Um teste prova que ele acusa uma tabela sem RLS. Tabela nova precisa de linha na massa (`db/testes/fixture.ts`), senão o teste falha.

## Passo sem superusuário no CI
Os comandos do passo sem superusuário (em "Comandos") imitam o DBaaS num Postgres limpo. O `rodar-antes-do-push.sh` já roda o passo; no `ci.yml` (governança) ele volta pelo pedido registrado na T-0003.
