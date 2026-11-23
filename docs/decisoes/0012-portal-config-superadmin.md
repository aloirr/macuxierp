# ADR 0012 — Portal de configuração (`/config`) e superadmin de plataforma

- **Status:** proposta
- **Data:** 23/11/2026 (Manaus)
- **Dono:** engenheiro-software
- **Tarefa:** T-0050, etapa E1 da v0.3.0 (caminho crítico): libera o banco-dados (E2, migração 0033) e o modulo-core (E3)
- **Base:** decisões do PO e do Alexandre de 22 e 23/11/2026 retransmitidas pelo gerente-projetos (portal em `/config` no mesmo domínio, com login, sessão e cookie próprios; superadmin como identidade de plataforma, fora dos tenants, sem impersonação; MFA/TOTP na versão seguinte; 1º superadmin pelo `operador.sh`); `CLAUDE.md` (regras 1, 3, 5, 6, 8 e 9); RN-CORE-01, RN-CORE-02 e RN-CORE-09 (`docs/produto/03`); RF-CAD-11 (`docs/produto/02`); desenho T-0002 (D1, D2, D12); `db/migrations/0002_plataforma.sql` (`plataforma.tenant`, `tenant_modulo`, `usuario`, `sessao`, `auditoria`, `tenant_por_slug`); `scripts/deploy/producao/operador.sh` e `empresa.mjs` (`criar-empresa`, T-0024); `scripts/plataforma/licenca.mjs` (D12).
- **Muda:** o D12 da T-0002 (licença só pelo script do operador) ganha um segundo caminho, o portal, com a mesma auditoria. O script continua valendo.

## Contexto
Hoje a Macuxi cria empresa, liga módulo e gera o 1º administrador só pelo terminal da VM (`operador.sh criar-empresa`, `licenca.mjs`). Na v0.3.0 o Alexandre quer isso numa tela, no mesmo domínio do ERP, sem dar a ninguém acesso de empresa para fazê-lo. O ERP não tem hoje identidade fora de tenant: todo usuário mora em `plataforma.usuario` com `tenant_id` e perfil, e toda rota passa por perfil → tenant → licença (RN-CORE-02) dentro de `comTenant` (RLS).

Junto, entra o perfil "analista de implantação" (RN-CORE-09), que muda a lista de perfis da RN-CORE-01.

## Opções
- (a) **Superadmin como perfil de tenant** (ex.: usuário `superadmin` no tenant de referência, com `BYPASSRLS` ou política global). Mistura identidade de plataforma com a de empresa, abre caminho para impersonação e para ler dado de negócio de todos os tenants. Descartada.
- (b) **Superadmin como identidade de plataforma**, tabelas próprias, cookie próprio, rotas `/v1/plataforma/*` fora do `/v1/<modulo>`, e acesso entre tenants só por funções SECURITY DEFINER de lista fechada. Escolhida.
- (c) Portal em outro domínio/serviço. Mais isolamento, mas outro deploy, outro certificado e outra publicação na VM (ADR 0003). Fica como evolução, se o risco pedir.

## Decisão
**Opção (b).**

### 1. Identidade e sessão de plataforma (desenho para o banco-dados, migração 0033)
As duas tabelas seguem a regra 5. Como não pertencem a tenant, o `tenant_id` é sempre o **tenant de referência** (`plataforma.tenant_referencia()`, D9), com `CHECK (tenant_id = plataforma.tenant_referencia())`. RLS ligado e forçado, **sem nenhuma política nem GRANT para `macuxierp_app`, `macuxierp_worker` ou `macuxierp_leitura`**: só as funções da seção 4 (donas das tabelas) leem e escrevem.

