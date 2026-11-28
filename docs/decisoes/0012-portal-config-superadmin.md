# ADR 0012 — Portal de configuração (`/config`) e superadmin de plataforma

- **Status:** proposta
- **Data:** 23/11/2026 (Manaus)
- **Dono:** engenheiro-software
- **Tarefa:** T-0050, etapa E1 da v0.3.0 (caminho crítico): libera o banco-dados (E2, migração 0033) e o modulo-core (E3)
- **Base:** decisões do PO e do Alexandre de 22 e 23/11/2026 retransmitidas pelo gerente-projetos (portal em `/config` no mesmo domínio, com login, sessão e cookie próprios; superadmin como identidade de plataforma, fora dos tenants, sem impersonação; MFA/TOTP na versão seguinte; 1º superadmin pelo `operador.sh`); `CLAUDE.md` (regras 1, 3, 5, 6, 8 e 9); RN-CORE-01, RN-CORE-02 e RN-CORE-09 (`docs/produto/03`); RF-CAD-11 (`docs/produto/02`); desenho T-0002 (D1, D2, D12); `db/migrations/0002_plataforma.sql` (`plataforma.tenant`, `tenant_modulo`, `usuario`, `sessao`, `auditoria`, `tenant_por_slug`); `scripts/deploy/producao/operador.sh` e `empresa.mjs` (`criar-empresa`, T-0024); `scripts/plataforma/licenca.mjs` (D12).
- **Emendada em:** 26/11 (§6), 27/11 (§1-A) e 28/11 (§7-A: TOTP obrigatório e papel `macuxierp_config` com login próprio, T-0090).
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
As duas tabelas seguem a regra 5. Como não pertencem a tenant, o `tenant_id` é sempre o **tenant de referência** (`plataforma.tenant_referencia()`, D9), com `CHECK (tenant_id = plataforma.tenant_referencia())`. RLS ligado, **sem GRANT para `macuxierp_app`, `macuxierp_worker`, `macuxierp_leitura` ou `macuxierp_config`**: só as funções da seção 4 (donas das tabelas) leem e escrevem. A 0033 deixou a RLS sem FORCE e com a política `isolamento_tenant` da regra 5 (o FORCE cegaria as funções donas no DBaaS sem superusuário); a proteção é a falta de privilégio.

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
- Papel novo `macuxierp_config` (NOLOGIN, **sem BYPASSRLS**). A apps/api entra nele só dentro de `comPlataforma` (`SET LOCAL ROLE macuxierp_config`; membership e risco em "Risco aberto (decisão do PO, 23/11)") e põe `set_config('macuxierp.sessao_superadmin', <sessao_id>, true)`. Só esse papel tem EXECUTE nas funções abaixo; `macuxierp_app` não.
- Toda função começa por `plataforma.exigir_superadmin()`: lê o `sessao_id` da configuração local, confere a sessão (não revogada, não vencida, ociosidade, superadmin ativo, `deve_trocar_senha` falso), atualiza `ultimo_uso_em` e devolve o `superadmin_id`, que a função usa na auditoria. Sessão inválida = exceção com SQLSTATE próprio, que a API traduz em 401.
- Lista fechada, como a 0033 criou (todas no schema `plataforma`, `SET search_path = pg_catalog, pg_temp`, `REVOKE ALL ... FROM PUBLIC`, EXECUTE só do `macuxierp_config`; as auxiliares internas, como `exigir_superadmin` e `auditar_superadmin`, sem EXECUTE de papel nenhum). Na coluna "Sessão", "não" é executável antes do login, como a `tenant_por_slug`; "troca" aceita a troca de senha pendente; "sim" exige a sessão completa. Cada função que muda estado grava a própria auditoria na mesma transação.

| Função | Sessão | O que faz |
|---|---|---|
| `superadmin_para_login(email)` | não | o superadmin não excluído do e-mail normalizado (hash, trava, troca pendente), para a API conferir o argon2 |
| `superadmin_registrar_falha(id, falhas, trava)` | não | soma a falha e só estende a trava (§6) |
| `superadmin_abrir_sessao(id, token_hash, expira_em)` | não | depois do argon2 certo: zera falhas e trava, grava `ultimo_acesso_em`, abre a sessão (até 8 h) e limpa sessões antigas; superadmin inativo ou travado = `MXS01` |
| `superadmin_sessao_por_token(token_hash)` | troca | a sessão válida do hash, renovando `ultimo_uso_em`; vazio se inválida |
| `superadmin_sair(sessao_id)` | troca | revoga só a sessão corrente |
| `superadmin_senha_atual()` | troca | o hash da senha do superadmin da sessão corrente, e só dele (a sessão não leva o e-mail) |
| `superadmin_trocar_senha(hash_atual, hash_nova)` | troca | trava otimista: troca só se o hash ainda é o conferido; tira a troca pendente, zera a trava e revoga as outras sessões. Recebe só hashes, nunca a senha em claro |
| `empresas_listar(busca, cursor uuid, limite)` | sim | sem a empresa de referência e sem as excluídas |
| `empresa_ler(id)` | sim | sem a empresa de referência e sem as excluídas; da 0035, o detalhe ampliado: `razao_social`, `cnpj`, `cidade`, `uf` e `primeiro_admin.email_mascarado` (emenda abaixo) |
| `empresa_criar(slug, nome, fuso, request_id)` | sim | ativa, só com o core |
| `empresa_situacao(id, situacao, motivo, request_id)` | sim | §2, "Suspender" |
| `empresa_modulos(id, jsonb, request_id)` | sim | `[{modulo, ativo, valido_ate}]`; o core nunca desliga |
| `empresa_primeiro_admin_criar(id, email, nome, senha_hash, request_id)` | sim | só se a empresa não tem administrador ativo |
| `empresa_primeiro_admin_senha(id, senha_hash, request_id)` | sim | zera falhas e trava e revoga as sessões do administrador |
| `empresa_primeiro_admin_email(id, request_id)` (0035) | sim | devolve o e-mail completo do 1º admin e audita `plataforma.admin.revelar_email` só com o id do administrador e o `request_id` |
| `empresa_gravar_receita(id, ficha jsonb, request_id)` (T-0101) | sim | grava a ficha da Receita em `core.empresa` e audita `plataforma.empresa.atualizar_receita` com os nomes dos campos que mudaram (emenda da ficha) |
| `empresa_contato_revelar(id, campo, request_id)` (T-0101) | sim | devolve o e-mail ou o telefone completo da ficha e audita `plataforma.empresa.revelar_contato` só com o campo e o `request_id` |
| `cnae_descricoes(codigos text[])`, `municipio_nomes(codigos text[])` (0066, T-0106) | sim | só leitura de tabela oficial (`cadastros.cnae`, `cadastros.municipio`, tenant de referência): `[{codigo, descricao}]` e `[{codigo, nome, uf}]` na ordem pedida, sem repetidos; desconhecido sai; mais de 1000 códigos = 22023. Sem auditoria (não lê dado de tenant) |
| `idem_plataforma_reservar(chave, rota, hash_corpo)`, `idem_plataforma_concluir(chave, rota, status, resposta)` | sim | Idempotency-Key de `/v1/plataforma/*` no tenant de referência (24 h); nas rotas de senha a resposta fica nula (§2) |

