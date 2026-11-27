# Config "menos é mais": simulação final na v4 aprovada (decisão 40)

A base é a v4 do Gerente Sênior: `aloirr/macuxierp-recados`, pasta `recados/anexos/R-20261127-180115-config-v4/`, commit 981da89. `gerar.py` vem do `gen4.py` dela e gera os HTML (`python3 gerar.py`). Os PNG mostram 390, 1366 e 1920 nas telas principais e 1366 e 1920 nos diálogos e na lista. Só dados **fictícios**. O PR do `packages/ui` e do `apps/web` sai na v0.3.28, depois do "aprovado".

## O que mudou em relação à v4
1. Hex trocados pelos **tokens do `packages/ui`**, nos casos em que a cor é a mesma ou quase igual:
   - azul-noite;
   - pérola;
   - `bordaTabela`;
   - grafite;
   - `textoSecundario`;
   - ativo, aviso e erro: `erroTexto` no lugar de #a3271c;
   - `nevoa` na linha.
2. Topo do /config em grafite, com a assinatura A negativo grafite e o selo Plataforma (regra da marca). "Sair" é link.
3. Tamanhos 11,5 e 12,5 viram 12 e 13, que estão na escala da marca. Rótulo em `rotuloDestaque` (azul-noite), pela regra de hierarquia de 27/11.
4. Correções pedidas:
   - (a) e-mail e telefone do Contato mascarados, com o link "mostrar";
   - (b) Usuários com a situação "Inativo" e a confirmação de excluir, que bloqueia o último administrador ativo e só mostra "Fechar";
   - (c) "Substituir…" em vermelho;
   - (d) em 390, a barra fixa (sticky no fim do fluxo) não cobre o conteúdo. Os blocos ficam em 1 coluna, as tabelas mostram as colunas essenciais e os links de linha ficam empilhados.
5. Novos:
   - confirmação digitada com o código da empresa, para Zerar pedidos (e para Substituir e Zerar cadastros), só para o superadmin;
   - lista de empresas no mesmo padrão.

## Tokens (proposta para o `packages/ui`)
**Papéis que mudam de valor**, o que muda a regra de 27/11 e precisa do "aprovado":
- `h1` 20;
- título de bloco 13/700, caixa-alta, fora da caixa;
- rótulo 12/600;
- texto 13.

**Novos:**
- `alturaCampo` 34;
- `espaco` 12, também o gap da grade;
- `cantoCartao` 8;
- `alturaLinhaTabela` 36 e `alturaCabecalhoTabela` 34;
- **`corCabecalhoTabela` #E6EBF3**, da v4: o design-de-marca não aprova como token, porque fica quase igual à `nevoa` e não existe no FDV. Quem decide é o Alexandre;
- `corLinhaAlternada` #FBFAF8, da v4.

## Regra dos botões (CLAUDE.md, regra 12)
- Uma barra no rodapé de cada bloco: ações à esquerda e destrutivas à direita, em vermelho. As destrutivas pedem confirmação e só o superadmin vê.
- Rodapé da página: estado à esquerda; à direita, Suspender empresa e, separados, Atualizar pela Receita, Descartar e Salvar.
- Fora das barras ficam só a busca, os links de linha (Editar · Redefinir senha · Excluir, Detalhes, Abrir) e os links de campo (trocar, mostrar).

## Validação (27/11, por volta das 18h30)
- design-de-marca: 🟢 no topo, nos botões, nos selos, no contraste e no 390. Os 🟡 foram aplicados:
  - links de linha sublinhados;
  - busca com 34 px e 13 px;
  - selo Plataforma com 1px 7px;
  - em 390, os Envios recentes mostram Quando, Registros, Com erro e Detalhes.
- corretor-redundancias: 🟢, sem botão fora de barra. Os 🟡 foram aplicados:
  - diálogo bloqueado: "Não dá para excluir…";
  - confirmação digitada mais curta;
  - "Detalhes" inteiro em 390.
- Ficam para o Alexandre:
  - #E6EBF3 × `nevoa` (decisão 43);
  - #FBFAF8;
  - tirar o "Excluir" da linha do último administrador ativo, em vez de explicar no diálogo (sugestão do corretor).
