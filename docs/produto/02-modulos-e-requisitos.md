# 02 — Módulos e requisitos (RF)

> Requisitos da v1. Cada RF tem dono (agente do módulo) e entra numa fase do doc 05. Regras de negócio no doc 03 (RN).

| Módulo | Agente | Depende de | Fase |
|---|---|---|---|
| `core` | modulo-core | — | F1 |
| `cadastros` | modulo-cadastros | core | F1 |
| `integracao-fdv` | modulo-integracao-fdv | core, cadastros, pedido | F2–F3 |
| `pedido` | modulo-pedido | core, cadastros | F3 |
| `fiscal` | modulo-fiscal | core, cadastros | F4 |
| `faturamento` | modulo-faturamento | core, cadastros, pedido, fiscal | F4 |

## Core (RF-CORE)
- **RF-CORE-01** Empresa (tenant) com dados legais, fuso e ambiente fiscal (homologação/produção) por filial emissora.
- **RF-CORE-02** Usuários do ERP, perfis (administrador, gerente, faturista, fiscal, vendedor, leitura) e permissões por ação.
- **RF-CORE-03** Licença por módulo: módulo sem licença some do menu e a API responde 403 `MODULO_INATIVO`.
- **RF-CORE-04** Certificado A1 por filial emissora: envio pelo BKO, criptografado no banco, validade exibida, alerta 30 dias antes de vencer.
- **RF-CORE-05** Auditoria de alterações sensíveis (fiscal, preço, crédito, certificado, ambiente).
- **RF-CORE-06** Exportação dos dados do tenant (LGPD) em arquivo, a qualquer hora.
- **RF-CORE-07** Arquivos no S3 com prefixo `macuxierp/<tenant>/` (XML, DANFE, anexos).

## Cadastros (RF-CAD)
- **RF-CAD-01** Clientes: CNPJ/CPF, IE (ou isento/não contribuinte), razão social, fantasia, endereço com código IBGE do município, contatos, limite de crédito, condição de pagamento, tabela de preço, filial e vendedor da carteira.
- **RF-CAD-02** Consulta de CNPJ (BrasilAPI e base aberta da Receita) e CEP (ViaCEP/BrasilAPI) para preencher o cadastro, com revisão do usuário.
- **RF-CAD-03** Situação da IE pelo webservice Consulta Cadastro da SEFAZ (com o A1 da filial).
- **RF-CAD-04** Produtos: código, descrição, NCM, CEST, unidade comercial e tributável, EAN, marca, origem da mercadoria, dados fiscais (grupo de tributação) e situação.
- **RF-CAD-05** Tabelas de preço (por filial, com vigência) e preço por tabela.
- **RF-CAD-06** Estoque simples por filial (saldo; entrada e saída manual e baixa pelo faturamento).
- **RF-CAD-07** Equipe: usuários do ERP e vendedores do FDV, com filial e carteira de clientes.
- **RF-CAD-08** Filiais: CNPJ, IE, regime tributário (CRT), endereço, série e número inicial da NF-e por série (o próximo número vem do faturamento, RN-FAT-01; D8 da T-0002).
- **RF-CAD-09** Condições de pagamento (parcelas em dias).
- **RF-CAD-10** Tabelas oficiais carregadas: NCM (Siscomex), CEST, CFOP, CST/CSOSN, municípios (IBGE), classificação tributária do IBS/CBS.

## Pedido (RF-PED)
- **RF-PED-01** Receber os pedidos aprovados no FDV (via integração), idempotente pelo UUID do FDV.
- **RF-PED-02** Lançar pedido manual no BKO.
- **RF-PED-03** Validar preço, desconto, crédito, estoque e condição de pagamento; mostrar as pendências.
- **RF-PED-04** Aprovar ou recusar, com motivo; devolver o status ao FDV.
- **RF-PED-05** Lista de pedidos com filtros (status, cliente, vendedor, data, filial) e exportação CSV.

## Fiscal (RF-FIS)
- **RF-FIS-01** Regras tributárias por NCM, CFOP, CST/CSOSN, UF de origem e destino, regime e tipo de cliente.
- **RF-FIS-02** Cálculo de ICMS, ICMS-ST (MVA), IPI, PIS e COFINS com o arredondamento do Manual da NF-e.
- **RF-FIS-03** Grupos IBS, CBS e IS (NT 2025.002-RTC vigente), com a classificação tributária oficial.
- **RF-FIS-04** Carga tributária aproximada (IBPT, Lei 12.741) no DANFE.

## Faturamento (RF-FAT)
- **RF-FAT-01** Gerar NF-e 55 a partir do pedido aprovado (total ou parcial), com prévia dos impostos.
- **RF-FAT-02** Autorizar na SEFAZ-AM (homologação e produção por tenant e filial emissora), consultar retorno e protocolo.
- **RF-FAT-03** DANFE em PDF; envio por e-mail ao cliente com o XML.
- **RF-FAT-04** Cancelamento, carta de correção (CC-e) e inutilização de faixa.
- **RF-FAT-05** Contingência (SVC) quando a SEFAZ estiver fora.
- **RF-FAT-06** Guarda do XML autorizado, imutável, por no mínimo 5 anos, com download.
- **RF-FAT-07** Títulos a receber simples: parcelas pela condição de pagamento, baixa manual.
- **RF-FAT-08** Painel de rejeições com a mensagem da SEFAZ e a ação sugerida.

## Integração FDV (RF-INF)
- **RF-INF-01** Publicar no Hub do FDV: filiais, vendedores, clientes, produtos, preços, estoque, títulos e notas, na ordem de dependência do Hub.
- **RF-INF-02** Carga inicial completa por entidade e depois delta por cursor.
- **RF-INF-03** Buscar os pedidos pendentes do FDV e devolver o retorno (número no ERP, status, nota).
- **RF-INF-04** Monitor no BKO: último envio por entidade, erros por linha, fila, sinal de vida.
- **RF-INF-05** Credencial do conector do FDV guardada criptografada por tenant.