`plataforma.superadmin`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `tenant_id` | uuid NOT NULL | = tenant de referência (CHECK) |
| `email` | text NOT NULL | normalizado como `plataforma.usuario.email` (CHECK igual); único entre os não excluídos |
| `nome` | text NOT NULL | 2 a 80 |
| `senha_hash` | text NOT NULL | `LIKE '$argon2id$%'` (mesmos parâmetros da API, `ARGON2_PADRAO`) |
| `deve_trocar_senha` | boolean NOT NULL DEFAULT true | a senha do `operador.sh` é provisória |
| `ativo` | boolean NOT NULL DEFAULT true | |
| `falhas_login` | integer NOT NULL DEFAULT 0 | `>= 0` |
| `bloqueado_ate` | timestamptz | trava da seção 6 |
| `ultimo_acesso_em` | timestamptz | |
| `senha_trocada_em` | timestamptz | revoga as sessões abertas antes |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | regra 5 |
| `external_id` | text ≤ 64 | regra 5 (sem uso hoje) |

`plataforma.sessao_superadmin`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | é o `sessao_id` da `SessaoPlataforma` |
| `tenant_id` | uuid NOT NULL | = tenant de referência (CHECK) |
| `superadmin_id` | uuid NOT NULL | FK `plataforma.superadmin(id)` |
| `token_hash` | `plataforma.sha256_hex` NOT NULL UNIQUE | só o SHA-256 do token opaco; o token em claro só existe no cookie |
| `expira_em` | timestamptz NOT NULL | absoluta: 8 h depois do login |
| `ultimo_uso_em` | timestamptz NOT NULL | ociosidade: vence 30 min sem uso |
| `revogada_em` | timestamptz | sair, troca de senha, desativação |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | regra 5 |
| `external_id` | text ≤ 64 | regra 5 |

A sessão vencida ou revogada é apagada pela rotina de limpeza depois de 30 dias (só ids e datas; sem IP nem agente do navegador, que seriam dado pessoal).

**Auditoria:** `plataforma.auditoria` ganha a coluna `superadmin_id uuid` (FK para `plataforma.superadmin`), com `CHECK (usuario_id IS NULL OR superadmin_id IS NULL)`. A linha do portal grava `tenant_id` = empresa **alvo**, `usuario_id` nulo e `superadmin_id` do autor. Login, falha, troca de senha e saída do superadmin vão com o tenant de referência. Nunca entram nome da empresa, e-mail, nome de pessoa, senha nem hash: o `depois` leva slug, módulos, situação, motivo e ids (o `semSegredos` do SDK continua valendo).

**Perfil `analista_implantacao` (RN-CORE-01 e RN-CORE-09):** o CHECK de `plataforma.usuario.perfil` (0002) **só passa a aceitar o valor na 0033**. Por isso o perfil **não entra no PR da E1**: ele entra em `PERFIS`, `ROTULOS_PERFIL` e na matriz `PERMISSOES` (só `cadastros.ver` e `cadastros.carga.executar`) num **PR casado** com a migração 0033 (banco-dados) e com os ajustes dos testes que percorrem `PERFIS` ou fixam a lista de perfis: `modules/core/api/rotas.test.ts:116` e `modules/core/web/web.test.ts:34` (modulo-core), `tests/integracao/rn/rn-core.test.ts:14` e `tests/integracao/rotas/autorizacao-rotas.test.ts:206` (testes). Até esse PR, o SDK tem só os 6 perfis atuais e nenhum módulo oferece o perfil na tela. Os contratos e portas do portal (`portal-config.ts`, `plataforma-rotas.ts`) não dependem do perfil novo.

