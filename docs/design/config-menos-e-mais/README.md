# Config "menos é mais": simulação (PROPOSTA, direção v4 aprovada na decisão 40)

Pedidos do Alexandre de 27/11 (Manaus):
- 17h48, R-20261127-174851: "MENOS É MAIS"; a página se preenche primeiro na horizontal, com tamanhos padrão;
- 17h58: "botoes sempre embaixo e juntos";
- decisão 40, por volta das 18h02, com a direção v4 do Gerente Sênior.

Ajustes do PO de 18h02 e 18h04 e tabela Usuários (R-20261127-175402). Só dados **fictícios**. O PR da Config vai na v0.3.28 e só sai depois do "aprovado" da simulação.

O que tem aqui: `simulacao.html` (abra com `#lista`, `#empresa`, `#excluir`, `#integracoes` ou `#zerar`) e 10 PNG: lista, empresa, empresa-excluir-usuario, integracoes e integracoes-confirmacao-digitada, cada um em 1366 e 1920.

## Tokens (proposta)
Sem escala paralela. Mudam os valores de papéis que já existem, o que muda a regra de 27/11 e precisa do "aprovado":
- `h1`: 24 → 20;
- título de seção (`tituloCartao`): 20 → 13, caixa-alta, azul-noite, **fora da caixa**;
- `rotuloDado`, usado também em `label`: 13 → 12;
- texto de campo e célula: 15 → 13.

Tokens novos:
- `alturaCampo` 34 px, para campo e todo botão;
- `espaco` 12 px;
- `cantoCartao` 8 px;
- **`corCabecalhoTabela` #E6EBF3**: está na v4 aprovada. O design-de-marca não aprova (fica quase igual à `nevoa` #ECEEF1, 1,03:1, e não existe no FDV) e propõe a `nevoa`. Quem decide é o Alexandre.
- `corLinhaAlternada` #FBFAF8: zebra da v4.

Na tabela: cabeçalho em `corCabecalhoTabela`, com texto azul-noite em negrito e linha azul-noite de 2 px; linhas alternadas em `perola`. A grade de 12 colunas, o vão de 16 e a margem de 24 vêm de `telas-horizontais.md`.

## Regra dos botões
- **Cartão**: uma barra só, no rodapé. Ações à esquerda; as destrutivas à direita, em `erroTexto`, com confirmação, e só para o superadmin.
- **Página** (v4): barra fixa no rodapé, com o estado à esquerda ("2 campos alterados"). À direita, nesta ordem: Suspender empresa (destrutivo), Atualizar pela Receita, Descartar e Salvar (primário).
- **Confirmação digitada**: Substituir tudo, Zerar cadastros e Zerar pedidos não faturados pedem o código da empresa e só aparecem para o superadmin (`integracoes-confirmacao-digitada-*`).
- **Fora das barras**: só a busca, os links de linha da tabela ("Editar · Ações ▾", ou um "Ações ▾" único, com Importar ou Log dentro) e os links de campo ("trocar" no CNPJ e "mostrar" no dado mascarado).
- **Topo do shell**: "Sair" é link, e não botão.

## Telas
- `lista-*`: título e busca; tabela com Empresa, Código, CNPJ, Situação, Módulos, Macuxi FDV e Criada em. Sem dado de negócio. "Criar empresa" fica na barra.
- `empresa-*`:
  - cabeçalho com nome, código, "Ativa" e "Igual à Receita · 27/11 13h15";
  - abas Empresa e Integrações;
  - Identificação em 3 linhas de 12 colunas;
  - CNAE 5, Contato 4 e Módulos 3;
  - Usuários: busca, e-mail mascarado com "mostrar", situações Ativo, Bloqueado, Inativo e Convite enviado, "Editar · Ações ▾" (Redefinir senha, Inativar, Excluir) e "+ Adicionar usuário" no rodapé.
- `empresa-excluir-usuario-*`: o bloqueio do último administrador ativo, só com "Fechar".
- `integracoes-*`: uma coluna por sentido.
  - **Sistema do cliente → ERP**:
    - cartão da ligação com Trocar chave do cliente, e Revogar chave em vermelho;
    - **Cargas recebidas**: Baixar modelos e Baixar erros, e Substituir tudo e Zerar cadastros em vermelho.
  - **ERP → Macuxi FDV**:
    - cartão da ligação com Registros por lote (salvo pela barra da página), Testar conexão e Trocar chave do FDV;
    - **Envios**: Carga completa, e Zerar pedidos não faturados em vermelho.

## Fora desta simulação
O BKO do cliente: o admin do cliente não tem /config e só vê o status das integrações (R-20261127-175011). Depois de aprovada, esta Config vira o modelo da Config do FDV.

## Validação (27/11, por volta das 18h15)
- design-de-marca: 🟢 nos botões, nos selos e nos links. 🟡 na cor #E6EBF3 (ver Tokens).
- corretor-redundancias: 🟢 nos botões. Os 🟡 foram aplicados:
  - o selo de situação aparece só na exceção ("Parcial");
  - "—" no lugar de "Desligada" para quem não tem o módulo;
  - "1 campo alterado" na aba Integrações.
- Divergências com a v4, feitas de propósito:
  - o rótulo de 11,5 px virou 12 e o botão de 12,5 px virou 13, para ficar na escala da marca;
  - o rótulo fica em azul-noite, e não no cinza da v4, pela regra de hierarquia de 27/11.
