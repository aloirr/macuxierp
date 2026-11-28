# Acesso sem a empresa: varredura do main (RD-2399 a RD-2418)

- Ordem do Alexandre (R-20261128-003527-gerente-projetos): "Solicitar a empresa deve sumir de qualquer tela". Base: R-20261128-002528 (1 usuário = 1 empresa; a empresa vem do usuário) e a decisão 125 B (R-20261128-003313).
- Tarefa T-0133, versão v0.3.30. Todos os achados entram na v0.3.30.
- Base: `origin/main` em d9838f95e39a7f4e45b9032b7f25341de8d5e7f7. Varredura só de leitura, em 28/11/2026 por volta de 00h39 (Manaus). As linhas citadas valem para esse commit.
- Onde se buscou: `apps/web`, `apps/api`, `packages/platform-sdk`, `modules/core` e `scripts/deploy`. Termos: "código da empresa", "codigo", "empresa" nos formulários de acesso, "slug", "EMPRESA_PLATAFORMA", `#codigo`, `MACUXI`.
- Tipo A0: o campo, o rótulo, a mensagem ou o link que pede ou mostra a empresa não serve mais para o usuário agir. Por isso a severidade é alta. A exceção é o que é só código interno, comentário ou teste.

## Resumo

**20 achados: 9 do engenheiro-software (API, SDK e e-mail) e 11 do engenheiro-apps (telas).** São 14 de severidade alta, 2 média e 4 baixa.

Ordem sugerida: primeiro o contrato do SDK (RD-2399, RD-2401, RD-2404 e RD-2405), porque as telas importam dele; depois a API; por último as telas e os e2e. O e-mail único em todo o sistema (branch `nuvem/v0330-banco-email-global`, do banco-dados) precisa estar no main antes de a API achar a empresa pelo e-mail.

O que se olhou e ficou sem achado:
- Troca de senha (`/senha` e `/config/senha`) e o primeiro acesso (troca obrigatória): não pedem nem mostram a empresa.
- Não há modelo de e-mail de "acesso" no main. O único e-mail de acesso é o da senha temporária, que serve ao "Esqueci a senha" e à redefinição (RD-2403).
- `/config`, painel do primeiro administrador (`painel.tsx:223-232`): a senha provisória aparece sem o código. Nada a tirar.
- `operador.sh`: não pede a empresa para a senha de ninguém. O `--empresa` do `a1-teste` e o "código da empresa" que o `empresa.mjs:323` imprime são do operador, que precisa saber em que empresa agiu: `manter`.
- `RECUPERAR_CONTA_BLOQUEADA` (`erros.ts:46-47`), "fale com o administrador da sua empresa": cita o papel e não pede a empresa: `manter`.
- A lista e a ficha de Empresas do `/config` mostram o código da empresa. Isso é cadastro, não acesso: fora deste escopo.

---

## engenheiro-software: API, SDK e e-mail

