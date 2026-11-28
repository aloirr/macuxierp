# ADR 0022 — Planos e licenças do ERP (A + D): catálogo como dado, trava de usuários e troca de plano

- **Status:** Proposta (28/11/2026). Os preços e o mapa perfil → tipo de licença estão **PENDENTES** do Alexandre (seção "Pendente do Alexandre"). Tudo fica atrás da bandeira `MACUXIERP_PLANOS`, desligada.
- **Data:** 28/11/2026, 07h10 (Manaus)
- **Dono:** engenheiro-software
- **Tarefa:** T-0054 (v0.3.32). Banco: migração **0083** (banco-dados), reservada pelo gerente para esta tarefa.
- **Origem:**
  - R-20261123-112038-alexandre: "planos do ERP: opção A + D (recomendada)", sem limite de NF-e, no molde da ADR 0047 do FDV;
  - decisão 131 do Alexandre (28/11, ~05h50, R-20261128-054929-gerente-projetos): "131 · Macuxi ERP, Planos A+D (T-0054): A (vai para a v0.3.32)".
- **Molde:** ADR 0047 do FDV (`aloirr/macuxifdv`, só leitura). **Copia a regra, não o conteúdo:** no ERP não há vendedor, gestor nem promotor como tipo de licença; há conta do BKO e filial emissora.
- **Relaciona:** ADR 0012 (portal `/config` e lista fechada de funções `SECURITY DEFINER`), RN-CORE-01 (perfis), RN-CORE-02 (licença do módulo), RN-CORE-09 (analista de implantação), regra 4 (centavos) e regra 6 (perfil, tenant e licença em toda rota).

## Contexto
Hoje a empresa nasce no `/config` (ADR 0012) com uma lista de módulos em `plataforma.tenant_modulo` (ativo, `valido_ate`). Não existe plano, preço, teste grátis nem teto de usuários. O cadastro de usuários, no BKO (core) e no `/config` (`plataforma.empresa_usuario_criar`, 0078), aceita qualquer número de contas.

O Alexandre aprovou dois modos de venda:
- **A, por usuário:** três planos com teto de usuários e de filiais emissoras, a Integração FDV inclusa ou adicional, usuário extra e filial extra;
- **D, combo FDV:** para o cliente com o Macuxi FDV ativo, o valor é por vendedor ativo no FDV, com mínimo, usuários ilimitados e a integração inclusa.

Valem para os dois: anual com meses grátis, teste de 14 dias e um plano **Piloto**, interno e sem cobrança, para a thathyany (AM2808). A trava nunca bloqueia quem já usa, e **não há limite de NF-e** em nenhum plano.

## Decisão

### 1. O catálogo é dado, nunca código (RN-PLA-01)
`plataforma.plano`, uma linha por plano e versão, com as colunas da regra 5 (`tenant_id` = tenant de referência, como as tabelas oficiais, D9) e mais estas:
- `codigo`, `versao` (inteiro, começa em 1), `nome`, `ordem` e `ativo`;
- `modalidade`: `por_usuario` (A), `combo_fdv` (D) ou `interno` (Piloto);
- `preco_mensal_centavos` (A) ou `preco_por_vendedor_centavos` e `minimo_mensal_centavos` (D), inteiros; o Piloto tem tudo zero;
- `licencas` (jsonb), com os tipos da seção 2 e `null` = sem limite;
- `modulos` (text[]), os módulos incluídos; `core` entra sempre;
- `adicionais` (jsonb): cada um com `codigo`, `preco_unitario_centavos` e `incluidos`; o adicional só vale se o plano o vende;
- `meses_gratis_anual`, `dias_teste`;
- `mapa_perfis` (jsonb): perfil → tipo de licença ou `nao_conta` (seção 2). Sem `default`: a linha só é gravada com o mapa completo.

O preço muda por **versão nova** do plano (`codigo`, `versao` único), nunca por `UPDATE` do preço. A assinatura guarda a versão que contratou. **Nenhum número vai em código, migração ou ADR:** os planos entram pelo seed do banco-dados, com os valores e o mapa tirados só do recado de confirmação do Alexandre (seção "Pendente do Alexandre").

