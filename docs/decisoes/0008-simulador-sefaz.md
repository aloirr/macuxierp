# ADR 0008 — Simulador da SEFAZ-AM na F4, fronteira homologação × produção e bibliotecas de XML

- **Status:** aceita; implementada na T-0045, etapas 1 a 5 (engenheiro-software)
- **Data:** 21/11/2026, 23h40 (Manaus)
- **Dono:** engenheiro-software
- **Base:** `CLAUDE.md`, regras 7, 8 e 9; ADR 0002 (biblioteca da NF-e, opção A, PL_010g); ADR 0005 (A1 cifrado); ADR 0006 (só o operador põe filial em produção); desenho `docs/desenho/T-0045.md`
- **Muda:** o critério de saída da F4 (doc 05), que deixa de depender do A1 da empresa piloto e do credenciamento na SEFAZ-AM
- **Altera:** ADR 0002 (o spike da T-0018 deixa de depender do A1 da piloto)

## Contexto
Decisão do Alexandre, em **21/11/2026, às 22h59 (Manaus)**, citada literalmente:

> "Sobre o certificado e homologação, simule elas para nao depender da thathyany."

A F4 (emissão) dependia de duas coisas fora do time: o A1 da empresa piloto e o credenciamento da filial na homologação da SEFAZ-AM. Além disso, a sessão da nuvem não alcança os portais do governo (o Portal Nacional da NF-e responde 403 ao proxy), então nem os schemas oficiais podem ser baixados daqui.

## Decisão

### 1. O simulador
`@macuxierp/sefaz-simulador` (`packages/sefaz-simulador`) implementa a porta `SefazTransporte` de `@macuxierp/nfe-sefaz`, in-process, com o mesmo contrato da SEFAZ: os mesmos pedidos, os mesmos `cStat` e o mesmo XML de retorno.
- **Serviços:** autorização em lote síncrono (indSinc 1) e assíncrono (recibo `nRec` e `consultarRecibo`, com 105 até passar o `tMed`), consulta de protocolo, status do serviço, cancelamento (110111, prazo de 24 h), CC-e (110110, por `nSeqEvento`) e inutilização. Contingência **SVC-RS** para o AM: o destino `svc-rs` exige `tpEmis` 7 e não tem inutilização. FS-DA e EPEC ficam fora, como no desenho.
- **`cStat`:** a tabela é a `MOTIVO` de `packages/sefaz-simulador/src/contexto.ts`, conferida pelo teste de cobertura do pacote (falha se algum código não for exercitado; os da assinatura são provados no verificador).
- **Conferências de verdade:** cada lote, evento e inutilização passa pelo teto de 500 KB, pelo XSD PL_010g (sem `<!DOCTYPE`) e pela verificação XMLDSig, com o CNPJ-base do certificado igual ao do emitente ou do autor (213). A ordem de cada serviço está no cabeçalho do arquivo dele.
- **Protocolo:** `nProt` de 15 dígitos no formato `9` + `tpEmis` + `cUF` + ano + sequencial. O 9 inicial identifica o simulador. O `digVal` é o `DigestValue` da assinatura da NF-e. `dhRecbto` sai em −04:00. O `verAplic` é `MACUXI-SIMULADOR-0.1`. Todo XML guardado diz de onde veio.
- **Estado em memória por destino** (filial + modo): notas, eventos, faixas inutilizadas e recibos. Os contadores de `nProt` e `nRec` são únicos no registro inteiro. O worker monta um registro na subida (`criarFabricaSimulador`); cada teste monta o seu. Tudo é determinístico com o relógio `agora` injetado.
- **Controles de teste:** `paralisar(108|109)`, `atrasarRecibo(n)`, `falharTransporte(n, { aposProcessar })` (a resposta perdida da seção 3.3 do desenho) e `denegar(documento)` (301/302).

### 2. A fronteira homologação × produção (regra 7)
O simulador **só atende homologação**: a trava fica no código, em três camadas, sem variável de ambiente (como: desenho T-0045 §2.2).

O ambiente vem de `core.ambiente_fiscal`, que só o operador põe em produção (ADR 0006). O teste de banco da API (`apps/api/src/sefaz-simulador.db.test.ts`) prova o caminho inteiro: o operador grava produção, o contrato do core devolve `producao`, o seletor lança o erro e a fábrica do simulador nunca é chamada. A produção real continua bloqueada também por `SEFAZ_ENDERECO_NAO_CONFERIDO` até a T-0046 conferir os endereços (`packages/nfe-sefaz/src/enderecos.ts`).

