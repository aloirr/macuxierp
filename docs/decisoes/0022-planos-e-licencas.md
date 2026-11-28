# ADR 0022 — Planos e licenças do ERP (A + D): catálogo como dado, trava de usuários e troca de plano

- **Status:** Proposta (28/11/2026). Os preços, os tetos e a regra de contagem estão **DECIDIDOS** pelo Alexandre (R-20261123-112038-alexandre; decisões 138 A e 139 A; decisão do PO de 28/11, 07h24). Tudo fica atrás da bandeira `MACUXIERP_PLANOS`, **desligada até o Alexandre ver a tela**.
- **Data:** 28/11/2026, 07h10 (Manaus). Revista às 07h30, com as decisões do PO das 07h24 e 07h25. Nada fica pendente.
- **Dono:** engenheiro-software
- **Tarefa:** T-0054 (v0.3.32). Banco: migração **0083** (banco-dados), reservada pelo gerente para esta tarefa, com o seed do catálogo.
- **Origem:**
  - R-20261123-112038-alexandre (23/11, 11h20): "planos do ERP: opção A + D (recomendada)", sem limite de NF-e, com os preços, os tetos, o anual, o teste, a trava, a carência do analista e o Piloto (seção 1.1);
  - decisão 131 do Alexandre (28/11, ~05h50, R-20261128-054929-gerente-projetos): "131 · Macuxi ERP, Planos A+D (T-0054): A (vai para a v0.3.32)";
  - decisões 138 A e 139 A do Alexandre (28/11, 07h19, via PO);
  - decisão do PO (28/11, 07h24): os preços e a regra de contagem já eram do Alexandre desde 23/11 e ficam DECIDIDOS.
- **Molde:** ADR 0047 do FDV (planos e licenças) e ADR 0049 do FDV (um perfil por usuário, que revê a RN-PLA-02 da 0047). As duas estão em `aloirr/macuxifdv`, que é só leitura. **Copia a regra, não o conteúdo:** no ERP **não há tipos de licença** por perfil. Os planos contam **usuário** e **filial emissora**.
- **Relaciona:** ADR 0012 (portal `/config` e lista fechada de funções `SECURITY DEFINER`), RN-CORE-01 (perfis), RN-CORE-02 (licença do módulo), RN-CORE-09 (analista de implantação), RN-CORE-15 (conta bloqueada), regra 4 (centavos) e regra 6 (perfil, tenant e licença em toda rota).

## Contexto
Hoje a empresa nasce no `/config` (ADR 0012) com uma lista de módulos em `plataforma.tenant_modulo` (ativo, `valido_ate`). Não existe plano, preço, teste grátis nem teto de usuários. O cadastro de usuários, no BKO (core) e no `/config` (`plataforma.empresa_usuario_criar`, 0078), aceita qualquer número de contas.

O Alexandre aprovou dois modos de venda:
- **A, por usuário:** três planos com teto de usuários e de filiais emissoras;
- **D, combo FDV:** para o cliente com o Macuxi FDV ativo, cobrado por vendedor ativo no FDV.

Há também o plano **Piloto**, interno, para a thathyany (AM2808). **Não há limite de NF-e** em nenhum plano.

## Decisão

### 1. O catálogo é dado, nunca código (RN-PLA-01)
`plataforma.plano`, uma linha por plano e versão, com as colunas da regra 5 (`tenant_id` = tenant de referência, como as tabelas oficiais, D9) e mais estas:
- `codigo`, `versao` (inteiro, começa em 1), `nome`, `ordem` e `ativo`;
- `modalidade`: `por_usuario` (A), `combo_fdv` (D) ou `interno` (Piloto);
- `preco_mensal_centavos` (A), ou `preco_por_vendedor_centavos` e `minimo_mensal_centavos` (D); são inteiros, e o Piloto tem tudo zero;
- `limite_usuarios` e `limite_filiais_emissoras` (inteiros; `null` = sem limite);
- `modulos` (text[]): os módulos incluídos; `core` entra sempre;
- `adicionais` (jsonb): cada um com `codigo`, `preco_unitario_centavos` e `incluidos`; o adicional só vale se o plano o vende;
- `meses_gratis_anual`, `dias_teste` e `cobranca` (boolean; falso só no Piloto).

