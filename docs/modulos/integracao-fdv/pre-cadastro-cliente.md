# Pré-cadastro de cliente do FDV (T-0059, lote 4 do integracao-fdv)

Desenho: `docs/desenho/T-0059.md` §5. Banco: `docs/banco/README.md` (migração 0057). Regra de guarda: **RN-INF-06**.

## Fluxo
1. **Busca** (`api/recebimento-clientes.ts`): `GET /integracao/v1/clientes/pendentes?limite=50` (máximo 100), repetido até a lista vir curta, com teto de 10 páginas por execução. Uma transação por pré-cadastro: grava a revisão em `cliente_recebido`, chama a porta `CriadorClienteFdv` (cadastros), grava a decisão e enfileira o retorno em `cliente_retorno`.
2. **Mesma revisão de novo**: não revalida; soma `tentativas_fdv` e o retorno `enviado` volta a `pendente`. **Revisão nova de um recusado**: situação `reenviado` (as anteriores ficam como histórico).
3. **Retorno** (`api/retorno-clientes.ts`): `POST /integracao/v1/clientes/{cliente_uuid}/retorno`, `vinculado` ou `rejeitado_erp` com `erros: [{campo, codigo, mensagem}]` (opção `MACUXIERP_FDV_CLIENTE_REVISAO`, padrão ligada). Tratamento da resposta em `domain/pre-cadastro-cliente.ts` (`tratarRespostaRetornoCliente`).
4. **Retenção até o 200** (§5.4): o cliente aceito e os endereços ficam com `registro_publicado.aguarda_vinculo = true` (o consumidor de `cadastros.cliente.alterado@1` liga; o montador do lote ignora). O 200 do `vinculado` libera, resolve o conflito e acorda o envio. O 422 `external_id_divergente` abre `conflito_chave` `vinculo_divergente` e o cliente continua retido.
5. **Expurgo** (RN-INF-06, `api/expurgo-pre-cadastro.ts`): `expurgarPreCadastro` calcula o corte (agora − 180 dias, com folga de relógio) e chama `integracao_fdv.expurgar_pre_cadastro(p_corte)` em cada tenant; a auditoria leva só as contagens. O agendamento diário em `apps/worker` é do engenheiro-software (`ROTINA_EXPURGO_PRE_CADASTRO`).

## Rotas do BKO (ação `integracao-fdv.ver`, licença do módulo)
- `GET /v1/integracao-fdv/clientes-recebidos?situacao=&limite=&cursor=`: uma linha por `cliente_uuid` (a revisão mais recente), os mais recentes primeiro. Documento só mascarado; vendedor nulo quando o FDV não manda (a tela mostra "—").
- `GET /v1/integracao-fdv/clientes-recebidos/exportar`: CSV com as mesmas colunas.

## Linha expurgada (decisão (c))
Razão social "—" (texto fixo) e documento `null` (o Zod do SDK só aceita a máscara; a tela mostra "—"). Ficam situação, data, revisão, `codigo_fdv`, motivo, códigos de erro e contagens.

## Agendas
`criarAgendasClientesFdv` (`integracao-fdv.busca-clientes` a cada 60 s e `integracao-fdv.retorno-clientes`), a registrar no worker sob o `MACUXIERP_FDV_RECEBIMENTO`. `garantirLinhaDoSinal` já semeia `proxima_busca_clientes_em`.
