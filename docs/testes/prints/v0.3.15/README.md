# Prints da v0.3.15: aba Empresa, Zerar e Substituir tudo (T-0101 R-3 e T-0093)

Tirados em 25/11/2026, às 15h48 (Manaus), no main `20687a9` (com o #681 da etapa 8, o #685 da frase em fonte mono, o #689 do
MenuAcoes e o #697 do "Mostrar"/"Ocultar"). Os 6 da aba Empresa e o `zerar-cadastro-1280` foram refeitos em 26/11/2026, às 17h59,
no main `195d46a` (com o #703: descrição do CNAE, município, os 3 estados da ficha e a prévia vazia sem espaço). O web roda no next dev contra a API de produção (`appPgDeTeste`, módulos do `main.ts`), com Postgres local e banco
efêmero. Larguras de 1280 e 390 px, com `deviceScaleFactor` 2. Refazer: `bash tests/e2e/rodar-prints.sh v0315 docs/testes/prints/v0.3.15`
(massa em `tests/e2e/api-prints-v0315.ts`, roteiro em `tests/e2e/prints-v0315.mjs`).

Só dados fictícios: "Comercial Tarumã Fictício Ltda", "Mercearia Sem Ficha Fictícia" e "Padaria Consultada Fictícia", contato
`@exemplo.invalid` e superadmin fictício. A ficha é gravada direto no banco: nenhuma chamada à Receita nem ao Hub. Nenhuma ação
destrutiva é confirmada: cada diálogo é fotografado e cancelado.

O roteiro confere em cada tela: sem 404, "undefined", NaN, "Algo deu errado", "Não foi possível" nem rolagem horizontal; a frase
de confirmação em fonte mono (Zerar por cadastro, Zerar pedidos e Substituir tudo); o e-mail da ficha só mascarado; cidade e UF
na ficha; a prévia com N = 3 e, com N = 0, sem o campo da frase.

| Print (1280 e 390) | O que mostra |
|---|---|
| `empresa-com-ficha` | Aba Empresa com a ficha completa: Cidade/UF no cartão, e-mail e telefone mascarados com Mostrar (#697). |
| `empresa-sem-ficha` | Empresa só com razão social e CNPJ: estado vazio único, "Ainda não consultada". |
| `empresa-consultada-sem-dados` | Consultada na Receita, sem dados: "Sem dados na Receita.", com a data da consulta. |
| `zerar-cadastro` | Aba Integração › Ações de Vendedores › Zerar: avisos e a frase em mono. |
| `zerar-pedidos-n-maior-0` | "Zerar pedidos não faturados" com 3 pedidos (1 do FDV) e a frase em mono. |
| `zerar-pedidos-n-0` | Prévia sem pedidos: só o texto, sem a frase e sem o botão. |
| `substituir-tudo` | Aba Dados › Importar Filiais › Substituir tudo: o efeito e a frase em mono. |

Pontos vistos nos prints de 25/11, já resolvidos no #703 (refeitos em 26/11): o espaço da prévia vazia do Zerar por cadastro, o
CNAE só com o código e o estado "consultada sem dados" com a fonte gravada.