O preço muda por **versão nova** do plano (`codigo` e `versao` formam a chave única), nunca por `UPDATE` do preço. A assinatura guarda a versão que contratou.

**Os números são dado do catálogo:** vão no seed da 0083 e **nunca viram constante no código** (SDK, API, core ou web). A tabela da seção 1.1 é o registro da decisão e a fonte do seed. Mudar um preço é uma versão nova do plano, por migração do banco-dados, citando o recado do Alexandre.

**Sem limite de NF-e:** o catálogo não tem coluna de notas, e nenhuma rota do faturamento ou do fiscal consulta o plano. Assim, nenhuma trava fica no caminho da emissão (regra 7).

Os contratos ficam em `packages/platform-sdk/src/planos.ts` (`PlanoSchema`, `ListaPlanosSchema`, `AssinaturaSchema`, `FichaAssinaturaSchema` e `TrocarPlanoSchema`), pelo engenheiro-software, depois do PR do SDK em andamento (T-0129).

### 1.1 Catálogo decidido (R-20261123-112038-alexandre; seed da 0083)
| Código | Modalidade | Mensal | Usuários | Filiais emissoras | Integração FDV |
|---|---|---|---|---|---|
| `essencial` | `por_usuario` | R$ 290,00 (29000) | 3 | 1 | adicional, R$ 149,00 (14900) |
| `profissional` | `por_usuario` | R$ 590,00 (59000) | 8 | 2 | inclusa |
| `empresarial` | `por_usuario` | R$ 990,00 (99000) | 20 | 5 | inclusa |
| `combo_fdv` | `combo_fdv` | R$ 25,00 (2500) por vendedor ativo no FDV, mínimo de R$ 290,00 (29000) | sem limite | sem limite (regra e) | inclusa |
| `piloto` | `interno` | zero, sem cobrança | sem limite | sem limite | inclusa |

- **Adicionais do A**, nos três planos: usuário extra de R$ 39,00 (3900) e filial extra de R$ 99,00 (9900).
- **Para todos os planos pagos:**
  - o anual tem 2 meses grátis (`meses_gratis_anual = 2`);
  - o teste dura 14 dias (`dias_teste = 14`);
  - a trava nunca bloqueia quem já usa (§4);
  - notas ilimitadas.
- **Piloto:** é interno, sem cobrança e sem limite de NF-e, e é só para a thathyany (AM2808), que entra nele pelo seed, sem teste.

### 2. O que conta (RN-PLA-02; molde da RN-PLA-02 da ADR 0047 e da ADR 0049)
**No ERP não há tipos de licença.** Os planos contam dois itens: **usuário** e **filial emissora**. A Integração FDV é módulo, incluso ou adicional (§4), e não é item contado.

**Usuário:**
1. Todo usuário **ativo** do tenant ocupa 1 licença de usuário, **qualquer que seja o perfil**. Como há um perfil por usuário (RN-CORE-01, no molde da ADR 0049 do FDV), não há prioridade entre perfis.
2. Não contam:
   - o usuário inativo (desativado) ou excluído;
   - a equipe Macuxi do `/config` (superadmin, suporte, implantação e financeiro);
   - o analista de implantação nos primeiros 60 dias, contados do `created_at` da conta (RN-CORE-09), pela isenção `implantacao`. A partir do 61º dia, ele conta como os outros, sem ninguém desmarcar;
   - o usuário de serviço da integração com o FDV.
3. **O bloqueado por senha conta** (RN-CORE-15; decisão 138 A).

