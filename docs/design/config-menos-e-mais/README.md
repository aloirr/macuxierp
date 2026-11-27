# Config "menos é mais": simulação nova (PROPOSTA, aguarda o "aprovado" do Alexandre)

Pedido do Alexandre em 27/11/2026 às 17h48 (Manaus), R-20261127-174851: as páginas se preenchem primeiro na horizontal e só depois descem, com tamanhos padrão. Complementos da PO: R-20261127-175011. Dados **fictícios**.

O que tem aqui: `simulacao.html` (abra com `#lista`, `#empresa`, `#integracao` ou `#dados`) e 8 PNG, cada uma das 4 telas em 1366 e 1920 px. O código e os tokens só entram em `packages/ui` e `apps/web` depois do "aprovado".

## Tokens únicos propostos
Só a escala da marca: 12, 13, 15, 17, 20 e 24 px.

| Token proposto | Valor | Onde |
|---|---|---|
| grade | 12 colunas, vão 16 px, margem 24 px | toda tela |
| altura de campo | 34 px, a mesma para campo, select e **todo botão**, inclusive os da linha da tabela | toda tela |
| texto | 13 px (`pequeno`), peso 400, grafite | campo, valor e célula |
| rótulo | 12 px (`micro`), 600, caixa-alta, `rotuloDestaque` | `label`, `dt` e `th`, um estilo só |
| título de cartão | 15 px (`base`), 700, `rotuloDestaque` | cartão |
| título de tela | 20 px (`grande`), 700 | h1 |
| espaço | 12 px entre campos e linhas, e 16 px entre cartões (o vão) | toda tela |
| cartão | margem interna de 16 px, canto de 8 px, borda `bordaTabela`, fundo branco | toda tela |

Diferença da referência do Gerente Sênior: o rótulo é de 12 px, e não de 11,5 px, porque 11,5 está fora da escala da marca.

## Telas
- **Lista de empresas**: a tabela na largura cheia, com Empresa, Código, CNPJ, Situação, Módulos, Força de vendas e Criada em. A busca e o "Criar empresa" ficam no cabeçalho. Não há dado de negócio: o superadmin não vê pedido, cliente nem nota (portal-config.md).
- **Cabeçalho da empresa**, igual nas 3 abas: nome, código, os selos "Ativa" e "Igual à Receita" e as ações "Atualizar pela Receita" e "Suspender".
- **Empresa**:
  - Identificação em 2 linhas de 12 colunas: Razão social 5, Fantasia 3, CNPJ 2 (só leitura, com "trocar"), IE 2; depois Situação na Receita 2, Abertura 2, Natureza jurídica 3, Porte 2, Regime 3.
  - Endereço numa linha: CEP 1, Logradouro 4, Nº 1, Compl. 2, Bairro 2, Município · UF 2.
  - 4 cartões: CNAE em chips 5, Contato 3, Módulos 2, 1º administrador 2.
  - Barra fixa com "Descartar" e "Salvar".
  - Em 1366 × 768, a tela inteira cabe sem rolagem.
- **Integração**: as duas ligações em 6 + 6, com os dados em 4 colunas, e a tabela "Últimos envios ao FDV" na largura cheia.
- **Dados**: as duas tabelas lado a lado (6 + 6). As ações de lote ficam no título do cartão a que pertencem ("Baixar modelos"; "Carga completa" e "Zerar pedidos não faturados"), sem barra solta.

## Fora desta simulação
O BKO do cliente: o admin do cliente não tem /config e só vê o status das integrações, sem reprocessar (regra do Alexandre, R-20261127-175011). Depois de aprovada, esta Config vira o modelo da Config do FDV.