**Sem limite de NF-e:** o catálogo não tem coluna de notas, e nenhuma rota do faturamento ou do fiscal consulta o plano. Isso também afasta qualquer trava no caminho da emissão (regra 7).

Os contratos ficam em `packages/platform-sdk/src/planos.ts` (`PlanoSchema`, `ListaPlanosSchema`, `AssinaturaSchema`, `FichaAssinaturaSchema`, `TrocarPlanoSchema`), pelo engenheiro-software, depois do PR do SDK que está em andamento (T-0129).

### 2. Tipos de licença (RN-PLA-02)
Três itens são contados contra o plano:

| Tipo | O que conta | Quem conta |
|---|---|---|
| `usuario` | conta ativa do BKO, não excluída, cujo perfil o `mapa_perfis` do plano aponta como `usuario` | a função `licencas_do_tenant()` (§4) |
| `filial_emissora` | `cadastros.filial` viva com `emissora = true` | idem |
| `integracao_fdv` | 1 quando o módulo `integracao-fdv` está ligado no `tenant_modulo` | idem |

Os adicionais vendidos somam ao teto do item:
- `usuario_extra` soma em `usuario`;
- `filial_extra` soma em `filial_emissora`;
- `integracao_fdv`, nos planos que não a incluem, libera o módulo.

Regras de contagem:
- usuário inativo ou excluído não conta; o bloqueado por senha (RN-CORE-15) continua contando;
- um perfil por usuário (RN-CORE-01), então uma conta ocupa no máximo uma licença;
- o perfil marcado `nao_conta` no mapa não ocupa licença;
- **carência do analista de implantação** (RN-CORE-09): o usuário com esse perfil não ocupa licença nos primeiros 60 dias, contados do `created_at` da conta (premissa 3); a partir do 61º dia, conta pelo tipo do mapa;
- o superadmin da Plataforma nunca conta: ele não é usuário de tenant (ADR 0012 §1).

O mapa perfil → tipo (quais dos 7 perfis da RN-CORE-01 contam como `usuario` e quais ficam `nao_conta`) é **PENDENTE**. Enquanto o seed não trouxer o mapa, a bandeira não liga (seção 7).

### 3. A assinatura
`plataforma.assinatura`, uma viva por tenant (índice único parcial em `tenant_id` sem `deleted_at`), com as colunas da regra 5, RLS ligado e mais estas:
- `plano_id` (a linha da versão contratada);
- `ciclo` (`mensal` ou `anual`);
- `adicionais` (jsonb, código → quantidade);
- `teste_ate` (date, no fuso da empresa, ou nula);
- `paga` (boolean);
- `vendedores_fdv` e `vendedores_fdv_em` (só na modalidade D, para o valor; seção 6);
- `pedido_id` (uuid, a idempotência da última troca).

`plataforma.assinatura_historico` guarda cada criação e troca: plano e versão de antes e de depois, ciclo, adicionais, `pedido_id`, autor (`superadmin_id`) e `ocorrido_em`. É só de inserção, e a assinatura nunca é apagada fisicamente. A auditoria vai também para a `plataforma.auditoria` (`plataforma.assinatura.criar` e `.trocar`), sem nome de empresa nem dado pessoal (regra 8).

O tenant lê a própria assinatura e o histórico só sob RLS (`SELECT` para o `macuxierp_app`). Ninguém do tenant escreve: a escrita é só pelas `sa_*` (§8).

### 4. A trava (RN-PLA-04, 422 `LICENCAS_ESGOTADAS`)
- A regra é a função pura `conferirNovoUsuario(situacao, mudanca)` do SDK. Ela recebe a situação devolvida pela `licencas_do_tenant()` e devolve `ok` ou a violação com o item (`usuario`, `filial_emissora` ou `integracao_fdv`), o contratado e o em uso.
- **Onde a trava vale:**
  - criar e reativar usuário;
  - mudar o perfil de um usuário para um perfil que conta;
  - marcar uma filial como emissora;
  - ligar o módulo `integracao-fdv`.
  Ela vale no BKO (core) e no `/config` (`empresa_usuario_criar` e as demais funções da 0078).