- **Erros:** a API traduz o SQLSTATE: `MXS01` → 401; `P0002` (empresa ou administrador inexistente) → 404; `23505` (empresa que já tem administrador) → 409; `23514` (slug reservado, fuso desconhecido, situação, motivo, módulos inválidos, core desligado, senha que mudou durante a troca) → 422.
- **Autor único:** o CHECK `auditoria_um_autor` (`usuario_id IS NULL OR superadmin_id IS NULL`) e o `INSERT` por coluna do app e do worker, sem `superadmin_id`, garantem que só as funções acima gravam o autor de plataforma.
- **Ações de auditoria** (nomes canônicos: o mesmo fato tem o mesmo nome, venha do portal ou do operador; RD-0899). As linhas antigas com `plataforma.usuario.criar` e `plataforma.licenca.alterar` ficam como estão, porque auditoria não se edita.

| Ação | Quem grava |
|---|---|
| `plataforma.superadmin.entrar`, `.falha`, `.sair`, `.senha` | funções de login e sessão |
| `plataforma.empresa.criar` | `empresa_criar`; `scripts/deploy/producao/empresa.mjs` |
| `plataforma.empresa.situacao` | `empresa_situacao` |
| `plataforma.modulos.alterar` | `empresa_modulos` (entidade `tenant`, uma linha por chamada); `empresa.mjs` e `scripts/plataforma/licenca.mjs` (entidade `tenant_modulo`, uma linha por módulo, com o módulo no `depois`) |
| `plataforma.admin.criar` | `empresa_primeiro_admin_criar`; `empresa.mjs` |
| `plataforma.admin.redefinir_senha` | `empresa_primeiro_admin_senha` |
| `plataforma.admin.revelar_email` | `empresa_primeiro_admin_email` (0035) |
| `plataforma.empresa.atualizar_receita` | `empresa_gravar_receita` (T-0101) |
| `plataforma.empresa.revelar_contato` | `empresa_contato_revelar` (T-0101) |
| `plataforma.superadmin.criar`, `.desativar`, `.reativar`, `.destravar` | operador (`scripts/deploy/producao/superadmin.mjs`); detalhes no §5 |
| `plataforma.superadmin.listar` | operador (`superadmin.mjs --acao listar`, T-0103): só o operador, a contagem e o `request_id`, sem e-mail |

- **Emenda do detalhe da empresa (decisão do Alexandre e do PO, 23/11, 0035):** o detalhe (`GET /empresas/:id`) mostra `razao_social`, `cnpj` (formato do domínio, sem máscara), `cidade` (nome do município pela tabela oficial) e `uf` da filial padrão, e o `primeiro_admin.email_mascarado` no padrão do PO "do****@gmail.com": as 2 primeiras letras do local + `****` + `@` + o domínio inteiro (local com 1 ou 2 letras vira `*` + `****`), gerado pela 0035. O e-mail completo só sai por `POST /v1/plataforma/empresas/:id/primeiro-admin/email` → `{ email }`, com o cabeçalho anti-CSRF (§2), `Cache-Control: no-store` e sem idempotência, pela função `plataforma.empresa_primeiro_admin_email(p_id, p_request_id)`, auditada como `plataforma.admin.revelar_email` (só o id do administrador e o `request_id`, **nunca o e-mail**). LGPD: o e-mail e a razão social e o CNPJ de MEI podem ser dado pessoal, então nunca entram em log, auditoria, lista ou busca; a busca segue só por slug e nome. O `nome` do `EmpresaPlataforma` (de `plataforma.tenant`, título no portal) e a `razao_social` (de `core.empresa`, cadastro fiscal) são campos **distintos**: um não substitui nem preenche o outro.

