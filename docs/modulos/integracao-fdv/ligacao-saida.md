# Ligação ERP → Macuxi FDV: contadores, histórico e Contato (T-0131, RN-INF-13)

Decisão do PO (28/11/2026, 07h05), opção A sem o Gravados: sem migração e sem evento novo.

**RN-INF-13 (proposta para o doc 03, a registrar pelo dono do doc):** Enviados = soma de `registros` dos lotes mandados ao Hub (`enviando`, `aceito`, `concluido`, `concluido_com_erros`); o lote `repetido` não conta duas vezes; `montado`, `falhou` e `recusado` não contam. Aceitos = soma de `aceitos` desses lotes (recebidas menos com erro, nunca acima dos registros do lote). O Contato é só leitura: identificador, ambiente, prefixo da chave, situação (regra do SDK `situacaoConectorFdv`) e último sinal aceito.

Rota: `GET /v1/integracao-fdv/ligacoes` (ação `integracao-fdv.ver`, tenant e licença do módulo). Contrato: `LigacoesResposta` em `modules/integracao-fdv/contracts/ligacoes.ts`. Regra: `modules/integracao-fdv/domain/ligacao.ts`.