Como a 0083 marca quem não conta:
- O superadmin é identidade de plataforma e não mora em `plataforma.usuario` (ADR 0012 §1), então nunca entra na conta.
- As contas do tenant que não contam ganham a coluna `plataforma.usuario.isencao_licenca` (aprovada pelo PO em 28/11, às 07h26). `null` = conta. Os valores são três:
  - `equipe_macuxi`: a conta do tenant usada pela equipe Macuxi;
  - `servico_integracao`: o usuário de serviço da integração com o FDV;
  - `implantacao`: o analista de implantação. A isenção vale **só nos 60 dias a partir do `created_at` da conta**. Depois, a conta passa a contar sozinha, sem ninguém desmarcar: a `licencas_do_tenant()` decide pela data (`now() < created_at + interval '60 days'`), e nenhuma rotina apaga a marca. Um `CHECK` aceita `implantacao` só no perfil `analista_implantacao`.
- **Só o superadmin grava a isenção**, pela `sa_marcar_isencao_licenca` (§8):
  - o tenant não tem `UPDATE` nessa coluna e não a vê na tela de usuários;
  - **toda mudança vai para a auditoria** na mesma transação (`plataforma.usuario.isencao_licenca`), com quem mudou (`superadmin_id`), quando (`created_at` da auditoria) e o `antes` e o `depois` do valor, sem e-mail nem nome (regra 8);
  - marcar de novo o mesmo valor não grava nem audita.
- O analista sem a marca `implantacao` conta desde o primeiro dia. O fluxo de criar usuário do `/config` já propõe a marca quando o perfil é `analista_implantacao`, e quem grava é o superadmin.
- Hoje o Conector do Hub entra com credencial própria, cifrada, e não com uma conta de `plataforma.usuario`. A isenção `servico_integracao` vale para quando existir essa conta.

**Filial emissora:** conta a filial viva com "Emite NF-e" ligado (`cadastros.filial.emissora = true`).

**Plano D:** o usuário **não tem limite**. O que conta é o vendedor ativo no FDV, pelo número que o Hub informa (§6). Esse número serve só para o valor: o D não trava usuário.

### 3. A assinatura
`plataforma.assinatura`, uma viva por tenant (índice único parcial em `tenant_id` sem `deleted_at`), com as colunas da regra 5, RLS ligado e mais estas:
- `plano_id` (a linha da versão contratada);
- `ciclo` (`mensal` ou `anual`);
- `adicionais` (jsonb, código → quantidade);
- `teste_ate` (date, no fuso da empresa, ou nula);
- `paga` (boolean);
- `vendedores_fdv` e `vendedores_fdv_em` (só no D, para o valor; §6);
- `pedido_id` (uuid, a idempotência da última troca).

`plataforma.assinatura_historico` guarda cada criação e troca: plano e versão de antes e de depois, ciclo, adicionais, `pedido_id`, autor (`superadmin_id`) e `ocorrido_em`. É só de inserção, e a assinatura nunca é apagada fisicamente. A auditoria vai também para a `plataforma.auditoria` (`plataforma.assinatura.criar` e `.trocar`), sem nome de empresa nem dado pessoal (regra 8).

O tenant lê a própria assinatura e o histórico só sob RLS (`SELECT` para o `macuxierp_app`). Ninguém do tenant escreve: a escrita é só pelas `sa_*` (§8).

### 4. A trava (RN-PLA-04, 422 `LICENCAS_ESGOTADAS`)
- **A regra** é a função pura `conferirNovoUsuario(situacao, mudanca)` do SDK. Ela recebe a situação devolvida pela `licencas_do_tenant()` e devolve `ok` ou a violação, com o item (`usuarios` ou `filiais_emissoras`), o contratado e o em uso.
- **Onde vale:**
  - criar ou reativar usuário além do contratado;
  - tirar a isenção de um usuário ativo;
  - ligar "Emite NF-e" numa filial além do contratado.
  Mudar o perfil não muda a contagem, porque todo perfil conta igual. A trava vale no BKO (core) e no `/config` (`empresa_usuario_criar` e as demais funções de usuário da 0078).
