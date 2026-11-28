# ADR 0021 — Login por e-mail único no sistema, sem o código da empresa

- **Status:** Proposta (28/11/2026). Fica **a decidir** o item 7 (superadmin × usuário com o mesmo e-mail).
- **Data:** 28/11/2026, 00h28 (Manaus)
- **Dono:** engenheiro-software
- **Tarefa:** T-0133 (v0.3.30). Desenho: o do engenheiro-software para a T-0133; banco: migração 0079 (banco-dados), depois da 0078.
- **Decisão do PO (28/11/2026, repassada pelo gerente-projetos):** a mensagem da empresa suspensa, que só aparece depois de a senha conferir (item 3).
- **Altera:** a D2 da T-0002 (`docs/desenho/T-0002.md`: usuário por tenant, login com empresa, e-mail e senha), a ADR 0012 §2 (login do superadmin e o `tenant_por_slug` no Suspender) e a ADR 0018 (o código reservado `MACUXI` no campo "empresa").
- **Número:** o 0020 já é a ADR `0020-formas-e-prazos.md`; esta é a 0021, o próximo livre no `main` e nos branches.

## Contexto
Hoje o login pede empresa (código), e-mail e senha (D2 e ADR 0018). O e-mail é único só dentro da empresa: o índice da 0078 vale por `tenant_id`. O superadmin entra com o código reservado `MACUXI`. A T-0133 tira o código da empresa da tela: a pessoa digita só o e-mail e a senha. Para isso, o e-mail precisa levar a uma conta só no sistema todo.

## Decisão

### 1. E-mail único no sistema todo
- A chave é `lower(btrim(email))`. Contam só as linhas vivas (`deleted_at IS NULL`).
- A unicidade vale entre os `plataforma.usuario` de **todas** as empresas. Contra o `plataforma.superadmin`, depende do item 7 (a decidir).
- Quem atende duas empresas usa um e-mail diferente em cada uma.
- Mensagem ao usuário, na criação ou na troca de e-mail com um e-mail já usado: **"Este e-mail já está em uso em outra empresa. Use outro e-mail."** (código `email_em_uso`, fonte única no SDK). A mensagem não diz qual empresa.

### 2. Login: `plataforma.conta_por_email(p_email)`
- Função `SECURITY DEFINER STABLE` (banco-dados, 0079). `EXECUTE` só do `macuxierp_app`; `REVOKE` de `PUBLIC`.
- Devolve **no máximo 1 linha**: `{ tipo: 'usuario' | 'superadmin', tenant_id | null, suspensa: boolean }`. Nunca devolve hash, nome nem e-mail.
- Empresa **encerrada** ou inexistente = nenhuma linha. Empresa **suspensa** devolve a linha com `suspensa = true` (item 3).
- Ela substitui o `plataforma.tenant_por_slug` no `semTenant` do login. Depois dela, o fluxo segue igual: a transação abre no `tenant_id` devolvido e lê o usuário com RLS, como hoje.
- **Sessão e JWT não mudam**: mesmo refresh, mesmo cookie, mesmas claims.

### 3. Falha neutra e empresa suspensa
- E-mail inexistente ou senha errada: o mesmo 401 `NAO_AUTENTICADO`, com a mensagem **"e-mail ou senha inválidos"**. O e-mail inexistente paga o mesmo custo de argon2 (`ConferenciaCustoIgual`).
- **Empresa suspensa (decisão do PO):** a função devolve o tenant mesmo suspenso. O `servico` confere a senha (argon2) primeiro. Com a senha certa, a resposta é 403 `EMPRESA_SUSPENSA` com **"Sua empresa está suspensa. Fale com o administrador da Macuxi."**, sem abrir sessão. Com a senha errada, o 401 genérico. Assim, só quem tem a senha descobre que a conta existe e que a empresa está suspensa.
- A suspensão continua revogando as sessões do tenant (ADR 0012 §2). Só a mensagem muda.

### 4. Trava e limite
- A trava por conta passa a ser por e-mail: `chaveEmail(email)` no lugar de `chaveEmpresaEmail(empresa, email)`.
- O limite por IP fica: 10 tentativas em 15 min (`LIMITE_LOGIN_IP_PADRAO`, ADR 0012 §6 e a emenda de 26/11).
- O `/esqueci` responde **sempre 202**, exista ou não o e-mail, e segue os `LIMITES_ESQUECI_SENHA`.

