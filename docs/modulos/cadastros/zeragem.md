# Zerar dados por cadastro (v0.3.5) — desenho

Status: desenho, domain e testes. Sem API, web ou contrato ainda. A RN é `RN-CAD-10` (doc 03, PR #381).
Código: `modules/cadastros/domain/zeragem.ts` (função pura `planoZeragem`) e `zeragem.test.ts`.

## Objetivo
O superadmin zera um cadastro (por exemplo, para recarregar a base na migração) sem quebrar pedido, título nem nota. O domain só **planeja**: recebe fatos injetados e devolve o que apagar, o que anular e o que fica. A API executa, na ordem do plano, numa transação, e revalida os fatos.

## Cadastros e cascata (ordem de DELETE, filhos antes do pai)
Tabelas de `db/migrations/0004_cadastros.sql`. A carteira não tem tabela: é `cliente.vendedor_id` (D7).

| Cadastro | Apaga, nesta ordem |
|---|---|
| produto | estoque_movimento, estoque_saldo, tabela_preco_item, produto_unidade, produto |
| cliente | cliente_contato, cliente_endereco, cliente |
| tabela_preco | tabela_preco_item, tabela_preco |
| vendedor | vendedor |
| condicao_pagamento | condicao_pagamento |
| filial | estoque_movimento, estoque_saldo, tabela_preco_item, cliente_contato, cliente_endereco, cliente, vendedor, filial |

Ordem global (`ORDEM_DELETE`): estoque_movimento, estoque_saldo, tabela_preco_item, produto_unidade, cliente_contato, cliente_endereco, cliente, vendedor, produto, tabela_preco, condicao_pagamento, filial.

Decisão: DELETE de verdade, não soft delete, porque o índice único `(tenant_id, external_id)` impediria recarregar o mesmo `external_id`.

## Referências opcionais: anular, não bloquear
`cliente.vendedor_id`, `cliente.tabela_preco_id` e `cliente.condicao_pagamento_id` são nuláveis. Ao zerar vendedor, tabela de preço ou condição, o cliente **fica** e a coluna vai a NULL (`UPDATE ... SET col = NULL`, antes dos DELETE). Zerar vendedor, portanto, esvazia a carteira dos clientes dele. A anulação vale também quando o pai some pela cascata da filial.

## Bloqueios (o que fica mantido)
Fatos injetados: ids existentes por tabela (com o pai de cada linha), ids em uso por cadastro e motivo (`pedido`, `titulo`, `nota`) e filiais com nota.
- Registro em uso fica mantido **com os filhos dele**; os demais são apagados.
- Com vários motivos, conta um só, o mais forte: pedido, título, nota.
- Filial com nota fica mantida, e tudo o que depende dela (clientes, vendedores, itens de preço, estoque).
- Filial com cliente ou vendedor em uso também fica, com o motivo do dependente.
- Zerar produto ou cliente não olha a filial com nota; vale só o "em uso" do próprio registro.

Retorno: `{ apagar: {tabela, ids}[], anular: {tabela, coluna, ids}[], mantidos: {cadastro, motivo, quantidade}[] }`. Idempotente: com os apagados já fora dos fatos, o plano seguinte vem vazio (o que foi mantido continua mantido).

## Exemplos
- Zerar produto com `p1` em uso por nota: apaga `p2` e os filhos só dele; mantidos `{produto, nota, 1}`.
- Zerar filial F1 com nota: F1, seus clientes, vendedores, itens e estoque ficam; F2 inteira é apagada.
- Zerar vendedor: apaga os vendedores livres e anula `cliente.vendedor_id` dos clientes deles.

## Decisões pendentes e decididas
Pendente:
a) **Estoque_movimento é só-inserção** (0004:257, `controle.somente_insercao`). Duas opções, sem escolha ainda: (1) migração (pedido ao `banco-dados`) liberando DELETE só pela zeragem; (2) manter o histórico e zerar só o saldo (a opção 2 impede apagar produto e filial que tenham movimento). A decisão sai no adendo de ADR do engenheiro, com o `banco-dados`. O plano atual assume a opção 1.

Decididas (decisões do gerente):
b) **"Em uso"** vem por portas de contrato do pedido e do faturamento (o cadastros não lê tabela de outro schema); o engenheiro liga as portas.
c) **FDV**: na mesma operação, o espelho órfão e o cursor da integração são zerados, e há o "inativar no FDV" explícito quando não houver recarga (dono: `integracao-fdv`). Evento novo só se o engenheiro achar necessário, com ADR.
d) **LGPD e prazo fiscal**: o que está ligado a nota fica mantido; há auditoria por lote (quem, quando, cadastro, contagens por tabela e por motivo), sem dado pessoal.
e) **Permissão**: só o SUPERADMIN, no `/config` (plugin de plataforma), e não o administrador da empresa (RN-CAD-10). A ação é da família `plataforma.*` (dono: engenheiro). Exige confirmação explícita (digitar o nome do cadastro e da empresa), prévia do plano (contagens) antes de executar, licença do módulo e idempotência por chave do lote.
