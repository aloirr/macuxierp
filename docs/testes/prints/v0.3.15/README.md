# Prints da v0.3.15: aba Empresa, Zerar e Substituir tudo (T-0101 R-3 e T-0093)

Tirados em 25/11/2026, às 15h48 (Manaus), no main `20687a9` (com o #681 da etapa 8, o #685 da frase em fonte mono, o #689 do
MenuAcoes, a 0066 dos nomes de CNAE e município e o #697 do "Mostrar"/"Ocultar"). O web roda no next dev contra a API de produção (`appPgDeTeste`, módulos do `main.ts`), com Postgres local e banco
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
| `empresa-consultada-sem-dados` | Consultada na Receita, sem dados: "Consultada, sem dados na Receita.", com a data. |
| `zerar-cadastro` | Aba Integração › Ações de Vendedores › Zerar: avisos e a frase em mono. |
| `zerar-pedidos-n-maior-0` | "Zerar pedidos não faturados" com 3 pedidos (1 do FDV) e a frase em mono. |
| `zerar-pedidos-n-0` | Prévia sem pedidos: só o texto, sem a frase e sem o botão. |
| `substituir-tudo` | Aba Dados › Importar Filiais › Substituir tudo: o efeito e a frase em mono. |

Pontos vistos nos prints, para a revisão de marca e UX:
1. Zerar por cadastro: a prévia vazia deixa um espaço em branco entre "Antes de zerar…" e o aviso dos 30%.
2. Ficha: CNAE principal e secundários só com o código (sem máscara nem descrição).
3. A ficha "consultada sem dados" só aparece se nenhum campo além da data tiver valor: com a fonte gravada (`receita_fonte`), a tela
   mostra a ficha com "—" em vez do estado vazio (`fichaVazia` conta a fonte).