- **Emenda da ficha da empresa pela Receita (T-0101; decisão do Alexandre, R-20261124-225456, itens 1 e 2; v0.3.13).** A lista fechada do `empresa_ler` é desta ADR, e não da 0013 (a 0013 trata só da Integração FDV). Por isso esta é a ADR emendada.
  - **Pré-requisito:** a linha em `core.empresa`, criada pela T-0100 (`docs/desenho/T-0100.md`). Sem a linha, a ficha mostra "—" e o "Atualizar pela Receita" responde 409 `CONFLITO` com "Cadastre a filial padrão antes".
  - **Campos (`core.empresa`, migração nova do banco-dados):** `nome_fantasia` e `ie` (já existem), endereço completo (logradouro, número, complemento, bairro, CEP, `municipio_ibge`, UF), `email`, `telefone`, CNAE principal (código), `cnae_secundarios` (lista de códigos), `data_abertura`, `natureza_juridica`, `porte`, regime pela Receita (`mei`, `simples` ou `normal`, só informativo), situação cadastral com a data dela, `receita_fonte` (`FonteConsulta` dos cadastros) e `receita_consultada_em`. O CRT da NF-e continua da filial (RF-CAD-08): a ficha não grava CRT. A IE não vem da Receita (vem da SEFAZ, RF-CAD-03) e continua como está.
  - **Fonte:** a mesma consulta do RF-CAD-02 (`SugestaoCnpj` e `ResultadoConsulta` de `modules/cadastros/contracts`). O modulo-cadastros amplia a `SugestaoCnpj` com `email`, `telefone`, `opcao_simples`, `opcao_mei`, `data_situacao_cadastral`, `data_abertura`, `natureza_juridica`, `porte` e `cnae_secundarios`, todos opcionais e de leitura tolerante. A API não importa `modules/cadastros/api`: quem liga a consulta dos cadastros ao plugin do portal é a composição em `apps/api`, por uma porta tipada no contrato.
  - **"Atualizar pela Receita":** `POST /v1/plataforma/empresas/:id/receita`, com o cabeçalho anti-CSRF (§2) e `Idempotency-Key`. A consulta usa sempre o CNPJ que já está em `core.empresa`; o CNPJ nunca muda por aqui. A função nova da lista fechada, `plataforma.empresa_gravar_receita(p_id, p_ficha jsonb, p_request_id)`, grava só os campos acima, mais a `razao_social` da Receita, e a data e a fonte. Audita `plataforma.empresa.atualizar_receita` só com os **nomes** dos campos que mudaram, a fonte e o `request_id`, **nunca os valores**. A consulta é guardada (data e fonte) mesmo quando nada muda.
  - **Leitura e máscara:** o `empresa_ler` passa a devolver a ficha com `email_mascarado` (o mesmo padrão "do****@gmail.com" do 1º admin) e `telefone_mascarado` (DDD + `****` + os 4 últimos dígitos, ex.: "(92) ****-1234"), nunca o valor completo. O endereço, os CNAE, a abertura, a natureza jurídica, o porte, o regime, a situação e a data e a fonte da consulta saem sem máscara.
  - **Revelar:** `POST /v1/plataforma/empresas/:id/contato/{email|telefone}` → `{ valor }`, nas mesmas condições do e-mail do 1º admin (emenda acima). A função nova `plataforma.empresa_contato_revelar(p_id, p_campo, p_request_id)` audita `plataforma.empresa.revelar_contato` só com o campo (`email` ou `telefone`) e o `request_id`.
  - **Exceção de escrita, estreita:** `empresa_gravar_receita` é a **única** função da lista que escreve em schema de módulo, e só nas colunas da ficha em `core.empresa`. Nenhuma outra coluna e nenhuma outra tabela do core. Outra escrita do portal em módulo pede ADR nova, como diz a 0013.
  - **LGPD:** e-mail, telefone, razão social e endereço de MEI podem ser dado pessoal. Seguem a regra da emenda acima: nada em log, auditoria, lista ou busca. A exportação LGPD do cliente (regra 8) passa a levar a ficha.

- Fonte dos nomes gravados pelo portal: `ACOES_PLATAFORMA` do SDK; `superadmin.*` são só de auditoria, sem rota; `empresa.ver` é permissão de rota, sem auditoria.
- As funções só tocam `plataforma.tenant`, `plataforma.tenant_modulo`, `plataforma.usuario` (só a linha do administrador), `plataforma.sessao` (revogação) e `plataforma.auditoria`. **Nenhuma lê schema de módulo** (cadastros, pedido, fiscal, faturamento, integração), com uma exceção só de leitura, da emenda acima: `empresa_ler` e `empresa_primeiro_admin_email` leem `core.empresa` (razão social e CNPJ) e a filial padrão em `cadastros.filial`, com o nome do município na tabela oficial. Da emenda da ficha (T-0101): `empresa_contato_revelar` lê `core.empresa`; a escrita é a exceção da emenda da ficha. Da T-0106 (0066): `cnae_descricoes` e `municipio_nomes` leem só tabela oficial do `cadastros` (tenant de referência), nenhum dado de tenant. Nenhuma lê dado de negócio (pedido, nota, cliente, título): o superadmin não vê dado de negócio. O tenant de referência nunca aparece nem muda.
- A dependência entre módulos é conferida na API (`conferirModulosPlataforma` com os `depende` dos manifestos) e a função grava; o `licenca.mjs` do operador passa a chamar a mesma regra na versão seguinte (hoje ele não confere).

