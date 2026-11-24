# ADR 0018 — Login único com o código reservado MACUXI

- **Status:** Proposta (23/11/2026)
- **Data:** 23/11/2026, 23h00 (Manaus)
- **Dono:** engenheiro-software
- **Tarefa:** T-0076 (RN-CORE-12; o "esqueci" é a RN-CORE-13)
- **Base:** especificação do Alexandre e do PO em `docs/design/login-unico/README.md` (#466): uma tela só, com Empresa, E-mail e Senha (com o olho), o código salvo no navegador e o "esqueci" na mesma tela, para todos.
- **Muda:** a ADR 0012 (o superadmin entrava pelo `/config/entrar`, com login próprio). A sessão, o cookie e as rotas `/v1/plataforma/*` da 0012 continuam.

## Contexto
Hoje há duas telas de entrada: `/login` (usuário do tenant, `POST /v1/auth/login`) e `/config/entrar` (superadmin, `POST /v1/plataforma/auth/entrar`), ligadas pelo link "Sou de uma empresa". O FDV tem uma tela só, e o Alexandre quer o mesmo no ERP. O superadmin não pertence a tenant (ADR 0012), então o campo "empresa" precisa de um valor que leve à plataforma sem virar empresa nunca.

## Decisão
1. **Código reservado.** O valor `MACUXI` no campo "empresa" (sem diferenciar maiúsculas) leva ao superadmin. A fonte única é `CODIGO_SUPERADMIN_LOGIN` (`packages/platform-sdk/src/portal-config.ts`). O texto da tela não mostra o código (nem ajuda, nem placeholder).
2. **Nunca vira empresa.** `SLUGS_RESERVADOS` inclui `macuxi`, e a criação de empresa recusa o código (`MENSAGEM_CODIGO_RESERVADO`). O banco repete a regra com um CHECK em `plataforma.tenant.slug` na migração 0049 (banco-dados), com o DETAIL `DETALHE_CODIGO_RESERVADO`. Mudou no SDK, muda no banco, numa migração nova.
3. **Uma rota.** `POST /v1/auth/login` (`CAMINHO_LOGIN`), com `LoginEntrada` = `{ empresa: CodigoEmpresaLogin, email, senha }`. `destinoDoCodigo` (função pura no SDK, usada pelo `resolverDestinoLogin` do core e pela API) dá o destino:
   - `config`: a API autentica o superadmin e abre a sessão do `/config`;
   - `bko`: a API autentica o usuário do tenant, como hoje.
4. **Resposta com o destino.** `LoginResposta` é o corpo de hoje mais o `destino`:
   - `bko`: `{ destino, token_acesso, expira_em }`. Sem `destino` (resposta antiga) vale `bko`;
   - `config`: `{ destino, expira_em }`, sem token no corpo.
   `SenhaATrocarResposta` ganha `destino` opcional. `EuResposta.usuario` e `EuPlataforma` ganham `motivo_troca` opcional, com o enum único `MOTIVOS_TROCA_SENHA`.
5. **Cookies separados.** O BKO segue com o `macuxierp_refresh` (caminho `/v1/auth`). O `/config` segue com o `COOKIE_CONFIG` (caminho `/v1/plataforma`), mesmo quando a sessão nasce no `/v1/auth/login`. Um login nunca grava os dois cookies. O `/config` continua exigindo o `CABECALHO_CSRF_CONFIG` nas escritas. A web manda o cabeçalho também no login, e a API o exige quando o destino é `config`, como no `/config/entrar`.
6. **Falha neutra.** Senha errada, e-mail inexistente, empresa inexistente ou suspensa e superadmin inexistente dão o **mesmo 401** (`NAO_AUTENTICADO`, mesma mensagem), com o mesmo custo de conferência (`ConferenciaCustoIgual`). A resposta não revela se o código digitado é o do superadmin.
7. **Mesmo limite.** O limite por IP e a trava por conta valem igual nos dois destinos, com o mesmo 429 `MUITAS_TENTATIVAS` (`MuitasTentativasResposta`, `retry_after_s`). O "esqueci" segue os `LIMITES_ESQUECI_SENHA`.

## Consequências
- O apps tira o link "Sou de uma empresa" e a tela `/config/entrar`. O login lembra só o código da empresa, nunca o e-mail ou a senha.
- O `LoginEntrada` valida o código como `CodigoEmpresaLogin` (UF + 4 dígitos ou `MACUXI`). Empresa com slug antigo, fora desse padrão, recebe 400 no login único. A API decide, antes do merge, se mantém a entrada antiga para esses slugs.
- A troca obrigatória (403 `TROCAR_SENHA`) leva a `/senha` ou a `/config/senha` pelo `destino`.

## O que sai
- `POST /v1/plataforma/auth/entrar` e `EntrarPlataformaEntrada`: ficam marcados `@deprecated` e saem numa versão seguinte, quando a web não os usar mais. Tirar a rota é mudança incompatível, avisada aos consumidores.
- A tela `/config/entrar` e o link "Sou de uma empresa".

## Referências
RN-CORE-12 e RN-CORE-13 (a registrar em `docs/produto/03`, que hoje vai até a RN-CORE-11) · ADR 0012 (portal `/config` e superadmin) · #466 (`docs/design/login-unico/README.md`) · `packages/platform-sdk/src/login.ts`, `esqueci-senha.ts`, `portal-config.ts` e `eu.ts`.