- **Na mesma transação** do insert ou update, quem grava chama `plataforma.licencas_do_tenant()`. A função é `SECURITY INVOKER`, roda sob RLS, faz `FOR UPDATE` na linha da assinatura e devolve, por item, o contratado (plano + adicionais) e o em uso. O `FOR UPDATE` serializa duas criações simultâneas, que assim nunca passam do limite. Nas funções `SECURITY DEFINER` do `/config`, a mesma conferência roda dentro da função, antes do insert.
- **Recusa:** 422 com `codigo = 'LICENCAS_ESGOTADAS'` e `detalhes = { item, contratado, em_uso }`. A mensagem é "O plano da empresa não tem mais licenças de <item>. Fale com a Macuxi para ampliar." (texto final com o designer-ux; regra 125 B, sem rótulo no início). No banco, a recusa é SQLSTATE 22023 com o código no `hint`, como na ADR 0047.
- **Teste vencido sem pagamento** (`teste_ate` no passado e `paga = false`): trava só a criação, com 422 `TESTE_VENCIDO`; não bloqueia o uso nem o login.
- **A trava nunca bloqueia quem já usa:** ela só olha a mudança pedida. Uma empresa acima do teto (por exemplo, por uma carência que venceu) continua usando tudo; só não cresce.
- **Sem assinatura, não trava:** a empresa anterior aos planos segue como hoje até ganhar uma assinatura.
- **Filial emissora:** marcar `emissora` é do módulo cadastros. Por isso, a conferência da filial é do modulo-cadastros (§9, pedido à parte). A contagem fica dentro da `licencas_do_tenant()`, que é infraestrutura do banco-dados, como a `tenant_modulo`. Nenhum módulo lê `cadastros.filial` direto (regra 1).

### 5. Troca de plano (RN-PLA-05)
- `PUT /v1/plataforma/empresas/:tenant_id/assinatura`, só do superadmin, idempotente por `pedido_id`: o mesmo `pedido_id` devolve a mesma resposta e não grava de novo.
- A troca é recusada quando o plano novo, com os adicionais pedidos, fica abaixo do uso em qualquer item: 422 `PLANO_ABAIXO_DO_USO`, com a lista dos itens. **A troca nunca desativa usuário, filial nem módulo.**
- A API confere antes com a função pura `conferirTrocaDePlano` do SDK, e a `sa_trocar_plano` confere de novo na transação, com o `FOR UPDATE` da assinatura.
- A troca liga no `tenant_modulo` os módulos do plano novo (`modulosDaAssinatura`) e nunca desliga um módulo em uso. Desligar continua pelo fluxo de módulos do `/config`, que tem as próprias regras (RN-CORE-02).
- Mudar a modalidade (A ↔ D ↔ Piloto) é uma troca como as outras, com as mesmas conferências.

### 6. Valor e teste (RN-PLA-06)
- **Modalidade A:** valor mensal = `preco_mensal_centavos` + Σ(quantidade × `preco_unitario_centavos` dos adicionais).
- **Modalidade D:** valor mensal = max(`minimo_mensal_centavos`, `vendedores_fdv` × `preco_por_vendedor_centavos`) + adicionais.
  - O `vendedores_fdv` é a quantidade de vendedores ativos no FDV. Ela vem só pela API do Hub (`/integracao/v1`), nunca de tabela do FDV (regra 1), gravada com a data da leitura.
  - Até existir a rota do Hub que devolve essa contagem (pendência do modulo-integracao-fdv, §9), o superadmin informa o número na troca, e a ficha mostra a data.
  - O D não trava usuários: o `mapa_perfis` do D aponta tudo para `nao_conta` ou o `licencas.usuario` é `null`. Isso sai do seed, não do código.
