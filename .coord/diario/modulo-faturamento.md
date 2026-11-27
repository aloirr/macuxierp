2026-11-24 — T-0088 — tela da bandeira de faturamento real com NF-e simulada (descritores web, testes, prints)
2026-11-24 — T-0093 — porta pedidosComNotaOuTitulo (portal_pedidos_com_uso, 0063) e PedidosComUsoFaturamento para o Zerar (RN-CAD-10)
2026-11-25 — T-0093 — status cancelado do pedido a faturar fora da fila (RN-CAD-10): filaAceitaNota no domain, statusNaFila na porta e emissão recusa linha cancelada (422 RN-CAD-10); enum/rótulo/filtro da fila já cobriam 'cancelado'; db test do caso 0065 não escrito (função nova).
2026-11-26 — T-0093 — db test do descarte do a faturar (portal_descartar_a_faturar, RN-CAD-10) e PedidosAprovados.obter com status numa consulta, sai statusNaFila (RD-1954); 550 testes do módulo verdes.
2026-11-27 — T-0101 — ConsultaNfeProducao do core (RN-CORE-16): criarConsultaNfeProducao lê faturamento.nota (5 status, só produção, RLS); corretor numa rodada (RD-a..d aplicados); 558 testes do módulo verdes com Postgres.
