# Schemas PL_010g (NF-e 4.00 com IBS, CBS e IS da NT 2025.002-RTC) — **a conferir com o ZIP oficial na T-0046**

Usados por `validarXsd` (`packages/nfe-sefaz/src/xsd.ts`). Dono: engenheiro-software. Decisão: ADR 0008 (e ADR 0002 para a versão da NT).

## Origem
- **Não é o pacote oficial.** O Portal Nacional da NF-e responde 403 ao proxy da sessão da nuvem. Estes arquivos vêm do
  **espelho do sped-nfe** (`nfephp-org/sped-nfe`, usado na opção MIT da ADR 0002, pasta `schemes/PL_010g`), no **commit `4596b89`**,
  baixado em 21/11/2026 para `/home/user/wt/_downloads/xsd-PL_010g-espelho-sped-nfe-4596b89/` (fora do repositório).
- Arquivo do espelho: `xsd-PL_010g-espelho-sped-nfe-4596b89.tar`, SHA-256
  `ed26afb03a135825ff47820d4e26f719faf09c0a1cfb57bd8ba0cd634d7582db`. Lista de hashes do espelho:
  `xsd-PL_010g-espelho-sped-nfe-4596b89.SHA256SUMS` (213 arquivos). Cada arquivo copiado foi conferido contra ela.
- Dados de terceiros tratados como não confiáveis: nenhum script do espelho foi executado; só os `.xsd` foram copiados,
  byte a byte (o `xmldsig-core-schema_v1.01.xsd` mantém o BOM do original).
- Versão registrada na ADR 0002: NT 2025.002-RTC **v1.53**, pacote **PL_010g** (v1.03, 26/10/2026), também "a conferir".

## O que entrou (só o necessário: NF-e 55, lote, `nfeProc`, cancelamento, CC-e, inutilização e os retornos)
Lista e hashes: `SHA256SUMS` (formato do `sha256sum -c`; o teste `src/xsd.test.ts` confere). Mudou um `.xsd`, atualize o `SHA256SUMS`.

### Acréscimo da EPEC (T-0021, ADR 0011, 22/11/2026)
- `envEPEC_v1.00.xsd`, `leiauteEPEC_v1.00.xsd` e `retEnvEPEC_v1.00.xsd`, do mesmo espelho e do mesmo commit `4596b89`
  (`schemes/PL_010g`), baixados pelo `raw.githubusercontent.com` em 22/11/2026 para fora do repositório e copiados byte a
  byte (nenhum script executado; sem `DOCTYPE` nem `ENTITY`). Dependem só do `tiposBasico_v1.03.xsd` e do
  `xmldsig-core-schema_v1.01.xsd`, que já estavam aqui. Hashes no `SHA256SUMS`. **A conferir com o ZIP oficial (T-0046).**

## O que ficou de fora
- Os demais 187 arquivos do espelho (outros eventos, distribuição DF-e, versões 3.10, etc.): a v1 não os usa.
- O arquivo com espaço no nome, `e112120_v1.00 .xsd` (SHA-256 `9129b37c0a75157e17b2e88624d80c99576442968e986976beb92cdc30d07042`),
  é de um evento fora da v1 e **não foi copiado**. Se entrar um dia, entra com o nome corrigido para `e112120_v1.00.xsd`.

## Conferência pendente (T-0046)
Antes da F5, baixar o ZIP oficial do PL_010g no Portal Nacional da NF-e (fora da nuvem, ou com o domínio liberado no
proxy), comparar arquivo a arquivo com o `SHA256SUMS` e registrar o resultado aqui e na ADR 0008. Divergência: trocar os
arquivos pelos oficiais, atualizar o `SHA256SUMS` e rodar os testes do `nfe-sefaz` e do `sefaz-simulador`.
