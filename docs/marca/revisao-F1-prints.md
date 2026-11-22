# Revisão de marca — 7 prints do BKO da F1 (T-0008)

> Autor: design-de-marca · 21/11/2026, 22h37 (Manaus) · Tarefa T-0008 (fechamento da F1; doc 05: "BKO de cadastro com print revisado").
> **Veredito geral da F1: APROVADO COM RESSALVAS.** Cor, tipografia e hierarquia batem com a marca Macuxi. Nenhum achado fere o manual a ponto de segurar a F1. As ressalvas (M-01 a M-05) entram nas próximas entregas do shell.

## 1. Fontes conferidas
| Fonte | O que vale | Situação nesta sessão |
|---|---|---|
| Manual da marca do FDV (`aloirr/macuxifdv`, `docs/marca/manual.md`, aprovado em 12/11/2026) | Fonte única da marca | **Sem acesso** (HTTP 403). Usei o resumo do repo: comentários de `packages/ui/src/tokens.ts` (§3, §4, §5.1, §5.2, §5.3), `.coord/tarefas/T-0028.md` e a conferência com o FDV no PR #5 |
| `docs/marca/README.md` | Mesma marca do FDV; só o específico do ERP entra aqui | Lido |
| PR #5 (`docs/marca/assinatura-erp.md`, branch `nuvem/T-0023-assinatura-erp`) | Assinatura A (principal) + C (vertical), decisão do Alexandre de 21/11, 21h29 (Manaus). **Ainda não é regra**: o §6 ("ERP" de ponta a ponta ou à esquerda) está em aberto e os SVGs finais não existem | Lido |
| `packages/ui/src/tokens.ts` e `tokens.css` | Paleta, cores de situação, fontes, escala (12/13/15/17/20/24) e pesos (400 a 700) | Lido |
| `apps/web/src/app/globals.css`, `layout.tsx`, `(shell)/layout.tsx`, `nav-lateral.tsx`, `licencas/page.tsx`, `not-found.tsx`, `lib/marca.ts` | Como os tokens chegam à tela | Lido |
| `docs/design/` | — | Não existe |
| `docs/testes/T-0008.md` e `.coord/tarefas/T-0044.md` | D-03 e RD-0068 já abertos (não repito) | Lido |

Conferência de cor no próprio print, por amostra de pixel: faixa e barra superior `#1E3350` (azulNoite), menu `#16202A` (grafite), item atual `#2B3743` (grafiteMenu), fundo `#F8F6F1` (perola). Batem com os tokens, sem hex solto.

Contraste dos pares usados (WCAG): branco/azulNoite 12,77:1 · bordaCinza/azulNoite ("Trocar filial") 8,07:1 · solClaro/grafite (título de grupo) 7,56:1 · branco/grafiteMenu 12,14:1 · grafite/perola 15,26:1 · textoSecundario/perola 7,03:1 · verdeSucesso/ativoFundo ("Licenciado") 5,51:1 · textoSecundario/nevoa ("Não contratado") 6,53:1 · erroTexto/erroFundo 6,04:1. Todos acima de 4,5:1.

## 2. Tabela por print
Legenda: ✅ conforme · 🟡 ressalva · 🔴 fere o manual.

