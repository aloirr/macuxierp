# Início mínimo do BKO (decisão 58 A, fecha o MC-0213): SIMULAÇÃO

Dados fictícios. Os tokens são os do #881 (declarados no `:root` da simulação, porque este branch é anterior a ele) e vale a regra 12. `gerar.py` gera os HTML (`python3 gerar.py`). PNG em 390, 1366 e 1920.

| Caso | Arquivos |
|---|---|
| Três atalhos: administrador com Pedidos, Faturamento e Cadastros licenciados | `inicio-completo-*` |
| Um atalho: licença parcial, só Pedidos, perfil vendas | `inicio-parcial-*` |

## Regra
- **Atalhos:** Pedidos (`/pedido/pedidos`), Notas fiscais (`/faturamento/notas`) e Clientes (`/cadastros/clientes`). Cada atalho só aparece com o módulo licenciado e o perfil autorizado, a mesma regra do menu.
- **MENOS É MAIS:** sem números e sem gráficos. O h1 "Início" vem com uma linha de saudação e o título de bloco "ATALHOS" fica fora da caixa.
- **Atalho:** o cartão inteiro é um link, com nome, uma linha de descrição e a seta. Não é botão, porque não há ação de página, e por isso não há barra.
- **Grade:** 12 colunas, com 4 colunas por atalho. Em 390, um embaixo do outro.
- **Licença parcial:** o único atalho fica com 4 colunas, e não com a linha toda, para o cartão não ficar esticado.
- **Topo e menu:** topo em azul-noite e menu lateral grafite, como hoje (decisão 53 A).

## Validação
design-de-marca 🟢, numa rodada. O ajuste dela foi aplicado: `#fff` trocado por `var(--mx-cor-branco)`.