### 2. Portal `/config`, cookie e rotas
- **Web:** `/config` na apps/web, no mesmo domínio (`erp.macuxifdv.com.br`), com shell próprio, sem o menu do BKO e sem o `EuResposta` do tenant. Login em `/config/entrar` (e-mail e senha; sem slug de empresa).
- **Cookie:** `macuxierp_config` (`COOKIE_CONFIG` do SDK), token opaco de 32 bytes aleatórios (base64url), `HttpOnly`, `Secure`, `SameSite=Strict`. Na API, `Path=/v1/plataforma`. Na apps/web (BFF), o cookie guardado pelo shell tem `Path=/config` e nome próprio, distinto do cookie do BKO. Nunca é aceito em `/v1/<modulo>` nem em `/v1/auth/*`; o JWT do tenant nunca é aceito em `/v1/plataforma/*`. Sem refresh: venceu (8 h ou 30 min ocioso), entra de novo.
- **CSRF:** além do `SameSite=Strict`, toda escrita em `/v1/plataforma/*` exige o cabeçalho `x-macuxierp-config: 1` (o navegador não manda em formulário de outro site).
- **Rotas da apps/api (engenheiro-software):** `POST /v1/plataforma/auth/entrar` (`EntrarPlataformaEntrada` → `SessaoPlataformaResposta` + cookie), `POST /auth/sair` (204, revoga), `GET /auth/eu` (`EuPlataforma`), `POST /auth/senha` (`TrocarSenhaPlataformaEntrada`, 204, revoga as outras sessões). Enquanto `deve_trocar_senha`, só `eu`, `senha` e `sair` respondem; o resto é 403 `TROCAR_SENHA`.
- **Rotas de empresa (plugin de plataforma do modulo-core, `definirPluginPlataforma`):**

| Método e caminho (`/v1/plataforma`) | Ação | Entrada → saída |
|---|---|---|
| `GET /empresas` | `plataforma.empresa.ver` | `ConsultaLista` → `paginaDe(EmpresaPlataforma)` (busca por slug) |
| `GET /empresas/:id` | `plataforma.empresa.ver` | → `EmpresaPlataforma` |
| `POST /empresas` (Idempotency-Key obrigatória) | `plataforma.empresa.criar` | `CriarEmpresaEntrada` → 201 `EmpresaPlataforma` (só o core ligado) |
| `PUT /empresas/:id/modulos` | `plataforma.modulos.alterar` | `AlterarModulosEntrada` → `EmpresaPlataforma`; 422 `RN-CORE-02` pelo `conferirModulosPlataforma` |
| `POST /empresas/:id/primeiro-admin` (Idempotency-Key obrigatória) | `plataforma.admin.criar` | `PrimeiroAdminEntrada` → 201 `PrimeiroAdminResposta` + `CABECALHOS_SENHA_PROVISORIA`; 409 se a empresa já tem administrador |
| `POST /empresas/:id/primeiro-admin/senha` | `plataforma.admin.redefinir_senha` | → `PrimeiroAdminResposta` + `CABECALHOS_SENHA_PROVISORIA`; zera falhas e trava e revoga as sessões desse administrador |
| `PUT /empresas/:id/situacao` | `plataforma.empresa.situacao` | `SituacaoEmpresaEntrada` → `EmpresaPlataforma` |

  A senha provisória (16 caracteres, `gerarSenhaProvisoria` do domain do core) aparece só na resposta, uma vez; a idempotência **não guarda** o corpo dessas respostas (o reenvio da mesma chave devolve 409, nunca a senha de novo). O "1º admin" é o administrador mais antigo e ativo da empresa (o `primeiro_admin` do `EmpresaPlataforma`, só id, ativo e bloqueado).
- **Ordem de checagem (`executarPlataforma` do SDK):** sessão de superadmin válida (401) → transação de plataforma (`BancoPlataforma.comPlataforma`) → função SECURITY DEFINER que revalida a sessão. **Sem perfil e sem licença de tenant**: o superadmin não tem perfil de empresa. O `ContextoRota` dos módulos não muda.
- **Suspender:** `situacao = 'suspenso'` bloqueia o login (o `tenant_por_slug` já filtra `ativo`), revoga as sessões de refresh do tenant na mesma transação e para as agendas (`tenants_ativos`). Trabalhos fiscais já na fila (retorno de lote, evento) terminam: nota em voo nunca fica sem retorno. Reativar devolve o login, sem recriar sessão.