- **Anual:** paga (12 − `meses_gratis_anual`) × mensal. Tudo em centavos inteiros, sem divisão.
- **Teste:** de hoje, no fuso da empresa (RN-CORE-04), até hoje + `dias_teste` − 1, inclusive.
- **Piloto:** `interno`, valor zero, sem teste e com `paga = true`. A thathyany (AM2808) entra no Piloto pelo seed, com o mesmo teto de hoje: sem limite.
- O valor é só informativo nesta versão. **Não há cobrança, boleto nem integração de pagamento** (contas a pagar e cobrança recorrente estão fora da v1).

### 7. Bandeira `MACUXIERP_PLANOS`
- Padrão desligado. Ligada só com `MACUXIERP_PLANOS=1` no ambiente da API, depois da 0083 aplicada e do seed com os preços e o mapa.
- **Com ela desligada:**
  - as rotas da seção 8 respondem 404;
  - o core e o `/config` não chamam a `licencas_do_tenant()`;
  - as telas escondem o bloco "Plano";
  - nada muda para as empresas atuais.
- **Com ela ligada:**
  - a API confere na subida que existe ao menos um plano ativo com `mapa_perfis` completo; se não existir, não sobe (falha cedo, sem trava pela metade);
  - a empresa sem assinatura continua sem trava.
- O worker não lê a bandeira: nenhuma fila depende de plano.

### 8. Rotas do portal (com a bandeira ligada)
| Rota | Quem | O que faz |
|---|---|---|
| `GET /v1/plataforma/planos` | superadmin | a lista dos planos ativos (última versão de cada código) |
| `POST /v1/plataforma/empresas-com-plano` | superadmin | o mesmo fluxo do `POST /v1/plataforma/empresas`, com os módulos tirados do plano, e a assinatura gravada pela `sa_gravar_assinatura`, idempotente. Com `simular`, não grava |
| `GET /v1/plataforma/empresas/:tenant_id/assinatura` | superadmin | a ficha: plano, versão, ciclo, adicionais, teste, licenças contratadas e em uso por item, e valor mensal e anual |
| `PUT /v1/plataforma/empresas/:tenant_id/assinatura` | superadmin | a troca de plano (§5) |
| `GET /v1/core/assinatura` | administrador do tenant | a mesma ficha, só da própria empresa, sob `comTenant` e RLS. Fica em `/v1/core`, porque o JWT do tenant nunca vale em `/v1/plataforma` (ADR 0012 §2) |

**Funções novas da lista fechada da ADR 0012 §4** (0083, schema `plataforma`, `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`, `REVOKE ALL ... FROM PUBLIC`, EXECUTE só do `macuxierp_config`, sessão "sim", começam por `exigir_superadmin()` e auditam na mesma transação):

| Função | O que faz |
|---|---|
| `sa_listar_planos()` | os planos ativos, sem o `mapa_perfis` interno (vai só o resumo do que conta) |
| `sa_ler_assinatura(tenant_id)` | a ficha, chamando a mesma contagem da `licencas_do_tenant()` para o tenant pedido |
| `sa_gravar_assinatura(tenant_id, plano_id, ciclo, adicionais, teste, pedido_id)` | cria a assinatura; repetir o mesmo `pedido_id` devolve a mesma, sem gravar |
| `sa_trocar_plano(tenant_id, plano_id, ciclo, adicionais, vendedores_fdv, pedido_id)` | a troca, com a conferência abaixo do uso, o histórico e a ligação dos módulos |

E, fora da lista fechada:
- `licencas_do_tenant()`, `SECURITY INVOKER`, EXECUTE do `macuxierp_app` e do `macuxierp_config`. Ela lê o tenant de `app.tenant_id` e devolve vazio quando não há assinatura.

**SQLSTATE → HTTP**, no `apps/api/src/plataforma/erros.ts` e no `erro-pg.ts` do core:
- `MXS01` = 401;
- `42501` = 403;
- `P0002` = 404;
- `22023` = 422 na escrita (código no `hint`: `LICENCAS_ESGOTADAS`, `TESTE_VENCIDO`, `PLANO_ABAIXO_DO_USO`, `PLANO_INATIVO` ou `ADICIONAL_NAO_VENDIDO`) ou 400 na leitura.