### 5. Quem pode ser superadmin e `operador.sh criar-superadmin` (depois da 0033)
- O 1º superadmin (e os seguintes) é criado **só pelo operador**, no molde do `criar-empresa`: `bash ~/macuxierp-deploy/operador.sh criar-superadmin --email "<e-mail>" [--nome "<nome>"] --operador <seu nome> [--confirmar]`. Sem `--confirmar`, transação READ ONLY e plano; com `--confirmar`, transação única, idempotente (repetir não duplica nem troca senha) e auditada com o tenant de referência. A senha provisória é gerada no host a partir do `/dev/urandom`, entra no contêiner só pelo ambiente, aparece uma vez no terminal e cria o superadmin com `deve_trocar_senha = true`. E-mail e nome só pelo ambiente, nunca no argv, na saída nem na auditoria.
- Desativar, reativar e zerar a trava: `bash ~/macuxierp-deploy/operador.sh superadmin --email "<e-mail>" --desativar|--reativar|--destravar --operador <seu nome> [--confirmar]` (mesmo molde, uma ação por vez, nunca gera senha). `--desativar` põe `ativo = false` e revoga as sessões abertas do portal; `--destravar` zera `falhas_login` e `bloqueado_ate`. Não há tela para criar superadmin.
- Senha perdida (T-0077): `bash ~/macuxierp-deploy/operador.sh superadmin --email "<e-mail>" --redefinir-senha --operador <seu nome> [--confirmar]`. Sem `--confirmar`, só o plano (READ ONLY), sem gerar senha. Com `--confirmar`, a senha provisória é gerada no host como no `criar-superadmin` (só pelo ambiente, uma vez no terminal; em falha, descartada) e, numa transação só, grava o `senha_hash` (argon2id) com `deve_trocar_senha = true`, zera `falhas_login` e `bloqueado_ate` e revoga as sessões abertas do portal. Superadmin inexistente ou desativado é recusado sem gravar (o desativado pede o `--reativar` antes). É a única ação do operador que troca senha e não é idempotente por desenho: cada execução confirmada é uma senha nova, auditada de novo (`plataforma.superadmin.redefinir_senha`, com `antes` = `deve_trocar_senha`, `falhas`, `travado` e `depois` = esses três mais `sessoes_revogadas`, `operador` e `motivo`).
- Repetir o que já está no estado pedido também não audita. `usuario_id` e `superadmin_id` ficam nulos (o autor é o operador, no `depois.operador`) e o superadmin é a entidade; o `depois` leva `ativo`, `deve_trocar_senha`, `sessoes_revogadas`, `falhas` e `travado`. Implementação (T-0050): o `operador.sh` manda o `scripts/deploy/producao/superadmin.mjs` ao contêiner `psql`, que grava direto em `plataforma.superadmin` como o admin do DBaaS (dono das tabelas, RLS sem FORCE; as funções da §4 exigem sessão de superadmin e não servem ao operador), numa transação única, no tenant de referência. Ações: `plataforma.superadmin.criar`, `.desativar`, `.reativar`, `.destravar` e `.redefinir_senha` (T-0077); ficam fora do `ACOES_PLATAFORMA` do SDK, que lista só as ações do portal (autor `superadmin_id`). Testes: `packages/config/deploy-operador.test.ts` (docker falso) e `apps/api/src/operador-superadmin.db.test.ts` (PG real; a senha confere com o `conferirSenha` da API sobre o hash da `superadmin_para_login`).

### 6. Limites de tentativa e bloqueio
- Por superadmin: 5 falhas seguidas travam por 15 min (o mesmo do login do tenant, `CONFIG_AUTH_PADRAO`); a trava zera no login certo.
- Por origem: no máximo 10 tentativas de `POST /v1/plataforma/auth/entrar` a cada 15 min por IP, em memória na API (429 `MUITAS_TENTATIVAS`). O IP não vai para log nem para banco.
- Mensagem única: "E-mail ou senha inválidos", sem dizer qual errou nem se o e-mail existe; o tempo de resposta é o mesmo (hash de referência quando o e-mail não existe).
- Log pino com `request_id` e `superadmin_id` (depois do login), nunca e-mail, senha, cookie ou token (a redação de `cookie` e `set-cookie` já existe na apps/api).

### 7. TOTP (versão seguinte, só o encaixe)
> Substituída pela "Emenda §7-A" (28/11/2026, T-0090), no fim desta ADR. O texto abaixo fica como histórico.

Nada disso entra na 0033 nem no código da v0.3.0:
- **Colunas** (migração da versão seguinte) em `plataforma.superadmin`: `totp_segredo_cifrado bytea` (AES-256-GCM pelo `cifra.ts` do SDK, com chave própria `MACUXIERP_CHAVE_TOTP` no secret do servidor, nunca a do A1), `totp_ativado_em timestamptz`, `totp_ultimo_passo bigint` (anti-reuso do mesmo código) e `recuperacao_hashes text[]` (10 códigos de uso único, argon2id). Em `plataforma.sessao_superadmin`: `segundo_fator_em timestamptz`.
- **Login em dois passos:** `entrar` com senha certa e TOTP ativo abre a sessão com `segundo_fator_em` nulo; só `POST /v1/plataforma/auth/segundo-fator` (código de 6 dígitos ou de recuperação) e `sair` respondem até ele ser preenchido. O `exigir_superadmin()` passa a exigir `segundo_fator_em` quando `totp_ativado_em` não é nulo. As falhas do segundo fator contam na mesma trava da seção 6.
- **Recuperação:** código de recuperação (uso único) ou `operador.sh superadmin --zerar-totp` (auditado). O segredo nunca volta para a tela depois do cadastro e nunca vai para recado ou log.
- A versão seguinte pode tornar o TOTP obrigatório para entrar no portal. Prazo e escopo dessa versão: "Risco aberto (decisão do PO, 23/11)".

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
- Risco da membership do `macuxierp_app` no `macuxierp_config`: ver "Risco aberto (decisão do PO, 23/11)".

