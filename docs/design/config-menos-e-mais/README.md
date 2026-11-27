# Config "menos é mais": simulação nova (PROPOSTA, aguarda o "aprovado" do Alexandre)

Pedido do Alexandre em 27/11/2026 às 17h48 (Manaus), R-20261127-174851: as páginas se preenchem primeiro na horizontal e só depois descem, com tamanhos padrão. Complementos da PO: R-20261127-175011. Dados **fictícios**.

O que tem aqui: `simulacao.html` (abra com `#lista`, `#empresa`, `#integracao`, `#dados` ou `#junta`) e 10 PNG (lista, empresa, opção A com Integração e Dados separadas, opção B com as duas juntas), em 1366 e 1920 px. O código e os tokens só entram em `packages/ui` e `apps/web` depois do "aprovado".

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

A grade de 12 colunas, o vão de 16 px e a margem de 24 px já estão em `telas-horizontais.md`. Botão secundário: grafite, peso 500 (`botaoSecundario`). Menu da linha: "Ações ▾" (`MenuAcoes`), com uma ação à vista. Selo: 2px 8px, canto 10. Datas sempre como "27/11 17h40".

## Telas (PNG em 1366 e 1920)
- `lista-*`: tabela na largura cheia, com Empresa, Código, CNPJ, Situação, Módulos, Força de vendas e Criada em. Sem dado de negócio.
- **Cabeçalho da empresa**: só nome, código, "Ativa" e "Suspender". O que vem da Receita fica no cartão Identificação.
- `empresa-*`:
  - Identificação em 3 linhas: Razão 5, Fantasia 3, CNPJ 2 com "trocar", IE 2; Situação na Receita 2, Abertura 2, Natureza 3, Porte 2, Regime 3; CEP 1, Logradouro 4, Nº 1, Compl. 2, Bairro 2, Município · UF 2.
  - Depois, 3 cartões: CNAE 5, Contato 4, Módulos 3.
  - **Usuários** numa tabela na largura cheia, com "Adicionar usuário" e, em cada linha, "Editar" e "Ações ▾" (Excluir, Bloquear, Redefinir senha). Esta tabela substitui o "1º administrador".
  - Barra com "Descartar" e "Salvar".
- **Opção A, abas separadas**:
  - `a-integracao-*`: as duas ligações em 6 + 6;
  - `a-dados-*`: "Cargas recebidas" e "Envios ao FDV" em 6 + 6, com as ações de lote no título do cartão.
- **Opção B, uma aba "Integração"** (`b-integracao-e-dados-*`): cada coluna é uma direção, com a ligação em cima e a tabela embaixo. Uma aba a menos, nenhum dado repetido e a página cheia nas duas larguras.

## Fora desta simulação
O BKO do cliente: o admin do cliente não tem /config e só vê o status das integrações, sem reprocessar (regra do Alexandre, R-20261127-175011). Depois de aprovada, esta Config vira o modelo da Config do FDV.

## Validação (27/11)
- design-de-marca: 🟢 na segunda rodada. Os 6 achados da primeira foram resolvidos.
- corretor-redundancias: 🟢 na segunda rodada. RD-a a RD-g foram resolvidos, e os 🟡 da segunda foram aplicados:
  - saíram as contagens que repetem as linhas da lista;
  - saiu "Ligado a", que repetia o título;
  - na opção B, saíram "Último lote" e "Último contato", que repetiam as tabelas;
  - Produtos passa a "Parcial" quando tem erros.
- Recomendação do corretor: a opção B. A escolha é do Alexandre.
