# Backlog — Macuxi ERP

> Só entra aqui o que o Alexandre mandou para o backlog com a palavra "backlog" (chat ou recado). Dono: gerente-projetos.

## Fora da v1 (prompt de abertura, seção 1) — entram só com "backlog" escrito do Alexandre
- Compras
- Contas a pagar completo
- Contabilidade
- SPED
- NFC-e
- NFS-e
- Produção
- App mobile
- Notas recebidas (Distribuição DF-e) — citada como fase 2 no prompt de abertura
- Telegram no repositório de recados (como o do FDV)

## Mandados ao backlog pelo Alexandre (pelo PO)
- 27/11 — **T-0113 — API pública e documentada de saída do ERP para qualquer força de vendas** ("49) A backlog", ~10h22, recado do PO após o R-20261127-101915). Outra força de vendas, que não o Macuxi FDV, lê os cadastros do ERP e envia os pedidos por essa API.
- **Conector para MySQL** (cenário B, ADR 0014, "a confirmar"): decisão do Alexandre "A (backlog)" às ~18h15 de 24/11 (R-20261124-181533). Só entra quando houver cliente com MySQL. Estimativa da ADR 0014 §16, com +15%: engenheiro-software 345 min, banco-dados 207 min, testes 104 min.

## Mandados ao backlog pelo Alexandre (23/11, pelo PO)
- **T-0079** — cadeia ICP-Brasil obrigatória para o A1 em produção (22h17). Hoje o upload aceita A1 autoassinado; a produção fiscal já recusa o A1 de teste (0047).
- **Fumaça em produção** (21h41) — usuário só de leitura na AM2808 e os secrets FUMACA_EMAIL, FUMACA_SENHA e FUMACA_EMPRESA_ID. O passo do #456 fica no main, desligado; a conferência das telas depois de cada publicar segue manual (PO e Alexandre).