- **Integração FDV:** ligar o módulo `integracao-fdv` num plano que não a inclui, sem o adicional contratado, é recusado com 422 `ADICIONAL_NAO_CONTRATADO`. É regra de módulo, não de contagem. O texto da tela é "A integração com o Macuxi FDV não está no plano desta empresa." (aprovado pelo PO em 28/11, às 07h26).
- **Na mesma transação** do insert ou update, quem grava chama `plataforma.licencas_do_tenant()`:
  - a função é `SECURITY INVOKER`, roda sob RLS e faz `FOR UPDATE` na linha da assinatura;
  - ela devolve, por item, o contratado (plano + adicionais) e o em uso;
  - o `FOR UPDATE` serializa duas criações simultâneas, que assim nunca passam do limite;
  - nas funções `SECURITY DEFINER` do `/config`, a mesma conferência roda dentro da função, antes do insert.
- **Recusa:** 422 com `codigo = 'LICENCAS_ESGOTADAS'` e `detalhes = { item, contratado, em_uso }`.
  - A mensagem é "O plano da empresa não tem mais licenças de <usuário | filial emissora>. Fale com a Macuxi para ampliar.". O texto final é do designer-ux, e pela regra 125 B a mensagem não começa com rótulo.
  - No banco, a recusa é SQLSTATE 22023 com o código no `hint`, como na ADR 0047.
- **Teste vencido sem pagamento** (`teste_ate` no passado e `paga = false`): trava só os cadastros novos, com 422 `TESTE_VENCIDO` (decisão 139 A). Nota, pedido, consulta e login continuam.
- **A trava nunca bloqueia quem já usa:** ela só olha a mudança pedida. A empresa acima do teto continua usando tudo e só não cresce. É o caso, por exemplo, da carência do analista que venceu.
- **Sem assinatura, não trava:** a empresa anterior aos planos segue como hoje até ganhar uma assinatura.
- **Filial emissora:** ligar "Emite NF-e" é do módulo cadastros. Por isso, a conferência da filial é do modulo-cadastros (§9). A contagem fica dentro da `licencas_do_tenant()`, que é infraestrutura do banco-dados, como a `tenant_modulo`. Nenhum módulo lê `cadastros.filial` direto (regra 1).

### 5. Troca de plano (RN-PLA-05)
- A troca é a rota `PUT /v1/plataforma/empresas/:tenant_id/assinatura`, só do superadmin. É idempotente por `pedido_id`: o mesmo `pedido_id` devolve a mesma resposta e não grava de novo.
- A troca é recusada quando o plano novo, com os adicionais pedidos, fica abaixo do uso em usuários ou em filiais emissoras: 422 `PLANO_ABAIXO_DO_USO`, com a lista dos itens. **A troca nunca desativa usuário, filial nem módulo.**
- A API confere antes, com a função pura `conferirTrocaDePlano` do SDK, e a `sa_trocar_plano` confere de novo na transação, com o `FOR UPDATE` da assinatura.
- A troca liga no `tenant_modulo` os módulos do plano novo (`modulosDaAssinatura`) e nunca desliga um módulo em uso. Desligar continua pelo fluxo de módulos do `/config`, que tem as próprias regras (RN-CORE-02).
- Mudar a modalidade (A ↔ D ↔ Piloto) é uma troca como as outras, com as mesmas conferências.

