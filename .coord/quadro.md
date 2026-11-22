# Quadro — Macuxi ERP

> Dono: gerente-projetos. Status: aberta → em_andamento → em_teste → em_revisao → concluida (ou bloqueada). Horários de Manaus.
> Fase atual: **F1 fechando, com F2, F3 e F4 em paralelo** desde 21/11, 22h57. Decisão do Alexandre de 22h59: "Abre tudo ao mesmo tempo. Sobre o certificado e homologação, simule elas para nao depender da thathyany." Previsão: doc 05, versão 2.
> Empresa piloto: **thathyany** (R-20261120-231848-gerente-projetos). Biblioteca NF-e: ADR 0002 opção A (R-20261120-231934-gerente-projetos).

| Tarefa | Título | Fase | Dono | Status | Onde |
|---|---|---|---|---|---|
| [T-0001](tarefas/T-0001.md) | F0 Fundação: estrutura, governança, guardião, recados, CI, docs 01–07, ADRs 0001–0005 | F0 | alexandre | concluida | PR #1 → 7e6c055 |
| [T-0002](tarefas/T-0002.md) | Desenho da F1 e contratos de core e cadastros (e ADR 0002 → aceita) | F1 | engenheiro-software | concluida | PR #4 → 165c5db |
| [T-0003](tarefas/T-0003.md) | Banco: papéis, schemas, RLS e tabelas oficiais (NCM, CEST, CFOP, CST, IBGE, cClassTrib) | F1 | banco-dados | concluida | PR #10 → 820cd28 |
| [T-0004](tarefas/T-0004.md) | API (Fastify), autenticação, licenças e worker base | F1 | engenheiro-software | concluida | PR #7 → 6e9ba49; PR #13 → 8a1d221 |
| [T-0005](tarefas/T-0005.md) | Shell do BKO (Next.js) com menu pelos manifestos | F1 | engenheiro-apps | concluida | PR #8 → 880b5f8 |
| [T-0006](tarefas/T-0006.md) | Core: empresa, usuários, perfis e certificado A1 (ADR 0005) | F1 | modulo-core | concluida | PR #14 → abcf95f |
| [T-0007](tarefas/T-0007.md) | Cadastros: clientes, produtos, preços, estoque, filiais, equipe e carteira, consultas CNPJ/CEP/IE | F1 | modulo-cadastros | concluida | PR #15 → 52c7b7e |
| [T-0008](tarefas/T-0008.md) | Testes da F1: RN, RLS e prints do BKO de cadastro | F1 | concluida | PR #58 → 46f9038; revisão dos prints: #65 → d6412b0 (marca) e #66 → 3aa804b (RD-0188 a 0190) |
| [T-0009](tarefas/T-0009.md) | Desenho do mapeamento ERP → Hub do FDV | F2 | engenheiro-software | concluida | PR #29 → 570566c; P-2 = opção A (21h45) |
| [T-0010](tarefas/T-0010.md) | Banco: schema integracao_fdv | F2 | banco-dados | concluida | PR #38 → 9f1d952 (0007 fora de ordem conferida) |
| [T-0011](tarefas/T-0011.md) | Conector nativo: lotes, cursor, fila, sinal e monitor | F2 | modulo-integracao-fdv | em_andamento | L1 #78 → e43fff9; C-9 #77 → 7e99fa8; L2a #123 (f041f4b) verde, segurado até o PR curto do testes que troca o it.fails do A-01 no arnês da T-0012; 0018 #122 → 13c90c7; L2b 2h00 (RD-0318, sem condicao_ausente); L3 5h45; total 18h41 |
| [T-0012](tarefas/T-0012.md) | Integração ida de ponta a ponta com tenant de teste do FDV | F2 | testes | em_andamento | arnês #117 → e7399e0 e corretor #119 → 9ef764a (93 verdes no dublê); rodada real PENDENTE (tenant, chave e virada); PR curto do A-01 junto com o #123 |
| [T-0013](tarefas/T-0013.md) | Desenho do pedido e do retorno ao FDV | F3 | engenheiro-software | concluida | #73 → 77c9e8a; emenda + ADR 0010 #96 → 038a20f; ajuste do §3.1 (à vista = forma E prazos 0) pedido |
| [T-0014](tarefas/T-0014.md) | Banco: schema pedido | F3 | banco-dados | concluida | #85 → 270cceb (0012); desvio: external_id único por tenant (RD-0226) |
| [T-0015](tarefas/T-0015.md) | Pedido: manual, validações e aprovação | F3 | modulo-pedido | em_andamento | #81, #87, #88 → 8104041; consulta do cadastros #93 → 23ff3c7; lote 2 #110 → c967a4d; componentes #118 → c7735e6; SDK formatar #124 → 6ae5a29; lote 3 telas #114 (CI a rodar de novo); 3b e 1d em seguida; total 17h27 |
| [T-0016](tarefas/T-0016.md) | Receber pedidos do FDV e devolver status | F3 | modulo-integracao-fdv | em_andamento | #82 → 103789e; #94 → 699b69b (conserto do main); #98 → e7bfad5; parte 2 #109 → 9b94b49; resolvedor #115 → cac028c; ligações no worker com o engenheiro (PR A 4h31; PR B 58 min depois do L2a) |
| [T-0017](tarefas/T-0017.md) | Pedidos: ida e volta de ponta a ponta | F3 | testes | em_andamento | session_019xHEXpSk5oe7qqKx4ZuKQx; real só na Etapa 9 do roteiro (virada de pedidos); 6h54 |
| [T-0018](tarefas/T-0018.md) | Spike da biblioteca NF-e (ADR 0002), contra o simulador | F4 | engenheiro-software | em_andamento | etapas 1 e 2 prontas: porte do sped-nfe em packages/nfe-emissor, PL_010g e NT v1.53 por fontes secundárias; etapa 3 depois do PR da T-0045 |
| [T-0019](tarefas/T-0019.md) | Banco: fiscal, faturamento, numeração sem buraco e XML imutável | F4 | banco-dados | em_andamento | session_019xHEXqpp9QB2Vtw6amSVuR; 0013/0014 com as 11 tabelas e 10 consultas do faturamento e a fiscal.regra_tributaria; 6h55 |
| [T-0020](tarefas/T-0020.md) | Fiscal: motor ICMS, ST, IPI, PIS, COFINS, IBS, CBS e IS | F4 | modulo-fiscal | em_andamento | #83 → 6f90ef5; #91 → 10122ff; lote 3 (IBS/CBS/IS, meio-para-par) e lote 4 (CST 60/CSOSN 500 com ST retido, CST 51); total 20h42 |
| [T-0021](tarefas/T-0021.md) | Faturamento: NF-e 55, eventos, DANFE, contingência, títulos | F4 | modulo-faturamento | em_andamento | #89 → e201c93 (lote 1a); lote 1b #99 → b0c4854; lote 1c (repositório SQL, rotas, worker com a porta real do nfe-sefaz) depois da 0013 (#121) |
| [T-0022](tarefas/T-0022.md) | 20 notas no simulador da SEFAZ-AM com o XML guardado | F4 | testes | em_andamento | #86 → 6132984 (plano e arnês); lote 2 #125 → 2a8df03 (transporte real do simulador, CNPJ no SAN em it.fails até o RD-0294); N01–N20 com o produto depois da T-0021 |
| [T-0023](tarefas/T-0023.md) | Assinatura "Macuxi ERP" da marca (proposta ao Alexandre) | F1 | design-de-marca | em_revisao | PR #5: A principal e C vertical (decisão de 21/11, 21h29); design-de-marca ajusta |
| [T-0024](tarefas/T-0024.md) | Deploy do ERP na VM do FDV com trava compartilhada (ADR 0003) | F1 | engenheiro-software | em_revisao | #51, #31, #54 e #40 (governança, 8f26661) no main; pronto para o pedido de deploy quando o Alexandre criar .env, secrets, DNS e rota |
| [T-0025](tarefas/T-0025.md) | coord.mjs: gravar recado por git quando a API recusar a escrita na nuvem | F1 | concluida | PR #27 → 31b7253 (R-20261121-213740-alexandre); ADR 0004 no PR #30 |
| [T-0026](tarefas/T-0026.md) | Carga inicial dos cadastros da thathyany pelos CSVs do kit | F1 | modulo-cadastros | concluida | #26, #28, #35, #49, #61, #63 e #64 → 40d3fa6; real ≈5h35 × 13h22; parcelas pela RN-CAD-09 |
| [T-0027](tarefas/T-0027.md) | Virada do conector da thathyany: kit do FDV sai, conector nativo do ERP entra | F3 | modulo-integracao-fdv | em_andamento | roteiro único em docs/status/2026-11-21-roteiro-virada-thathyany.md (decisão de 23h22, opção B) |
| [T-0028](tarefas/T-0028.md) | Tokens da marca em packages/ui (cores, situação, escala tipográfica) | F1 | designer-ux | concluida | PR #12 → 4c4d46f |
| [T-0029](tarefas/T-0029.md) | Integração de plataforma da F1 (módulos na API, multipart, worker, helpers comuns) | F1 | engenheiro-software | concluida | PR #19 → 64ca207 |
| [T-0030](tarefas/T-0030.md) | Troca da filial para produção fiscal só com a aprovação do Alexandre conferida (regra 7) | F1 | engenheiro-software | concluida | #24, #25, #45 → 3373fab, #46 → 5534fc6, #47 → 5580830, #56 → 267b8bb (e2e) |
| [T-0031](tarefas/T-0031.md) | Core: resíduos da revisão do PR #14 (RD-0008, RD-0009, lint e teste de banco da concorrência) | F1 | modulo-core | concluida | PR #18 → 65a25f3 |
| [T-0032](tarefas/T-0032.md) | Banco: updated_at estritamente crescente por linha (token de concorrência) | F1 | banco-dados | concluida | PR #20 → ee17b80 |
| [T-0034](tarefas/T-0034.md) | Cadastros: versão crescente por agregado nos eventos (D6; hoje tudo sai com versao 1) | F1 | engenheiro-software | concluida | #39 → 02d8311, #52 → c839e82, #55 → fee4f07 |
| [T-0036](tarefas/T-0036.md) | coord.mjs: melhorias da revisão do PR #27 (credencial na URL do erro, GIT_TERMINAL_PROMPT, 403 de limite, leitura atrasada) | F1 | alexandre | aberta | quando o Alexandre pedir |
| [T-0037](tarefas/T-0037.md) | Cadastros pelo SDK: cursor, CSV, filtros, naoEncontrado e ExportadorModulo LGPD (ligação da F1) | F1 | modulo-cadastros | concluida | #43 → 7a72192, #44 → a57cb80 |
| [T-0038](tarefas/T-0038.md) | Testes: MACUXI_DB_MIGRACOES no rodar-antes-do-push (ligação da F1) | F1 | concluida | dentro do PR #58 |
| [T-0039](tarefas/T-0039.md) | Shell do BKO: listas pelo platform-sdk/listas (CSV, filtros na URL, proximo_cursor) | F1 | engenheiro-apps | concluida | #37 → 842804b |
| [T-0040](tarefas/T-0040.md) | Core e worker: multipart do A1, listas pelo SDK, exportação LGPD, avisos e rotinas reais (ligação da F1) | F1 | modulo-core | concluida | #42, #57 e #59 → f94838d; o shell exibir o aviso está na T-0044 |
| [T-0035](tarefas/T-0035.md) | Alerta do A1: adaptadores SQL de FonteCertificados.vencendoAte (limite exclusivo) e DestinoAvisos (UNIQUE certificado e dia) | F1 | modulo-core | concluida | #34 → 8c7f6cd, #42 → 410e8a8, #57 → 1ace025 |
| [T-0041](tarefas/T-0041.md) | SDK: descritor comum de página de lista (lacuna c do PR #37, RD-0121) | F1 | engenheiro-software | concluida | #50 → 4660b89, #53 → d9165ab |
| [T-0042](tarefas/T-0042.md) | API: dependências de produção numa função só e helper appPgDeTeste (achados A-06 da T-0008 e A1 da T-0030) | F1 | engenheiro-software | concluida | #70, #75, #79; adoção do RD-0178: cadastros #95 → 1e9cb67; core e shell por recado |
| [T-0043](tarefas/T-0043.md) | Banco: 🟡 do #34 (filial_id × certificado, CHECK de dias, aviso na fixture) e índice (tenant_id, agregado_id, versao) em plataforma.evento (0011) | F1 | banco-dados | concluida | #69 → 0e8bd94 (0011) |
| [T-0044](tarefas/T-0044.md) | Defeitos da T-0008: D-02 (menu sem página), D-05 (estoque fora do contrato de listas), D-06 (filial nos vendedores), D-03/A-04/RD-0068 (shell) | F1 | engenheiro-apps | concluida | #71 → 14a6b11, #72 → 24616d7, #80 → b45129e, #84 → 491156e |
| [T-0045](tarefas/T-0045.md) | Simulador da SEFAZ-AM em homologação e A1 de teste (ADR 0008) | F4 | engenheiro-software | em_revisao | session_019xHEXobzuxryzKvBKH2J23; packages/nfe-sefaz (55 cStat, XSD PL_010g, XMLDSig, A1 de teste, trava da regra 7), ADR 0008; push depois do corretor; leitura do A1 decifrado com o core (session_019xHEXsahPu9EFJpT98GVgG) |
| [T-0046](tarefas/T-0046.md) | Homologação real na SEFAZ-AM (antes da F5) | F5 | testes | bloqueada | credenciamento da thathyany e A1 dela |
| [T-0047](tarefas/T-0047.md) | Governança: 🟡 da revisão do #48 (gh pr merge sem corte de nuvem, regex do add_repo, trailer Agente no penúltimo bloco) | F1 | alexandre | aberta | quando o Alexandre pedir |
| [T-0048](tarefas/T-0048.md) | Atualizar o zod para >= 4.6.6 (GHSA-mrhx-c7xc-m3w5) | F4 | engenheiro-software | aberta | achado da revisão da T-0045 |
| [T-0033](tarefas/T-0033.md) | Core: expor lerChaveA1 e as funções de validade do A1 pela api (destrava o PR #19) | F1 | modulo-core | concluida | PR #22 → cba7f5f |

## Travado pela nuvem (21/11, 23h00)
Gerente ativo: session_019xHEXorMcUM7hAvrbsGwJd. PO: session_019xHEXqMSs1piLUgLS4zYxV.
| Sessão | Caminhos |
|---|---|
| T-0011 L1 (session_019xHEXr5HoPcRW2ToGZSt5W) e C-9 (session_019xHEXoushQXrzBsftxmqQ9) | `modules/integracao-fdv/`; `apps/worker` |
| T-0016 (session_019xHEXpxZD8x6Yz2EtufbWb) | `modules/integracao-fdv/` (recebimento e retorno, arquivos próprios) |
| T-0014 (session_019xHEXqmyz5qDWenDkdwgHm) e T-0019 (session_019xHEXqpp9QB2Vtw6amSVuR) | `db/` (0012; 0013 e 0014) |
| T-0015 (session_019xHEXqr2ZzdHZXTk6hx7F2) | `modules/pedido/` |
| T-0020 (session_019xHEXsQMYW7aYDvYJNWoSk) | `modules/fiscal/` |
| T-0021 (session_019xHEXp6WA4p3cY3CAqPdXS) | `modules/faturamento/`, `docs/modulos/faturamento/` |
| T-0045 e T-0018 (session_019xHEXobzuxryzKvBKH2J23) | `packages/sefaz-simulador` e o pacote da NF-e; `docs/decisoes/` (0008, 0009) |
| T-0042 RD-0178 (session_019xHEXqFwTvfmEcLabGfWN6) | `packages/platform-sdk` |
| testes: T-0044 (session_019xHEXpiLCEwxWWS4KMA7Rk), T-0012 e T-0017 (session_019xHEXpSk5oe7qqKx4ZuKQx), T-0022 (session_019xHEXrwCf5UrGFMh2zUCck) | `tests/`, `docs/testes/` (uma subpasta por tarefa) |
| T-0044 (session_019xHEXpmsXLKSdMnDhuJJVr) | `apps/web`, `modules/cadastros/` (#71, #72) |
| T-0023 (session_019xHEXsi68pkRSBNcRmrmW9) | `docs/marca/` (PR #5) |

## Reservas
- ADR: 0001–0005 usadas; 0006 reservada para a T-0030 (21/11). Migrações: 0007 T-0010, 0008 T-0030, 0009 T-0035, 0010 T-0026, 0011 T-0043, 0012 T-0014, 0013 e 0014 T-0019, 0015 T-0011 (espelho erp_id, config do conector e conflito_chave), 0016 pedido (a_vista, CHECKs do FDV, endereço do retrato), 0017 parcelas_cartao com CHECK permissivo (#116), 0018 referencia.dados.chave (#122), 0019 reservada ao banco-dados (invariante estrita das parcelas do cartão NOT VALID, depois das formas do cadastros e da limpeza, e COMMENT de pedido.a_vista = fora do crédito); próxima livre: 0020. ADR 0007 T-0013 (no main), 0008 T-0045, 0009 T-0018 (se precisar), 0010 external_id no Hub (emenda da T-0013); próxima ADR livre: 0011.
- Tarefas: T-0001–T-0048 usadas; próxima livre: T-0049.
- Achados do corretor (RD): reservados pelo gerente antes de numerar. RD-0020–0022 T-0033 (PR #22); RD-0023–0026 T-0030 (PRs #24 e #25); RD-0027–0033 T-0026 (PR #26, renumerar os RD-0025–0031); RD-0034–0040 T-0029; RD-0041–0047 T-0024; RD-0048–0054 T-0009; RD-0055–0061 T-0010; RD-0062–0068 T-0008; RD-0069–0072 T-0023; RD-0073–0079 T-0034; RD-0080–0086 T-0035; RD-0087–0089 ADR 0004 (T-0025); RD-0090–0096 T-0030 etapa 2; RD-0097–0105 T-0026 etapa 2; RD-0106–0110 T-0040; RD-0111–0115 T-0037; RD-0116–0118 T-0038; RD-0119–0123 T-0039; RD-0124–0128 T-0041; RD-0129–0133 T-0034 etapa 2 (#55); RD-0134–0135 T-0040 (#59); RD-0136–0145 T-0026 fase B; RD-0146–0149 T-0026 (#61, #63); RD-0150–0159 T-0011; RD-0160–0164 T-0013; RD-0165–0172 T-0042; RD-0173–0177 T-0043; RD-0178–0187 T-0044; RD-0188–0195 revisão dos prints da F1 (0188–0190 usados); RD-0196–0200 T-0011 C-9; RD-0201–0205 revisão do #48; RD-0206–0220 usados pelas sessões da onda 3 (0211–0212 na ADR 0004, #75); RD-0221–0225 T-0012; RD-0226–0230 T-0014; RD-0231–0240 T-0015; RD-0241–0247 T-0016; RD-0248–0252 T-0017; RD-0253–0257 T-0018; RD-0258–0262 T-0019; RD-0263–0272 T-0020; RD-0273–0287 T-0021; RD-0288–0292 T-0022; RD-0293–0300 T-0045; RD-0301–0303 emenda da T-0013; RD-0304–0308 cadastros (consulta para o pedido e RD-0178); RD-0309–0311 SDK do pedido (#87); RD-0312–0316 T-0015 lote 1b; RD-0317–0319 ADR 0010; RD-0320–0322 migração 0015; RD-0323–0326 cadastros RD-0178; RD-0327–0329 T-0015 lote 1c; RD-0330–0332 migração 0016; RD-0333 #97; RD-0334–0336 eventos e SDK (C-10, titulo.baixado@1); RD-0337–0339 T-0020 lote 4; RD-0340–0342 cadastros à vista; RD-0343–0350 core (A1 decifrado, RD-0178, cifra); RD-0351–0352 T-0013 §3.1; RD-0353–0366 T-0015 lote 2; RD-0367–0386 T-0021 lotes seguintes; RD-0387–0389 cadastros endereços; RD-0390–0392 cadastros resolvedor; RD-0393–0397 cadastros formas; RD-0398–0400 T-0015 classeForma; RD-0401–0403 migração 0017; RD-0404–0409 T-0015 lote 3; RD-0410–0415 shell do pedido; RD-0416–0419 packages/ui do pedido; RD-0420–0422 migração 0018; RD-0423–0425 cadastros imutabilidade do external_id; RD-0426–0429 SDK formatar e formas (#124); RD-0430–0432 T-0015 lote 3b; RD-0433–0436 packages/ui ajustes de marca (MC-0006 a MC-0017); RD-0437–0439 cadastros/web aviso de troca; RD-0440–0448 T-0022 lote 2 (renumerados de RD-0301–0309, que colidiam); próxima livre: RD-0449. Sessão que vai numerar pede a faixa ao gerente por send_message.

## Regras de operação (21/11, 21h51; atualizadas às 22h41)
- Decisão de 22h41 (R-20261121-223923-alexandre): o Alexandre não aprova mais nada no GitHub. Merge de governança e aprovação de deploy saem pela sessão do PO, com o pacote preparado pelo gerente (resumo de governança, ou pedido de deploy com versão, SHA, suíte completa verde, CI do main e issue). Ao Alexandre vão só tela, texto, design e funcionalidade.
- Recados sempre pelo coord.mjs direto no aloirr/macuxierp-recados; nada de pasta local nem MACUXI_RECADOS=local.
- PR comum entra por merge do gerente pela regra do doc 07 (CI do PR e do main verdes, verificar OK, corretor e engenheiro sem 🔴, squash com Head-SHA e Agente), sem autorização do Alexandre (decisão de 21h51). Governança, deploy e produção fiscal continuam com a frase literal dele.
- PR não toca no `.coord/diario/<dono>.md`: a linha vai no corpo do PR ("Linha do diário") e o dono grava em lote num PR só de diário quando a fila esvaziar.
- Faixas de RD e números de migração são reservados no quadro antes de usar.
- Regra nova (22/11, 00h05, depois do main vermelho entre o #88 e o #94): PR que muda `contracts/` entra sozinho; o PR seguinte que consome o contrato só entra com o CI rodado de novo sobre o main novo (ou o typecheck do merge local conferido pelo gerente).

## Depende do Alexandre
- Roteiro da virada da thathyany (`docs/status/2026-11-21-roteiro-virada-thathyany.md`): Etapa 0 (criar o Conector `macuxierp` e gravar a chave pelo formulário seguro) pode ser feita agora; Etapa 1 = .env, secrets, DNS, deploy e carga da thathyany no ERP.
- Decididas: 23h55 (à vista por forma; FDV sem condição = rejeitado_erp; à vista fora do limite), 00h15 (IBS/CBS/IS meio-para-par), 00h30 (recusa de cadastro opção A; à vista = forma E prazos 0).
- T-0046 (homologação real, antes da F5): credenciamento da thathyany na SEFAZ-AM e A1 dela pela tela do BKO.
- Governança: scripts/cadastros/*.test.mjs no ci.yml (T-0026).
> Decisão de 21/11, 21h29 (Manaus): "SEGUIR COM O RECOMENDADO" (`docs/status/2026-11-21-decisoes-alexandre.md`).
- Secrets do GitHub, `.env` de produção (com `MACUXIERP_CHAVE_A1`, 32 bytes, obrigatória), DNS e rota `erp.` no túnel: preparar agora (lista na seção 2). O deploy só sai com "aprovo deploy vX.Y.Z".
- Pedido ao time do FDV: só o `flock` no `implantar.sh`. O tenant de teste saiu (decisão de 23h22: teste na thathyany).
- Credenciamento da thathyany na SEFAZ-AM e A1 de homologação pela tela do BKO (seção 4): saiu do caminho da F4 (decisão de 22h59) e agora destrava a T-0046.
- Ambientes por papel (decisão de 21h47, opção A): MacuxiERP-engenheiro-software, -banco-dados, -testes, -corretor-redundancias e -design-de-marca criados. Faltam 8 (designer-ux, engenheiro-apps e os 6 módulos), que seguem no MacuxiERP-GP até o Alexandre liberar espaço.
- Governança: MACUXI_DB_MIGRACOES no job de testes do CI, junto com o PR do `producao-publicar.yml`.
- T-0024: autorizar, na sessão dela, o push dos branches nuvem/T-0024-web e nuvem/T-0024-corretor.
- PR de governança do `producao-publicar.yml` (compose no sparse-checkout e scp; sem túnel, FCM, recados e build-args do web), descrito no PR #31.
- Pendência aberta: aceitar ou não um "produto incompleto" (sem NCM) na carga da T-0026. Se aceitar, muda o contrato e pede ADR.


## Próximos lotes (doc 05, versão 2)
> 21/11, 23h00 (Manaus): F2, F3 e F4 em paralelo (decisão de 22h59). 23h10–23h22: pedido do FDV entra aprovado; crédito à vista sem análise; FDV real, na thathyany, por virada entidade por entidade com o external_id do kit.
1. Entraram em 22/11, 00h20–00h31 (Manaus): #113, #99, #115, #116 (0017), #117, #118, #119, #120, #122 (0018), #124 e #125 (main 2a8df03, typecheck 16/16). Segurados: #123 (espera o PR curto do A-01 do testes), #114 (CI de base antiga, push novo pedido), #121 (0013, conflito com a 0017 em db/testes/apoio.ts, banco-dados resolve). Entraram às 00h10: #98, #96, #97, #91, #93, #95 (main 1e9cb67, typecheck verde). Antes: #92, #94 (conserto). Fila (23h50, histórico): #77 e #82 (juntando o main), lote 1b da T-0015, consulta do cadastros, emenda da T-0013 + ADR 0010, 0015, simulador (T-0045), 0013 (T-0019) e #5 (marca). Entraram às 23h30: #74, #75, #76, #78, #79, #81, #83, #84, #85, #86 e #87.
2. Marcos: 1ª nota autorizada no simulador a partir de um pedido manual em 22/11, por volta das 14h00 (teto às 18h00); F3 contra o dublê em 22/11, 16h00; F4 (20 notas no simulador) em 23/11, 12h00.
3. Pendentes de fora: Etapas 0 e 1 do roteiro da virada (Conector `macuxierp`, chave, .env, secrets, DNS, deploy e carga da thathyany no ERP); credenciamento e A1 da thathyany (T-0046).
4. Depois da F3 e da T-0024: T-0027.
