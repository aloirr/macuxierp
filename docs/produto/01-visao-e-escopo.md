# 01 — Visão e escopo

> Pedido do Alexandre (dono do produto), prompt de abertura de 21/11/2026. Decisão do stack: R-20261120-205653-alexandre (macuxifdv-recados), registrada na ADR 0001.

## Visão
O **Macuxi ERP** é um ERP 100% na nuvem, multiempresa (SaaS), que guarda os dados de cada empresa cliente e é a **fonte da verdade** dos cadastros e do faturamento do **Macuxi FDV** (força de vendas). A primeira versão tem só o básico para o FDV ser usado de fato: cadastros, pedidos, faturamento com NF-e e o fiscal que o faturamento precisa.

- Endereço: **https://erp.macuxifdv.com.br**.
- Mesma VM, mesmo servidor de banco e mesmas conexões de produção do FDV, com banco, papéis, serviço e prefixo de arquivos próprios (doc 04).
- Mesmo time de agentes, mesmas regras e mesmo fluxo de deploy do FDV.

## Para quem
| Pessoa | O que faz no ERP |
|---|---|
| Administrador da empresa | Cadastra empresa, filiais, certificado A1, usuários, perfis e licenças |
| Gerente comercial | Aprova pedidos, acompanha status e crédito |
| Faturista | Fatura pedidos aprovados, emite, cancela e corrige NF-e, imprime DANFE |
| Fiscal / contador da empresa | Mantém regras tributárias, confere notas e rejeições |
| Vendedor (no FDV) | Não entra no ERP: recebe cadastros, preços, estoque, títulos e o status dos pedidos pelo FDV |

## Escopo da v1
1. **Cadastros**: clientes, produtos, preços por tabela, estoque simples, equipe (usuários do ERP e vendedores do FDV) com carteira e filial, filiais e empresa (CNPJ, IE, regime, A1).
2. **Pedidos**: recebe os do FDV, permite lançar manual, aprova e devolve o status ao FDV.
3. **Faturamento**: pedido aprovado → **NF-e modelo 55** (emissão, DANFE em PDF, cancelamento, CC-e, inutilização, contingência e consulta), guarda do XML autorizado e títulos a receber simples.
4. **Fiscal (apoio)**: regras por NCM, CFOP e CST/CSOSN (ICMS, ICMS-ST, IPI, PIS, COFINS) e os grupos **IBS, CBS e IS** da Reforma Tributária (NT 2025.002-RTC vigente).
5. **Integração FDV**: publica no Hub `/integracao/v1` do FDV, no contrato canônico do doc 06 do FDV, e recebe os pedidos. Conector **nativo na nuvem**, sem Conector on-premise, idempotente por `external_id`.

## Fora da v1
Compras, contas a pagar completo, contabilidade, SPED, NFC-e, NFS-e, produção e app mobile. Cada um entra só com o "backlog" escrito do Alexandre.

## Princípios
- **Gastar o mínimo**: ferramentas e fontes gratuitas (doc 04, seção "Fontes gratuitas"; ADR 0002). O único custo inevitável é o certificado A1, que é do cliente.
- **Fiscal sem surpresa**: homologação antes de produção, por empresa; produção só com "aprovo produção fiscal <empresa>".
- **Uma verdade**: o ERP é dono do cadastro e do faturamento; o FDV recebe, nunca o contrário.

## Fases
F0 Fundação → F1 Cadastros → F2 Integração FDV (ida) → F3 Pedidos → F4 Faturamento em homologação → F5 Produção piloto. Critérios de pronto e previsão no doc 05.