### 6. Valor e teste (RN-PLA-06)
- **A:** valor mensal = `preco_mensal_centavos` + Σ(quantidade × `preco_unitario_centavos` dos adicionais).
- **D:** valor mensal = max(`minimo_mensal_centavos`, `vendedores_fdv` × `preco_por_vendedor_centavos`) + adicionais.
  - O `vendedores_fdv` é o número de vendedores ativos que o Hub do FDV informa. Ele vem só pela API do Hub (`/integracao/v1`), nunca de tabela do FDV (regra 1), e é gravado com a data da leitura.
  - Até existir a rota do Hub que devolve essa contagem (pendência do modulo-integracao-fdv, §9), o superadmin informa o número na troca, e a ficha mostra a data.
- **Anual:** paga-se (12 − `meses_gratis_anual`) × o mensal. Com 2 meses grátis, são 10 × o mensal. Tudo em centavos inteiros, sem divisão.
- **Teste:** vai de hoje, no fuso da empresa (RN-CORE-04), até hoje + `dias_teste` − 1, inclusive. Com 14 dias, um teste aberto em 28/11/2026 termina em 11/12/2026.
- **Piloto:** valor zero, sem teste e com `paga = true`.
- O valor é só informativo nesta versão. **Não há cobrança, boleto nem integração de pagamento** (contas a pagar e cobrança recorrente estão fora da v1).

### 7. Bandeira `MACUXIERP_PLANOS`
- **Padrão desligado.** Liga só com `MACUXIERP_PLANOS=1` no ambiente da API, e **só depois de o Alexandre ver a tela** (decisão do PO de 28/11, 07h24), com a 0083 e o seed aplicados.
- **Com ela desligada:**
  - as rotas da seção 8 respondem 404;
  - o core, o cadastros e o `/config` não chamam a `licencas_do_tenant()`;
  - as telas escondem o bloco "Plano";
  - nada muda para as empresas atuais.
- **Com ela ligada:**
  - a API confere na subida que existe ao menos um plano ativo; se não existir, não sobe (falha cedo, sem trava pela metade);
  - a empresa sem assinatura continua sem trava.
- O worker não lê a bandeira: nenhuma fila depende de plano.

### 8. Rotas do portal (com a bandeira ligada)
| Rota | Quem | O que faz |
|---|---|---|
| `GET /v1/plataforma/planos` | superadmin | a lista dos planos ativos (a última versão de cada código) |
| `POST /v1/plataforma/empresas-com-plano` | superadmin | o mesmo fluxo do `POST /v1/plataforma/empresas`, com os módulos tirados do plano e a assinatura gravada pela `sa_gravar_assinatura`, idempotente. Com `simular`, não grava |
| `GET /v1/plataforma/empresas/:tenant_id/assinatura` | superadmin | a ficha: plano, versão, ciclo, adicionais, teste, usuários e filiais emissoras contratados e em uso, e o valor mensal e o anual |
| `PUT /v1/plataforma/empresas/:tenant_id/assinatura` | superadmin | a troca de plano (§5) |
| `PUT /v1/plataforma/empresas/:tenant_id/usuarios/:usuario_id/isencao-licenca` | superadmin | marca ou tira `equipe_macuxi`, `servico_integracao` ou `implantacao` (§2); tirar a isenção passa pela trava; toda mudança é auditada |
| `GET /v1/core/assinatura` | administrador do tenant | a mesma ficha, só da própria empresa, sob `comTenant` e RLS. Fica em `/v1/core` porque o JWT do tenant nunca vale em `/v1/plataforma` (ADR 0012 §2) |

**Funções novas da lista fechada da ADR 0012 §4.** Todas são da 0083, no schema `plataforma`, `SECURITY DEFINER`, com `SET search_path = pg_catalog, pg_temp`, `REVOKE ALL ... FROM PUBLIC` e EXECUTE só do `macuxierp_config`. Todas pedem a sessão "sim", começam por `exigir_superadmin()` e auditam na mesma transação.

