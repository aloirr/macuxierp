# ADR 0006 — Troca da filial para produção fiscal só pelo script do operador

- **Status:** aceita no desenho; a implementação é a T-0030, etapa 2 (modulo-core, banco-dados e engenheiro-software)
- **Data:** 21/11/2026 (Manaus)
- **Dono:** engenheiro-software
- **Base:** `CLAUDE.md`, regra 7; RN-CORE-08; desenho T-0002 (D12 e a rota `PUT /ambientes-fiscais/:filial_id`); ADR 0004; desenho `docs/desenho/T-0030.md`
- **Muda:** a linha `PUT /ambientes-fiscais/:filial_id` do desenho T-0002

## Contexto
A regra 7 diz que a filial emissora só passa para **produção fiscal** com o "aprovo produção fiscal <empresa>" do Alexandre. Na T-0006 (PR #14), a rota do tenant `PUT /v1/core/ambientes-fiscais/:filial_id` aceita `ambiente: "producao"` com qualquer texto no formato `R-AAAAMMDD-HHMMSS[-n]-alexandre` em `recado_aprovacao`. O domain confere só o formato. O banco (CHECK `ambiente_producao_aprovada` em `0003_core.sql`) também confere só o formato. A API não confere se o recado existe, se é do Alexandre nem se fala da empresa certa.

**Consequência hoje:** um administrador do cliente inventa um id no formato certo e põe a filial em produção sozinho. A NF-e passa a valer na SEFAZ sem a aprovação. Achado da revisão do engenheiro-software no head 6171c32 (21/11/2026, 18h05).

## Opções
**(a) Script do operador, como as licenças (D12).** A troca **para** produção sai da rota do tenant. Quem faz é o operador, pelo `scripts/plataforma/ambiente-fiscal.mjs`, com a conexão do operador (`MACUXIERP_DATABASE_URL_OPERADOR`). O script grava o id do recado, a auditoria e o evento. A rota do tenant só aceita a volta para homologação, que segue auditada. O banco garante de novo: o papel `macuxierp_app` não consegue gravar `producao`.

**(b) A rota confere o recado no GitHub.** A API lê `aloirr/macuxierp-recados` pela API REST, confere o autor `alexandre`, o texto "aprovo produção fiscal <empresa>" e a empresa do tenant.

| Critério | (a) script do operador | (b) conferência na rota |
|---|---|---|
| Quem consegue pôr em produção | só quem tem a conexão do operador (o Alexandre ou quem ele indicar) | qualquer administrador que acerte o id de um recado verdadeiro de **outra** empresa ou de texto parecido; a defesa fica toda no casamento de texto |
| Dependências na produção | nenhuma nova | rede até o GitHub e um token de leitura do repositório de recados no `.env` da API (segredo novo, exposto ao processo que atende a internet) |
| Falha do GitHub | não afeta | a troca falha; o 403 que as sessões da nuvem já recebem hoje mostra que esse caminho é frágil |
| Garantia no banco | sim: política RLS restritiva barra `producao` vinda do `macuxierp_app` | não dá: o banco não lê o GitHub, então o app sempre poderia gravar `producao` |
| Autoria do recado | o formulário de issue do repositório de recados grava `de: alexandre`; o guardião barra agente escrevendo em nome dele (ADR 0004). O operador baixa o arquivo e o script confere | igual, mas lida por um token que vive na API |
| Frequência | rara: uma vez por filial emissora na vida do cliente | idem; não compensa um caminho on-line |
| Esforço | um script no molde do `licenca.mjs`, uma política RLS e a rota mais simples | cliente GitHub na API, cache, tempo-limite, segredo novo, ADR de dependência |

## Decisão
Opção **(a)**.

1. **Rota do tenant** `PUT /v1/core/ambientes-fiscais/:filial_id` (`core.ambiente.trocar`, administrador): o corpo é só `{ ambiente }`. `homologacao` grava, audita e publica o evento. `producao` responde **422 `RN-CORE-08`** (mensagem no desenho T-0030, §3.1). O campo `recado_aprovacao` sai do corpo. Voltar para homologação não pede aprovação.
2. **Script do operador** `scripts/plataforma/ambiente-fiscal.mjs` (dono engenheiro-software), no molde do `licenca.mjs`: simula por padrão e, para produção, confere o arquivo do recado (autor, id e empresa); grava ambiente, auditoria e evento numa transação. Detalhes no desenho T-0030, §4.
3. **Banco** (migração `0008`, banco-dados): política RLS **restritiva** em `core.ambiente_fiscal` para o `macuxierp_app`, `WITH CHECK (ambiente = 'homologacao')` no INSERT e no UPDATE. O operador é o dono da tabela, sem `FORCE ROW LEVEL SECURITY`, e passa. O CHECK `ambiente_producao_aprovada` continua como está.
4. **RN-CORE-08** (doc 03) passa a dizer quem troca e por onde. Texto proposto no desenho T-0030, §7; o gerente-projetos o aplica no doc 03, em PR dele.

## Consequências
- Nenhum caminho do tenant põe a filial em produção. O domain recusa, a rota recusa e o banco recusa, e há um teste em cada camada.
- A confiança fica no operador. Quem tem a conexão do operador já é dono do banco e pode tudo. O script **evita engano** (empresa trocada, recado de outro autor, filial de outro tenant) e deixa rastro. Ele não defende contra o próprio operador. A conexão do operador fica só no `.env` do servidor, e quem a cria é o Alexandre.
- A API não ganha segredo nem dependência de rede nova.
- A tela do BKO deixa de oferecer "produção". Ela mostra o ambiente, o recado registrado e a orientação "peça à Macuxi". O botão de voltar para homologação continua.
- O cliente que quiser produção pede à Macuxi. O Alexandre escreve o "aprovo", e o operador roda o script. Leva minutos, e acontece uma vez por filial.