### 3. Por que os contratos ficam no SDK, e não em `modules/core/contracts`
A identidade e as rotas de plataforma não são de módulo: ficam fora do `/v1/<modulo>`, sem licença e sem tenant, e são consumidas pela apps/api (login e montagem), pelo modulo-core (executar das rotas de empresa) e pela apps/web (portal). É o mesmo caso do `EuResposta` (decisão de 21/11): uma fonte só no SDK, sem Node. Ficam em `packages/platform-sdk/src/portal-config.ts` (Zod e a função pura `conferirModulosPlataforma`) e `plataforma-rotas.ts` (portas e tipos). `modules/core/contracts` (do modulo-core) não muda.

### 4. Acesso entre tenants: só funções SECURITY DEFINER de lista fechada (banco-dados, 0033)
- Papel novo `macuxierp_config` (NOLOGIN, **sem BYPASSRLS**). A apps/api entra nele só dentro de `comPlataforma` (`SET LOCAL ROLE macuxierp_config`) e põe `set_config('macuxierp.sessao_superadmin', <sessao_id>, true)`. Só esse papel tem EXECUTE nas funções abaixo; `macuxierp_app` não.
- Toda função começa por `plataforma.exigir_superadmin()`: lê o `sessao_id` da configuração local, confere a sessão (não revogada, não vencida, ociosidade, superadmin ativo, `deve_trocar_senha` falso), atualiza `ultimo_uso_em` e devolve o `superadmin_id`, que a função usa na auditoria. Sessão inválida = exceção com SQLSTATE próprio, que a API traduz em 401.
- Lista fechada (cada função `SET search_path = pg_catalog, pg_temp`, `REVOKE ALL ... FROM PUBLIC`): `superadmin_para_login(email)`, `superadmin_registrar_falha(id, falhas, trava)`, `superadmin_abrir_sessao(id, token_hash, expira_em)`, `superadmin_sessao_por_token(token_hash)`, `superadmin_sair(sessao_id)`, `superadmin_trocar_senha(...)` (as de login são executáveis pela API antes de haver sessão, como a `tenant_por_slug`); `empresas_listar(busca, cursor, limite)`, `empresa_ler(id)`, `empresa_criar(slug, nome, fuso, request_id)`, `empresa_situacao(id, situacao, motivo, request_id)`, `empresa_modulos(id, jsonb, request_id)`, `empresa_primeiro_admin_criar(id, email, nome, senha_hash, request_id)`, `empresa_primeiro_admin_senha(id, senha_hash, request_id)`; da 0035, `empresa_primeiro_admin_email(id, request_id)`. Cada uma grava a própria auditoria na mesma transação.
- **Emenda do detalhe da empresa (decisão do Alexandre e do PO, 23/11, 0035):** o detalhe (`GET /empresas/:id`) mostra `razao_social`, `cnpj` (formato do domínio, sem máscara), `cidade` (nome do município pela tabela oficial) e `uf` da filial padrão, e o `primeiro_admin.email_mascarado` no padrão do PO "do****@gmail.com": as 2 primeiras letras do local + `****` + `@` + o domínio inteiro (local com 1 ou 2 letras vira `*` + `****`), gerado pela 0035. O e-mail completo só sai por `POST /v1/plataforma/empresas/:id/primeiro-admin/email` → `{ email }`, com o cabeçalho anti-CSRF (§2), `Cache-Control: no-store` e sem idempotência, pela função `plataforma.empresa_primeiro_admin_email(p_id, p_request_id)`, auditada como `plataforma.admin.revelar_email` (só o id do administrador e o `request_id`, **nunca o e-mail**). LGPD: o e-mail e a razão social e o CNPJ de MEI podem ser dado pessoal, então nunca entram em log, auditoria, lista ou busca; a busca segue só por slug e nome.
- As funções só tocam `plataforma.tenant`, `plataforma.tenant_modulo`, `plataforma.usuario` (só a linha do administrador), `plataforma.sessao` (revogação) e `plataforma.auditoria`. **Nenhuma lê schema de módulo** (cadastros, pedido, fiscal, faturamento, integração): o superadmin não vê dado de negócio. O tenant de referência nunca aparece nem muda.
- A dependência entre módulos é conferida na API (`conferirModulosPlataforma` com os `depende` dos manifestos) e a função grava; o `licenca.mjs` do operador passa a chamar a mesma regra na versão seguinte (hoje ele não confere).