| Função | O que faz |
|---|---|
| `sa_listar_planos()` | os planos ativos |
| `sa_ler_assinatura(tenant_id)` | a ficha, com a mesma contagem da `licencas_do_tenant()` para o tenant pedido |
| `sa_gravar_assinatura(tenant_id, plano_id, ciclo, adicionais, teste, pedido_id)` | cria a assinatura; repetir o mesmo `pedido_id` devolve a mesma, sem gravar |
| `sa_trocar_plano(tenant_id, plano_id, ciclo, adicionais, vendedores_fdv, pedido_id)` | a troca, com a conferência abaixo do uso, o histórico e a ligação dos módulos |
| `sa_marcar_isencao_licenca(tenant_id, usuario_id, isencao)` | grava ou tira a isenção (§2), com a auditoria de quem mudou e quando; tirar confere a trava; repetir o mesmo valor não grava |

Fora da lista fechada fica a `licencas_do_tenant()`: `SECURITY INVOKER`, com EXECUTE do `macuxierp_app` e do `macuxierp_config`. Ela lê o tenant de `app.tenant_id` e devolve vazio quando não há assinatura.

**SQLSTATE → HTTP**, no `apps/api/src/plataforma/erros.ts` e no `erro-pg.ts` do core:
- `MXS01` = 401;
- `42501` = 403;
- `P0002` = 404;
- `22023` = 422 na escrita, com o código no `hint` (`LICENCAS_ESGOTADAS`, `TESTE_VENCIDO`, `PLANO_ABAIXO_DO_USO`, `PLANO_INATIVO`, `ADICIONAL_NAO_VENDIDO` ou `ADICIONAL_NAO_CONTRATADO`), ou 400 na leitura.

### 9. Quem faz o quê (para o gerente disparar)
Ordem: E1 → E2 (banco e SDK em paralelo) → E3 (core, cadastros, integração e API) → E4 (telas) → E5 (testes).

