# 03 — Regras de negócio e permissões (RN)

> Toda RN vira função pura no `domain` do módulo, com teste escrito antes, nomeado com a regra (`it('RN-...: ...')`). A API sempre revalida. Regra nova ou alterada passa pelo gerente-projetos e, se for do Alexandre, cita o recado.

## Plataforma e Core (RN-CORE)
- **RN-CORE-01** Perfis da v1: administrador, gerente, faturista, fiscal, vendedor, leitura. Um perfil por usuário por empresa. A empresa nunca fica sem um administrador ativo: o último não pode ser desativado, excluído nem trocar de perfil.
- **RN-CORE-02** Toda rota checa perfil, tenant e licença do módulo, nesta ordem. Sem licença: 403 `MODULO_INATIVO`. O tenant só lê as licenças; elas mudam pelo script do operador, com auditoria (D12 da T-0002).
- **RN-CORE-03** Dinheiro em centavos (inteiro). Arredondamento meio para cima na 2ª casa, nas regras do Manual da NF-e; rateio sem perder centavo (a diferença vai para a primeira parcela).
- **RN-CORE-04** Datas gravadas em UTC; exibidas no fuso do tenant (padrão Manaus, UTC−4).
- **RN-CORE-05** Escrita idempotente: toda criação vinda de fora aceita `external_id` e não duplica no reenvio.
- **RN-CORE-06** Certificado A1: guardado criptografado; a senha nunca volta para a tela nem para log; certificado vencido bloqueia a emissão daquela filial com a mensagem "Certificado vencido em DD/MM/AAAA: envie o novo".
- **RN-CORE-07** LGPD: sem dado pessoal em log; exportação a qualquer hora; exclusão do tenant respeita a guarda fiscal (XML e dados da nota por 5 anos, no mínimo).
- **RN-CORE-08** Ambiente fiscal por filial emissora: começa em homologação. A troca para produção é feita só pela Macuxi, pelo script do operador, com o recado "aprovo produção fiscal <empresa>" do Alexandre conferido (autor, texto e empresa). O id do recado fica na filial e na auditoria (ADR 0006). O administrador do cliente só volta a filial para homologação, sem aprovação, e a volta também fica na auditoria.

## Cadastros (RN-CAD)
- **RN-CAD-01** CNPJ e CPF validados pelo dígito verificador; CNPJ alfanumérico (a partir de 2026) aceito conforme a regra da Receita.
- **RN-CAD-02** IE validada pela regra da UF; "ISENTO" só para quem é isento; não contribuinte sem IE gera `indIEDest` 9.
- **RN-CAD-03** Município sempre pelo código IBGE (7 dígitos), coerente com a UF.
- **RN-CAD-04** NCM precisa existir e estar vigente na tabela carregada; CEST obrigatório quando o NCM está em segmento com substituição tributária.
- **RN-CAD-05** Dados de consulta externa (CNPJ, CEP, IE) são sugestão: só gravam depois da revisão do usuário.
- **RN-CAD-06** Preço vale por filial e por vigência; tabela sem item na filial usa a filial padrão (mesma regra do FDV, RN-CORE-39 do FDV).
- **RN-CAD-07** Estoque simples: saldo por filial, nunca negativo sem permissão do gerente.
- **RN-CAD-08** Cadastro excluído é inativado (`deleted_at`), nunca apagado, e o FDV recebe a inativação.
- **RN-CAD-09** Condição de pagamento: de 1 a 36 parcelas, cada prazo de 0 a 999 dias, em qualquer ordem. A mesma regra vale no cadastro manual e na carga por CSV (T-0026); o limite de 24 parcelas do kit do Conector do FDV não vale para o ERP (decisão do Alexandre, 21/11/2026).