## Risco aberto (decisão do PO, 23/11)
- **Risco:** a credencial do `macuxierp_app` consegue `SET ROLE macuxierp_config`. É assim que a API entra no papel: a 0033 faz `GRANT macuxierp_config TO macuxierp_app WITH INHERIT FALSE, SET TRUE`, e o teste (a) de `db/testes/superadmin-0033.db.test.ts` fixa essa membership. Quem tiver a credencial (vazamento ou SQL injetado) chama as funções de sessão "não" do §4, inclusive `superadmin_abrir_sessao`, que não confere a senha (o argon2 é conferido na API), e abre uma sessão de superadmin sem a senha.
- **Mitigações atuais:**
  - a credencial do `macuxierp_app` fica só no secret do servidor;
  - o SQL da API é só parametrizado;
  - o `SET LOCAL ROLE macuxierp_config` existe só dentro de `comPlataforma`;
  - nenhuma função da lista fechada lê dado de negócio (schema de módulo), então o papel não dá ao invasor dado de negócio que a credencial do app, que já escolhe o `app.tenant_id` da transação, não desse;
  - toda sessão aberta deixa `plataforma.superadmin.entrar` na auditoria.
- **Correção (obrigatória antes da 2ª empresa cliente no ERP):** separar a credencial e o papel do portal (login próprio, sem membership do `macuxierp_app`), junto com o TOTP (§7).
- **Até lá:** o portal não cria uma 2ª empresa em produção sem o ok do PO (regra de operação, decisão do PO de 23/11 ~08h30; sem trava em código).

Ampliada pela ADR 0013 (Integração FDV no portal, T-0056).

