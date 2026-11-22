# Contrato comum das listas do BKO — paginação, filtros na URL e CSV

> Dono: engenheiro-software (T-0029; achados RD-0002 e RD-0003 do corretor; descritor de página na T-0041, RD-0121). Fonte da verdade: `packages/platform-sdk/src/listas.ts`, importado por `@macuxierp/platform-sdk` (API e módulos) e por `@macuxierp/platform-sdk/listas` (shell, sem Node). Mudança incompatível = nova versão + ADR + recado aos consumidores.

## Paginação (um formato só)
- Chaves num lugar só (RD-0121): `CHAVE_CURSOR`, `CHAVE_LIMITE` e `CHAVES_PAGINACAO` (`['cursor', 'limite']`); `CHAVE_BUSCA` e `CHAVE_INATIVOS`. Ninguém redeclara essas strings no módulo nem no shell.
- Consulta: `?limite=` (1 a 200, padrão 50) e `?cursor=<id do último item da página anterior>` (UUID). Ordem estável por `id`.
- Resposta: `{ itens: [...], proximo_cursor: uuid | null }`; `null` = última página.
- Zod: `ConsultaPaginada`; listas de cadastro usam `ConsultaLista` (mais `?busca=`, até 80 caracteres, e `?inativos=true`), estendida com os filtros do módulo (`ConsultaLista.extend({ filial_id: ... })`). Resposta: `paginaDe(ItemZod)`.
- Repositório: busca `limite + 1` linhas com `id > cursor ORDER BY id` e devolve `paginar(linhas, limite)`.
- Fora do contrato (`CHAVES_FORA_DO_CONTRATO`): `pagina`, `por_pagina`, `total` e `offset`.
- **Parâmetro inválido** (limite fora de 1 a 200, cursor que não é UUID, `inativos` diferente de `true`/`false`, filtro fora do Zod do módulo) devolve **400 `VALIDACAO`** com `campos`; chave desconhecida é ignorada. O shell **volta à primeira página** (`recomecarLista(filtros, campos)`: sem `cursor`, sem `limite` e sem os campos apontados).
- **`inativos` só aparece na URL e na consulta quando é `true`** (ausente = `false`). A API ainda aceita `inativos=false` por compatibilidade; o shell nunca escreve.

## Descritor de página de lista (T-0041)
Cada tela de lista do BKO é um dado, definido no `web` do módulo e reusado na rota da API:
```ts
export const CLIENTES = definirPaginaLista({
  id: 'clientes',                       // rota do shell: /<modulo>/<id>
  api: '/v1/cadastros/clientes',        // /v1/<modulo>/<recurso>, sem query e sem :param
  item: Cliente,                        // Zod do item (contracts do módulo)
  busca: true, inativos: true,          // chaves comuns que a página aceita (padrão false)
  filtros: { filial_id: z.string().uuid().optional() }, // filtros do módulo: chave → Zod
  colunas: [{ id: 'nome', titulo: 'Nome', valor: (c) => c.razao_social }, { id: 'limite', titulo: 'Limite', valor: ..., exige: 'cadastros.cliente.credito' }],
  csv: { arquivo: 'clientes.csv' },     // ou false
});
```
- `definirPaginaLista` valida na carga e lança `PaginaListaInvalida`: id em minúsculas/hífen; `api` no padrão; filtro em snake_case e fora das chaves reservadas (paginação, `busca`, `inativos` e as de *Fora do contrato*); coluna sem `id` repetido; `csv.arquivo` = `<nome>.csv`.
- O descritor pronto (`PaginaLista<I, F>`, congelado) traz também `chaves` (as chaves aceitas na URL, em ordem), `consulta` (Zod da rota GET: `definirRota({ consulta: CLIENTES.consulta })` → 400 `VALIDACAO`) e `resposta` (`paginaDe(item)`).
- Tela (sem Node, por `@macuxierp/platform-sdk/listas`): `filtrosDaUrl(pagina, location.search)`, `urlDaLista(caminho, filtros)` (a mesma para a tela e para `pagina.api`), `trocarFiltro` (volta à primeira página), `primeiraPagina`, `proximaPagina(filtros, proximo_cursor)` (null na última) e `recomecarLista` (depois do 400).
- Colunas: `ColunaLista<L> = ColunaCsv<L> & { id, exige? }`; `colunasDoPerfil(pagina, perfil)` esconde a coluna de quem não tem a ação (a API protege de novo).
- CSV na API: `csvDaLista(pagina, perfil, linhas)` = `respostaCsv(csv.arquivo, paraCsv(colunasDoPerfil(...), linhas))`; página com `csv: false` lança.
- Formatação de exibição (documento, centavos) fica na coluna (`valor`), no `web` do módulo; o CSV sai com o mesmo texto da tela.

## Filtros na URL
- `lerFiltros(location.search, ['busca', 'uf', ...])`: só as chaves permitidas, aparadas, sem vazio; repetida fica com a primeira.
- `paraQuery(filtros)`: query string com as chaves em ordem e sem vazio; base de `urlDaLista`.

## CSV
- `paraCsv(colunas, linhas)` com `ColunaCsv<L> = { titulo, valor(linha) }`: separador `;`, BOM UTF-8 e CRLF (Excel em pt-BR); texto que começa com `= + - @` ganha apóstrofo (injeção de fórmula); número negativo segue número.
- Na API: `respostaCsv('clientes.csv', csv)` devolve `content-type: text/csv; charset=utf-8`, `content-disposition: attachment` e `cache-control: no-store`.
- O CSV é do usuário logado e respeita as mesmas checagens da rota (RN-CORE-02); nunca vai para log.