| RD | Tipo · sev. | Onde (arquivo:linha) | Texto exato | Correção em uma linha |
|---|---|---|---|---|
| RD-2399 | código · alta | `packages/platform-sdk/src/login.ts:45-49`; `apps/api/src/app.ts:246-249`; `apps/api/src/auth/servico.ts:124-128` | `LoginEntrada = z.object({ empresa: CodigoEmpresaLogin, email, senha })`; `destinoDoCodigo(entrada.empresa)`; `tenantIdPorSlug(tx, entrada.empresa…)` | O `POST /v1/auth/login` recebe só `{ email, senha }`. A API procura o e-mail no superadmin (destino `config`) e depois no usuário (e-mail único), e o tenant vem do usuário. |
| RD-2400 | texto · alta | `apps/api/src/auth/servico.ts:70` | `'Empresa, e-mail ou senha inválidos'` | `'E-mail ou senha inválidos'`. |
| RD-2401 | código · alta | `packages/platform-sdk/src/esqueci-senha.ts:23`; `apps/api/src/app.ts:266-267, 276-277`; `apps/api/src/auth/servico.ts:163-172, 186` | `PedirSenhaTemporariaEntrada = z.object({ empresa: CodigoEmpresaLogin, email })`; `destinoDoCodigo(empresa) === 'config'` | O `POST /v1/auth/esqueci` recebe só `{ email }`, e o desvio para o superadmin é pelo e-mail, como no login. |
| RD-2402 | texto · alta | `packages/platform-sdk/src/esqueci-senha.ts:31-32` | `'Se o e-mail estiver cadastrado nesta empresa, você vai receber uma senha temporária em alguns minutos. Ela vale por 72 horas.'` | `'Se o e-mail estiver cadastrado, enviamos as instruções.'` (decisão 125 B; o mesmo texto da caixa verde da tela, RD-2412). |
| RD-2403 | texto · alta | `packages/platform-sdk/src/esqueci-senha.ts:152, 155, 159, 166`; `packages/platform-sdk/src/email-senha-temporaria-html.ts:4, 56-57`; `apps/api/src/auth/senha-temporaria.ts:53-57`; `apps/api/src/plataforma/servico.ts:129` | `` `Código da empresa: ${campos.codigo_empresa}` `` e a linha "Código da empresa" do HTML. O superadmin recebe "Código da empresa: MACUXI". | Tirar a linha do texto e do HTML e o parâmetro `codigo_empresa` (de `emailSenhaTemporaria` e de `mensagemSenhaTemporaria`). O e-mail fica com o e-mail, a senha temporária e o botão. |
| RD-2404 | código · alta | `packages/platform-sdk/src/esqueci-senha.ts:111-118, 120-134` | `urlEntrarPreenchida(codigo_empresa, email)` → `/#codigo=…&email=…`; `PreenchimentoLogin = { codigo, email }` | `urlEntrarPreenchida(email)` → `/#email=…`. O `lerPreenchimentoLogin` lê só o `email` e ignora o `codigo` dos links antigos. |
| RD-2405 | texto · alta | `packages/platform-sdk/src/portal-config.ts:50-54`; `packages/platform-sdk/src/login.ts:22-33, 40-42` | `CODIGO_SUPERADMIN_LOGIN = 'MACUXI'` "no campo empresa do login e do esqueci"; mensagem `'Código da empresa inválido, ex.: AM2808'`; `destinoDoCodigo` | O `CodigoEmpresaLogin`, o `destinoDoCodigo` e o uso do `MACUXI` no login saem. O `macuxi` fica só nos `SLUGS_RESERVADOS` da criação de empresa. |
| RD-2406 | código · baixa | `apps/api/src/plataforma/limite-ip.ts:24-25, 104`; `apps/api/src/plataforma/servico.ts:114`; `apps/api/src/auth/servico.ts:126` | `EMPRESA_PLATAFORMA = 'plataforma'`; `chaveEmpresaEmail(empresa, email)` | Com o e-mail único, a trava da conta usa `chaveEmail(email)`, e o `EMPRESA_PLATAFORMA` sai. |
| RD-2407 | doc · baixa | `apps/api/src/app.ts:4-6, 236-237`; `packages/platform-sdk/src/login.ts:2-6`; `packages/platform-sdk/src/esqueci-senha.ts:112-113, 149` | "`POST /v1/auth/login` com o código da empresa; o código reservado MACUXI desvia por dentro"; "Leva o código da empresa" | Reescrever os comentários para o login por e-mail e senha, sem código. |

## engenheiro-apps: telas

