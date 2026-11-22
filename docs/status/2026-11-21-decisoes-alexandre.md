# Decisões do Alexandre: 21/11/2026, 21h29 (Manaus)

> Dono: gerente-projetos. Foi o Agente PO quem trouxe a decisão. A gravação de recados deu 403, então o aviso fica registrado aqui, pela regra provisória.

## Aviso para todos (de gerente-projetos, texto literal)
Texto literal do Alexandre, 21/11/2026, 21h29 (Manaus): "SEGUIR COM O RECOMENDADO". Era a resposta às recomendações a) a e) do status da retomada (`docs/status/2026-11-21-retomada.md`).

| # | Assunto | O que fica decidido | Quem faz |
|---|---|---|---|
| a | T-0023, PR #5 | A assinatura principal é a A, e a versão vertical de apoio é a C, desde que as duas batam com a composição do FDV. A B sai. | design-de-marca ajusta o PR #5. O merge segue o fluxo comum. |
| b | T-0025 | Opção 1: o Alexandre abre uma sessão com `MACUXI_AGENTE=alexandre` e depois escreve "autorizo o merge do PR #N no commit <sha>". Até lá vale a regra provisória: o recado vai no corpo do PR, no diário e por send_message. | Alexandre (roteiro abaixo) |
| c | T-0024 | Secrets, `.env` de produção, DNS e rota `erp.` são preparados agora. Nada é publicado sem "aprovo deploy vX.Y.Z". | Alexandre (lista abaixo); engenheiro-software (`env.modelo`) |
| d | F2 | O Alexandre pede já ao time do FDV o tenant de teste com credencial de conector e o `flock` no `implantar.sh`. | Alexandre (texto abaixo) |
| e | F4 | O credenciamento da thathyany na SEFAZ-AM e o A1 de homologação pela tela do BKO começam agora. O A1 nunca passa por chat nem por recado. A produção fiscal só sai com "aprovo produção fiscal thathyany". | Alexandre e thathyany (passo a passo abaixo) |

## 1. Roteiro da T-0025 (sessão do Alexandre)
1. Abra uma sessão nova no ambiente MacuxiERP-GP, com `MACUXI_AGENTE=alexandre`. Só o Alexandre define essa variável. Use um branch `alexandre/T-0025-recados-por-git` a partir do `main`.
2. O prompt da sessão é a tarefa `.coord/tarefas/T-0025.md`:
   - quando a API do GitHub der 403 na escrita, `enviar` e `lido` do `scripts/coord.mjs` fazem clone raso do `aloirr/macuxierp-recados`, commit e push com `--ff-only`, sem force e sem perder o formato do recado;
   - os testes em `coord-recados.test.mjs` cobrem o caminho por git;
   - o doc 07 e a ADR 0004 são atualizados. O doc 07 é do gerente e a ADR é do engenheiro: os dois vão por pedido aos donos ou num PR separado de cada dono.