| Print | Cor | Tipografia | Logo / assinatura | Tom de voz | Hierarquia | Veredito |
|---|---|---|---|---|---|---|
| 01-login | ✅ faixa azulNoite, cartão branco sobre perola, botão principal azulNoite | ✅ título do cartão 20, rótulo 600, botão 600 | 🟡 só o nome em texto "Macuxi ERP" (provisório correto, sem logo inventado); falta a assinatura C e o favicon (M-01) | ✅ "Entrar", "Empresa", "E-mail", "Senha" | ✅ marca → título → campos → ação | 🟡 |
| 02-login-erro-outro-tenant | ✅ erro com erroTexto/erroFundo (6,04:1), sem vermelho fora do papel | ✅ | 🟡 como 01 (M-01) | ✅ "Empresa, e-mail ou senha incorretos." direto e sem revelar qual campo | ✅ erro acima dos campos | 🟡 |
| 03-selecionar-filial-tenant-a | ✅ | ✅ CNPJ com números tabulares; apoio em 13 | 🟡 como 01 (M-01) | ✅ "Selecionar filial", "Continuar" | ✅ | 🟡 |
| 04-inicio-tenant-a | ✅ barra azulNoite, menu grafite (§4), item atual grafiteMenu com filete solClaro, título de grupo solClaro | ✅ h1 24/700, item de menu 500, grupo 12/600 caixa alta | 🟡 nome em texto na barra; falta a assinatura A (M-01); a marca do cliente (razão social e filial) fica em texto normal, abaixo da Macuxi, sem competir ✅ | Texto do Início: já coberto por RD-0068 (T-0044) | 🟡 divisória do menu só após "Plataforma" (M-02); "Pedidos" dentro de Cadastros já coberto por D-03 (T-0044) | 🟡 |
| 05-licencas-tenant-a | ✅ selo verde só para situação; "Não contratado" neutro | 🟡 nome do módulo na linha em 700 (padrão do navegador para `th`), acima do peso de cabeçalho de tabela (M-05) | — (print recortado na tabela, sem barra nem menu) | 🟡 descrições com jargão técnico ao cliente: "tenant", "Hub /integracao/v1", "NT 2025.002-RTC", "Conector nativo em nuvem"; "FDV" solto no lugar de "Macuxi FDV" (M-04) | ✅ título → apoio → tabela | 🟡 |
| 06-sem-permissao-404 | ✅ | 🟡 título do cartão em 24 dentro do shell e em 20 no login (M-03) | 🟡 como 04 (M-01) | Texto "O endereço não existe ou o módulo não está licenciado…" para quem não tem permissão: já coberto por RD-0068 (T-0044) | 🟡 divisória curta antes de "Conta", diferente da divisória cheia após "Plataforma" (M-02) | 🟡 |
| 07-inicio-tenant-b-1024 | ✅ | ✅ mesma escala do 04 em 1024 px | 🟡 como 04 (M-01); marca do cliente B em texto, sem competir ✅ | Já coberto por RD-0068 (T-0044) | 🟡 divisória só após "Plataforma"; nada entre "Cadastros" e "Conta" (M-02) | 🟡 |

## 3. Achados
| ID | Onde | Tipo | Fere | Gravidade | Correção | Dono |
|---|---|---|---|---|---|---|
| **M-01** | Login (01–03), barra superior (04, 06, 07) e aba do navegador (`apps/web` não tem `icon`/`favicon`) | logo / aplicação | Manual do FDV, Aplicações (favicon, login, BKO); PR #5 §2 e §8.5 | média | Hoje: nome em texto "Macuxi ERP" (`apps/web/src/lib/marca.ts`), correto como provisório. Depois dos SVGs finais em `docs/marca/ativos/`: login com a assinatura C (empilhado positivo, centralizado acima do cartão ou na faixa); barra superior com a A em negativo azul-noite (descritor em `bordaCinza`); favicon só com o símbolo, a partir de 16 px; tamanho mínimo da assinatura 20 px de altura. Usar o arquivo oficial, sem redesenhar nem recolorir | designer-ux (spec em `docs/design/` e componente em `packages/ui`); depois engenheiro-apps aplica em `apps/web` |
| **M-02** | Menu lateral (04, 06, 07); `apps/web/src/app/globals.css:38` | aplicação / hierarquia | §4 (menu do BKO, divisória em grafiteMenu) e consistência entre telas equivalentes | baixa | Antes: `.lateral section + section, .lateral ul + h2` gera divisória cheia após "Plataforma", curta antes de "Conta" (06) e nenhuma antes de "Faturamento" e "Conta" (04, 07). Depois: uma regra só, toda seção de grupo separada da anterior pela mesma divisória `1px solid var(--mx-cor-grafite-menu)`, de ponta a ponta, sem margem lateral. Entra no mesmo PR do D-03 (T-0044), sem repetir o D-03 | engenheiro-apps |
| **M-03** | 404 dentro do shell (06); `apps/web/src/app/globals.css:25` × `:40` | tipografia | §5.3 e `papeis.tituloCartao` (20) | baixa | Antes: `.conteudo h1` (24) vence `.cartao-central h1` (20) por vir depois no CSS. Depois: título de cartão central em `var(--mx-tamanho-titulo-cartao)` em qualquer lugar (ex.: `.conteudo .cartao-central h1` ou mover a regra do cartão para depois) | engenheiro-apps |
| **M-04** | Licenças (05); texto vem de `modules/core/manifest.ts:6`, `modules/integracao-fdv/manifest.ts:6` e demais `descricao`; nome em `apps/web/src/lib/nomes-modulos.ts` | voz | Tom de voz da marca (sem jargão técnico com o cliente; nome de produto) | média | Descrição para o cliente, sem termo interno. Sugestões: Plataforma: "Empresa, usuários, perfis, licenças, histórico de alterações, arquivos e exportação dos seus dados (LGPD)." · Fiscal: "Regras de imposto por NCM, CFOP e CST/CSOSN: ICMS, ICMS-ST, IPI, PIS, COFINS e os novos IBS, CBS e IS." · Integração: "Liga o ERP ao Macuxi FDV: envia cadastros, títulos e situação dos pedidos e recebe os pedidos dos vendedores." · Pedidos: "Pedidos vindos do Macuxi FDV ou lançados à mão, com aprovação e acompanhamento." Nome do módulo: "Integração Macuxi FDV". O produto é sempre "Macuxi FDV", nunca "FDV" solto | engenheiro-apps (com modulo-core e modulo-integracao-fdv, donos do `descricao`, ou um texto de exibição no `apps/web`, como já existe em `nomes-modulos.ts`) |
| **M-05** | Licenças (05), coluna "Módulo"; `apps/web/src/app/globals.css:42-43` | tipografia | §5.2 (700 só em título) | baixa | Antes: `th scope="row"` em 700 (padrão do navegador). Depois: `tbody th { font-weight: var(--mx-peso-cabecalho-tabela); }` (600) | engenheiro-apps |

