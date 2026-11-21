# Contrato comum das listas do BKO — paginação, filtros na URL e CSV

> Dono: engenheiro-software (T-0029; achados RD-0002 e RD-0003 do corretor). Fonte da verdade: `packages/platform-sdk/src/listas.ts`, importado por `@macuxierp/platform-sdk` (API e módulos) e por `@macuxierp/platform-sdk/listas` (shell, sem Node). Mudança incompatível = nova versão + ADR + recado aos consumidores.

## Paginação (um formato só)
- Consulta: `?limite=` (1 a 200, padrão 50) e `?cursor=<id do último item da página anterior>` (UUID). Ordem estável por `id`.
- Resposta: `{ itens: [...], proximo_cursor: uuid | null }`; `null` = última página.
- Zod: `ConsultaPaginada`; listas de cadastro usam `ConsultaLista` (mais `?busca=`, até 80 caracteres, e `?inativos=true`), estendida com os filtros do módulo (`ConsultaLista.extend({ filial_id: ... })`). Resposta: `paginaDe(ItemZod)`.
- Repositório: busca `limite + 1` linhas com `id > cursor ORDER BY id` e devolve `paginar(linhas, limite)`.
- Fora do contrato: `pagina`, `por_pagina`, `total` e `offset`.

## Filtros na URL
- `lerFiltros(location.search, ['busca', 'uf', ...])`: só as chaves permitidas, aparadas, sem vazio; repetida fica com a primeira.
- `paraQuery(filtros)`: query string com as chaves em ordem e sem vazio; a mesma para a URL da tela e para a chamada à API.

## CSV
- `paraCsv(colunas, linhas)` com `ColunaCsv<L> = { titulo, valor(linha) }`: separador `;`, BOM UTF-8 e CRLF (Excel em pt-BR); texto que começa com `= + - @` ganha apóstrofo (injeção de fórmula); número negativo segue número.
- Na API: `respostaCsv('clientes.csv', csv)` devolve `content-type: text/csv; charset=utf-8`, `content-disposition: attachment` e `cache-control: no-store`.
- O CSV é do usuário logado e respeita as mesmas checagens da rota (RN-CORE-02); nunca vai para log.
