# Fumaça das rotas: telas × API (T-0065)

Escrito em 2026-11-23, 17:34 (Manaus), pelo agente `testes`.

## Motivo
A v0.3.5 saiu com a aba Cargas do `/config` chamando um GET que a API não tinha (404 genérico), visto pelo Alexandre em produção. Nenhum teste cruzava "o que o web chama" com "o que a API registra".

## Camada (a): no CI e na suíte completa
O teste `tests/integracao/rotas/fumaca-telas.db.test.ts` (o cabeçalho e `NAO_EXTRAIVEIS` dizem como a lista é montada, o que confere e o que fazer com tela nova).

## Camada (b): depois de todo publicar, contra produção (proposta)
Passo novo no `.github/workflows/producao-publicar.yml`, job de deploy, logo depois de "conferir pelo domínio" (health check `/v1/saude` com a versão e `/login`).
- **Mesma lista**: o teste da camada (a) exporta a lista de GETs em `tests/integracao/rotas/fumaca-rotas.json` (`rotas[]` com `metodo`, `caminho` com `:id` e `area` `bko`|`plataforma`). Um caso do teste (sem Postgres) falha se o JSON commitado divergir da extração, para não ficar velho; o comando de regenerar está no campo `regenerar` do JSON. O passo só lê esse JSON do SHA da tag e preenche os parâmetros.
- **Usuário**: uma empresa de teste em produção, com todos os módulos licenciados, e um usuário com perfil `leitura` (RN-CORE-01). Os parâmetros seguem o campo `origem` de cada rota (seção "Parâmetros" abaixo).
- **Rotas `/v1/plataforma`**: hoje **não existe superadmin só de leitura** (`plataforma.superadmin`, migração 0033, não tem papel nem escopo). Até existir, **só as rotas do BKO entram**; as do portal ficam cobertas só pela camada (a).
- **Secrets** (environment `PRODUCAO`, só o Alexandre cria): `FUMACA_EMAIL`, `FUMACA_SENHA` e `FUMACA_EMPRESA_ID`; depois, `FUMACA_SA_EMAIL` e `FUMACA_SA_SENHA` para o superadmin de leitura.
- **Só GET**, nunca escrita; o login usa a rota de sessão existente e a sessão é encerrada ao fim.
- **Tempo**: 10 s por rota e 3 min no total (`timeout-minutes` do passo).
- **Critério**: 404 genérico (`NAO_ENCONTRADO`/"Rota não encontrada") ou 5xx = falha; 200 e 4xx de regra passam.
- **Na falha**: o publicar fica vermelho e abre ou comenta a issue "Aprovar deploy <tag>" com a lista das rotas que caíram. **Sem rollback automático**: a volta segue o procedimento atual do publicar.
- **Log sem dado pessoal**: só método, caminho com `:id` e status; nada de corpo, token, e-mail ou ID real.

## Quem faz
- `engenheiro-software`: o passo no `producao-publicar.yml` e o script que lê o JSON, em **PR de governança** (`.github/**`, `Agente: alexandre`); merge só com "autorizo o merge do PR #N no commit <sha>" do Alexandre.
- `testes`: gerar e conferir o JSON a partir do teste da camada (a).
- `banco-dados` e `modulo-core`: a empresa de teste e o usuário `leitura` em produção (seed idempotente, por `external_id`); o superadmin só de leitura, se aprovado (precisa de ADR, porque muda a 0033 e o ADR 0012).
- Alexandre: criar os secrets e aprovar o superadmin de leitura.

## Pendências abertas
1. Decidir se haverá superadmin só de leitura (sem ele, `/v1/plataforma` fica fora da camada b).
2. Empresa de teste em produção: nome, licenças e se conta no faturamento da Macuxi.
3. Secrets `FUMACA_*` ainda não criados.
4. ~~Rotas com parâmetro: de onde vem o valor.~~ Fechada em 2026-11-23 (T-0065 b): ver "Parâmetros: o campo `origem`" abaixo.

## Parâmetros: o campo `origem`
O JSON (`formato: 1`) traz `uuid_ficticio` no topo (o mesmo `UUID_FICTICIO` de `tests/apoio/caminhos.ts`) e, em cada rota com `:param`, um `origem` que diz ao executor de onde tirar o valor **em tempo de execução**. Rotas sem parâmetro não têm `origem`. Em `formato: 1`, no máximo um parâmetro por rota; rota com dois faz o teste falhar e o formato sobe de versão.
- **`contexto`** (`nome`: `empresa` | `filial`): `/v1/plataforma/empresas/:id/...` usa a empresa do token; `/filiais/:id` usa a filial da empresa de teste (1ª da lista de filiais).
- **`lista`** (`de`: `GET /v1/...`, `campo`: `itens[0].id`): o executor chama o GET de lista do mesmo recurso (presente no JSON, sem parâmetro) e usa o 1º `itens[].id` (`paginaDe` → `itens`). Lista vazia: usa o `uuid_ficticio` e vale a regra do fictício.
- **`ficticio`**: não há lista (ex.: `/v1/core/exportacoes/:id`); usa o `uuid_ficticio`.
- **Aprovado**: 200 ou 4xx de regra, inclusive 404 de registro inexistente; **reprovado**: 404 genérico (`NAO_ENCONTRADO`/"Rota não encontrada") ou 5xx.
- **LGPD**: nenhum id real no repositório nem no log; um caso do teste (sem Postgres) falha se o JSON trouxer UUID além do fictício, CNPJ, CPF ou e-mail. Na camada (a), com Postgres, cada lista de origem é chamada e precisa devolver `itens[]`.

Exemplo (a lista real está em `tests/integracao/rotas/fumaca-rotas.json`):

```json
{
  "formato": 1,
  "uuid_ficticio": "…",
  "rotas": [
    { "metodo": "GET", "caminho": "/v1/core/exportacoes/:id", "area": "bko", "origem": { "tipo": "ficticio" } },
    { "metodo": "GET", "caminho": "/v1/faturamento/notas/:id", "area": "bko",
      "origem": { "tipo": "lista", "de": "GET /v1/faturamento/notas", "campo": "itens[0].id" } },
    { "metodo": "GET", "caminho": "/v1/plataforma/empresas/:id/integracao-fdv", "area": "plataforma",
      "origem": { "tipo": "contexto", "nome": "empresa" } }
  ]
}
```
