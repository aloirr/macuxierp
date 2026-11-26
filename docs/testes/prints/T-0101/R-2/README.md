# T-0101, R-2: falha da fonte da Receita na tela (1280 e 390)

Os prints saem de `bash tests/e2e/rodar-ficha-receita.sh`, que roda o roteiro `tests/e2e/ficha-receita-falha.mjs`. O web roda em `next dev` contra a API de produção do /config. O único dublê é o `fetch` das fontes da Receita, definido em `tests/e2e/api-ficha-receita.ts`. Os prints são de 26/11/2026 (Manaus), com dados fictícios.

| Print | Fonte | Mensagem na tela |
|---|---|---|
| `falha-tempo-*.png` | tempo esgotado | "Não foi possível consultar a Receita agora. Tente de novo em alguns minutos." |
| `falha-erro_5xx-*.png` | 503 | a mesma |
| `falha-nao_encontrado-*.png` | 404 | "A Receita não encontrou o CNPJ desta empresa. …" |
| `falha-fora_do_formato-*.png` | 200 fora do formato | "A Receita devolveu dados incompletos. Tente de novo mais tarde." |
| `ok-1280.png` | ok, 1ª consulta | "Ficha atualizada pela Receita." |
| `ok-390.png` | ok, 2ª consulta | "Consulta feita: a ficha já estava em dia." |

Em todos os casos de falha:
- a mensagem é um alerta (`role=alert`) e sai do catálogo;
- não aparece "Algo deu errado";
- nem o CNPJ nem o corpo da fonte aparecem na tela;
- a ficha não muda depois de recarregar a página.
