# Zerar dados por cadastro (RN-CAD-10)

A regra é a `RN-CAD-10` (doc 03). O domain só **planeja**: recebe fatos e devolve o que apagar, anular e manter. O efeito roda nas funções do banco, que reconferem `emUso` com FOR UPDATE.

## Onde está
- Plano puro e testes: `modules/cadastros/domain/zeragem.ts` e `zeragem.test.ts` (lista de cadastros, tabelas, dependências, cascata, ordem dos motivos e bloqueios estão lá e no SDK, `packages/platform-sdk/src/portal-cargas.ts`).
- Plugin de plataforma: `modules/cadastros/api/zeragem.ts` (testes `zeragem.test.ts` em memória e `zeragem.db.test.ts` no banco, que exige a 0043 v3).
- Portas e tipos: `modules/cadastros/api/zeragem-portas.ts`.

## Decisões
- **Motivos de uso**, do mais forte ao mais fraco: pedido > título > nota > fiscal (`MOTIVOS_USO` do SDK). Com vários motivos conta o primeiro. O que está em uso fica mantido com os filhos; `fiscal` vem dentro do `emUso` da porta (`core.portal_usos_filiais`).
- `estoque_movimento` é só-inserção: o DELETE passa pela função interna `cadastros.zerar_estoque_movimento` (SECURITY DEFINER), só da zeragem.
- DELETE de verdade, não soft delete, por causa do índice único `(tenant_id, external_id)`.
- Nada fiscal entra no plano (nota, XML, evento). Pedido não faturado fica fora desta versão.
- FDV: na mesma operação o espelho e o cursor da integração são zerados; dono: `integracao-fdv`.
- LGPD e prazo fiscal: o que liga a nota fica mantido; auditoria por lote (quem, quando, cadastro, contagens), sem dado pessoal.
- Permissão: só superadmin, no `/config`, ação `plataforma.cadastros.zerar`; prévia antes de executar, licença do módulo, idempotência por chave do lote. A frase de confirmação é do SDK (`FRASE_ZERAR_DADOS`).

## Rotas
Plugin `criarPluginPlataformaCadastrosZerar(deps)`, tudo na mesma transação do `comPlataforma`.
- `POST CAMINHOS_CARGAS_PLATAFORMA.previa`: simulado, não escreve nada.
- `POST CAMINHOS_CARGAS_PLATAFORMA.zerar`: `idempotencia: 'obrigatoria'`; com bloqueio, 422 `zeragem_bloqueada`. Ordem: `zerarEspelho` → `cadastros.portal_zeragem_fatos` → usos → `tirarFiliais` (só se o plano apaga filial) → `cadastros.portal_zerar`. Erro em qualquer passo desfaz os anteriores.

## Portas (implementadas pela apps/api)
`UsosCadastroPlataforma`, `EstadoIntegracaoPlataforma`, `UsuariosFiliaisPlataforma`; `deps` do plugin: `{ usos, integracao, usuarios }`.

## Erros
Sobem crus do plugin; o mapa é da apps/api: `MXC04` (`empresa_inativa` | `modulo_desligado`), `MXC03` (o estado mudou, recarregar a prévia), `MXI03` (`entidade_ligada` | `lote_em_voo`).
