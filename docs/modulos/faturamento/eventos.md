# Faturamento: eventos fiscais (T-0021, lote 2)

Fonte do fluxo dos eventos. Regras puras em `modules/faturamento/domain`; serviço em `api/eventos.ts`, worker em `api/processador-eventos.ts`, peças comuns com o transmissor em `api/sefaz-comum.ts`, envelopes dos XMLs em `api/xml-proc-eventos.ts`. O XML de evento sai do `packages/nfe-emissor` pela porta `EmissorNFe`
(`cancelar`, `cartaCorrecao`, `inutilizar`); o faturamento só valida e entrega o pedido.

| Evento | Arquivo | Regra | Pedido |
|---|---|---|---|
| Cancelamento | `cancelamento.ts` | RN-FAT-02 | 110111, nSeqEvento 1 |
| CC-e | `carta-correcao.ts` | RN-FAT-02 | 110110, nSeqEvento = maior + 1 (1 a 20), xCondUso |
| Inutilização | `inutilizacao.ts` | RN-FAT-01 | faixa, ano (4 dígitos; XML usa 2) |
| Consulta | `consulta.ts` | RN-FAT-02/03/07 | reconcilia status |

## Regras
- Cancelamento: só `autorizada`; prazo de 24 h da autorização (parâmetro `prazoHoras`; cancelamento extemporâneo
  depende da UF, cStat 155); justificativa de 15 a 255 caracteres, aparada.
- CC-e: só `autorizada`, nunca `cancelada`; recusada enquanto a nota tem cancelamento pendente (RN-FAT-02, `validarCartaCorrecao`); o inverso, cancelar com CC-e pendente, é permitido e a SEFAZ rejeita a CC-e; texto de 15 a 1000; no máximo 20 por nota. Aviso por palavra-chave
  (valor, dados de remetente/destinatário, datas) orienta e não bloqueia, pois o texto é livre.
- Inutilização: 1 ≤ inicial ≤ final ≤ 999999999; final até próximo + 99 (0013); não cobre nota `autorizada`,
  `cancelada` ou `em_autorizacao`; `rascunho` e `rejeitada` da faixa viram `inutilizada`.
- Retorno da inutilização: só 102 registra. **563 (faixa já inutilizada na SEFAZ) NUNCA é rejeição** (RN-FAT-01): a inutilização fica `pendente`, com
  `c_stat` 563 e o motivo `ja_inutilizada_na_sefaz` (divergência para o suporte), sem liberar a faixa e sem passar as notas a `inutilizada` (isso só com o
  ProcInut). A varredura não a retoma. Os demais códigos (256, 241, 215...) rejeitam e a faixa volta a ser buraco no banco.
- Consulta: 100 em nota não autorizada = guardar o XML antes de tudo; 101/135/155 = `cancelada` só por evento da SEFAZ
  (135 de CC-e não cancela); 110/301/302/303 = denegada; 217 = pode reenviar (ou divergência se a nota local é autorizada).
  Nota autorizada nunca é editada; discordância vira `divergencia`.

## Fluxo (lote 2: serviço, worker e rotas)
Ordem da T-0018 §8, com a API sem A1 decifrado (ADR 0005 item 4):
1. **API** (`api/eventos.ts`, rotas em `api/rotas.ts`): valida no domain, confere o A1 ativo pelos metadados (`temA1Ativo`), grava o PEDIDO
   `pendente` (`nota_evento` ou `inutilizacao`) e enfileira o trabalho; responde 202. Repetir o mesmo cancelamento (ou a mesma CC-e) pendente
   devolve o mesmo pedido; o `rejeitado` volta a `pendente` com a MESMA sequência.
2. **Worker** (`api/processador-eventos.ts`): tx1 trava (advisory), lê o pedido, a nota e o A1 (`lerA1`); no cancelamento **reconfere o prazo de 24 h**
   (`prazoDeCancelamentoEsgotado`) e, fora do prazo, rejeita o pedido localmente (cStat 501, com o motivo) SEM chamar a SEFAZ. Depois, numa tx curta,
   **trava de transmissão com lease** (`iniciarTransmissao`): trava a linha do pedido e grava a tentativa em `transmissao` com `respondida_em` nulo;
   havendo lease ativo (padrão 5 min, `leaseMin`) a fila e a varredura saem com `em_processamento`, e a varredura só retoma o pedido com o lease
   vencido (ou fechado). O retorno fecha o lease (uma linha por tentativa); falha de transporte o fecha com o motivo. Só então chama a porta `EmissorNFe` FORA da tx com o pedido
   guardado (`dhEvento` = `updated_at` da linha pendente, `idLote` = esse instante, fuso de Manaus: a retentativa sai idêntica); tx2 guarda o
   `procEventoNFe` (`evento_cancelamento`, `evento_cce`) ou o `ProcInutNFe` (`inutilizacao`) em `nota_xml` ANTES do status: o gatilho da 0013
   registra o evento e cancela a nota (ou registra a inutilização e passa rascunhos e rejeitadas da faixa a `inutilizada`); só então publica
   `faturamento.nota.cancelada@1` (com as quantidades). Retorno rejeitado marca o pedido `rejeitado`; 573 só vira registrado se a consulta confirma. **Ordem das travas na tx2: NOTA antes do evento** (e notas da faixa antes da inutilização), como a consulta e a API, para evitar deadlock.
   O `ano` da inutilização é gravado uma vez no pedido (4 dígitos): o retry, mesmo depois da virada de ano, reenvia o do pedido.
3. **Consulta** (`consultarNota`): `reconciliarConsulta` sobre o cStat do envelope; 100 em nota em autorização reprocessa a guarda; 101 por evento
   guarda o `procEventoNFe` que a consulta traz e cancela; o resto é divergência, sem editar a nota autorizada.

Regras da 0013 que o repositório segue: CC-e na sequência (`max + 1`, até 20), um cancelamento por nota, faixa começando no máximo no próximo
número e terminando até `próximo + 99`, sem sobreposição com faixa não rejeitada, só sobre notas `rascunho` ou `rejeitada`.

## `dhEvento` e pendências
- `dhEvento` sai do `updated_at` da linha `pendente` (a 0013 não tem coluna própria). É estável porque só o reabrir (`rejeitado` para `pendente`) muda a linha, e
  ele gera um pedido novo (novo `dhEvento` e `idLote`); a retentativa do mesmo pedido o encontra igual. A troca por colunas próprias (0024) segue pendente.
- **Pendência (563 e ProcInut)**: guardar o ProcInut de uma faixa que a SEFAZ já tem exige o XML do retorno original, que se perdeu. O caminho é o suporte
  reprocessar com o `assinado` guardado, se houver. Não há consulta de inutilização na SEFAZ para recuperar o protocolo.
- **Pendência (563 sem saída)**: a inutilização com 563 (`pendente`, `ja_inutilizada_na_sefaz`) ainda não tem caminho na API para o suporte resolver
  (guardar o ProcInut ou reabrir/cancelar o pedido). Até lá a faixa fica reservada.
- **501 local (RN-FAT-03)**: o worker só grava o 501 de prazo vencido se o cancelamento não tem NENHUMA linha em `transmissao`; com lease ativo devolve
  `em_processamento`; com tentativa anterior sem lease ativo transmite e a SEFAZ responde (o 573 segue pela consulta).
- **Pendência (lease sem coluna)**: o lease usa a linha de `transmissao` (`respondida_em` nulo); a 0013 não tem campo de controle no pedido.
