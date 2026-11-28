# Módulo fiscal

Motor tributário puro (`modules/fiscal/domain`), contrato `fiscal.calculo@1` (`contracts`) e, desde a T-0021, o adaptador de cálculo em `modules/fiscal/api`.

## Adaptador `CalculoFiscal` (T-0021)
`criarCalculoFiscal({ emitentes, repositorio? })` de `@macuxierp/fiscal/api`. O método `calcular(tx, entrada)` é estruturalmente compatível com a porta `CalculoFiscal` do faturamento (`modules/faturamento/api/portas.ts`): o apps/api passa o objeto direto, sem adaptador extra.

- **Entrada e saída**: tipos em `api/calculo.ts` (`EntradaCalculoDoFiscal`); resultado `ResultadoCalculoFiscal` em `contracts` (`cfops` por sequência, `item_id` = `String(sequencia)`). Erro de negócio é resultado tipado; falha de banco sobe como exceção.
- **Regras e IBPT** lidos na `tx` do tenant (RLS por `app.tenant_id`, sem `tenant_id` de parâmetro): `fiscal.regra_tributaria` (inclui `p_dif` e `p_icms_efet`, migração 0021) com vigência pela `data_emissao` (RN-FIS-04; regra fora da vigência nem chega ao motor) e `fiscal.carga_aproximada` (o ajuste do tenant vence a tabela geral do tenant de referência). O motor aplica a especificidade (RN-FIS-01) e o arredondamento (RN-FIS-03, meio para cima; IBS/CBS/IS meio para par).
- **Porta injetada `ConsultaEmitenteFiscal`**: `emitente(tx, filial_id)` devolve `{ uf, crt, regime_pis_cofins?, industrial_ipi? }` (`industrial_ipi` só para o IPI) e `producaoPropria(tx, produto_ids)` devolve o conjunto dos produtos fabricados (assinatura igual à de `criarConsultaParaFiscal`, cadastros; uma chamada por cálculo). O pedido e os contracts de cadastros não trazem `regime_pis_cofins` nem `industrial_ipi` da filial; quem liga (apps/api) implementa sobre os contratos de cadastros. Filial sem dados = `REGRA_INCOMPLETA`.
- **CFOP** (`domain/cfop.ts`, função pura): escolhido por item: revenda 5102/6102 (interestadual para não contribuinte 6108) ou fabricado 5101/6101 (6107); item sem `produto_id` é revenda; refinado pelo CST/CSOSN do ICMS (substituto 5403/6403 ou 5401/6401; retido 5405/6404) com nova passada do motor só se o CFOP mudou; se mudar de novo, `REGRA_INCOMPLETA` ("CFOP x CST incoerente"). Fonte: Ajuste SINIEF 07/2001.

## Premissas e limites da v1
- CFOP por item pela produção própria do produto (T-0021); devolução e exterior seguem fora.
- `tipo_contribuinte` pelo `ind_ie_dest` (1 contribuinte, 2 isento, 9 não contribuinte); `consumidor_final` = `ind_ie_dest` diferente de 1 (igual ao `indFinal` do faturamento; `destinatarioPeloIndIe` no domain); finalidade `normal`.
- Sem `st_retido` (dados da compra): o ICMS efetivo do CST 60 só sai quando o faturamento passar a informá-lo.
- IBPT pela UF do emitente e sem `ex` (exceção tarifária).

## Pendências
- Ligação no apps/api (`ConsultaEmitenteFiscal` e `calculo: criarCalculoFiscal(...)` em `DepsEmissao`).
- CFOP de devolução, exterior (7xxx) e produção própria x revenda por produto (precisa de dado no cadastro de produto).

## ICMS-ST e IPI por regra: `regra_aplicada`, `calc_st`, `calc_ipi` (T-0132, RN-FIS-05, 63 A)
- O motor preenche por item `regra_aplicada: { st, ipi }` e, só quando verdadeiro, `calc_st` / `calc_ipi` (`v_bc`, `p_aliq` de 4 casas, `v_valor`, em centavos, meio para cima). Sem regra o campo é omitido; nunca se inventa alíquota.
- `calc_st` = base do ST (BC × (1 + MVA) × (1 − redução ST)), alíquota interna do destino e ICMS-ST (menos o ICMS próprio). O FCP-ST segue em `icms.v_fcp_st`. ST retido (CST 60/CSOSN 500) é repasse da nota de compra: não gera `calc_st`.
- `calc_ipi`: ad valorem usa BC e alíquota da regra; por unidade (pauta) e CST 51..55 saem com `v_bc` e `p_aliq` 0 (regra existe, sem alíquota ad valorem). Emitente não industrial: sem `calc_ipi`. Industrial sem regra de IPI: erro `REGRA_NAO_ENCONTRADA` só na emissão (`modo: "emissao"`, padrão do motor); no cálculo do pedido/FDV (adaptador, modo `previa`) o campo é omitido e não há erro.
- Totais `calc_st` / `calc_ipi` só se todos os itens têm a regra do imposto; `v_st` e `v_ipi` continuam sempre. O adaptador da API revalida a saída pelo `CalculoSaida`.