| Etapa | Dono | Entrega | Pronto quando |
|---|---|---|---|
| E1 | engenheiro-software | esta ADR | merge no `main` |
| E2 | banco-dados | migração **0083**: `plataforma.plano`, `plataforma.assinatura` e `plataforma.assinatura_historico` (regra 5, RLS, colunas da §1 e da §3); a coluna `plataforma.usuario.isencao_licenca` (`equipe_macuxi`, `servico_integracao` ou `implantacao`, com o `CHECK` do perfil, sem `UPDATE` do `macuxierp_app` e com a auditoria de toda mudança); a `licencas_do_tenant()` (§2 e §4, com o `FOR UPDATE`, a carência de 60 dias e as isenções); as cinco `sa_*` da §8; a conferência da trava dentro de `empresa_usuario_criar` e das demais funções de usuário da 0078 (só quando há assinatura); o **seed do catálogo da §1.1**, com os valores em centavos. O teste `db/testes/planos-0083.db.test.ts` prova: a RLS (o tenant lê só a própria assinatura e não escreve); o EXECUTE só do `macuxierp_config` nas `sa_*`; duas criações simultâneas sem passar do teto; o inativo e o excluído fora da conta, e o bloqueado dentro; a isenção `implantacao` que deixa de valer sozinha no 61º dia; as outras isenções e a auditoria de toda mudança; a troca abaixo do uso recusada; a idempotência por `pedido_id`; a empresa sem assinatura sem trava; e o seed igual à §1.1 | testes de banco verdes com `MACUXI_PG_EXIGIR=1` |
| E2 | engenheiro-software | `packages/platform-sdk/src/planos.ts`: os schemas Zod da §1; as funções puras `conferirNovoUsuario`, `conferirTrocaDePlano`, `valorMensal`, `valorAnual`, `fimDoTeste` e `modulosDaAssinatura`, com teste antes citando RN-PLA-01, 02, 04, 05 e 06; os códigos de erro; a bandeira `planosLigados(env)`. **Nenhum preço como constante:** os testes usam planos de exemplo. Só depois do PR do SDK em andamento (T-0129) | unitários do SDK verdes |
| E3 | modulo-core | a trava no BKO: criar e reativar usuário (`alterar-usuario.ts` e o repositório), na mesma transação, com a `licencas_do_tenant()` e a `conferirNovoUsuario`; a rota `GET /v1/core/assinatura` (só o administrador); a tradução dos SQLSTATE no `erro-pg.ts`; no plugin de plataforma, as rotas da §8 chamando só as `sa_*`; e o `ADICIONAL_NAO_CONTRATADO` ao ligar a integração. Testes citando RN-PLA-02, RN-PLA-04 e RN-PLA-05 | unitários e de banco do core verdes |
| E3 | modulo-cadastros | **conta a filial emissora:** ligar "Emite NF-e" (`emissora = true`) numa filial, ao criar ou ao editar, chama a `licencas_do_tenant()` e a `conferirNovoUsuario` na mesma transação e recusa com 422 `LICENCAS_ESGOTADAS` (item `filiais_emissoras`). Vale também na carga (RF-CAD-11). Testes citando RN-PLA-02 e RN-PLA-04 | unitários e de banco do cadastros verdes |
| E3 | modulo-integracao-fdv | **conta os vendedores pelo Hub:** a leitura do número de vendedores ativos pela API do Hub (`/integracao/v1`, nunca tabela do FDV), exposta por contrato em `modules/integracao-fdv/contracts`, para o `/config` gravar o `vendedores_fdv` (§6). Se o Hub ainda não tiver a rota, o pedido ao FDV vai pelo gerente | contrato e teste verdes |
| E3 | engenheiro-software | apps/api: a bandeira, a conferência na subida, a montagem das rotas e o `erros.ts`; revisão final | typecheck e testes da API verdes |
| E4 | engenheiro-apps | `/config`: o passo "Plano" ao criar a empresa (com a simulação), a ficha da assinatura no detalhe da empresa, a troca de plano com a lista dos itens abaixo do uso e a isenção na lista de usuários da empresa. BKO: o bloco "Plano" (só leitura) para o administrador e o 422 `LICENCAS_ESGOTADAS` na tela de usuários. Grade de 12 colunas, tokens do `packages/ui` e botões no rodapé (regras 11 e 12); prints em 1366 e 1920 px, **para o Alexandre ver antes de a bandeira ligar** | prints validados pelo `design-de-marca` e vistos pelo Alexandre |
| E5 | testes | `tests/`: a trava ponta a ponta (BKO, `/config` e filial), a bandeira desligada sem efeito e o fluxo do Piloto | suíte verde |

Também: o designer-ux escreve os textos finais, e o gerente-projetos leva as RN-PLA ao doc 03, pelo PO.

## RN novas propostas (para o doc 03)
- **RN-PLA-01** Catálogo: o plano é dado (modalidade, preço por versão, limite de usuários e de filiais emissoras, módulos e adicionais), no seed, nunca em código. O adicional só vale se o plano o vende, e o core entra sempre. Não há limite de NF-e.
- **RN-PLA-02** Contagem: não há tipos de licença. Todo usuário ativo ocupa 1 licença de usuário, qualquer que seja o perfil, e o bloqueado por senha conta (138 A). Não contam:
  - o inativo e o excluído;
  - a equipe Macuxi do `/config`;
  - o analista de implantação nos primeiros 60 dias;
  - o usuário de serviço da integração.
  A filial conta quando "Emite NF-e" está ligado. No D, o usuário não tem limite, e conta o vendedor ativo no FDV que o Hub informa.