### 3. Bibliotecas (todas JS ou WASM puros, sem binário nativo, publicadas há mais de 24 h)
| Biblioteca | Versão | Licença | Uso |
|---|---|---|---|
| `xml-crypto` | 6.4.0 | MIT | C14N 1.0 e verificação XMLDSig (enveloped, RSA-SHA1, SHA-1). A T-0018 usa a mesma para **assinar** |
| `@xmldom/xmldom` | 0.8.15 | MIT | DOM do XML; a mesma versão que o `xml-crypto` usa (um parser só) |
| `node-forge` | 1.4.3 | BSD-3-Clause (dupla com GPL-2.0; usamos a BSD) | PKCS#12: o A1 de teste e, na T-0018, a leitura do `.pfx` para assinar |
| `xmllint-wasm` | 5.3.0 | MIT | validação XSD com o libxml2 2.13.8 compilado para WebAssembly |
| `@types/node-forge` | 1.3.14 | MIT | tipos (só desenvolvimento) |

Dependência transitiva: `xpath` 0.0.33 (MIT, do `xml-crypto`). O `minimumReleaseAge` de 24 h do workspace foi respeitado.

**Por que estas:** o `xml-crypto` é a implementação de XMLDSig mais usada em Node e evita duplicar C14N com a T-0018. O `node-forge` é o único PKCS#12 em JS puro maduro, porque o Node não monta nem abre PKCS#12 sem TLS. O `xmllint-wasm` usa o mesmo motor da referência (libxml2) sem compilar nada na VM. A T-0018 se alinha a esta escolha: quem precisar de outra biblioteca para a mesma função abre uma ADR nova.

**Reutilização:** o validador (`validarXsd`), o verificador (`verificarAssinaturaXml`, `verificarAssinaturaNFe`), a chave de acesso (`montarChaveNFe`, `dvChaveNFe`) e os envelopes (`montarNfeProc`, `montarEnviNFe`, `montarEnvEvento`) ficam em `@macuxierp/nfe-sefaz`, para o emissor da T-0018 e o worker. O apoio só de teste (A1 fictício, documentos mínimos e assinatura de teste) fica em `@macuxierp/nfe-sefaz/teste`, que o código de produção nunca importa.

### 4. Schemas "a conferir"
Os XSD do PL_010g vêm do espelho do sped-nfe (commit `4596b89`), conferidos pelos hashes SHA-256 do espelho. Só os 23 necessários entram em `packages/nfe-sefaz/schemas/PL_010g/`, com um README que registra a origem, o commit e a pendência. Os hashes ficam só no `SHA256SUMS`, que um teste recalcula. Eles ficam **"a conferir com o ZIP oficial na T-0046"**. O arquivo do espelho com espaço no nome (`e112120_v1.00 .xsd`) não é usado na v1 e não foi copiado.

### 5. Critério novo da F4 e a T-0046
- **F4 pronta** = **"20 notas autorizadas no simulador, com o XML guardado"** (o `nfeProc` com hash SHA-256 e gravação única), mais cancelamento, CC-e e inutilização, nos testes de aceitação (T-0022, etapa 6 do desenho).
- **T-0046 — homologação real na SEFAZ-AM**, **obrigatória antes da F5**: A1 da empresa piloto pelo caminho da ADR 0005, credenciamento, conferência dos endereços (`enderecos.ts`) e dos schemas oficiais, e as mesmas notas contra a SEFAZ-AM de verdade. O simulador prova o fluxo do ERP, não o credenciamento nem as regras próprias da SEFAZ-AM.

## Consequências
- A F4 anda sem o A1 da piloto e sem a SEFAZ. O risco de "passou no simulador e falhou na SEFAZ" fica concentrado na T-0046, que é obrigatória antes da F5.
- A regra 7 continua inteira: nada do simulador chega à produção, nem por configuração errada.
- Quatro dependências novas no `nfe-sefaz`, sem nativo. O XSD custa entre 50 e 150 ms por documento (o WASM compila o schema a cada chamada). Isso é aceitável na fila da SEFAZ; se pesar, o próximo passo é reaproveitar a instância.
- **Simplificações conhecidas do simulador** (documentadas no código): o lote assíncrono é processado no recebimento (a consulta de protocolo já vê a nota antes do `tMed`); o estado da SVC-RS não se sincroniza com o do AM; não confere cadeia ICP-Brasil, LCR nem as regras de negócio da NF-e (totais, CFOP, tributos); o 570 é usado também para o `tpEmis` 1 na SVC; o 242 (cabeçalho SOAP) só faz sentido no servidor SOAP local, que fica para depois.
- **Pendente no core** (leitura do A1 decifrado por filial para o worker): desenho T-0045 §5.