## Pedido (RN-PED)
- **RN-PED-01** Pedido do FDV é idempotente pelo UUID do FDV: reenvio não duplica. O pedido do FDV chega aprovado pelo vendedor e entra no ERP **já aprovado**, sem nova aprovação nem análise de crédito. Problema de cadastro (cliente, produto, filial ou condição inexistente ou inativa, item incoerente) recusa o recebimento e volta ao FDV como `rejeitado_erp` com motivo (decisão do Alexandre, 21/11, 23h10).
- **RN-PED-02** Status: recebido → aprovado | em_analise; em_analise → aprovado | recusado; aprovado → faturado_parcial | faturado | cancelado; faturado_parcial → faturado | cancelado. recusado, faturado e cancelado são finais. Transição fora da lista é recusada com a lista do que é possível.
- **RN-PED-03** Pedido manual: aprovação automática quando preço, desconto, crédito e estoque passam; senão vai para análise com as pendências listadas.
- **RN-PED-04** Crédito (pedido manual): saldo de títulos abertos + pedidos aprovados não faturados + este pedido ≤ limite do cliente. Limite 0 = sem crédito: o pedido vai para análise, **exceto à vista** (todos os prazos da condição = 0 dias), que não passa pela análise de crédito; preço e estoque continuam validados (decisão do Alexandre, 21/11, 23h10).
- **RN-PED-05** Todo status novo volta ao FDV (`retorno`) com o número do pedido no ERP.

## Fiscal (RN-FIS)
- **RN-FIS-01** A regra tributária é escolhida pela combinação mais específica (NCM > grupo; UF destino > todas; tipo de cliente > todos); empate é erro de cadastro, nunca escolha silenciosa.
- **RN-FIS-02** Simples Nacional usa CSOSN; regime normal usa CST. O CRT vem da filial emissora.
- **RN-FIS-03** IBS, CBS e IS seguem a NT 2025.002-RTC na versão registrada em ADR; a versão em uso aparece na tela de regras.
- **RN-FIS-04** Toda regra guarda a fonte (NT, convênio, anexo) e a vigência.

## Faturamento (RN-FAT)
- **RN-FAT-01** Numeração da NF-e sequencial por série e filial, **sem buraco**: o número é reservado na mesma transação que grava a nota; número perdido só sai por inutilização.
- **RN-FAT-02** Nota autorizada **nunca é editada**: correção por CC-e (só campos permitidos) ou cancelamento (no prazo da SEFAZ).
- **RN-FAT-03** O XML autorizado (com o protocolo) é **guardado antes de qualquer outra coisa** (DANFE, e-mail, evento, integração). Falha ao guardar = a nota fica "autorizada, guarda pendente" e nada mais anda até guardar.
- **RN-FAT-04** Homologação e produção separadas por tenant e filial; nota de homologação leva a marca de "sem valor fiscal" e nunca vai ao FDV como faturamento real.
- **RN-FAT-05** Contingência só quando a SEFAZ estiver indisponível (consulta de status) e só pela modalidade registrada em ADR; ao voltar, a nota é transmitida e conferida.
- **RN-FAT-06** Títulos a receber: uma parcela por prazo da condição de pagamento, rateio sem perder centavo (RN-CORE-03).
- **RN-FAT-07** Rejeição da SEFAZ mostra o código, a mensagem e a ação sugerida; a nota rejeitada pode ser corrigida e reenviada com o mesmo número.

## Integração FDV (RN-INF)
- **RN-INF-01** O ERP fala com o FDV **só** pela API do Hub (`/integracao/v1`), com a credencial de conector daquele tenant no FDV. Nunca lê tabela do FDV.
- **RN-INF-02** Envio na ordem de dependência do Hub (doc 06, seção "Entidades publicadas").
- **RN-INF-03** Idempotência por `external_id` + hash do registro; reenvio com o mesmo conteúdo não muda nada.
- **RN-INF-04** Falha do Hub vai para a fila com retentativa e backoff; erro por linha aparece no monitor sem o valor do dado pessoal.
- **RN-INF-05** Só o ERP é fonte da verdade do que publica: alteração no FDV de um cadastro vindo do ERP não volta para o ERP.

## Permissões (matriz da v1)
| Ação | administrador | gerente | faturista | fiscal | vendedor | leitura |
|---|---|---|---|---|---|---|
| Empresa, filiais, usuários, ver licenças, A1 | ✔ | | | | | |
| Clientes e produtos (editar) | ✔ | ✔ | ✔ | | | |
| Preços e crédito | ✔ | ✔ | | | | |
| Regras fiscais | ✔ | | | ✔ | | |
| Lançar pedido manual (criar, editar, revalidar) | ✔ | ✔ | ✔ | | | |
| Aprovar pedido | ✔ | ✔ | | | | |
| Emitir, cancelar, CC-e, inutilizar | ✔ | | ✔ | ✔ | | |
| Trocar ambiente fiscal | só com o "aprovo produção fiscal" do Alexandre | | | | | |
| Ver tudo | ✔ | ✔ | ✔ | ✔ | própria carteira | ✔ |