3. A sessão roda os testes de `scripts/` e de `.claude/hooks/` e o `node scripts/coord.mjs verificar alexandre --base origin/main`. Depois abre o PR com `Agente: alexandre` no último bloco do commit.
4. Com o CI verde, o Alexandre escreve: **"autorizo o merge do PR #N no commit <sha>"**, com o head SHA do PR. O merge sai só depois disso.
5. Teste final: o gerente grava um recado de verdade (`node scripts/coord.mjs enviar ...`) numa sessão da nuvem. Os recados que ficaram só no texto (os docs de status de 21/11 e os corpos dos PRs #19 a #26) são gravados em lote pelo gerente e por cada dono.

## 2. Secrets do GitHub, `.env` de produção e DNS (só nomes, nunca valores)
Os valores são criados pelo Alexandre, em Settings → Secrets and variables → Actions do `aloirr/macuxierp` e no `/opt/macuxierp/.env` da VM (modo 600). Nada disto vai para chat, recado ou repositório.

### 2.1 Secrets do repositório `aloirr/macuxierp`
O workflow `producao-publicar.yml` já lê estes nomes.

| Secret | Para quê | Observação |
|---|---|---|
| `PROD_SSH_KEY`, `PROD_SSH_KNOWN_HOSTS`, `PROD_HOST`, `PROD_USER` | acesso à VM | os mesmos valores do FDV (mesma VM) |
| `PROD_PG_HOST`, `PROD_PG_PORTA`, `PROD_PG_CA_CERT` | servidor PostgreSQL (DBaaS) | o mesmo servidor do FDV |
| `PROD_PG_ADMIN_USUARIO`, `PROD_PG_ADMIN_SENHA` | admin do DBaaS, para migrações e para criar o banco e os papéis | sem superusuário (ADR 0003 item 6) |
| `PROD_S3_KEY_ID`, `PROD_S3_SECRET` | S3 com prefixo `macuxierp/<tenant>/` | pode ser o mesmo S3 do FDV; se possível, uma chave restrita ao prefixo |
| `PROD_SMTP_HOST`, `PROD_SMTP_PORTA`, `PROD_SMTP_USUARIO`, `PROD_SMTP_SENHA`, `PROD_SMTP_REMETENTE`, `PROD_SMTP_TLS` | e-mail (alerta do A1, exportação LGPD) | remetente do ERP |
| `PROD_CLOUDFLARE_TUNNEL_TOKEN` | túnel | o túnel do FDV (ADR 0003 item 5) |
| `PROD_ALERTA_WEBHOOK` | alerta de saúde | opcional |
| `MACUXI_RECADOS_TOKEN_SERVIDOR` | recados pelo servidor | conferir o uso com o engenheiro |

**Fica de fora:** `PROD_FCM_SERVICE_ACCOUNT_JSON` e `PROD_FCM_PROJECT_ID`. São resto do FDV (push do app), e o ERP não tem mobile. Pedido ao engenheiro-software: tirar do `producao-publicar.yml` num PR de governança.

### 2.2 `.env` de produção (`/opt/macuxierp/.env`, gerado pelo publicar ou criado pelo Alexandre)
O modelo oficial é o `env.modelo` da T-0024, com os nomes usados pelo código no PR #19:
- `MACUXIERP_BANCO`: conexão com o banco `macuxierp`, pelos papéis `macuxierp_app` e `macuxierp_worker`;
- `MACUXIERP_CHAVE_A1`: **32 bytes, obrigatória**, porque a API não sobe sem ela. Gere uma vez e guarde fora do repositório. Se ela se perder, o A1 cifrado não abre mais;
- `MACUXIERP_JWT_SEGREDO`: segredo das sessões do BKO;
- `MACUXIERP_COOKIE_SEGURO` (ligado em produção), `MACUXIERP_HOST`, `MACUXIERP_PORTA`, `MACUXIERP_PG_POOL`, `MACUXIERP_WORKER_INTERVALO_MS`, `MACUXIERP_VERSAO` e `MACUXIERP_API_URL`: configuração sem segredo, com valores padrão no `env.modelo`;
- S3 e SMTP, com os nomes que o `env.modelo` da T-0024 fixar.

### 2.3 DNS e túnel (painel do Cloudflare)
- O host `erp.macuxifdv.com.br` entra no túnel do FDV.
- `/v1` vai para `macuxierp-api` e o resto para `macuxierp-web`, pela rede Docker do túnel como rede externa.
- O DNS de `erp.` é um CNAME do túnel, que o painel cria ao adicionar o hostname público.

### 2.4 Na VM e no banco (o `preparar-vm.sh` da T-0024 guia)
- Pasta `/opt/macuxierp` e trava `/var/lock/macuxi-producao-vm.lock`.
- No DBaaS: o banco `macuxierp` e os papéis `macuxierp_app`, `macuxierp_worker` e `macuxierp_leitura`, criados pelo admin.

## 3. Texto do pedido ao time do FDV (para o Alexandre encaminhar)
> Time do Macuxi FDV, o Macuxi ERP vai começar a integração com o Hub (`/integracao/v1`) e o deploy na mesma VM. Peço duas coisas:
>
> 1. **Um tenant de teste no FDV, com credencial de conector**, só para testes do ERP. Ele não pode ser o da thathyany nem ter dado real. O tenant precisa aceitar a publicação de filiais, clientes, produtos, preços, estoque, vendedores, carteira e títulos, e o envio e o retorno de pedidos. Mandem a credencial por um canal seguro, fora de chat e de recado, para eu gravar como secret.
> 2. **A trava `flock` no `scripts/deploy/producao/implantar.sh` do FDV**, no mesmo arquivo que o ERP vai usar: `flock -w 1800 /var/lock/macuxi-producao-vm.lock`, antes de qualquer `docker compose` e solta no fim. Assim o FDV e o ERP nunca publicam ao mesmo tempo na VM (ADR 0003 do ERP). Enquanto a trava não existir do lado do FDV, o ERP só publica com o FDV parado.
>
> Mais tarde, depois da fase de pedidos do ERP, vamos combinar a virada da thathyany: o kit do Conector sai das entidades que o ERP passar a publicar (T-0027).

## 4. Passo a passo do credenciamento da thathyany na SEFAZ-AM e do A1 de homologação
> Os endereços, as NT vigentes e o procedimento exato são conferidos no portal oficial da SEFAZ-AM pela T-0018 antes do primeiro envio. Este roteiro é o caminho usual e não substitui o portal.

1. **Pré-requisitos da thathyany:** inscrição estadual ativa no AM e regime tributário definido (Simples Nacional ou regime normal). O contador dela confirma CNAE, CFOP de saída e CST/CSOSN usuais.
2. **Certificado digital A1 (e-CNPJ)** da thathyany, válido. Para a homologação, pode ser o mesmo A1 de produção.
3. **Credenciamento como emissora de NF-e (modelo 55)** no portal da SEFAZ-AM, feito pela thathyany ou pelo contador, com o acesso de contribuinte. O pedido é para o ambiente de **homologação** primeiro. Guarde o protocolo.
4. **No ERP:** o administrador da thathyany envia o A1 e a senha **pela tela do BKO** (ADR 0005). O arquivo vai cifrado para o banco e nunca passa por chat, e-mail ou recado. A filial emissora fica em **homologação**.
5. **Teste em homologação:** a T-0018 (spike da biblioteca, ADR 0002 opção A) e depois a T-0022 (20 notas autorizadas com o XML guardado) rodam só em homologação.
6. **Produção:** só depois da F4, com **"aprovo produção fiscal thathyany"** escrito pelo Alexandre, aplicado pelo script do operador (ADR 0006).
