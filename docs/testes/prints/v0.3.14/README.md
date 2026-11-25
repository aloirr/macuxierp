# Prints da v0.3.14: aba Empresa e Zerar pedidos não faturados

Tirados em 25/11/2026, às 05h40 (Manaus), no SHA `37b983d`. O web roda em modo de produção (next build e servidor standalone) contra a API de produção, com Postgres local. Larguras de 1280 e 390 px, com `deviceScaleFactor` 2. Só dados fictícios: empresas "Comercial Tarumã Fictício Ltda" e "Mercearia Sem Ficha Fictícia", contato `@exemplo.invalid` e superadmin fictício. A conferência automática não achou 404, "undefined", NaN, "Algo deu errado", "Não foi possível" nem rolagem horizontal.

| Print | O que mostra |
|---|---|
| `empresa-com-ficha-1280.png` | /config › empresa › aba Empresa, com a ficha da Receita completa: e-mail e telefone mascarados, com Revelar. |
| `empresa-com-ficha-390.png` | A mesma tela, no celular. |
| `empresa-sem-ficha-1280.png` | Aba Empresa de uma empresa só com razão social e CNPJ: "Atualizar pela Receita" e os campos com "—". |
| `empresa-sem-ficha-390.png` | A mesma tela, no celular. |
| `zerar-pedidos-n-maior-0-1280.png` | Aba Integração › "Zerar pedidos não faturados", prévia com 3 pedidos (1 do FDV), frase e botão desabilitado. |
| `zerar-pedidos-n-maior-0-390.png` | A mesma prévia, no celular. |
| `zerar-pedidos-n-0-1280.png` | Prévia sem pedidos: "Não há pedidos sem nota e sem título para apagar." |
| `zerar-pedidos-n-0-390.png` | A mesma prévia, no celular. |

Pontos para a v0.3.15, registrados pelo gerente:
1. Cidade/UF "—" no cartão "Dados da empresa" e endereço da ficha sem cidade e UF (engenheiro-apps, com marca e UX).
2. Estado vazio único na ficha sem consulta (engenheiro-apps, com marca e UX).
3. Prévia com N = 0 sem a frase e sem o botão (engenheiro-apps).
4. Fonte mono da frase (design-de-marca).
