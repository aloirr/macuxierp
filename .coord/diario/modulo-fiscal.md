2026-11-22 — T-0021 — adaptador CalculoFiscal (fiscal/api) sobre fiscal.calculo@1, CFOP puro, leitura de regras/IBPT com RLS
2026-11-22 — T-0021 — ajustes da revisão (RD-0529/0530/0531): cfop e ind_ie_dest no domain, ResultadoCalculoFiscal em contracts, CFOP incoerente vira REGRA_INCOMPLETA
2026-11-22 — T-0021 — CFOP por item pela produção própria do produto (porta producaoPropria, domain/cfop, calculo)
2026-11-22 — T-0021 — CFOP por item pela produção própria (ConsultaEmitenteFiscal.producaoPropria): fabricado 5101/6101/6107/5401/6401, revenda 5102/6102/6108/5403/6403; RD-0628 a RD-0630 aplicados; revisão do engenheiro aprovada.
2026-11-28 — T-0132 — contrato fiscal.calculo@1: ST e IPI por regra opcionais (RN-FIS-05), fixtures e testes
2026-11-28 — T-0132 — passo 2: motor preenche regra_aplicada, calc_st e calc_ipi (63 A), API revalida; 206 testes do fiscal verdes
2026-11-28 — T-0127 — regras fiscais no BKO: contrato do catálogo e CRUD (ajustar_mva sem default), domain (validação, catálogo sem ST interestadual, resolução), rotas /v1/fiscal/regras e /catalogo com fiscal.regra.alterada@1, descritores web; 245 testes do fiscal verdes