Fora do meu escopo, só registrado: o print 05 está recortado na tabela (sem barra nem menu). Para a marca basta, mas a próxima rodada da T-0008 pode tirar o print da tela inteira (testes).

## 4. Veredito
- **F1: aprovado com ressalvas.** Nenhum 🔴. As cores saem dos tokens e batem no pixel; contraste de todos os pares acima de 4,5:1; escala e pesos dentro do §5; a marca do cliente nunca compete com a Macuxi; o nome provisório "Macuxi ERP" está escrito do jeito certo (PR #5 §7.3).
- M-01 depende da T-0023 (o Alexandre decide o §6 do PR #5 e saem os SVGs finais). Não segura a F1: o texto provisório é a regra atual.
- M-02 a M-05 são ajustes pequenos; reteste no print da próxima rodada do shell.

## 5. Pedidos aos donos
Texto pronto para o gerente gravar. Cópia ao `gerente-projetos`.

**Para designer-ux — M-01 (média)**
| Contexto | O que preciso | Pronto quando |
|---|---|---|
| Revisão de marca dos prints da T-0008 (`docs/marca/revisao-F1-prints.md`): login, barra superior e aba do navegador mostram só o nome em texto "Macuxi ERP" (provisório correto). A assinatura A + C foi decidida pelo Alexandre em 21/11, 21h29 (Manaus), e segue em ajuste no PR #5 (T-0023) | Quando os SVGs finais estiverem em `docs/marca/ativos/`: a spec de aplicação em `docs/design/` e o componente de marca em `packages/ui`: login com a C (empilhado positivo), barra superior com a A em negativo azul-noite (descritor `bordaCinza`), favicon só com o símbolo (16 px), mínimo de 20 px de altura com a escrita, sempre pelo arquivo oficial | Spec e componente publicados, validados pelo design-de-marca no print; o engenheiro-apps recebe o pedido de aplicação no `apps/web` |

**Para engenheiro-apps — M-02, M-03, M-05 (baixa) e M-04 (média)**
| Contexto | O que preciso | Pronto quando |
|---|---|---|
| Revisão de marca dos prints da T-0008 (`docs/marca/revisao-F1-prints.md`). D-03 e RD-0068 já estão na T-0044 e não se repetem aqui | **M-02** `globals.css:38`: uma regra só de divisória no menu lateral, `1px solid var(--mx-cor-grafite-menu)` de ponta a ponta entre todo grupo (hoje cheia após "Plataforma", curta antes de "Conta" e ausente antes de "Faturamento"); pode ir no PR do D-03. **M-03** `globals.css:25`/`:40`: título do cartão central em `var(--mx-tamanho-titulo-cartao)` (20) também dentro do shell (hoje 24 no 404). **M-05** `globals.css:42-43`: `tbody th` em `var(--mx-peso-cabecalho-tabela)` (600), não 700. **M-04** Licenças: descrições sem jargão ("tenant", "Hub /integracao/v1", "NT 2025.002-RTC", "Conector nativo em nuvem") e "Macuxi FDV" no lugar de "FDV"; textos sugeridos no M-04 da revisão; combine com modulo-core e modulo-integracao-fdv (donos do `descricao`) ou use um texto de exibição no `apps/web` | Prints 04, 05, 06 e 07 refeitos com as quatro correções e revalidados pelo design-de-marca |
