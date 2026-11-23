# ADR 0014 — Cenário B: entrada de dados do banco do cliente no ERP (API `/entrada/v1` e Conector) e VM de teste

- **Status:** Proposta (23/11/2026). Vira "Aceita" com a revisão do gerente e o PR de governança da seção 10.
- **Data:** 23/11/2026 (Manaus)
- **Dono:** engenheiro-software
- **Tarefa:** T-0057 (v0.3.7). Roteiro da VM: `docs/banco/vm-cenario-b.md` (banco-dados, #387).
- **Base:** pedido do Alexandre (pelo PO, 23/11 ~12h47 e 14h08): entrada de dados no molde do FDV, com uma API REST de entrada e um Conector on-premise, e uma VM Linux de teste com o banco `ERP_THATHYANY`. Decisão de 14h19: "banco está vazio. vamos começar a thathyany do zero." O banco é fictício e não há restore de `.bak`. Ordem da R-20261123-150400-alexandre, renumerada pelo PO em 23/11, 15h36: v0.3.5 carga no /config → v0.3.6 zerar, desconto e credencial um por um → **v0.3.7 cenário B** → v0.3.8 pré-cadastro → v0.3.9 cadastro bloqueado. Premissas respondidas pelo PO em 23/11, 15h29 (§3 e §7).
- **Fontes copiadas (só consulta, nada muda no FDV):** `aloirr/macuxifdv@c460e92c4bf935c8096e6c67dd6b98a7929cf664` (FDV v1.0.28): `apps/conector` (versão **1.5.0**), `apps/conector/src/hub/cliente.ts` (rotas do Hub), `modules/integracao/kit-thathyany/conector/conector.json` (consultas das views), `docs/produto/03` (RN-INT-06 e a trava de 30%) e `.github/workflows/conector-publicar.yml`. O esquema do banco segue `aloirr/macuxifdv@0b79391`, `kit-thathyany/sql/criar-banco.sql`, com cópia de consulta em `aloirr/macuxierp-recados@8eef2ae`, `recados/anexos/T-0057/criar-banco-fdv-0b79391.sql`.
- **Amplia:** ADR 0010 (`external_id`), ADR 0012 (lista fechada de funções SECURITY DEFINER do portal) e ADR 0013 (o portal configura módulo; esta é a "ADR nova" que a §1 da 0013 exige para o segundo módulo).

## Contexto
Hoje o ERP só recebe cadastro pelo BKO, um a um ou pela carga de CSV (RF-CAD-11, `executarCarga`), e publica no FDV pela Integração FDV (ADR 0013). O cliente que já tem um ERP próprio (o thathyany, código FDV `am2808`) alimenta o FDV direto pelo Conector do kit. No cenário B o caminho passa a ser **banco do cliente → Conector → ERP → FDV**: o Macuxi ERP vira o dono do cadastro e o FDV o recebe só do ERP. Faltava decidir onde a entrada mora, que contrato ela fala, como o Conector é copiado, como fica a credencial e o que a VM de teste precisa.

## Decisão

### 1. A entrada é um submódulo do `cadastros`
- Fica em `modules/cadastros/{domain,api,contracts}/entrada/`, sem módulo novo nem licença nova. A rota exige o módulo **`cadastros`** licenciado e ativo e a empresa `ativo` (regra 6). Sem isso a resposta é 403 `RN-CORE-02`.
- **A regra é a da carga.** O lote recebido vira as mesmas linhas internas da carga de CSV (`domain/carga`: `modelo`, `mapear`, `referencias`, `dependencias`, `diferenca`), e a gravação passa pelo mesmo caminho do `executarCarga`. O `modulo-cadastros` extrai de `api/carga.ts` uma `gravarLinhas` que as duas entradas chamam. Não pode haver regra repetida (o corretor confere). A única diferença é a origem: o adaptador puro `domain/entrada/adaptar.ts` transforma o registro do Hub (seção 2) na linha da carga, citando RN-CAD-* e RN-INT-*.
- Depois de gravado, o cadastro sai para o FDV pelo caminho que já existe (eventos `cadastros.*@1` → Integração FDV). A entrada **não fala com o FDV**. O `integracao-fdv` só confirma que a gravação pela entrada publica como a do BKO e que não pede a carga inicial por conta própria.

### 2. Contrato: o mesmo do Hub `/integracao/v1` do FDV
- A `/entrada/v1` fala **o mesmo contrato** do Hub, para o Conector 1.5.0 funcionar sem mudar a montagem do lote: `LoteEnvelope` (`versao_contrato`, `entidade`, `conector_id`, sessão de carga completa com parte n e "último", registros), `LoteResultado` (contadores e erros por linha com `indice`, `external_id`, `campo` e `codigo`, **sem o dado**), `CursorEntidade` e a resposta do sinal. Os payloads são os 10 cadastros da F2 (`ENTIDADES_ENVIO_FDV`: filial, vendedor, forma e prazo de pagamento, produto, unidade do produto, preço, estoque, cliente e endereço do cliente), com dinheiro em centavos, datas UTC com `Z` e quantidades numéricas.
- **Onde fica o tipo:** os payloads hoje estão em `modules/integracao-fdv/contracts/hub.ts`, mas o `cadastros` não pode importar o `integracao-fdv`, porque o `integracao-fdv` já depende do `cadastros` (ver `SolicitacaoCargaInicial`). Por isso o envelope e os 10 payloads sobem para o **SDK**, em `packages/platform-sdk/src/hub-v1.ts`, com teste e o commit do FDV citado no cabeçalho. O `cadastros` e o `apps/conector` importam de lá. O `hub.ts` do `integracao-fdv` passa a **reexportar** do SDK num PR do `modulo-integracao-fdv` (fora do caminho crítico), e um teste trava os dois iguais até a troca, como o `LIMITE_REGISTROS_LOTE_FDV`. Este é o contrato de payload, não o da carga inicial: o `integracao-fdv.carga_inicial.solicitada@1` não muda.
- **Fora da v0.3.7:** os outros 6 do kit (`catalogo_no`, `transportadora`, `tabela_escalonada`, `rota`, `titulo` e `nota`). Um lote deles recebe 422 com `codigo` `entidade_fora_da_fase`, e o `conector.json` do kit do ERP não os lista. Também ficam fora a entrada de pedidos (`/pedidos/pendentes` e `/pedidos/{uuid}/retorno`; quem recebe pedido é o FDV) e a reconciliação diária (`/reconciliacoes`, RN-INT-07). As três rotas respondem 404 e o kit do ERP não tem `pedidos` nem `reconciliacao`.

### 3. Rotas `/entrada/v1` (apps/api, plugin do `cadastros`)

| Método e caminho | Entrada → saída | Observação |
|---|---|---|
| `POST /entrada/v1/lotes` | `LoteEnvelope` → 202 `{ lote_id, estado: 'recebido' }` | `Idempotency-Key` **obrigatória**. A mesma chave com o mesmo corpo devolve o mesmo `lote_id`; com outro corpo, 409. Até 5.000 registros (`LIMITE_REGISTROS_LOTE_FDV`) e o mesmo teto de bytes do Hub (o PR confere contra o FDV). 400/413/422 recusam o envelope inteiro, sem lote criado (RN-INT-01). |
| `GET /entrada/v1/lotes/:id?limite_erros=n` | → `LoteResultado` | Só o lote do próprio conector. 404 para o lote de outro conector ou de outro tenant. |
| `GET /entrada/v1/cursores/:entidade` | → `CursorEntidade` | `alterado_em` e `external_id` do último registro aplicado, por conector e entidade. |
| `POST /entrada/v1/sinal` | `{ versao, ... }` do Conector → `RespostaSinal` | Grava o último sinal e a versão. A política de versão sai com a mínima e a recomendada do ERP. A **atualização automática fica desligada** na v0.3.7 (seção 6). |

- **Autenticação de máquina, sem JWT nem sessão:** `Authorization: Bearer <chave>` e `X-Macuxi-Conector-Id`, como no FDV. A chave dá acesso **só** a `/entrada/v1`, e o JWT do BKO é recusado ali. Cabe na regra 6 como o "perfil" `conector_entrada`, uma identidade de máquina com escopo fixo e sem permissões do BKO.
- **Processamento assíncrono:** o `POST` grava o lote e enfileira o trabalho `cadastros.entrada_lote` (apps/worker). O worker valida pelo Zod do SDK, adapta, grava por `gravarLinhas` e escreve o resultado. Um lote por entidade e por conector de cada vez, na ordem de chegada, para o cursor não pular.
- **Carga completa (RN-INT-06, copiada):** pode ocupar vários lotes da mesma sessão. Só ao concluir o último, os ativos da entidade **não vistos desde o início da sessão** são inativados (`deleted_at`, nunca apagados). Uma sessão incompleta não inativa nada, e o registro que veio inválido nunca é inativado. **A trava de 30%** (`limite_inativacao_pct`, padrão 30) também vale aqui: acima dela o lote fica `aguardando_confirmacao`, com as inativações paradas, e quem confirma é **só o superadmin, no `/config`**, com auditoria; a confirmação expira em 7 dias (PO, 23/11 15h29; no FDV quem confirma é admin ou analista do BKO). A trava vale só para a carga completa de **entrada**: o "Substituir tudo" manual da carga de CSV continua sem limite, com a frase de confirmação.
- **LGPD:** o corpo do lote (que tem dado pessoal de cliente) fica no banco só até o processamento e é **zerado** quando o lote termina, ou em 24 h, o que vier antes. O resultado guarda só os contadores e os erros por linha sem o dado. Nenhum log leva o corpo, a chave ou o dado do registro, só `lote_id`, entidade, contagens e códigos.

### 4. Credencial do conector
- **Duas bases por empresa, uma por dono:** "via Conector" (o programa on-premise) e "via API" (o ERP do cliente chamando direto). Cada uma tem no máximo uma credencial ativa. O `conector_id` é único na plataforma (`[A-Za-z0-9._-]{1,100}`, a mesma regra do Conector).
- **A chave é gerada na API** (32 bytes aleatórios, base64url) e **mostrada uma vez**, na resposta do portal. O banco guarda só o `HMAC-SHA256(pepper, chave)`, o prefixo de exibição (8) e as datas. O pepper fica na variável `MACUXIERP_PEPPER_ENTRADA` do servidor (32 bytes; **só o Alexandre cria**). Sem ela, a geração de chave responde 503 e a autenticação recusa tudo. Trocar a chave invalida a anterior na hora.
- **Autenticar sem tenant:** antes da autenticação não há `app.tenant_id` (RLS). Por isso o papel `macuxierp_app` chama a função SECURITY DEFINER `cadastros.entrada_autenticar(p_conector_id text) → (tenant_id, credencial_id, tipo, chave_hmac)`, que só a ela tem EXECUTE e que não devolve mais nada. A API compara o HMAC com `timingSafeEqual` e só então abre a transação com o `app.tenant_id`. Um limite de tentativas por `conector_id` e IP, no molde do §6 da ADR 0012, segura a força bruta.
- **No portal** (lista fechada da ADR 0012, EXECUTE só do `macuxierp_config`, com `exigir_superadmin`, `empresa_alvo` e `auditar_superadmin`, no molde da §2 da 0013): `cadastros.portal_entrada_ler` (credenciais sem o hash, último sinal, versão e, por entidade, cursor, último lote e erros abertos, sem dado de negócio), `cadastros.portal_entrada_credencial_definir` (cria ou troca, recebendo o HMAC já calculado pela API) e `cadastros.portal_entrada_confirmar_inativacao` (a trava de 30%). A auditoria usa nomes canônicos `cadastros.entrada.credencial.criar|trocar` e `cadastros.entrada.inativacao.confirmar`, sem chave, hash nem prefixo.

### 5. Telas
- **`/config`, aba "Integração"** (o lugar já reservado em `apps/web/src/app/config/(portal)/empresas/[id]/aba-integracao.tsx`): as colunas **"Integração via Conector"** e **"Integração via API"**, cópia do portal do FDV, **acima** do bloco "Macuxi FDV". Cada coluna mostra o `conector_id`, o prefixo da chave, o botão de gerar ou trocar a chave (que mostra a chave uma vez, com "copiar" e o aviso de que ela não aparece de novo), o último sinal, a versão e a lista por cadastro (último lote, erros e confirmação pendente). O `engenheiro-apps` monta, o `designer-ux` revisa e o `design-de-marca` valida.
- **BKO:** só leitura, com o status da entrada por cadastro, ao lado do status da Integração FDV. Sem chave e sem botão.

### 6. O Conector: cópia do `apps/conector` do FDV 1.5.0
- **Base:** `apps/conector` do `aloirr/macuxifdv@c460e92`, versão **1.5.0** (a última, que já traz o 1.4.0). A cópia vai para `apps/conector` do ERP como `@macuxierp/conector` versão `1.0.0`. O `package.json` e o LEIA-ME registram "base FDV 1.5.0 @c460e92", e o histórico do FDV não é copiado.
- **O que muda na cópia (só isto):**
  1. **Prefixo configurável:** `hub.prefixo` no esquema da configuração, com o padrão `/entrada/v1` no ERP. No FDV o prefixo `/integracao/v1` é fixo no cliente. A URL continua só HTTPS (HTTP só para localhost nos testes).
  2. **Tipos do SDK:** o import de `@macuxi/integracao/contracts` troca por `@macuxierp/platform-sdk/hub-v1` (seção 2).
  3. **Atualização automática desligada:** `atualizacao.ativa` fica falso e não há chave de assinatura nem bucket na v0.3.7. A troca de versão é manual. Ligar a atualização pede ADR nova, com a chave do ERP (nunca a do FDV).
  4. **Linux oficial ao lado do Windows:** além do pacote Windows (WinSW, como no FDV), um pacote `tar.gz` com o `conector.mjs`, o exemplo e uma unidade **systemd**: usuário próprio `macuxi-conector` sem login, `ProtectSystem=strict`, `NoNewPrivileges=yes`, a pasta de dados em `/var/lib/macuxi-conector` e os segredos em `EnvironmentFile=/etc/macuxi-conector/segredos.env` (dono root, 0600, `MACUXI_CONECTOR_ERP_SENHA` e `MACUXI_CONECTOR_HUB_CHAVE`; o provedor `env` do FDV já lê). O Node 24.7+ vem do pacote da distribuição ou do NodeSource, conforme o roteiro.
  5. **Pedidos e reconciliação:** o código fica, sem uso. O esquema da configuração do ERP recusa `pedidos` e `reconciliacao` com uma mensagem clara.
- **Kit do ERP:** `apps/conector/exemplos/conector.thathyany.exemplo.json`, copiado do `kit-thathyany/conector/conector.json` só com os 10 cadastros, apontando para a URL do ERP, com `conectorId` próprio (o do ERP, nunca o `thathyany-conector` do FDV) e sem `pedidos`. As consultas às views `dbo.vw_macuxi_*` são as do kit, sem mudança.
- **Fronteiras:** o `apps/conector` importa só `packages/platform-sdk` (nada de `modules/*`), e o verificador de fronteiras passa a olhar a pasta (seção 9, linha 1).

### 7. VM de teste
- É o roteiro `docs/banco/vm-cenario-b.md` (SQL Server 2022 **Express**, banco `ERP_THATHYANY` fictício, **30 dias**).
- **O Conector roda na própria VM**, pela unidade systemd da seção 6, e lê `127.0.0.1,1433`. A saída é HTTPS para o ERP. O banco-dados acrescenta ao roteiro a seção "Instalar o Conector" (o pacote Linux, `segredos.env`, `systemctl enable --now`, `conector status`).
- **ERP alvo (PO, 23/11 15h29):** a API de produção `erp.macuxifdv.com.br`, na empresa **AM2808** (thathyany), que já existe e só tem dados fictícios; não há empresa nova. Do lado do FDV vale a credencial da Integração FDV já salva na AM2808, no ambiente **Produção** do Hub, com a thathyany do FDV parada; não há Hub de teste novo.
- **Carga dos CSVs:** na VM roda o Claude Code com Remote Control, e é por ele que o Alexandre carrega os CSVs fictícios nas tabelas `tha_*` (R-20261123-151313).
- **Virada sem envio duplicado:** antes do primeiro lote do Conector do ERP, o Conector do kit do FDV (`thathyany-conector`) precisa estar **desligado**, e o Alexandre inativa no FDV os cadastros antigos (decisão de 14h19). A ordem fica no roteiro, com o "como conferir".
- **Senhas:** a do `macuxi_conector` fica só num arquivo local da VM, `/etc/macuxi-conector/segredos.env` (root, 0600), fora do repositório, junto com a chave do conector; a do `sa` fica no cofre. A sessão do Claude Code da VM não lê esses arquivos nem cita valor em recado, commit ou log.

### 8. Banco (banco-dados; migração a reservar no quadro)
Todas as tabelas no schema `cadastros`, com as colunas da regra 5 e RLS:
- `entrada_credencial` (`conector_id` único global, `tipo` `conector|api`, `chave_hmac bytea`, `chave_prefixo`, `criada_em`, `substituida_em`, `ultimo_uso_em`; no máximo uma ativa por tenant e tipo);
- `entrada_lote` (`credencial_id`, `entidade`, `idempotency_key`, `hash_corpo`, `corpo jsonb` que pode ser nulo e é zerado ao terminar, `estado` `recebido|processando|concluido|concluido_com_erros|falhou|aguardando_confirmacao`, os contadores e a sessão de carga completa com a parte e o "último");
- `entrada_lote_erro` (`indice`, `external_id`, `campo`, `codigo`; sem o dado);
- `entrada_cursor` (por credencial e entidade);
- `entrada_sinal` (último sinal, versão e IP de origem truncado);
- as funções da seção 4: `entrada_autenticar` para o `macuxierp_app`, e as três `portal_entrada_*` para o `macuxierp_config`.

Os testes `*.db.test.ts` cobrem: isolamento por tenant; a autenticação sem tenant devolvendo só o próprio; o hash nunca no `portal_entrada_ler`; a idempotência do lote; o corpo zerado ao concluir; a sessão incompleta que não inativa; a trava de 30%; e a auditoria com `superadmin_id`.

### 9. Quem faz o quê e ordem
| # | Dono | O quê | Depende de |
|---|---|---|---|
| 0 | Alexandre (PR de governança, seção 10) | `donos.json`, workflow e CI para `apps/conector` | esta ADR |
| 1 | engenheiro-software | `packages/platform-sdk/src/hub-v1.ts` (envelope e os 10 payloads, com teste); a autenticação de máquina e o plugin `/entrada/v1` na apps/api; o mapa de erros; a cópia do `apps/conector` (seção 6); o verificador de fronteiras (`scripts/fronteiras.mjs`) olhando o `apps/conector` | 0 para o `apps/conector`; o SDK sai antes |
| 2 | banco-dados | a migração da seção 8 e os testes de banco; a seção "Instalar o Conector" no roteiro da VM; a §1 do roteiro deixa de dizer que nada vai para `erp.macuxifdv.com.br` e passa a dizer que o Conector da VM alimenta a AM2808 no ERP de produção (§7) | 1 (SDK) |
| 3 | modulo-cadastros | `domain/entrada` (o adaptador e a sessão de carga completa, com a trava de 30%, puros e com teste antes), a extração de `gravarLinhas` de `api/carga.ts`, o trabalho do worker e as rotas do plugin | 1 e 2 |
| 4 | modulo-integracao-fdv | `contracts/hub.ts` reexportando do SDK; o teste de que a gravação pela entrada publica como a do BKO | 1 |
| 5 | engenheiro-apps · designer-ux · design-de-marca | as colunas do `/config` e o status no BKO (seção 5) | 3 (contrato) |
| 6 | testes | `tests/`: ponta a ponta Conector → `/entrada/v1` → cadastros → dublê do Hub; JWT recusado na `/entrada/v1`; chave de outro tenant recusada; o corpo e a chave fora de log e resposta; a trava de 30%; os 10 cadastros com o layout do kit | 3, 4 e 5 |
| 7 | Alexandre e banco-dados | a VM pelo roteiro, com o Conector instalado e a virada da seção 7 | 6 |

### 10. O que o PR de governança precisa (não faz parte deste PR)
É um PR só, no início da v0.3.7, com `Agente: alexandre`. O merge sai com "autorizo o merge do PR #N no commit <sha>".
1. **`.coord/donos.json`:** `apps/conector/**` para o `engenheiro-software`; `modules/cadastros/**/entrada/**` continua no `modulo-cadastros` (já coberto por `modules/cadastros/**`, só conferir); `packages/platform-sdk/src/hub-v1*.ts` no `engenheiro-software` (já coberto, conferir).
2. **`.github/workflows/conector-montar.yml`** (novo, só `workflow_dispatch`): monta o pacote Windows (zip) e o Linux (`tar.gz`) do `apps/conector`, com o SHA-256 de cada arquivo, e os sobe como **artefato do GitHub** (30 dias). Falha fechada se a versão do input for diferente da do `package.json`. **Sem assinatura, sem bucket e sem secret** na v0.3.7 (seção 6, item 3).
3. **`.github/workflows/ci.yml`:** o `apps/conector` entra no escopo, no lint, no typecheck e no build do PR, e os testes dele entram na suíte do `producao-liberar`.
4. **Segredo (o Alexandre cria; não é PR):** `MACUXIERP_PEPPER_ENTRADA`, pelo passo da seção 11. Nenhum secret do GitHub novo na v0.3.7.

### 11. Passo do Alexandre: criar o `MACUXIERP_PEPPER_ENTRADA`
- **Onde:** no `.env` de produção da VM, `/opt/macuxierp/.env`, o mesmo arquivo da `MACUXIERP_CHAVE_A1` e da `MACUXIERP_CHAVE_INTEGRACAO`. Não é secret do GitHub.
- **Quando:** antes da publicação da v0.3.7. O engenheiro-software soma, no PR da linha 1 da seção 9, a variável ao `compose.yml` (só na `macuxierp-api`) e ao `env.modelo`, e a conferência no `implantar.sh`: sem 32 bytes válidos, a publicação para antes do `up`, como já acontece com a `MACUXIERP_CHAVE_INTEGRACAO`.
- **Como** (na VM, com o usuário de sudo; o valor não passa pela tela nem pelo histórico):
  ```bash
  if sudo grep -q '^MACUXIERP_PEPPER_ENTRADA=.' /opt/macuxierp/.env; then
    echo "já existe: não troque"
  else
    printf 'MACUXIERP_PEPPER_ENTRADA=%s\n' "$(openssl rand -hex 32)" | sudo tee -a /opt/macuxierp/.env >/dev/null
  fi
  sudo grep -c '^MACUXIERP_PEPPER_ENTRADA=' /opt/macuxierp/.env   # 1
  sudo stat -c '%a %U' /opt/macuxierp/.env                         # 600 e o usuário de deploy
  ```
  Depois, guarde uma cópia do valor no cofre de senhas, lendo direto do arquivo, sem colar em chat ou recado.
- **O que reiniciar:** nada à mão. A `macuxierp-api` lê a variável na publicação da v0.3.7 ("aprovo deploy v0.3.7"), quando o `implantar.sh` recria os contêineres. É uma publicação por vez na VM (ADR 0003). O worker não usa o pepper.
- **Nunca troque sem motivo:** um pepper novo invalida todas as chaves de entrada, e todos os conectores precisam de chave nova no `/config`. Se ele vazar, gere outro, publique e troque as chaves de todas as empresas.

## Consequências
- O ERP passa a ter uma segunda porta de escrita de cadastro, por máquina, ao lado do BKO e da carga de CSV, com a mesma regra (seção 1).
- O cliente com ERP próprio fala com o ERP pelo mesmo programa e contrato que já conhece do FDV. Só a URL e o prefixo mudam.
- O SDK ganha o contrato do Hub (`hub-v1`), e o `integracao-fdv` deixa de ser o único dono dos payloads.
- A lista fechada da ADR 0012 ganha `cadastros.entrada_autenticar` (do `macuxierp_app`, a primeira fora do portal) e as três `cadastros.portal_entrada_*`.
- O repositório ganha um `apps/conector`, que precisa de manutenção própria. Mudança no Conector do FDV não chega sozinha: cada atualização é uma cópia nova, citando o commit.

## Riscos
- **Envio duplicado ao FDV** se o `thathyany-conector` do FDV não for desligado antes da virada. Mitigação: a seção 7 e o roteiro, com o "como conferir".
- **Contrato × layout do kit:** um campo da view pode não caber no payload ou no cadastro do ERP. Mitigação: o teste por entidade da seção 9 (item 6), com as consultas do kit.
- **Inativação em massa** pela carga completa. Mitigação: a sessão completa e a trava de 30% (seção 3).
- **`entrada_autenticar` fora do portal:** a função roda antes do tenant. Mitigação: ela devolve só o necessário para comparar, o limite de tentativas e o EXECUTE só do `macuxierp_app`.
- **Divergência do Conector copiado** em relação ao do FDV. Mitigação: as mudanças ficam limitadas à seção 6, e um teste do `apps/conector` trava o contrato pelo SDK.
- **VM esquecida** além dos 30 dias: o gerente cobra na ronda (roteiro, seção 8).

## Alternativas descartadas
- (a) **Módulo novo `entrada`, com licença própria:** a regra do cadastro ficaria fora do `cadastros` ou repetida.
- (b) **O ERP lê o banco do cliente direto** (conexão de entrada na VM do ERP): abriria a 1433 do cliente para a internet e tiraria do cliente o controle do que sai.
- (c) **Contrato novo para a `/entrada/v1`:** obrigaria a reescrever a montagem do lote no Conector, e o cliente teria dois contratos.
- (d) **O Conector manda ao FDV e ao ERP ao mesmo tempo:** o FDV receberia o mesmo cadastro por dois caminhos, e o ERP deixaria de ser o dono.
- (e) **Base no Conector 1.4.0:** ficaria sem as correções do 1.5.0, sem ganho.
- (f) **Payloads só em `cadastros/contracts`:** criaria uma segunda cópia do contrato do Hub ao lado da do `integracao-fdv`.
