# Módulo fiscal

Motor tributário puro (`modules/fiscal/domain`), contrato `fiscal.calculo@1` (`contracts`) e, desde a T-0021, o adaptador de cálculo em `modules/fiscal/api`.

## Adaptador `CalculoFiscal` (T-0021)
`criarCalculoFiscal({ emitentes, repositorio? })` de `@macuxierp/fiscal/api`. O método `calcular(tx, entrada)` é estruturalmente compatível com a porta `CalculoFiscal` do faturamento (`modules/faturamento/api/portas.ts`): o apps/api passa o objeto direto, sem adaptador extra.

- **Entrada e saída**: tipos em `api/calculo.ts` (`EntradaCalculoDoFiscal`); resultado `ResultadoCalculoFiscal` em `contracts` (`cfops` por sequência, `item_id` = `String(sequencia)`). Erro de negócio é resultado tipado; falha de banco sobe como exceção.
- **Regras e IBPT** lidos na `tx` do tenant (RLS por `app.tenant_id`, sem `tenant_id` de parâmetro): `fiscal.regra_tributaria` (inclui `p_dif` e `p_icms_efet`, migração 0021) com vigência pela `data_emissao` (RN-FIS-04; regra fora da vigência nem chega ao motor) e `fiscal.carga_aproximada` (o ajuste do tenant vence a tabela geral do tenant de referência). O motor aplica a especificidade (RN-FIS-01) e o arredondamento (RN-FIS-03, meio para cima; IBS/CBS/IS meio para par).
- **Porta injetada `ConsultaEmitenteFiscal`**: `emitente(tx, filial_id)` devolve `{ uf, crt, regime_pis_cofins?, industrial_ipi? }`. O pedido e os contracts de cadastros não trazem `regime_pis_cofins` nem `industrial_ipi` da filial; quem liga (apps/api) implementa sobre os contratos de cadastros. Filial sem dados = `REGRA_INCOMPLETA`.
- **CFOP** (`domain/cfop.ts`, função pura): base 5102/6102 (terceiros) ou 5101/6101 (industrial); interestadual para não contribuinte 6108/6107; refinado pelo CST/CSOSN do ICMS (substituto 5403/6403 ou 5401/6401; retido 5405/6404) com nova passada do motor só se o CFOP mudou; se mudar de novo, `REGRA_INCOMPLETA` ("CFOP x CST incoerente"). Fonte: Ajuste SINIEF 07/2001.

## Premissas e limites da v1
- Emitente industrial usa 5101/6101 em todo item. Revenda por industrial precisa do dado "fabricado ou revendido" do produto, a pedir ao modulo-cadastros.
- `tipo_contribuinte` pelo `ind_ie_dest` (1 contribuinte, 2 isento, 9 não contribuinte); `consumidor_final` = `ind_ie_dest` diferente de 1 (igual ao `indFinal` do faturamento; `destinatarioPeloIndIe` no domain); finalidade `normal`.
- Sem `st_retido` (dados da compra): o ICMS efetivo do CST 60 só sai quando o faturamento passar a informá-lo.
- IBPT pela UF do emitente e sem `ex` (exceção tarifária).

## Pendências
- Ligação no apps/api (`ConsultaEmitenteFiscal` e `calculo: criarCalculoFiscal(...)` em `DepsEmissao`).
- CFOP de devolução, exterior (7xxx) e produção própria x revenda por produto (precisa de dado no cadastro de produto).