### 9. Quem faz o quê (para o gerente disparar)
Ordem: E1 → E2 (banco e SDK em paralelo) → E3 (core e API) → E4 (telas) → E5 (testes).

| Etapa | Dono | Entrega | Pronto quando |
|---|---|---|---|
| E1 | engenheiro-software | esta ADR | merge no `main` |
| E2 | banco-dados | migração **0083**: `plataforma.plano`, `plataforma.assinatura`, `plataforma.assinatura_historico` (regra 5, RLS, colunas da §1 e §3); `plataforma.licencas_do_tenant()` (§4, com o `FOR UPDATE` e a carência de 60 dias); as quatro `sa_*` da §8; a conferência da trava dentro de `empresa_usuario_criar` e das demais funções de usuário da 0078 (só quando existe assinatura); o seed **sem números** até o recado do Alexandre (o seed com valores sai em PR próprio, depois do recado); `db/testes/planos-0083.db.test.ts`, que prova: RLS (o tenant lê só a própria assinatura, não escreve); EXECUTE só do `macuxierp_config` nas `sa_*`; duas criações simultâneas não passam do teto; o inativo não conta e o bloqueado conta; a carência de 60 dias; a troca abaixo do uso recusada; a idempotência por `pedido_id`; e a empresa sem assinatura sem trava | testes de banco verdes com `MACUXI_PG_EXIGIR=1` |
| E2 | engenheiro-software | `packages/platform-sdk/src/planos.ts`: os schemas Zod da §1; as funções puras `conferirNovoUsuario`, `conferirTrocaDePlano`, `valorMensal`, `valorAnual`, `fimDoTeste` e `modulosDaAssinatura`, com teste antes citando RN-PLA-01..06; os códigos de erro; a bandeira `planosLigados(env)`. Só depois do PR do SDK em andamento (T-0129) | unitários do SDK verdes |
| E3 | modulo-core | a trava no BKO: criar, reativar e mudar perfil (`alterar-usuario.ts` e o repositório), na mesma transação, com `licencas_do_tenant()` e `conferirNovoUsuario`; a rota `GET /v1/core/assinatura` (só o administrador); a tradução dos SQLSTATE no `erro-pg.ts`; e, no plugin de plataforma, as rotas da §8 chamando só as `sa_*`. Testes citando RN-PLA-02, RN-PLA-04 e RN-PLA-05 | unitários e de banco do core verdes |
| E3 | engenheiro-software | apps/api: a bandeira, a conferência na subida, a montagem das rotas e o `erros.ts`; revisão final | typecheck e testes da API verdes |
| E4 | engenheiro-apps | `/config`: o passo "Plano" no criar empresa (com a simulação), a ficha da assinatura no detalhe da empresa e a troca de plano com a lista dos itens abaixo do uso; BKO: o bloco "Plano" (só leitura) para o administrador e o 422 `LICENCAS_ESGOTADAS` na tela de usuários. Grade de 12 colunas, tokens do `packages/ui`, botões no rodapé (regras 11 e 12); prints em 1366 e 1920 px | prints validados pelo `design-de-marca` |
| E5 | testes | `tests/`: a trava ponta a ponta (BKO e `/config`), a bandeira desligada sem efeito e o fluxo do Piloto | suíte verde |

**Fora dos quatro donos (pedidos à parte, pelo gerente):**
- **modulo-cadastros:** a trava `filial_emissora` ao marcar `emissora = true`, com a mesma `licencas_do_tenant()`;
- **modulo-integracao-fdv:** a contagem de vendedores ativos pela API do Hub, para a modalidade D (§6);
- **designer-ux:** os textos finais;
- **gerente-projetos:** as RN-PLA-01..06 no doc 03, pelo PO.

