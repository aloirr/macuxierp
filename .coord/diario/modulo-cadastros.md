2026-11-21 — T-0007 — Cadastros completo (contracts, domain, api e web). Domain: RN-CAD-01 a 08, D7 (carteira) e D8 (filial) em funções puras com teste. API `/v1/cadastros`: filiais, clientes (endereços, contatos, limite só adm/gerente, vendedor só na própria carteira), produtos (unidades, NCM/CEST vigentes), tabelas de preço (PUT em lote até 5.000, preço vigente com queda na filial padrão), estoque e movimentos (negativo só adm/gerente), condições de pagamento, vendedores, transferência de carteira, consultas CNPJ/CEP (sugestão, BrasilAPI/ViaCEP com reserva, timeout 5 s, cache 24 h sem sócios nem CPF), IE (202, 422 RN-CORE-06 sem A1) e tabelas oficiais só leitura; eventos na outbox e auditoria (A). Adaptador SQL testado com PostgreSQL real (MACUXI_DB_MIGRACOES). Web: páginas do BKO como dados (colunas, filtros na URL, CSV, permissões). Previsão do doc 05 (16h06) mantida. Recados no corpo do commit (caixa 403 até a T-0025): pedidos ao engenheiro-software (montar o plugin em apps/api/src/modulos.ts; ErroApi com 503; turbo inputs para o teste de banco), ao modulo-core (porta do A1 por filial; payload de core.usuario.alterado@1) e ao testes (rodar sql.db.test.ts no CI).
2026-11-21 — T-0007 — correções da revisão do PR #15: CNPJ da consulta via validarDocumentoCliente, testes duplicados removidos, auditoria do limite de crédito, RN-CAD-03 (endereço principal) e RN-CAD-06 (vigência) no domain
2026-11-22 — C-10 — external_id de unidade, preço e endereço nos eventos (ADR 0010)
2026-11-22 — T-0021 — consumidor de estoque das notas (autorizada baixa, cancelada devolve)
2026-11-22 — T-0021 — campos fiscais da filial e do produto, consulta para o fiscal
2026-11-22 — T-0021 — regime PIS/COFINS obrigatório na filial CRT 3
2026-11-23 — T-0051 — carga por entidade: modelo CSV, aviso de dependência e entidade única
2026-11-23 — T-0051 — entidade_faltante no CARGA_DEPENDENCIA
2026-11-23 — T-0051 — manifest do cadastros usa os PERFIS do SDK (RN-CORE-09)
2026-11-23 — T-0053 — textos da regra A0 no cadastros (RD-1064, 1066–1069, 1080)
2026-11-23 — T-0058 — mensagens fiscais (RN-CAD-04) com o código e a ação na carga
2026-11-23 — T-0058 — planoSubstituicao (substituir tudo inativa o que falta)
2026-11-23 — T-0058 — carga no /config: adicionar e substituir tudo, menu fora do BKO
2026-11-23 — T-0058 — substituir_tudo reativa na carga seguinte (ativo=sim por padrão) e não inativa existente sem external_id (sem_chave)
2026-11-23 — T-0058 (WIP) — reativação no ponto comum da carga (carga-reativar.ts, chamado no executarCarga) e testes forma × prazo
2026-11-23 — T-0058 (WIP) — carga do portal no por_etapa: rotas validar/gravar (iniciar → comTenant → concluir), estoque 400 por substituirPermitido, testes unitários e de banco
2026-11-23 — T-0058 — hotfix: situação, modelo e erros da carga no /config
2026-11-23 — T-0058 — v0.3.7 item 1: nenhuma carga depende de outra
2026-11-23 — T-0058 — v0.3.7 -5: cadastros nos 8 nomes do SDK (situação sem depende_de e liberada; carga com ponte condicao_pagamento→prazo_pagamento até a cadastros-c; zerar com cliente absorvendo o endereço); 6 testes de banco do zerar aguardam a lista de 8 nomes na 0043/0044 (banco-dados)
2026-11-23 — T-0058 — carga: cliente.csv com endereços (tipo_endereco, seq) e condicoes_pagamento.csv (forma e prazo na mesma linha); 8 arquivos; cliente_endereco, forma_pagamento e prazo_pagamento ignorados com aviso
2026-11-23 — T-0058 — Substituir tudo do cliente (endereços ausentes inativados junto) e da condição de pagamento (carga-substituir.ts, substituicao-cliente.ts); rebase sobre o #412
2026-11-23 — T-0058 — Substituir tudo do portal liga cliente e condicao ao carga-substituir; mapa unico TABELA_SUBSTITUIVEL; DEPENDENCIAS do domain removido; testes ajustados ao modelo de condicao
2026-11-23 — T-0058 — v0.3.6 item 2: rebase no 84da1f5 e achados RD-1203/1204/1205 (aplicarSubstituicao genérico em carga-substituir.ts, paiDe, comUso, dadosDaForma, seq único, testes enxutos, README)
2026-11-23 — T-0058 — v0.3.7: o -5 (cadastros-a, 6497493) e a carga de cliente/condições (ee70d35) viraram um PR só, num commit; a ponte ENTIDADE_DO_PIPELINE saiu e o pipeline usa os 8 nomes pelo paraEntidadeCarga
2026-11-24 — T-0059 lote E — validação do pré-cadastro do FDV (domain/pre-cadastro-fdv) e porta CriadorClienteFdv (api/criador-cliente-fdv), com testes de domínio e de banco
2026-11-24 — T-0059 — lote E: parecer do corretor RD-1625 a RD-1632 (validarClienteNovo compartilhado POST/criador, chaves do pré-cadastro, códigos de município, limites pelos schemas)
2026-11-24 — T-0088 — lote C: lista única de clientes e produtos no PAGINAS (parecer do corretor), edição de preços e filiais
2026-11-24 — T-0085 — lote A: correções do parecer do corretor RD-1530 a RD-1545
2026-11-24 — T-0088 — lote C: limite de crédito fora do corpo do faturista (criação e PATCH); merge do main preservando prazos (#538)
2026-11-24 — T-0085 — 365/24 só na entrada; entidade/evento @1 (condição e cliente) aceitam legado 999 dias/36 parcelas
2026-11-24 — T-0097 — fração só em KG e M (RN-CAD-17): quantidadeAceitaFracao/validarFracaoDaQuantidade em contracts; validação no fator da unidade, no movimento de estoque e na carga de estoque
2026-11-26 — T-0112 — RN-CAD-15: prazo médio digitado dentro da faixa das parcelas (domain, POST/PATCH 422, carga, web)