## Emenda (26/11/2026, 22h51): sem trava por tempo no login e no Esqueci (substitui partes da §6)
Pedido do Alexandre, pelo PO, em 26/11 às 21h21: "quando eu clicar em esquecer a senha, gerar a senha e colocar a senha temporária para ele desbloquear automaticamente". Decisão 38 A: entra na v0.3.17 (PR #750). Vale para o tenant e para o superadmin, pela tela única e pelo `/config/entrar`, e muda a RN-CORE-15 e a RN-CORE-13.
- **Bloqueio da conta sem prazo:** na 5ª falha seguida (`maxFalhas`), a conta bloqueia sem prazo (`BLOQUEIO_SEM_PRAZO`, apps/api/src/auth/apoio-login.ts) e responde o 423 `CONTA_BLOQUEADA` com "Recuperar a senha". Ela não solta com o tempo. Saem dele só a senha temporária válida, que desbloqueia na hora (`desbloqueou: true`), e o `operador.sh superadmin --destravar` (ou o administrador, no tenant). Sai o `travaMinutos` do `ConfigAuth`. Um bloqueio antigo, com prazo e já vencido, recomeça a contagem.
- **Limite por IP (10 em 15 min, contra força bruta):** conta só as falhas (401 e 423), na tela única e no `/config/entrar`, que deixa de contar o login certo. Com o IP no limite, **só a temporária válida entra**: a senha comum, certa ou errada, recebe o 429 `MuitasTentativasResposta`, sem somar falha na conta e com o mesmo custo de argon2 da recusa.
- **Esqueci:** sai o limite por conta. Fica só o anti-spam por IP, 20 pedidos a cada 15 min (`LIMITES_ESQUECI_SENHA` do SDK), sempre com o 202 neutro.
- **Trava em memória da conta que não existe (T-0111):** também sem prazo, para o 423 continuar igual ao da conta que existe. Ela tem um teto de 100 mil chaves e zera quando o processo reinicia.

## Emenda §1-A (27/11/2026, Manaus): entrar no `/config` pela sessão do BKO, sem novo login (45 A, v0.3.21)

- **Base:** decisão do PO (45 A) e do Alexandre ("46) A", retransmitida pelo gerente-projetos às 06h43 de 27/11); desenho do banco-dados (0076). Muda a §1 só neste ponto: o superadmin continua identidade de plataforma, fora dos tenants e sem impersonação. O que sai é o segundo login.
- **Quem tem acesso (`acesso_config` no `EuResposta`):** o usuário do BKO que tem um superadmin com o mesmo e-mail normalizado (`lower(btrim)`), e esse superadmin precisa estar ativo, não excluído, não travado (`bloqueado_ate` no passado ou nulo) e sem `deve_trocar_senha`. O usuário e o tenant de origem também precisam estar ativos, e o usuário sem troca de senha pendente. O item "Configuração" do menu do BKO só aparece com `acesso_config = true`, que vem da função de leitura `plataforma.superadmin_acesso_pelo_bko`.
- **Rota `POST /v1/auth/config` (`CAMINHO_ENTRAR_PELO_BKO`, no SDK):** fica no `/v1/auth` do tenant e não no `/v1/plataforma`, onde o JWT do tenant nunca vale (§2). A prova é o refresh da sessão do BKO, o cookie do `/v1/auth`, que o BFF repassa como no `/v1/auth/sair`, mais o `CABECALHO_CSRF_CONFIG`. A função `plataforma.superadmin_abrir_sessao_pelo_bko` (SECURITY DEFINER, EXECUTE só do `macuxierp_config`) só lê a `plataforma.sessao`: não gira o refresh nem mexe na família. Ela abre a `sessao_superadmin` com `expira_em = least(fim da sessão do BKO, agora + 8 h)` (a regra fica só no banco; a API manda as 8 h, `VALIDADE_SESSAO_CONFIG_MS`); a ociosidade de 30 min vale igual.
- **Uma por sessão do BKO:** abrir de novo pela mesma sessão do BKO revoga a sessão do `/config` aberta antes por ela. A sessão do BKO conta pela família do refresh, porque o refresh gira a cada uso. A leitura da sessão do BKO é `FOR NO KEY UPDATE`, para serializar duas aberturas ao mesmo tempo, e não altera a linha.
- **Sem argon2, sem efeito no login:** o caminho não zera `falhas_login` nem a trava e não grava `ultimo_acesso_em` do superadmin.
- **Respostas:** 200 `SessaoPlataformaResposta` com o cookie `COOKIE_CONFIG` (Path=/v1/plataforma); 401 para refresh inválido, vencido ou revogado, ou tenant ou usuário inativo; 403 `CODIGO_TROCAR_SENHA` para usuário com troca pendente; 403 `CODIGO_SEM_ACESSO_CONFIG` sem superadmin válido. A mensagem não diz por quê, para não revelar se o e-mail é de um superadmin.
- **Auditoria:** `plataforma.superadmin.entrar_pelo_bko` no tenant de referência, como o `entrar`, com `superadmin_id` como autor e `depois = {tenant_origem, usuario_id, sessao_bko_id}`. Sem e-mail, hash ou token (regra 8).
- **Risco aceito pelo Alexandre ("46) A"):** quem roubar a sessão do BKO desse usuário (o refresh de 30 dias) entra no `/config` como superadmin, sem a senha do superadmin. Mitigações:
  - o teto da sessão do BKO e das 8 h;
  - CSRF;
  - o cookie `HttpOnly`, `Secure` e `SameSite` dos dois lados;
  - uma sessão do `/config` por sessão do BKO;
  - a auditoria de cada entrada;
  - desativar o superadmin ou revogar a sessão do BKO corta o caminho na hora.
  Sair do BKO **não** derruba a sessão do `/config` já aberta (ela vence pelo próprio teto ou pelo "Sair" do portal).
- **Versão seguinte:** com o TOTP (§7), este caminho passa a pedir o segundo fator. Exigir uma sessão do BKO recente (login há menos de N minutos) fica junto com o TOTP.

## Emenda §7-A (28/11/2026, 07h20, Manaus): TOTP obrigatório e papel `macuxierp_config` com login próprio (decisão 130 A, T-0090, v0.3.32)

- **Base:** decisão 130 do Alexandre (28/11, ~05h50, R-20261128-054925-gerente-projetos): "130 · Macuxi ERP, MFA do superadmin (T-0090): A (vai para a v0.3.32 e entra assim que a senha do papel macuxierp_config existir)". Também a T-0090 (critérios 1 a 4) e a "Correção" do "Risco aberto (decisão do PO, 23/11)", obrigatória antes da 2ª empresa.
- **Substitui:** a §7 ("só o encaixe"). Muda também a §4, para o papel com login próprio, e a §1-A, que passa a pedir o segundo fator. A "sessão do BKO recente" da §1-A continua fora: o segundo fator já cobre o roubo da sessão do BKO.
- **Banco:** migração **0084** (banco-dados), reservada pelo gerente. Ela depende só da 0033 e da 0076 e é independente da 0083 (planos, ADR 0022).

### 1. Um interruptor só: a senha do papel
- O que liga tudo é a **`MACUXIERP_SENHA_CONFIG`** (64 hex), no `/opt/macuxierp/.env` da VM. **Só o Alexandre a cria**, à mão na VM (regra 9). O `preparar-vm.sh` nunca a gera nem a regrava, e ela nunca vai para o git, recado, chat ou log. O `env.modelo` lista só o nome.
- **Sem a variável**, que é o padrão e o estado de hoje:
  - a API segue como hoje: `SET LOCAL ROLE macuxierp_config` a partir do pool do `macuxierp_app`, dentro de `comPlataforma`;
  - o TOTP fica desligado;
  - as colunas da 0084 existem, mas ninguém as exige.
- **Com a variável:**
  - o `banco.sh` aplica a senha ao papel, como faz com os outros (verificador SCRAM), e confere o login;
  - o compose entrega a senha só à api;
  - a API abre um **segundo pool**, `criarPool('macuxierp-api-config')`, com `PGUSER=macuxierp_config`, e confere na partida (`conferirPapel('macuxierp_config')`, sem superusuário e sem BYPASSRLS);
  - o `BancoPlataformaPg` passa a usar esse pool **sem `SET ROLE`**;
  - o TOTP passa a ser obrigatório no `/config` (regra pela decisão 130 A do Alexandre; regra d da ADR 0022).
- **Falha cedo:** com a `MACUXIERP_SENHA_CONFIG` e sem a `MACUXIERP_CHAVE_TOTP`, a API não sobe. O aviso cita só o nome da variável (T-0076).
- **Chave do segredo TOTP:** é a `MACUXIERP_CHAVE_TOTP` (32 bytes, hex ou base64), gerada na VM pelo `preparar-vm.sh` se faltar e nunca trocada, como a `MACUXIERP_CHAVE_INTEGRACAO`. É separada da chave do A1 e da chave da integração: nunca reaproveitar.
- **A membership sai depois:** o `GRANT macuxierp_config TO macuxierp_app` da 0033 só pode ser revogado depois de a produção rodar com o pool próprio. Revogar antes quebraria o `/config` enquanto a senha não existe. A revogação é a migração **0087** (banco-dados, reservada pelo gerente). Ela entra só depois disso, e é ela que fecha o "Risco aberto". Até ela entrar, vale a regra de operação de não criar a 2ª empresa (Risco aberto).

### 2. Colunas e funções (0084)
**Papel:** `ALTER ROLE macuxierp_config LOGIN`, sem senha na migração.
- Sem senha, nenhum login por senha passa (pg_hba do DBaaS com SCRAM).
- O papel continua sem BYPASSRLS, sem CREATEROLE e sem nenhum GRANT em tabela.
- O papel ganha `CONNECT` no banco do ERP e `USAGE` no schema `plataforma`, e nada além disso.
- Os EXECUTE são só os da lista fechada.

**Em `plataforma.superadmin`** (sem GRANT de papel nenhum, como na 0033):

| Coluna | O que guarda |
|---|---|
| `totp_segredo_cifrado bytea` | o segredo de 20 bytes, AES-256-GCM pelo `cifra.ts` do SDK com a `MACUXIERP_CHAVE_TOTP`. **Nunca em claro** no banco, no log ou na tela depois do cadastro |
| `totp_ativado_em timestamptz` | quando o cadastro foi confirmado com um código certo; nulo = sem TOTP |
| `totp_ultimo_passo bigint` | o último passo de 30 s aceito, para o mesmo código não valer duas vezes |
| `totp_falhas integer NOT NULL DEFAULT 0 CHECK (>= 0)` | as falhas seguidas do segundo fator (§4) |
| `recuperacao_hashes text[]` | 10 códigos de recuperação, **só o hash argon2id** de cada um; o código usado sai do array |

**Em `plataforma.sessao_superadmin`:** `segundo_fator_em timestamptz`.

**`exigir_superadmin()`**, com a sessão "sim", passa a recusar com `MXS01`:
- a sessão com `segundo_fator_em` nulo de superadmin que tem TOTP ativo;
- a sessão de superadmin sem TOTP ativo quando o TOTP é obrigatório.

O "obrigatório" chega ao banco pela configuração local `macuxierp.totp_obrigatorio = 'on'`, que a API põe em `comPlataforma` e `antesDaSessao` só quando o pool próprio está ligado. Assim o banco não lê variável de ambiente, e a 0084 aplicada sem a senha não muda nada.

**Funções novas da lista fechada** (§4; `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`, `REVOKE ALL ... FROM PUBLIC`, EXECUTE só do `macuxierp_config`). Elas criam uma classe nova de sessão, **"fator"**: sessão válida, com a senha conferida e o segundo fator pendente.

| Função | Sessão | O que faz |
|---|---|---|
| `superadmin_totp_para_conferir()` | fator | o `totp_segredo_cifrado`, o `totp_ultimo_passo` e os `recuperacao_hashes` do superadmin da sessão corrente, e só dele |
| `superadmin_totp_confirmar(passo)` | fator | o código certo: grava `segundo_fator_em`, zera `totp_falhas` e avança `totp_ultimo_passo`. Um passo igual ou anterior ao último é recusado com 22023 `CODIGO_REUSADO` |
| `superadmin_totp_registrar_falha()` | fator | soma 1 em `totp_falhas`; na 5ª falha seguida, bloqueia a conta e revoga a sessão (§4) |
| `superadmin_recuperacao_usar(indice)` | fator | tira do array o hash que a API conferiu, grava `segundo_fator_em` e zera `totp_falhas` |
| `superadmin_totp_cadastrar(segredo_cifrado)` | fator | só sem TOTP ativo: grava o segredo pendente, que substitui um pendente anterior |
| `superadmin_totp_ativar(passo, recuperacao_hashes)` | fator | confere que há segredo pendente, grava `totp_ativado_em`, o passo, os 10 hashes e `segundo_fator_em` |

Mais duas mudanças:
- `superadmin_abrir_sessao` e `superadmin_abrir_sessao_pelo_bko` abrem a sessão com `segundo_fator_em` nulo;
- `superadmin_sessao_por_token` devolve também `segundo_fator_pendente` e `totp_ativo`, para a API escolher a tela.

Cada função que muda estado grava a auditoria na mesma transação:
- `plataforma.superadmin.totp_ativar`;
- `.segundo_fator`, com `depois = {meio: 'totp' | 'recuperacao', recuperacao_restantes}`;
- `.segundo_fator_falha`;
- `.totp_zerar`.

A auditoria nunca leva o código, o segredo ou o hash (regra 8).

### 3. Fluxo e rotas (`/v1/plataforma/auth/*`)
- **Entrar** (senha, pela tela única, ou pelo BKO, §1-A): a sessão abre com o segundo fator pendente. A resposta traz `proximo_passo`:
  - `segundo_fator` quando há TOTP;
  - `cadastrar_totp` quando não há TOTP e ele é obrigatório;
  - `trocar_senha`, que vem antes dos dois.
  Com a sessão "fator", só `sair` e as rotas abaixo respondem; o resto dá 401.
- **`POST /segundo-fator`** `{ codigo }`:
  - 6 dígitos: TOTP do RFC 6238 (HMAC-SHA1, passo de 30 s, janela de ±1 passo);
  - 18 caracteres: código de recuperação (alfabeto do `senha-temporaria.ts`, RN-CORE-10).
  O código errado dá 401 com a mensagem única "Código inválido.", conta a falha (§4) e soma no limite por IP (emenda de 26/11).
- **`POST /totp/cadastro`:** gera o segredo com `crypto.randomBytes(20)`, cifra, grava pela `superadmin_totp_cadastrar` e devolve **uma vez só** a chave em base32 e a URI `otpauth://totp/Macuxi%20ERP?secret=…&issuer=Macuxi%20ERP`. A URI não leva o e-mail (LGPD).
- **`POST /totp/ativar`** `{ codigo }`:
  - confere o código contra o segredo pendente;
  - gera os 10 códigos de recuperação, grava só os hashes argon2id e devolve os códigos **uma vez só**;
  - a resposta vai com `Cache-Control: no-store`, como a senha provisória.
- **TOTP no SDK:** a conta do RFC 6238 vira uma função pura no SDK (`totp.ts`, com o HMAC injetado), com os vetores de teste do apêndice B do RFC. O HMAC vem do `node:crypto` na API. **Nenhuma dependência nova no SDK nem na API.**
- **QR code:** a apps/web desenha o QR a partir da URI. Se precisar de biblioteca, o pedido vem ao engenheiro-software antes, com o nome, o tamanho e a licença. Sem ela, a tela mostra só a chave para digitar no app.
- **Log:** nunca o código, o segredo, a URI, a chave base32 ou os códigos de recuperação. A redação do pino ganha `codigo`, `segredo`, `otpauth` e `recuperacao`.

### 4. Contagem de falhas
- **Por conta:** `totp_falhas` conta só as falhas do segundo fator. São 5 seguidas, o mesmo `maxFalhas` do login.
  - Na 5ª, a função bloqueia a conta sem prazo (`bloqueado_ate` = `BLOQUEIO_SEM_PRAZO`, emenda de 26/11) e revoga a sessão "fator". A resposta é 423 `CONTA_BLOQUEADA`, com o aviso da RN-CORE-15.
  - O acerto zera `totp_falhas`.
  - A falha de senha continua em `falhas_login`, como hoje. Os dois contadores não se somam, para que um erro de digitação do código não roube a conta de quem errou a senha uma vez.
- **Saída do bloqueio:**
  - a senha temporária (RN-CORE-13) desbloqueia a **senha**: zera `falhas_login`, `totp_falhas` e a trava, mas a sessão que ela abre continua pedindo o segundo fator. **A temporária nunca dispensa o TOTP**;
  - o `operador.sh superadmin --destravar` também zera os dois contadores.
- **Por IP:** a falha do segundo fator conta no limite por IP de 10 em 15 min (429 `MUITAS_TENTATIVAS`).
- **Recuperação perdida:** `operador.sh superadmin --email … --zerar-totp --operador … [--confirmar]`, no molde do `--destravar`. Ele zera o segredo, `totp_ativado_em`, os hashes e `totp_falhas` e revoga as sessões; no próximo login, o superadmin cadastra de novo. É auditado (`plataforma.superadmin.totp_zerar`) e fica fora do `ACOES_PLATAFORMA`.

### 5. Quem faz o quê (para o gerente disparar)
Ordem: E1 → E2 (banco) → E3 (API, core e operador) → E4 (telas) → E5 (testes, corretor e revisão).

| Etapa | Dono | Entrega | Pronto quando |
|---|---|---|---|
| E1 | engenheiro-software | esta emenda | merge no `main` |
| E2 | banco-dados | migração **0084**: o `LOGIN` do papel (sem senha), `CONNECT` e `USAGE`; as colunas do §2; `exigir_superadmin()` com o segundo fator e o `macuxierp.totp_obrigatorio`; as seis funções novas e as três alteradas; a auditoria. `db/testes/superadmin-totp-0084.db.test.ts` prova: o papel tem LOGIN, não tem BYPASSRLS nem GRANT em tabela; o EXECUTE das funções novas é só do `macuxierp_config`; a sessão "fator" não passa no `exigir_superadmin()`; o passo repetido é recusado; a 5ª falha bloqueia e revoga; o código de recuperação vale uma vez; e, sem `totp_obrigatorio`, nada muda para o superadmin sem TOTP | testes de banco verdes com `MACUXI_PG_EXIGIR=1` |
| E3 | engenheiro-software | SDK: `totp.ts` (função pura, vetores do RFC) e os contratos das rotas do §3 em `plataforma-rotas.ts`, depois do PR do SDK em andamento (T-0129). apps/api: o segundo pool atrás da `MACUXIERP_SENHA_CONFIG`, a falha cedo sem a `MACUXIERP_CHAVE_TOTP`, as rotas do §3, a redação do pino e o `erros.ts`. Deploy: `env.modelo`, `banco.sh` (aplicar e conferir a senha só se ela existir), `compose.yml` (só a api) e `preparar-vm.sh` (a chave TOTP). `operador.sh superadmin --zerar-totp`. Revisão final | unitários e de banco da API verdes; `deploy-operador.test.ts` verde |
| E3 | modulo-core | o plugin de plataforma: nenhuma rota de empresa responde com a sessão "fator" (teste citando RN-CORE-12); o `entrar_pelo_bko` devolve o `proximo_passo` | testes do core verdes |
| E4 | engenheiro-apps | `/config`: as telas "Código de verificação" (6 dígitos, com o link "Usar um código de recuperação"), "Cadastrar o autenticador" (QR ou chave, e o código para confirmar) e "Códigos de recuperação" (mostrados uma vez, com "Copiar" e "Já guardei"), seguindo o `proximo_passo` também na entrada pelo BKO. Os textos vêm do designer-ux. Grade de 12 colunas, tokens do `packages/ui`, botões no rodapé (regras 11 e 12); prints em 1366 e 1920 px | prints validados pelo `design-de-marca` |
| E5 | testes, corretor-redundancias e engenheiro-software | `tests/`: sem TOTP não entra (critério 1); a recuperação vale uma vez (critério 2); o papel só alcança as funções do portal (critério 3); a temporária não dispensa o TOTP; nada de código ou segredo em log | suíte verde; revisão sem 🔴 |
| E6 (depois da produção com o pool próprio) | banco-dados | migração **0087**: `REVOKE macuxierp_config FROM macuxierp_app`; o teste (a) de `db/testes/superadmin-0033.db.test.ts` passa a provar que o `macuxierp_app` **não** consegue `SET ROLE macuxierp_config`. A API sem `MACUXIERP_SENHA_CONFIG` deixa de abrir o `/config`, e isso fica escrito na nota da versão | testes de banco verdes; a produção já rodando com o pool próprio |

**Do Alexandre, depois do deploy da v0.3.32:**
1. Criar a `MACUXIERP_SENHA_CONFIG` na VM (64 hex, `openssl rand -hex 32`) e reiniciar a api.
2. Cadastrar o autenticador no primeiro login do `/config`.

Até a variável existir, o `/config` funciona como hoje (decisão 130 A). O critério 4 da T-0090 ("pronto antes da 2ª empresa") só fecha com a variável criada e com a 0087, que revoga a membership.
