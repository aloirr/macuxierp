# /config no padrão do ERP (T-0140, v0.3.33)

Desenho do designer-ux. Decisão 142 B do Alexandre (entra na v0.3.33). Origem: pedido do Alexandre de 28/11/2026, ~06h40 Manaus (R-20261128-064409), simulação aprovada às 06h46 (R-20261128-064621: grupos do menu abrem e fecham).

**Fonte visual não localizada.** A simulação `config-erp-20261128` fica em `macuxifdv-recados/recados/anexos/`, e esse clone não existe nesta sessão (só `macuxierp-recados` e `aloirr/macuxifdv`, sem a pasta). O desenho abaixo vem do texto dos recados R-20261128-064409 e -064621 e da config v4 aprovada (`R-20261127-180115-tokens-config-v4.md`). Conferir contra os prints da simulação antes de montar a tela.

Regras: telas horizontais, grade de 12 colunas, MENOS É MAIS (CLAUDE.md, regra 11) e botões embaixo e juntos (regra 12). Mensagem nunca começa com rótulo (125 B). Só tokens do `packages/ui` (`telas-horizontais.md`).

## 1. Mapa de navegação

Menu lateral no padrão do BKO (`<nav>` com grupos em acordeão: seta `>` fechado, `⌄` aberto; só o grupo da tela atual abre sozinho; a **T-0138** entrega o acordeão). Cada usuário vê só os itens que o perfil libera; item sem permissão não aparece (nem desabilitado). Selo "Plataforma" no topo grafite, como em `portal-config.md`.

```
EMPRESAS                        (perfil com plataforma.empresas)
  Empresas                      /config/empresas            lista
    Ficha da empresa            /config/empresas/:id        abas: Dados · Módulos · Integração
INTEGRAÇÕES                     (perfil com plataforma.integracoes)
  Macuxi FDV  >                 (subgrupo, abre e fecha)
    Integração                  /config/integracoes/fdv     seletor de empresa
ACESSO                          (perfil com plataforma.acesso)
  Usuários                      /config/acesso/usuarios     equipe da Macuxi ERP
  Perfis e permissões           /config/acesso/perfis
  Auditoria                     /config/acesso/auditoria
```

- **Superadmin** vê os três grupos. Outro perfil da equipe vê só o que tiver.
- **Menu que some** (decisão 133 B, R-20261128-062108): fica resolvido aqui. O menu é um componente único, montado do mesmo descritor de permissões da sessão, nunca por tela; os grupos recolhem, a barra não some. Esconder a barra inteira é opcional e fora da v0.3.33.
- **Empresas, aba "Integração"**: só o bloco **Sistema do cliente → ERP**. Saem "Envios recentes" e tudo do FDV, que passa a viver só em Integrações > Macuxi FDV > Integração. Nenhuma informação aparece nos dois lugares.
- **Acesso** é da equipe da Macuxi ERP (os usuários do próprio ERP), não dos usuários de empresa (esses ficam na ficha da empresa, sem dado de negócio, como em `portal-config.md`).

## 2. Telas

Todas: página na largura toda, grade `repeat(12, 1fr)` com vão de 12 px, cartão sobre `branco` com borda e canto `--mx-medida-canto-cartao` (8 px), padding 16 px (tabela sem padding). Título do bloco fora do cartão, 13 px, peso `--mx-peso-titulo`, caixa-alta, `rotuloDestaque` (Azul noite). Campo `--mx-medida-altura-campo` (34 px); linha `--mx-medida-altura-linha-tabela` (36 px); th com `--mx-peso-cabecalho-tabela` e `rotuloDestaque`. Dado só de leitura é texto; aviso de status é `Chip`/selo com texto junto da cor. Barra de botões: uma por bloco, no rodapé do bloco (ações à esquerda, destrutivos à direita); ações da página só na barra do rodapé da página; fora delas só busca e links de linha. Ações por linha ficam no `MenuAcoes` (Ações ▾), que não conta como botão solto.

### 2.1 Empresas > lista (`/config/empresas`)
- Bloco único, **12 colunas**: `TabelaDensa` (Slug, Nome, Situação, Módulos), busca no cabeçalho do bloco, filtro na URL (`?busca=`), "Carregar mais" no rodapé do bloco.
- Rodapé da página: **Criar empresa** (principal).
- Textos e estados vazios como em `portal-config.md` §2.

### 2.2 Empresas > ficha (`/config/empresas/:id`)
- Cabeçalho: nome, slug, selo de situação. Abas: **Dados**, **Módulos** (conteúdo igual, só passa à grade de 12) e **Integração**.
- **Dados:** Identificação (6) + Endereço (6); linha CNAE (4) | Contato (4) | 1º administrador (4); tabela Usuários (12). Campo curto em 1 a 2 colunas.
- **Módulos:** lista de caixas (12), regras de `portal-config.md` §4.
- **Integração:** só **Sistema do cliente → ERP**, em 12 colunas: bloco "Registros na carga" (`TabelaDensa`: Cadastro, Registros, Situação, Última carga; **sem coluna do lote**); por linha, `MenuAcoes` "Ações ▾" com **Importar arquivo**, **Baixar modelo**, **Ver log**. Rodapé do bloco: **Trocar chave** e **Revogar chave** (destrutivo, à direita, com confirmação digitada, como na config final aprovada).
- Rodapé da página: estado ("Nenhuma alteração pendente") à esquerda; à direita Suspender/Reativar (destrutivo), Descartar e Salvar (principal).