### 5. Superadmin na mesma tela
- O superadmin entra na mesma tela, com e-mail e senha, e vai ao `/config` (`destino: 'config'`, ADR 0018 §3 a §5 sem mudança nos cookies e no CSRF).
- Saem o código reservado como caminho de login e a constante `EMPRESA_PLATAFORMA` (`apps/api/src/plataforma/limite-ip.ts`). `SLUGS_RESERVADOS` e o CHECK da 0049 ficam: o código `macuxi` continua sem poder virar empresa.

### 6. Transição de uma versão
- O campo `empresa` do `LoginEntrada` fica **opcional e ignorado** na v0.3.30 e sai na versão seguinte (mudança incompatível avisada aos consumidores).
- A API conta em log quantos logins ainda mandam `empresa`: só a contagem, com `tenant_id` quando houver, `modulo` e `request_id`, **sem e-mail nem código**.
- O e-mail da senha temporária deixa de levar o código da empresa.

### 7. Superadmin × usuário com o mesmo e-mail (**a decidir**)
A unicidade contra o superadmin quebra a emenda §1-A da ADR 0012 (decisão 45 A): o `/config` pelo BKO acha o superadmin pelo **mesmo e-mail** do usuário do BKO. Com o e-mail único também contra o superadmin, esse par não existe mais.

- **Opção A (recomendada):** o superadmin fica **fora** da unicidade com os usuários. A unicidade vale só entre usuários de todas as empresas, e entre superadmins. No login, a `conta_por_email` prefere o usuário da empresa; o superadmin que não tem usuário com o mesmo e-mail entra no `/config`. O superadmin com usuário entra no BKO e passa ao `/config` pela §1-A, como hoje. Custo: nenhum dado novo; a §1-A não muda.
- **Opção B:** um vínculo explícito entre o superadmin e o usuário do BKO (por exemplo, `plataforma.superadmin.usuario_id`), no lugar da comparação por e-mail. O e-mail fica único também contra o superadmin. Custo: coluna e migração do vínculo, ajuste da `superadmin_acesso_pelo_bko` e da `superadmin_abrir_sessao_pelo_bko` e do `operador.sh criar-superadmin`.

Até a escolha, os itens 1 e 8 que tocam o superadmin ficam condicionados a ela.

### 8. Migração 0079 (banco-dados), depois da 0078
1. **Checagem antes de tudo:** conta os e-mails repetidos entre usuários vivos (e, na opção B, usuário × superadmin). Se houver, aborta com `RAISE EXCEPTION` que leva **só a contagem**, nunca o e-mail.
2. Índice único `usuario_email_global_uq` em `lower(btrim(email)) WHERE deleted_at IS NULL`, no lugar do índice por tenant da 0078.
3. Gatilho `BEFORE INSERT OR UPDATE OF email, deleted_at` nas duas tabelas (`usuario` e `superadmin`), com `pg_advisory_xact_lock(hashtext(lower(btrim(email))))`, que serializa a corrida entre as tabelas (o índice não cruza tabelas) e dá o erro `email_em_uso`. Na opção A, o gatilho cuida só de superadmin × superadmin e o índice cobre os usuários.
4. As funções de criação de usuário (primeiro admin e usuário do BKO) checam o e-mail globalmente e devolvem `email_em_uso`.
5. A função `conta_por_email` do item 2.

O `producao-publicar` volta atrás sozinho se a checagem abortar: a migração roda numa transação, e a versão anterior segue no ar. Repetidos em produção são resolvidos com o cliente antes de publicar de novo.

## LGPD e segredos
- Nada de e-mail em log, auditoria, erro do banco ou recado: a checagem da migração e a contagem do campo `empresa` levam só números.
- O hash da senha nunca sai da função de login.

## Consequências
- A tela de login tem só e-mail e senha; o navegador não guarda mais o código da empresa.
- Uma pessoa com duas empresas precisa de dois e-mails.
- A web mostra a mensagem do `email_em_uso` no cadastro de usuário e no primeiro admin.
- Os testes do login cobrem: e-mail inexistente com o mesmo custo, senha errada, empresa suspensa só depois da senha, empresa encerrada como inexistente, trava por e-mail, `/esqueci` sempre 202 e o campo `empresa` ignorado.

## Referências
D2 da T-0002 · ADR 0012 (§2, §6 e emenda §1-A) · ADR 0018 · RN-CORE-12 e RN-CORE-13 · `apps/api/src/auth/servico.ts`, `repositorio-pg.ts` e `portas.ts` · `apps/api/src/plataforma/limite-ip.ts` e `servico.ts` · `packages/platform-sdk/src/login.ts` e `portal-config.ts` · migrações 0049, 0078 e 0079.