### 5. Quem pode ser superadmin e `operador.sh criar-superadmin` (depois da 0033)
- O 1º superadmin (e os seguintes) é criado **só pelo operador**, no molde do `criar-empresa`: `bash ~/macuxierp-deploy/operador.sh criar-superadmin --email "<e-mail>" [--nome "<nome>"] --operador <seu nome> [--confirmar]`. Sem `--confirmar`, transação READ ONLY e plano; com `--confirmar`, transação única, idempotente (repetir não duplica nem troca senha) e auditada com o tenant de referência. A senha provisória é gerada no host a partir do `/dev/urandom`, entra no contêiner só pelo ambiente, aparece uma vez no terminal e cria o superadmin com `deve_trocar_senha = true`. E-mail e nome só pelo ambiente, nunca no argv, na saída nem na auditoria.
- Desativar, reativar e zerar a trava: `bash ~/macuxierp-deploy/operador.sh superadmin --email "<e-mail>" --desativar|--reativar|--destravar --operador <seu nome> [--confirmar]` (mesmo molde, uma ação por vez, nunca gera senha). `--desativar` põe `ativo = false` e revoga as sessões abertas do portal; `--destravar` zera `falhas_login` e `bloqueado_ate`. Não há tela para criar superadmin.
- Repetir o que já está no estado pedido também não audita. `usuario_id` e `superadmin_id` ficam nulos (o autor é o operador, no `depois.operador`) e o superadmin é a entidade; o `depois` leva `ativo`, `deve_trocar_senha`, `sessoes_revogadas`, `falhas` e `travado`. Implementação (T-0050): o `operador.sh` manda o `scripts/deploy/producao/superadmin.mjs` ao contêiner `psql`, que grava direto em `plataforma.superadmin` como o admin do DBaaS (dono das tabelas, RLS sem FORCE; as funções da §4 exigem sessão de superadmin e não servem ao operador), numa transação única, no tenant de referência. Ações: `plataforma.superadmin.criar`, `.desativar`, `.reativar` e `.destravar`; ficam fora do `ACOES_PLATAFORMA` do SDK, que lista só as ações do portal (autor `superadmin_id`). Testes: `packages/config/deploy-operador.test.ts` (docker falso) e `apps/api/src/operador-superadmin.db.test.ts` (PG real; a senha confere com o `conferirSenha` da API sobre o hash da `superadmin_para_login`).

### 6. Limites de tentativa e bloqueio
- Por superadmin: 5 falhas seguidas travam por 15 min (o mesmo do login do tenant, `CONFIG_AUTH_PADRAO`); a trava zera no login certo.
- Por origem: no máximo 10 tentativas de `POST /v1/plataforma/auth/entrar` a cada 15 min por IP, em memória na API (429 `MUITAS_TENTATIVAS`). O IP não vai para log nem para banco.
- Mensagem única: "E-mail ou senha inválidos", sem dizer qual errou nem se o e-mail existe; o tempo de resposta é o mesmo (hash de referência quando o e-mail não existe).
- Log pino com `request_id` e `superadmin_id` (depois do login), nunca e-mail, senha, cookie ou token (a redação de `cookie` e `set-cookie` já existe na apps/api).

### 7. TOTP (versão seguinte, só o encaixe)
Nada disso entra na 0033 nem no código da v0.3.0:
- **Colunas** (migração da versão seguinte) em `plataforma.superadmin`: `totp_segredo_cifrado bytea` (AES-256-GCM pelo `cifra.ts` do SDK, com chave própria `MACUXIERP_CHAVE_TOTP` no secret do servidor, nunca a do A1), `totp_ativado_em timestamptz`, `totp_ultimo_passo bigint` (anti-reuso do mesmo código) e `recuperacao_hashes text[]` (10 códigos de uso único, argon2id). Em `plataforma.sessao_superadmin`: `segundo_fator_em timestamptz`.
- **Login em dois passos:** `entrar` com senha certa e TOTP ativo abre a sessão com `segundo_fator_em` nulo; só `POST /v1/plataforma/auth/segundo-fator` (código de 6 dígitos ou de recuperação) e `sair` respondem até ele ser preenchido. O `exigir_superadmin()` passa a exigir `segundo_fator_em` quando `totp_ativado_em` não é nulo. As falhas do segundo fator contam na mesma trava da seção 6.
- **Recuperação:** código de recuperação (uso único) ou `operador.sh superadmin --zerar-totp` (auditado). O segredo nunca volta para a tela depois do cadastro e nunca vai para recado ou log.
- A versão seguinte pode tornar o TOTP obrigatório para entrar no portal.