### 2.3 Integrações > Macuxi FDV > Integração (`/config/integracoes/fdv`)
- Faixa de topo (12): **seletor de empresa** (3 colunas) e, ao lado, a situação da ligação em selo (2). Troca de empresa pela URL (`?empresa=`).
- **ERP → FDV** (12): uma `TabelaDensa` por cadastro (Cadastro, Último envio, Pendentes, Situação), com "Ações ▾" por linha: **Ver log**, **Reprocessar**, **Reenviar tudo ao FDV** (esta com `DialogoMotivo` destrutivo).
- **Aviso só quando houver erro:** um `FaixaPendencias` acima das tabelas, com o problema e a ação ("3 cadastros com erro. Abra o log e reprocesse."). Sem erro, nenhum aviso.
- Uma barra no rodapé: **Testar conexão**, **Trocar chave**, **Zerar pedidos…** (destrutivo, à direita, com confirmação digitada) e **Salvar** (principal).

### 2.4 Acesso > Usuários (`/config/acesso/usuarios`)
- Bloco único (12): `TabelaDensa` (Nome, E-mail, Perfil, Situação, Último acesso), busca, filtros na URL. Equipe Macuxi ERP; sem usuário de empresa.
- Rodapé da página: **Novo usuário** (principal). Edição em página própria com a barra de rodapé (Salvar, Descartar; Bloquear à direita).

### 2.5 Acesso > Perfis e permissões (`/config/acesso/perfis`)
- Esquerda (4): lista de perfis. Direita (8): matriz de permissões por grupo do menu (caixas com texto, nunca só cor); o perfil superadmin é fixo e não editável.
- Rodapé da página: Descartar e **Salvar**.

### 2.6 Acesso > Auditoria (`/config/acesso/auditoria`)
- Filtros na URL (período, usuário, ação) em 12 colunas, 1 a 2 colunas cada; `TabelaDensa` (Quando, Quem, Ação, Alvo, Resultado). Só leitura: sem barra de botões; "Carregar mais" no rodapé do bloco. Sem dado pessoal em log nem no motivo.

## 3. Os dois 🟡 do PO

1. **"COM ERRO" × "FALHA": um nome só. Fica "Com erro"** (selo `Chip` tom `aviso`, com contagem quando houver: "3 com erro"), igual ao que a carga já mostra (`cargas.ts`, "N com erro"). "Falha" deixa de existir como situação de cadastro ou lote. Quando a leitura em si não responde, o selo é "Indisponível" (já existente), que é outro estado. Vale para as telas 2.2 e 2.3 e para o log.
2. **"Sem contato" no lugar de "Atrasado" quando nunca houve contato.** "Atrasado" só existe com último contato anterior à janela esperada (selo aviso, com "Último contato <data>"). Sem nenhum contato registrado (ligação nova ou chave nunca usada): selo "Sem contato" (tom neutro, sem alarme), e a coluna da data mostra "—". A derivação na web é do `engenheiro-apps` (hoje `operacao-fdv.ts` mapeia `atrasado`); a API entrega `ultimo_contato` nulo.

## 4. Plano por dono e estimativa

Tempo do dono, sem a margem de 15% (a previsão a aplica).

| Dono | Entrega | Horas |
|---|---|---|
| engenheiro-apps | Shell da /config com menu por perfil e acordeão (reaproveita a T-0138); páginas Empresas (lista, ficha com aba Integração enxuta), Integrações > FDV (seletor, tabelas, Ações ▾, barra do rodapé), Acesso (Usuários, Perfis, Auditoria); selos "Com erro" e "Sem contato"; prints 1366/1920 | **9 h** |
| engenheiro-software | Se faltar: API da equipe Macuxi ERP para **Perfis e permissões** (CRUD, perfil superadmin fixo, permissão por rota) e **Auditoria** (listagem filtrável, cursor), contratos Zod em `platform-sdk`, testes; `ultimo_contato` nulo no contrato da ligação. **A confirmar:** só vi que existe `packages/platform-sdk/src/auditoria.ts`; não verifiquei a API. | 0 h se já existir; até 4 h se faltar |
| designer-ux | Este desenho; no `packages/ui`, `MenuLateral` com grupos e subgrupo (se a T-0138 já cobrir o acordeão, só o subgrupo), selo "Sem contato", conferência do token de grade; revisão dos prints em 1366 e 1920 | **3 h** (1 h antes, 2 h na revisão) |
| design-de-marca | Validar layout e o selo neutro | 0,5 h |
| testes | E2E do menu por perfil (item oculto sem permissão) | 1 h |

## 5. Ordem

1. **v0.3.32 (já):** T-0138 (acordeão do menu) e T-0139 (botão do usuário). O componente do menu nasce aqui; a T-0140 só o reutiliza com os grupos da /config.
2. **v0.3.33, passo 1:** designer-ux publica o subgrupo do menu e o selo "Sem contato"; em paralelo, engenheiro-software confirma e entrega Perfis e Auditoria da equipe.
3. **Passo 2:** engenheiro-apps monta nesta ordem: shell com menu por perfil (absorve "menu que some") → Empresas (ficha, aba Integração enxuta, sem "Envios recentes") → Integrações > Macuxi FDV > Integração → Acesso (Usuários, Perfis, Auditoria). Acesso fica por último para a API não bloquear o resto.
4. **Passo 3:** designer-ux e design-de-marca revisam os prints em 1366 e 1920; corretor numa rodada; PR.
5. Caminho crítico: engenheiro-apps (9 h).

## Pendências e riscos
- Conferir com a simulação `config-erp-20261128` quando o clone `macuxifdv-recados` estiver disponível (ver topo).
- As permissões `plataforma.empresas`, `plataforma.integracoes` e `plataforma.acesso` são propostas deste desenho; o nome final é do engenheiro-software.
