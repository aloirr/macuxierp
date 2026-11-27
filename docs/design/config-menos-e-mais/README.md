# Config "menos é mais": simulação nova (PROPOSTA, aguarda o "aprovado" do Alexandre)

Pedido do Alexandre em 27/11/2026 às 17h48 (Manaus), R-20261127-174851: as páginas se preenchem primeiro na horizontal e só depois descem, com tamanhos padrão. Complementos da PO: R-20261127-175011. Dados **fictícios**.

O que tem aqui: `simulacao.html` (abra com `#lista`, `#empresa`, `#excluir`, `#integracao`, `#dados` ou `#junta`) e 12 PNG (lista, empresa, confirmação de exclusão de usuário, opção A com Integração e Dados separadas e opção B com a aba única "Integrações"), em 1366 e 1920 px. O código e os tokens só entram em `packages/ui` e `apps/web` depois do "aprovado".

## Tokens (proposta)
Não há escala paralela. Mudam só os valores de **papéis que já existem** em `packages/ui/src/tokens.ts`. Isso muda a regra das telas horizontais aprovada em 27/11 (`docs/marca/README.md`), e o "aprovado" do Alexandre precisa cobrir também essa mudança.

| Papel existente | Hoje | Proposta |
|---|---|---|
| `h1` | 24 | 20 (`grande`) |
| `tituloCartao` | 20 | 15 (`base`) |
| `rotuloDado` (também em `label` e `th`, caixa-alta 600 `rotuloDestaque`) | 13 | 12 (`micro`) |
| texto de campo, valor e célula | 15 | 13 (`pequeno`) |

Tokens novos, só os que hoje não existem:
- `alturaCampo` de 34 px, para campo, select e todo botão, inclusive os da linha;
- `espaco` de 12 px, entre campos e linhas;
- `cantoCartao` de 8 px.

A grade de 12 colunas, o vão de 16 px e a margem de 24 px já estão em `telas-horizontais.md`. Botão secundário: grafite, peso 500 (`botaoSecundario`). Na tabela, só links de linha; os botões ficam na barra. Selo: 2px 8px, canto 10. Datas sempre como "27/11 17h40".

## Regra dos botões (Alexandre, 27/11 17h58: "botoes sempre embaixo e juntos")
- **Cartão**: uma barra só, no rodapé. Ações à esquerda; as destrutivas à direita, em vermelho (`erroTexto`), com confirmação. As destrutivas só aparecem para o superadmin.
- **Página**: Salvar, Descartar, Atualizar pela Receita e Suspender empresa ficam na barra fixa do rodapé.
- **Fora das barras**: só a busca e os links de linha da tabela (Editar · Redefinir senha · Excluir, Importar · Substituir, Log · Reenviar).

## Telas (PNG em 1366 e 1920)
- `lista-*`: busca no cabeçalho; tabela na largura cheia, sem dado de negócio; "Criar empresa" na barra.
- `empresa-*`:
  - cabeçalho com nome, código e "Ativa";
  - Identificação em 3 linhas de 12 colunas, com o selo "Igual à Receita · 27/11 13h15";
  - cartões CNAE 5, Contato 4 (com o link "mostrar") e Módulos 3;
  - **Usuários** (R-20261127-175402): busca, colunas Nome, E-mail mascarado, Perfil, Situação e Último acesso, links Editar · Redefinir senha · Excluir e, no rodapé, "+ Adicionar usuário".
- `empresa-excluir-usuario-*`: confirmação do Excluir. Ela bloqueia o último administrador ativo.
- **Opção A**:
  - `a-integracao-*`: as duas ligações em 6 + 6;
  - `a-dados-*`: "Cargas recebidas" (Baixar modelos | Zerar cadastros) e "Envios ao Macuxi FDV" (Carga completa | Zerar pedidos não faturados).
- **Opção B, aba "Integrações"** (`b-integracoes-*`), recomendada pela PO e pelo corretor: os dois sentidos lado a lado, Sistema do cliente → ERP e ERP → Macuxi FDV, com a ligação em cima e a tabela embaixo.

## Fora desta simulação
O BKO do cliente: o admin do cliente não tem /config e só vê o status das integrações, sem reprocessar (regra do Alexandre, R-20261127-175011). Depois de aprovada, esta Config vira o modelo da Config do FDV.

## Validação
A versão 2 (commit 3b25ab6) teve 🟢 da marca e do corretor. A versão 3 (regra dos botões e Usuários) está em validação.