### 8. Quem faz o quê
| Etapa | Dono | Entrega |
|---|---|---|
| E1 | engenheiro-software | esta ADR; contratos e portas no SDK (`portal-config.ts`, `plataforma-rotas.ts`); `ROTULOS_PERFIL` com os 6 perfis atuais |
| E2 (PR casado) | engenheiro-software, banco-dados, modulo-core e testes | perfil `analista_implantacao` no SDK, na 0033 e nos 4 testes listados no §1 |
| E2 (0033) | banco-dados | migração 0033: seção 1 (tabelas, coluna `superadmin_id` na auditoria, CHECK do perfil com `analista_implantacao`), seção 4 (papel `macuxierp_config`, `exigir_superadmin` e a lista fechada), testes `*.db.test.ts` de RLS (o app não lê as tabelas novas; o papel não tem BYPASSRLS; função sem sessão falha) |
| E3 | modulo-core | plugin de plataforma (`definirPluginPlataforma`) com as rotas de empresa da seção 2 e o repositório que chama só as funções da 0033; testes citando RN-CORE-02 (dependências) e a senha provisória uma vez |
| E3 | engenheiro-software | apps/api: `/v1/plataforma/auth/*`, cookie, limite por IP, adaptador `BancoPlataforma`, montagem do plugin; `operador.sh criar-superadmin` e `superadmin` (seção 5) |
| E3 | modulo-cadastros | RN-CORE-09 na carga: o analista grava todas as entidades do RF-CAD-11, inclusive preço, sem a edição de cada uma; linha com filial ou limite de crédito recusada com "Só o administrador carrega filial e limite de crédito."; `analista_implantacao` no `perfis` do manifesto |
| E4 | engenheiro-apps | `/config` na apps/web (shell, entrar, trocar senha, lista e detalhe da empresa, módulos, 1º admin com a senha mostrada uma vez, suspender/reativar) |
| E5 | designer-ux | telas do portal em `packages/ui` e `docs/design/` (validação do `design-de-marca`) |
| E6 | testes | `tests/`: isolamento (cookie do portal recusado em `/v1/<modulo>`, JWT recusado em `/v1/plataforma`), sem impersonação, sem leitura de schema de módulo, trava e limite, senha provisória fora de cache e de log |

## Fora desta decisão
- MFA/TOTP (só o encaixe, seção 7), impersonação (nunca), leitura de dado de negócio dos tenants (nunca).
- Encerrar e excluir empresa (com a guarda fiscal da regra 8), trocar slug, editar fuso pelo portal, troca do ambiente fiscal para produção (continua pelo `operador.sh` com o "aprovo produção fiscal", ADR 0006).
- Tela de gestão de superadmins e perfis dentro da plataforma (todos têm o mesmo poder).
- Domínio ou serviço separado para o portal (opção c).

## Consequências
- A Macuxi cria e configura empresa sem terminal e sem acesso de empresa. O BKO dos tenants não muda.
- A RN-CORE-02 do doc 03 diz que as licenças "mudam pelo script do operador": o PO acrescenta "ou pelo portal `/config`, com a mesma auditoria" (recado ao agente PO).
- O `main` nunca fica com o `analista_implantacao` no SDK sem o CHECK da 0033 (§1).
- Risco: as funções SECURITY DEFINER são a fronteira; toda função nova entra na lista fechada só por ADR e com teste de banco.