- **RN-PLA-04** Trava: não cria nem reativa usuário, nem liga "Emite NF-e", além do contratado (422 `LICENCAS_ESGOTADAS`). Com o teste vencido sem pagamento, trava só os cadastros novos (422 `TESTE_VENCIDO`, 139 A). Nunca bloqueia quem já usa. Sem assinatura, não trava.
- **RN-PLA-05** Troca de plano: recusada abaixo do uso, item a item (422 `PLANO_ABAIXO_DO_USO`). Nunca desativa usuário, filial nem módulo. É idempotente pelo `pedido_id`.
- **RN-PLA-06** Valor:
  - o A é o plano mais os adicionais;
  - o D é o maior entre o mínimo e vendedores × preço, mais os adicionais;
  - o anual é (12 − meses grátis) × o mensal, em centavos;
  - o teste dura `dias_teste` dias corridos, no fuso da empresa;
  - o Piloto vale zero.

O número RN-PLA-03 fica vago: no FDV ele trata do "por usuário" da Pesquisa e do Treinamento, que não tem equivalente no ERP. Assim os números continuam correspondendo aos da ADR 0047.

## Decidido (Alexandre, via PO)
- **Preços, tetos, anual, teste, trava, carência do analista e Piloto:** R-20261123-112038-alexandre (23/11), confirmados como DECIDIDOS pelo PO em 28/11, às 07h24 (§1.1).
- **Contagem:** a regra da §2, decidida pelo PO em 28/11, às 07h24, no molde da RN-PLA-02 da ADR 0047 e da ADR 0049 do FDV.
- **(a) Decisão 138 A** (28/11, 07h19): o usuário bloqueado por senha ocupa licença. Só o desativado ou o excluído libera.
- **(b) REGRA, carência do analista:** 60 dias, contados da criação da conta (`created_at`). É a leitura literal do "primeiros 60 dias" do Alexandre em 23/11 (decisão do PO, 28/11, 07h25).
- **(c) Decisão 139 A** (28/11, 07h19): o teste vencido sem pagamento trava só os cadastros novos. Nota, pedido e consulta continuam.
- **(d) REGRA, decisão 130 A:** o TOTP do superadmin fica obrigatório no momento em que a senha do `macuxierp_config` for criada (ADR 0012, emenda §7-A).
- **(e) REGRA, filial no D:** o R-20261123-112038 dá teto de filial só aos planos do A. O D não tem teto de filial, e o seed grava `null`. É a leitura literal do recado, aprovada pelo PO em 28/11, às 07h26; um teto futuro entra como versão nova do plano.
- **Bandeira:** a `MACUXIERP_PLANOS` só liga depois de o Alexandre ver a tela (decisão do PO, 28/11, 07h25).
- O administrador do tenant só vê a ficha. Quem troca de plano é só o superadmin.

Nada fica pendente nesta ADR (decisão do PO, 28/11, 07h25).

## Alternativas consideradas
- **Planos como constantes no SDK:** descartada. Cada preço viraria deploy, e o histórico da assinatura se perderia.
- **Tipos de licença por perfil, como na ADR 0047 do FDV:** descartada pelo PO (28/11, 07h24). No ERP todo perfil conta igual, e um perfil por usuário (molde da ADR 0049) dispensa a prioridade.
- **Trava só na API, sem a função SQL:** descartada. Duas criações simultâneas passariam do limite.
- **Reaproveitar o `tenant_modulo`:** descartada. Ele liga módulo e não tem limite, ciclo, teste nem adicionais.
- **Contar vendedores lendo o banco do FDV:** proibida pela regra 1. Só pela API do Hub.
- **Limite de NF-e por plano:** descartada pelo Alexandre ("sem limite de NF-e"). Ela também poria uma trava no caminho da emissão.

## Consequências
- Com a bandeira desligada, nada muda. Ligada, o que só acontece depois de o Alexandre ver a tela, só as empresas com assinatura passam a ter trava.
- A lista fechada da ADR 0012 §4 ganha cinco funções `sa_*`, todas com teste de banco.
- O `tenant_modulo` continua sendo a fonte da licença do módulo (RN-CORE-02). O plano só liga módulos nele e nunca desliga.
- Mudar um preço é uma versão nova do plano, por migração, nunca um deploy de código.
