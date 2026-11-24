# Macuxi Conector do Macuxi ERP (`@macuxierp/conector` 1.0.0)

Programa on-premise que lê o banco do ERP do cliente (SQL Server, PostgreSQL ou Oracle), empurra os cadastros por delta à
**`/entrada/v1` do Macuxi ERP** e, na mão contrária, grava no banco do cliente os pedidos que o ERP entrega e devolve o status
(integrado, faturado, cancelado). A conexão é sempre de saída, por HTTPS. Decisão: ADR 0014 (`docs/decisoes/0014-cenario-b-entrada-de-dados.md`), seção 6.

## Origem

**Base FDV 1.5.0 @c460e92**: cópia do `apps/conector` do `aloirr/macuxifdv@c460e92` (Conector 1.5.0, que já traz o 1.4.0),
recebida via `aloirr/macuxierp-recados@55c86b8` (`recados/anexos/T-0057/conector-fdv-c460e92/`). O histórico do FDV não foi
copiado e o FDV não muda. As regras citadas no código (`RN-INT-*`, `T-0xxx`) são as do FDV, na numeração de lá.

## O que mudou em relação ao FDV (ADR 0014 §6, só isto)

1. **Prefixo configurável:** `hub.prefixo` no `conector.json`, padrão `/entrada/v1` (no FDV o `/integracao/v1` era fixo). Começa
   com `/` e não termina em `/`. A `hub.url` continua só HTTPS (HTTP só para `localhost`, nos testes).
2. **Tipos:** o `@macuxi/integracao/contracts` do FDV virou um adaptador único, `src/contrato.ts`. Por enquanto ele define tudo
   localmente, no formato da `/entrada/v1` (os 10 cadastros da F2), e troca para `@macuxierp/platform-sdk/hub-v1` quando o SDK
   publicar o contrato. Entidades fora da fase (`catalogo_no`, `transportadora`, `tabela_escalonada`, `rota`, `titulo`, `nota`) e
   campos fora do contrato do ERP são recusados no `validar-config`.
3. **Atualização automática desligada:** `atualizacao.ativa` é falso e o esquema recusa `true` ("atualização automática desligada
   no Macuxi ERP; troca manual (ADR 0014 §6)"). Não há chave de assinatura embutida (a do FDV não veio). O código fica, sem uso.
4. **Linux oficial ao lado do Windows:** pacote `tar.gz` com unidade systemd (ver [LEIA-ME-LINUX.md](LEIA-ME-LINUX.md)).
5. **Mão dupla:** a gravação de pedidos e o ciclo de status do 1.5.0 seguem iguais. A **reconciliação** não existe na `/entrada/v1`:
   o esquema recusa a seção `reconciliacao` ("reconciliação não existe na /entrada/v1 do Macuxi ERP (ADR 0014 §6)"). A descida de
   clientes e notas (ADR 0014 §13) entra depois.

## Configuração

Exemplos em `exemplos/`:

| Arquivo | Para quê |
|---|---|
| `conector.thathyany.exemplo.json` | kit da empresa thathyany (VM de teste, Linux): os 10 cadastros + pedidos, lendo as views `dbo.vw_macuxi_*` do kit, `conectorId` `thathyany-erp` |
| `conector.exemplo.json` | SQL Server genérico, todos os campos do contrato (fictício) |
| `conector.oracle.exemplo.json` | Oracle genérico (fictício) |

Nada de senha ou chave no arquivo: `erp_senha` e `hub_chave` vêm do provedor de segredos (`env`: `MACUXI_CONECTOR_ERP_SENHA` e
`MACUXI_CONECTOR_HUB_CHAVE`; `windows`: Gerenciador de Credenciais). A chave é a do conector gerada no portal do ERP (`/config`,
aba "Integração"), mostrada uma vez só.

## Windows (WinSW, como no FDV)

O pacote `conector-<versão>.zip` (`node scripts/pacote.mjs`) leva o `conector.mjs`, o Node 24 portátil, o WinSW e os exemplos.
Na pasta do Conector, no PowerShell como administrador:

```powershell
.\node.exe conector.mjs validar-config --config conector.json
"<senha do banco>" | .\node.exe conector.mjs segredo definir erp_senha --config conector.json
"<chave do conector>" | .\node.exe conector.mjs segredo definir hub_chave --config conector.json
.\node.exe conector.mjs testar-conexao --config conector.json
.\node.exe conector.mjs instalar-servico --winsw .\WinSW-x64.exe --config conector.json
```

## Linux (systemd)

Veja [LEIA-ME-LINUX.md](LEIA-ME-LINUX.md): usuário próprio sem login, `ProtectSystem=strict`, dados em `/var/lib/macuxi-conector`
e segredos em `/etc/macuxi-conector/segredos.env` (root, 0600). Pacote: `node scripts/montar-linux.mjs --versao 1.0.0` (depois do build).

## Comandos

```bash
pnpm --filter @macuxierp/conector build        # dist/conector.mjs (esbuild, arquivo único)
pnpm --filter @macuxierp/conector test         # vitest + node --test dos scripts
pnpm --filter @macuxierp/conector lint
pnpm --filter @macuxierp/conector typecheck
pnpm --filter @macuxierp/conector start -- validar-config --config exemplos/conector.thathyany.exemplo.json
```

CLI (`conector <comando> [--config <arquivo>]`): `validar-config`, `testar-conexao`, `status [--json]`, `rodar [--uma-vez]`,
`carga-completa <entidade|todas>`, `retomar <entidade>`, `segredo definir <nome>`, `trocar-chave`, `instalar-servico`,
`desinstalar-servico`, `versao`. O teste de integração com PostgreSQL (`test/integracao.pg.test.ts`) usa `bash db/scripts/pg-local.sh`.