## RN novas propostas (para o doc 03)
- **RN-PLA-01** Catálogo: o plano é dado (modalidade, preço por versão, licenças por tipo, módulos, adicionais e mapa de perfis). O adicional só vale se o plano o vende, e o core entra sempre. Não há limite de NF-e.
- **RN-PLA-02** Tipos e contagem: `usuario`, `filial_emissora` e `integracao_fdv`. O perfil dá o tipo pelo mapa do plano. O inativo e o excluído não contam; o bloqueado conta. O analista de implantação não conta nos primeiros 60 dias da conta.
- **RN-PLA-04** Trava: não cria, reativa, muda perfil, marca filial emissora nem liga a integração além do contratado (422 `LICENCAS_ESGOTADAS`). O teste vencido sem pagamento trava só a criação (422 `TESTE_VENCIDO`). Nunca bloqueia quem já usa. Sem assinatura, não trava.
- **RN-PLA-05** Troca de plano: recusada abaixo do uso, item a item (422 `PLANO_ABAIXO_DO_USO`). Nunca desativa usuário, filial nem módulo. É idempotente pelo `pedido_id`.
- **RN-PLA-06** Valor: o A é o plano mais os adicionais; o D é o maior entre o mínimo e vendedores × preço, mais os adicionais; o anual é (12 − meses grátis) × mensal, em centavos. O teste dura `dias_teste` dias corridos, no fuso da empresa. O Piloto vale zero.

(A RN-PLA-03 do FDV, "por usuário" da Pesquisa e do Treinamento, não tem equivalente no ERP; o número fica vago para manter a correspondência com a ADR 0047.)

## Pendente do Alexandre (nada disso entra sem o recado dele)
1. **Preços:**
   - A: o mensal de cada plano, o adicional da Integração FDV, o usuário extra e a filial extra;
   - D: o preço por vendedor e o mínimo;
   - para os dois: os meses grátis do anual e os dias de teste.
   Os números do recado de 23/11 (R-20261123-112038-alexandre) são a proposta do PO. O seed só os usa depois da confirmação do Alexandre, citada pelo id do recado. **PENDENTE.**
2. **Tetos por plano:** usuários e filiais emissoras de cada plano do A, e se o D tem teto de filial. **PENDENTE.**
3. **Mapa perfil → tipo de licença:** para cada perfil da RN-CORE-01 (administrador, gerente, faturista, fiscal, vendedor, leitura e analista de implantação), se ocupa `usuario` ou `nao_conta`. **PENDENTE.**

## Premissas (a confirmar com o PO)
1. O bloqueado por senha continua contando, como no FDV.
2. O teste vencido sem pagamento trava só novos cadastros, sem bloquear o uso.
3. A carência de 60 dias do analista conta do `created_at` da conta, e não do início da assinatura.
4. O administrador do tenant só vê a ficha. Quem troca de plano é só o superadmin.
5. A thathyany fica no Piloto, sem teto.

## Alternativas consideradas
- **Planos como constantes no SDK:** descartada. Cada preço viraria deploy, e o histórico da assinatura se perderia.
- **Trava só na API, sem a função SQL:** descartada. Duas criações simultâneas passariam do limite.
- **Reaproveitar o `tenant_modulo`:** descartada. Ele liga módulo e não tem tipo de licença, ciclo, teste nem adicionais.
- **Contar vendedores lendo o banco do FDV:** proibida pela regra 1. Só pela API do Hub.
- **Limite de NF-e por plano:** descartada pelo Alexandre ("sem limite de NF-e"). Ela também colocaria uma trava no caminho da emissão.

## Consequências
- Com a bandeira desligada, nada muda. Ligada, só as empresas com assinatura passam a ter trava.
- A lista fechada da ADR 0012 §4 ganha quatro funções `sa_*`, todas com teste de banco.
- O `tenant_modulo` continua sendo a fonte da licença do módulo (RN-CORE-02). O plano só liga módulos nele e nunca desliga.
- O seed com os números é um PR do banco-dados à parte, depois do recado do Alexandre.