| RD | Tipo · sev. | Onde (arquivo:linha) | Texto exato | Correção em uma linha |
|---|---|---|---|---|
| RD-2408 | texto · alta | Entrada "/" (o `/login` e o `/config/entrar` caem nela por 308): `apps/web/src/lib/login-regras.ts:7-8`; `apps/web/src/app/login/formulario.tsx:15-16, 34, 62, 73, 93`; `apps/web/src/app/login/entrar.ts:59-60` | Rótulo `'Código da empresa'`; obrigatório `'Informe o código da empresa.'`; `campo('empresa', 'text', 'organization')` | Tirar o campo: a tela fica só com E-mail e Senha, como na simulação 1c72a48 aprovada (125 B). |
| RD-2409 | texto · alta | `apps/web/src/lib/login-regras.ts:13` | `credencial: 'Empresa, e-mail ou senha incorretos.'` | `'E-mail ou senha incorretos.'` |
| RD-2410 | texto · alta | `apps/web/src/lib/login-regras.ts:2, 55, 59-68, 81, 96` | `erroDoCodigo` mostra o `'Código da empresa inválido, ex.: AM2808'` do SDK | Tirar `erroDoCodigo` e o `'empresa'` de `CampoLogin`. A validação fica só com o e-mail e a senha. |
| RD-2411 | texto · alta | "Esqueci a senha": `apps/web/src/components/esqueci-senha.tsx:20, 66-67, 92-116, 142-166`; `apps/web/src/lib/esqueci-resultado.ts:17, 26`; `apps/web/src/app/login/esqueci.ts:6-7`; `apps/web/src/lib/esqueci-api.ts:22-23`; `apps/web/src/app/login/formulario.tsx:131` | `CAMPOS = ['empresa', 'email']` (o painel mostra "Código da empresa"); `empresaInicial` | O painel pede só o E-mail: `CAMPOS = ['email']`, e o `empresaInicial` sai. |
| RD-2412 | texto · alta | `apps/web/src/lib/esqueci-resultado.ts:13` | `'Se os dados estiverem certos, a senha temporária chega no seu e-mail em instantes. Ela vale 72 horas e desbloqueia a conta.'` | `'Se o e-mail estiver cadastrado, enviamos as instruções.'` (decisão 125 B; "os dados" eram empresa e e-mail). |
| RD-2413 | texto · alta | `/config` sem sessão: `apps/web/src/lib/rota-login.ts:10-11`, usado em `apps/web/src/app/config/sessao/encerrar/route.ts:15, 20`, `apps/web/src/lib/config/sessao.ts:31, 38` e `apps/web/src/lib/config/cargas-rotas.ts:65, 74` | `` ROTA_LOGIN_SUPERADMIN = `${ROTA_LOGIN}#codigo=${CODIGO_SUPERADMIN_LOGIN}` `` (a entrada abre com "MACUXI" no campo) | `ROTA_LOGIN_SUPERADMIN` sai, e todo lugar volta para `ROTA_LOGIN` ("/"). |
| RD-2414 | código · alta | Link do e-mail: `apps/web/src/lib/login-preenchimento.ts:5-11`; `apps/web/src/app/login/formulario.tsx:84-93` | `return { empresa: f.codigo ?? e.salvo ?? '', email: f.email ?? '' }` | `valoresIniciaisLogin` devolve só `{ email }`, lido do `#email=`; o `#codigo` de link antigo é ignorado. |
| RD-2415 | código · média | `apps/web/src/lib/codigo-salvo.ts:1-45`; `apps/web/src/app/login/formulario.tsx:8, 87, 98` | `CHAVE_CODIGO_EMPRESA = 'mx.codigo_empresa'`; `gravarCodigoDoLogin(r.entrou.destino, valores.empresa)` | Apagar o `codigo-salvo.ts` e as duas chamadas: sem o campo, não há código para lembrar. A chave antiga pode ser apagada uma vez com `removeItem`. |
| RD-2416 | código · média | `apps/web/src/lib/acao-versao.ts:8, 17, 46-62` | `Rascunho { empresa: string; email: string }`; "guarda só empresa e e-mail" | O rascunho da recarga guarda só o `email`. |
| RD-2417 | doc · baixa | `apps/web/src/app/login/formulario.tsx:18, 84`; `apps/web/next.config.ts:41`; `apps/web/src/app/login/tela.tsx:4` | "Código, e-mail e senha só no estado do formulário"; "o fragmento do link do e-mail (`#codigo=…&email=…`)" | Reescrever os comentários para e-mail e senha e `#email=`. |
| RD-2418 | teste · baixa | `apps/web/e2e/login-raiz.mjs:7-9, 48-50, 84, 100-101`; `apps/web/e2e/versao-nova.mjs:4, 86, 111, 114` | `getByLabel('Código da empresa')`; `/login#codigo=AM2808&email=…`; `'empresa voltou preenchida'` | Os e2e passam a usar só E-mail e Senha, com o link `#email=`, e o superadmin é reconhecido pelo e-mail. |

## Reteste

Quando os dois PRs estiverem no main, o corretor refaz esta busca e, na entrada "/", no "Esqueci a senha" e no `/config` sem sessão, tira o print em 1366 e 1920 px. Cada RD fecha como `corrigido` ou `reaberto` no `catalogo.md`.
