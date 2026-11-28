# Tokens da v0.3.28: BKO antes × depois

Cada PNG põe lado a lado o main 5fadaaa (antes) e o branch `designer-ux/T-0101-tokens-config` (depois), com `next dev` e a API real da massa `tests/e2e/api-prints-v0312.ts`. Por cima entram 25 clientes, 12 produtos, 14 pedidos e 6 notas em rascunho, todos fictícios e inseridos no banco efêmero. Larguras: 1366 e 390.

| Tela | PNG |
|---|---|
| Login | `comparar-login-*` |
| Lista densa: Pedidos (Clientes e Produtos ainda mostram "Disponível em breve" no BKO) | `comparar-pedidos-*` |
| Pedido (formulário Novo pedido) | `comparar-pedido-novo-*` |
| Notas fiscais (lista) | `comparar-notas-*` |
| Nota fiscal (detalhe) | `comparar-nota-*` |

## O que muda e o que foi conferido
- O `th` passa a caixa-alta 12/700 azul-noite, sobre névoa, com linha de 2 px. Linhas de 36 px com zebra.
- h1 de 20 px.
- Botões com 13 px e 34 px.
- Nada sai cortado nem quebrado em 1366 e 390.
- Os prints acharam um defeito, já corrigido no `packages/ui`: o `<a class="mx-botao-secundario">` (Limpar, Exportar CSV, abas da nota) ficava com o texto no alto da caixa. O `a.mx-botao-secundario { display: inline-block }` do `globals.css` vence o `display` do pacote. Agora o botão centraliza pelo `line-height`.

## Para o engenheiro-apps (fora do `packages/ui`)
1. `.campo input` e `select` do shell seguem com cerca de 40 px, contra 34 px do botão ao lado (filtros de Pedidos e de Notas). Precisam usar `var(--mx-medida-altura-campo)`.
2. O "Acesse sua conta" do login usa `--mx-tamanho-titulo-cartao`, que agora vale 13. Precisa usar `--mx-tamanho-titulo-dialogo` (20).
3. O `a.mx-botao, a.mx-botao-secundario { display: inline-block }` do `globals.css` pode sair.
4. Já acontecia antes: em 390, as tabelas de Pedidos e de Notas rolam para o lado.
