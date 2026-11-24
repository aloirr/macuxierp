# Roteiro da VM de teste do cenário B (v0.3.11)

> T-0057 · autor: `banco-dados` · criado em 2026-11-23, 14h10 (Manaus); revisto em 2026-11-23, 14h20 (Manaus), com a decisão do Alexandre (via PO, 23/11, 14h19): "banco está vazio. vamos começar a thathyany do zero." Vale o banco **fictício**. Revisto em 2026-11-23, 15h15 (Manaus), com a decisão R-20261123-151313-alexandre (banco controlado pelo Claude Code da VM, via Remote Control; SQL Server Express). Revisto em 2026-11-23, 15h23 (Manaus): alinhado ao prompt de arranque do PO (segredos em ~/thathyany/.segredos.env, carga por MERGE, sem 2A.1). Revisto em 2026-11-24, 05h51 (Manaus), para a v0.3.11 (ADR 0014 §6, §7 e §13): o banco passa a ser criado pelo **kit do ERP** (`docs/banco/kit-erp/criar-banco.sql`, seção 5), com a mão dupla (pedido, nota e pré-cadastro descendo); o `macuxi_conector` ganha EXECUTE nas `sp_macuxi_*` (seção 7); entram as seções **7A** (instalar o Conector) e **7B** (virada sem envio duplicado).
> Cenário B (ADR 0014; numerado como v0.3.11 desde 23/11, 23h00), aprovado pelo Alexandre. **Só teste, temporário.** Numeração: as seções novas são a **2A** (Claude Code na VM), a **7A** e a **7B**; as demais mantêm o número.
> Sem segredo neste texto: tudo o que é sensível aparece como marcador (`<IP_DO_ALEXANDRE>`, `<HOST_DA_VM>`...). As senhas do `sa` e do conector são geradas pela própria sessão da VM em `~/thathyany/.segredos.env` (seção 2A) e nunca aparecem em doc, chat, recado, commit ou log.

## 1. Objetivo, escopo e o que NÃO é

**Objetivo:** subir uma VM Linux de teste com o banco `ERP_THATHYANY` (cliente thathyany, código FDV `am2808`) **criado do zero** pelo kit do ERP (no molde do kit do Macuxi FDV) e populado com **dados fictícios**, para o Conector do ERP, que roda na VM, ler as views e enviar ao Macuxi ERP de **produção** (`erp.macuxifdv.com.br`), na empresa **AM2808** (ADR 0014 §7), e gravar no banco o que desce do ERP (pedido, nota e pré-cadastro de cliente, §13).

**Escopo:** uma VM, o Claude Code da própria VM controlado pelo Alexandre via Remote Control (seção 2A), um SQL Server 2022 Express, o banco criado pelo `criar-banco.sql` do kit do ERP (seção 5), a carga dos CSVs fictícios e do catálogo (seção 6), o login `macuxi_conector` com o mínimo (SELECT nas views e EXECUTE nas `sp_macuxi_*`, seção 7), o Conector do ERP como serviço systemd (seção 7A), a virada sem envio duplicado ao FDV (seção 7B), firewall fechado; a VM fica enquanto durarem os testes e é apagada no encerramento (seção 8).

**O que NÃO é:**
- Não é dado de produção: o banco da VM é de teste, só com dados fictícios. O destino é o ERP de produção (`erp.macuxifdv.com.br`), na empresa AM2808 (ADR 0014); nada roda na VM de produção do FDV/ERP e nenhum outro tenant é tocado.
- Não é cópia do banco real do cliente: **não há restore de `.bak`** nem dado de cliente real.
- **Nada do código nem do banco do Macuxi FDV muda** (`aloirr/macuxifdv` é só consulta). A única ação no FDV é a da virada (seção 7B), feita pelo Alexandre por decisão de 23/11, 14h19: desligar o `thathyany-conector` e inativar os cadastros antigos da AM2808.
- **O ERP nunca lê tabela do FDV.** O conector lê só as views deste banco de teste; o banco `macuxierp` não ganha acesso a ele nem ao banco do FDV.
- Não é permanente: acaba quando o Alexandre encerrar os testes por recado (seção 8).
- Nenhum agente do time recebe acesso: quem opera o banco é a sessão do Claude Code **da VM**, na conta do Alexandre, com os CSVs que ele manda no prompt.

## 2. VM

- **Sistema:** Ubuntu Server 22.04 LTS (é a versão suportada pelo SQL Server 2022 no Linux).
- **Tamanho sugerido:** 2 vCPU, 4 GB de RAM (o SQL Server exige no mínimo 2 GB), disco de dados de 40 GB (sobra para os dados fictícios, o catálogo e o log).
- **Disco:** **volume cifrado do provedor** (criptografia em repouso, ligada na criação do disco), com os dados num **volume separado** do disco do sistema. (Se o provedor não oferecer, LUKS na instalação, com o ok do Alexandre.) **Snapshot automático do provedor desligado**, para nada sobreviver ao encerramento (seção 8).
- **Atualizações:**
  ```bash
  sudo apt update && sudo apt full-upgrade -y
  sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
  sudo timedatectl set-timezone UTC   # carimbos técnicos em UTC
  ```
- **Usuário sem root, com sudo:**
  ```bash
  sudo adduser <USUARIO_ADMIN>
  sudo usermod -aG sudo <USUARIO_ADMIN>
  # chave pública do Alexandre (só a pública)
  sudo -u <USUARIO_ADMIN> mkdir -p /home/<USUARIO_ADMIN>/.ssh
  echo '<CHAVE_PUBLICA_DO_ALEXANDRE>' | sudo tee /home/<USUARIO_ADMIN>/.ssh/authorized_keys
  sudo chmod 700 /home/<USUARIO_ADMIN>/.ssh && sudo chmod 600 /home/<USUARIO_ADMIN>/.ssh/authorized_keys
  sudo chown -R <USUARIO_ADMIN>: /home/<USUARIO_ADMIN>/.ssh
  ```
- **SSH só por chave** (em `/etc/ssh/sshd_config.d/10-endurecer.conf`):
  ```
  PasswordAuthentication no
  KbdInteractiveAuthentication no
  PermitRootLogin no
  AllowUsers <USUARIO_ADMIN>
  ```
  `sudo sshd -t && sudo systemctl restart ssh` — **antes de fechar a sessão atual**, abra outra e confira que entra.

Como conferir:
- O painel do provedor mostra o volume de dados "encrypted".
- `sudo sshd -T | grep -Ei 'passwordauth|permitroot'` → `no` / `no`.
- De fora: `ssh -o PubkeyAuthentication=no <USUARIO_ADMIN>@<HOST_DA_VM>` deve falhar com `Permission denied (publickey)`.

## 2A. Claude Code na VM (Remote Control)

Decisão R-20261123-151313-alexandre: o banco é controlado pelo **Claude Code da própria VM**, que o Alexandre comanda pelo Remote Control (claude.ai/code). Os CSVs fictícios chegam nos prompts dessa sessão.

- **Instalar** (como `<USUARIO_ADMIN>`, instalador nativo):
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  claude --version
  ```
- **Login:** só o Alexandre, com a conta dele: pelo SSH roda `claude` uma vez na VM e segue o `/login` no navegador. Este roteiro não leva credencial, token nem e-mail da conta.
- **Pasta de trabalho e Remote Control (agora, com tmux):**
  ```bash
  install -d -m 700 ~/thathyany ~/thathyany/carga
  tmux new -s thathyany
  cd ~/thathyany && claude remote-control
  # destacar: Ctrl-b d  (a sessão aparece no claude.ai/code do Alexandre)
  ```
- **Passo posterior, só depois do tmux testado: serviço systemd de usuário** (`~/.config/systemd/user/claude-remote.service`; confira o caminho do `claude` com `command -v claude`):
  ```ini
  [Unit]
  Description=Claude Code Remote Control (thathyany)
  After=network-online.target

  [Service]
  WorkingDirectory=%h/thathyany
  ExecStart=%h/.local/bin/claude remote-control
  Restart=on-failure

  [Install]
  WantedBy=default.target
  ```
  ```bash
  tmux kill-session -t thathyany          # sai o tmux, entra o serviço
  systemctl --user daemon-reload && systemctl --user enable --now claude-remote
  sudo loginctl enable-linger <USUARIO_ADMIN>
  ```
- **Segredos gerados pela própria sessão, sem mostrar nada:** no arranque, a sessão da VM gera as duas senhas em `~/thathyany/.segredos.env` (permissão 600), só se o arquivo ainda não existir (gerar de novo depois do setup quebraria o `sa`). `printf` é do próprio shell: nada vai à lista de processos. O sufixo `Aa1!` garante maiúscula, minúscula, dígito e símbolo, e o tamanho (mais de 30 caracteres) passa da política do SQL Server:
  ```bash
  [ -e ~/thathyany/.segredos.env ] || ( umask 077; printf 'MSSQL_SA_PASSWORD=%s\nSENHA_CONECTOR=%s\n' \
    "$(openssl rand -base64 24 | tr -d '/+=')Aa1!" \
    "$(openssl rand -base64 24 | tr -d '/+=')Aa1!" > ~/thathyany/.segredos.env )
  ```
  Os comandos carregam o arquivo **num subshell**, só para aquele comando: `( set -a; . ~/thathyany/.segredos.env; set +a; SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" sqlcmd ... )`. A sessão **nunca imprime o arquivo** (nada de `cat`, `echo` ou trecho da senha no chat, recado ou log); se o Alexandre precisar da senha, lê pelo SSH. O `.segredos.env` e os CSVs **nunca** vão ao repositório.
- **sudo só para o arranque:** o Alexandre cria um drop-in temporário e o valida; ele é **removido no fim do arranque** (seção 7, último passo do prompt de arranque). Depois disso a sessão da VM não tem sudo sem senha (a carga da seção 6 não precisa: a pasta de carga é do usuário).
  ```bash
  echo '<USUARIO_ADMIN> ALL=(ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/90-arranque >/dev/null
  sudo chmod 440 /etc/sudoers.d/90-arranque
  sudo visudo -cf /etc/sudoers.d/90-arranque || sudo rm -f /etc/sudoers.d/90-arranque
  ```
- **Firewall não muda:** o Remote Control só abre conexão de **saída** (HTTPS); nenhuma porta de entrada nova (seção 3).

Como conferir:
- `claude --version` responde; `tmux ls` mostra `thathyany` (com o serviço: `systemctl --user is-active claude-remote` → `active`).
- A sessão aparece no claude.ai/code do Alexandre.
- `ls -ld ~/thathyany ~/thathyany/carga` → `drwx------`; `stat -c '%a' ~/thathyany/.segredos.env` → `600` (só a permissão, sem abrir o arquivo).
- `sudo ufw status` igual ao da seção 3.
- Depois do arranque: `sudo -n true` falha e `/etc/sudoers.d/90-arranque` não existe.

O prompt de arranque é o entregue pelo PO ao Alexandre em 23/11, e cobre as seções 2 a 7.

## 3. Firewall

Regra: **22 só para `<IP_DO_ALEXANDRE>`; 1433 nunca exposta; o resto negado.** Aplicar no `ufw` **e** no firewall do provedor (grupo de segurança), se houver; os dois juntos.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <IP_DO_ALEXANDRE> to any port 22 proto tcp
# NÃO existe regra para 1433
sudo ufw enable
```
No provedor: entrada só TCP 22 de `<IP_DO_ALEXANDRE>/32`; nenhuma outra regra de entrada.

**O conector roda na própria VM** e chega ao SQL Server por `127.0.0.1,1433`: sem IP extra liberado e sem túnel SSH para o conector. A saída dele para o ERP (`erp.macuxifdv.com.br`, HTTPS) é tráfego de saída (já permitido), como a do Remote Control (seção 2A).

Como conferir:
- `sudo ufw status verbose` → `Default: deny (incoming)`, uma regra só: `22/tcp ALLOW IN <IP_DO_ALEXANDRE>`.
- `sudo ss -tlnp` → `1433` só em `127.0.0.1` (e/ou `::1`), nunca em `0.0.0.0` ou `*`.
- De fora (outro IP qualquer): `nc -vz -w 5 <HOST_DA_VM> 1433` e `nc -vz -w 5 <HOST_DA_VM> 22` → ambos falham (timeout).
- Do IP do Alexandre: `nc -vz -w 5 <HOST_DA_VM> 22` → abre; `1433` → falha.

## 4. SQL Server 2022 no Ubuntu 22.04

**Edição:** SQL Server **Express** (escolha do Alexandre, R-20261123-151313-alexandre). Os dados fictícios ficam bem abaixo do limite de 10 GB por banco do Express.

Executada pela sessão do Claude Code da VM no arranque (prompt de arranque do PO, seção 2A), com o sudo temporário. Na sessão, as ferramentas vão pelo caminho completo (`/opt/mssql-tools18/bin/sqlcmd` e `bcp`), porque o shell dela pode não ler o `~/.bashrc`.

```bash
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | sudo tee /etc/apt/trusted.gpg.d/microsoft.asc
curl -fsSL https://packages.microsoft.com/config/ubuntu/22.04/mssql-server-2022.list | sudo tee /etc/apt/sources.list.d/mssql-server-2022.list
sudo apt update && sudo apt install -y mssql-server
( set -a; . ~/thathyany/.segredos.env; set +a; MSSQL_PID=Express ACCEPT_EULA=Y \
  sudo --preserve-env=MSSQL_PID,ACCEPT_EULA,MSSQL_SA_PASSWORD /opt/mssql/bin/mssql-conf -n setup )
```
- A senha do `sa` é a `MSSQL_SA_PASSWORD` gerada pela sessão em `~/thathyany/.segredos.env` (seção 2A); ela passa ao setup pelo ambiente de um subshell só (não fica em variável persistida, histórico, lista de processos nem doc).
- Ferramentas de linha de comando (`sqlcmd` e `bcp`):
  ```bash
  curl -fsSL https://packages.microsoft.com/config/ubuntu/22.04/prod.list | sudo tee /etc/apt/sources.list.d/mssql-release.list
  sudo apt update && sudo ACCEPT_EULA=Y apt install -y mssql-tools18 unixodbc-dev
  echo 'export PATH="$PATH:/opt/mssql-tools18/bin"' >> ~/.bashrc
  ```
- **Só localhost e TLS:**
  ```bash
  sudo /opt/mssql/bin/mssql-conf set network.ipaddress 127.0.0.1
  # certificado (autoassinado serve para o teste; o acesso é só local)
  sudo /opt/mssql/bin/mssql-conf set network.tlscert /etc/ssl/mssql/mssql.pem
  sudo /opt/mssql/bin/mssql-conf set network.tlskey  /etc/ssl/mssql/mssql.key
  sudo /opt/mssql/bin/mssql-conf set network.tlsprotocols 1.2
  sudo /opt/mssql/bin/mssql-conf set network.forceencryption 1
  sudo systemctl restart mssql-server
  ```
  (os arquivos do certificado pertencem a `mssql:mssql`, permissão 600 na chave.)

Como conferir:
```bash
systemctl status mssql-server --no-pager
( set -a; . ~/thathyany/.segredos.env; set +a; SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" sqlcmd -S 127.0.0.1 -U sa -C -Q "SELECT SERVERPROPERTY('Edition'), SERVERPROPERTY('ProductVersion');" )
( set -a; . ~/thathyany/.segredos.env; set +a; SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" sqlcmd -S 127.0.0.1 -U sa -C -Q "SELECT encrypt_option FROM sys.dm_exec_connections WHERE session_id=@@SPID;" )   # TRUE
ss -tln | grep 1433   # só 127.0.0.1
```
Edição `Express Edition (64-bit)`, versão `16.x`.

## 5. Criar o banco com o kit do ERP

**Fonte:** `docs/banco/kit-erp/criar-banco.sql`, no repositório do ERP (dono: `banco-dados`; T-0057). É o kit do ERP, no molde do `kit-thathyany/sql/criar-banco.sql` do FDV (`aloirr/macuxifdv@0b79391`, só consulta), com as colunas derivadas dos payloads do contrato do Hub v1 (`modules/integracao-fdv/contracts/hub.ts`) e a descida da ADR 0014 §13. O kit do FDV **não** entra no repositório do ERP.

**O que ele cria** (reexecutável: `IF NOT EXISTS` e `CREATE OR ALTER`; sem dado e sem segredo no arquivo):
- o banco `ERP_THATHYANY` (colação `Latin1_General_100_CI_AI_SC_UTF8`);
- **10 tabelas `dbo.tha_*`**, uma por cadastro da F2: `filial`, `vendedor`, `forma_pagamento`, `prazo_pagamento`, `produto`, `produto_unidade`, `preco`, `estoque`, `cliente`, `cliente_endereco` (chave `external_id` com colação binária, coluna `alterado_em` em UTC, índice `(alterado_em, external_id)`, dinheiro em centavos). Os outros 6 do kit do FDV (`catalogo_no`, `transportadora`, `tabela_escalonada`, `rota`, `titulo` e `nota`) ficam fora da fase (ADR 0014 §2);
- **13 views `dbo.vw_macuxi_*`**: as 10 de cadastro (sobem) e as 3 do retorno, `vw_macuxi_pedido_status`, `vw_macuxi_pedido_nota_item` e `vw_macuxi_cliente_retorno`;
- **6 tabelas de entrada** do que desce do ERP: `macuxi_pedido_entrada`, `macuxi_pedido_entrada_item`, `macuxi_pedido_nota_item`, `macuxi_nota_entrada`, `macuxi_nota_entrada_item` e `macuxi_cliente_entrada`;
- **5 procedures de descida `dbo.sp_macuxi_*`** (o Conector executa): `sp_macuxi_pedido_inserir`, `sp_macuxi_pedido_item_inserir`, `sp_macuxi_nota_inserir`, `sp_macuxi_nota_item_inserir` e `sp_macuxi_cliente_inserir`. Todas idempotentes pela chave do que desce (`pedido_uuid`, a chave da nota, `cliente_uuid`): repetir a chamada não muda nada; a mesma chave com outro conteúdo é recusada. Validam a entrada e gravam numa transação;
- **3 procedures `dbo.sp_tha_*` que simulam o ERP do cliente** no teste (o `sa` roda; o Conector não tem acesso): `sp_tha_pedido_status_definir` (integrar, rejeitar, faturar, cancelar), `sp_tha_pedido_nota_item_gravar` (itens faturados) e `sp_tha_cliente_pre_cadastro_resolver` (vincular o pré-cadastro a um `tha_cliente` ou rejeitá-lo);
- o login e o usuário **`macuxi_conector`** (seção 7). A senha vem da variável `SENHA_CONECTOR` do `~/thathyany/.segredos.env`, que o `sqlcmd` lê como `$(SENHA_CONECTOR)`; ela nunca é escrita no arquivo.

**Layout dos CSVs:** as colunas das `tha_*` do kit do ERP seguem o contrato do Hub v1 e **não foram conferidas coluna a coluna** contra o kit do FDV (cópia de consulta em `aloirr/macuxierp-recados@8eef2ae`, `recados/anexos/T-0057/criar-banco-fdv-0b79391.sql`). Se os CSVs do PO seguirem o kit do FDV, a validação do cabeçalho da seção 6 (passo 2) mostra a diferença e a sessão **para** antes de carregar.

Passos:
1. O arquivo chega a `~/thathyany/criar-banco.sql` na VM como diz o prompt de arranque do PO: o conteúdo do arquivo no commit do `main` indicado pelo PO, nunca editado na VM.
2. Conferir o hash contra o do commit (quem manda o arquivo calcula com `git show <sha>:docs/banco/kit-erp/criar-banco.sql | sha256sum` e põe o valor no prompt):
   ```bash
   sha256sum ~/thathyany/criar-banco.sql
   ```
   Diferente: **parar** e falar com o Alexandre; não rodar.
3. Rodar como `sa`. O `set -a` exporta a `SENHA_CONECTOR` do arquivo, e o `sqlcmd` a usa como variável de script (sem `-v`, a senha não aparece na lista de processos). Sem ela, o `sqlcmd` para com "scripting variable not defined":
   ```bash
   ( set -a; . ~/thathyany/.segredos.env; set +a; SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" \
     sqlcmd -S 127.0.0.1 -U sa -C -b -i ~/thathyany/criar-banco.sql )
   ```
   A última consulta do script lista só os objetos e as permissões do `macuxi_conector` (sem dado). A senha do conector não pode ter apóstrofo (`'`); a gerada na seção 2A não tem.

Como conferir:
```sql
USE ERP_THATHYANY;
SELECT COUNT(*) FROM sys.tables     WHERE name LIKE 'tha[_]%';           -- 10
SELECT COUNT(*) FROM sys.tables     WHERE name LIKE 'macuxi[_]%';        -- 6
SELECT COUNT(*) FROM sys.views      WHERE name LIKE 'vw[_]macuxi[_]%';   -- 13 (10 de cadastro + 3 do retorno)
SELECT COUNT(*) FROM sys.procedures WHERE name LIKE 'sp[_]macuxi[_]%';   -- 5
SELECT COUNT(*) FROM sys.procedures WHERE name LIKE 'sp[_]tha[_]%';      -- 3
```
Rodar o script de novo não dá erro nem muda as contagens (troca só a senha do conector, pela mesma do arquivo).

## 6. Popular

Executada pela **sessão do Claude Code da VM** (seção 2A), sem sudo. O Alexandre cola no prompt o CSV **fictício** (do PO, ou o catálogo exportado do FDV, que não tem dado pessoal) e diz a tabela `tha_*` de destino. Nada vai por `scp`, ao repositório nem a recado.

Regras da carga:
- **Ordem:** a mesma das tabelas na seção 5: `tha_filial`, `tha_vendedor`, `tha_forma_pagamento`, `tha_prazo_pagamento`, `tha_produto`, `tha_produto_unidade`, `tha_preco`, `tha_estoque`, `tha_cliente` e `tha_cliente_endereco`.
- **Formato:** UTF-8, separador `;`, primeira linha de cabeçalho; campo vazio = nulo; `ativo` como `1` ou `0`; dinheiro nas colunas `*_cents` em centavos inteiros; datas civis `AAAA-MM-DD`.
- **As tabelas `macuxi_*` não recebem CSV:** quem grava nelas é o Conector (pelas `sp_macuxi_*`) e a simulação do ERP do cliente (pelas `sp_tha_*`, seção 7.3).
- **`external_id`** é a chave: único e estável por linha; recarregar a mesma linha usa o mesmo `external_id`.
- **`alterado_em`** em **UTC** (`AAAA-MM-DD HH:MM:SS.mmm`); a carga o avança para `SYSUTCDATETIME()` (é por ele que o conector lê a mudança).
- **Carga por `MERGE` pelo `external_id`, que nunca apaga linha:** linha do arquivo com `external_id` já na tabela é atualizada; a que não existe é inserida; linha da tabela que não está no arquivo fica como está. Carregar o mesmo arquivo duas vezes dá o mesmo resultado; se a carga cair no meio, basta repetir com o mesmo arquivo. Se o `MERGE` esbarrar em chave estrangeira, a sessão **para** e responde ao Alexandre.
- **Regras gravadas na VM:** estas regras ficam em `~/thathyany/CLAUDE.md`, que a sessão lê a cada carga: `MERGE` por `external_id`; `alterado_em` em UTC; nunca apaga linha; cabeçalho validado antes; CSV apagado depois; dado pessoal real = parar, apagar o arquivo e avisar o Alexandre; nunca mostrar o `.segredos.env`.

Passos da sessão, para cada CSV (`<tabela>` = a `tha_*` dita pelo Alexandre; `sqlcmd` e `bcp` em `/opt/mssql-tools18/bin/`; senha sempre pelo subshell da seção 2A):
1. **Gravar** o conteúdo do prompt em `~/thathyany/carga/<tabela>.csv` (pasta 700, do usuário). Por isso a carga é com `bcp`, que lê o arquivo com o usuário do shell (o `BULK INSERT` leria com o usuário `mssql` e não alcança a pasta).
2. **Validar o cabeçalho** contra a tabela (mesma quantidade, nomes e ordem):
   ```bash
   head -1 ~/thathyany/carga/<tabela>.csv | sed 's/^\xEF\xBB\xBF//; s/\r$//' | tr ';' '\n' > ~/thathyany/carga/<tabela>.cab
   ( set -a; . ~/thathyany/.segredos.env; set +a; SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" \
     sqlcmd -S 127.0.0.1 -U sa -C -d ERP_THATHYANY -h -1 -W \
     -Q "SET NOCOUNT ON; SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.<tabela>') ORDER BY column_id;" ) \
     | diff - ~/thathyany/carga/<tabela>.cab
   ```
   Diferente: **parar** e responder ao Alexandre o que difere (coluna faltando, sobrando ou fora de ordem), sem carregar.
3. **Criar a staging vazia**, com a mesma estrutura e um nome que **não** casa com `tha[_]%` (a contagem de 10 da seção 5 continua valendo):
   ```sql
   DROP TABLE IF EXISTS dbo.carga_<tabela>;
   SELECT TOP 0 * INTO dbo.carga_<tabela> FROM dbo.<tabela>;
   ```
4. **Carregar a staging com `bcp`:**
   ```bash
   ( set -a; . ~/thathyany/.segredos.env; set +a; bcp dbo.carga_<tabela> in ~/thathyany/carga/<tabela>.csv \
     -S 127.0.0.1 -U sa -P "$MSSQL_SA_PASSWORD" -u -d ERP_THATHYANY -c -C 65001 -t ';' -F 2 -m 1 \
     -e ~/thathyany/carga/<tabela>.erros )
   ```
   O `bcp` **não lê** `SQLCMDPASSWORD` (sem `-P`, pede a senha no terminal, e a sessão não tem terminal interativo). Por isso a senha vai por `-P "$MSSQL_SA_PASSWORD"` dentro do próprio subshell: o valor nunca é digitado nem impresso e não fica em histórico, porque a sessão não usa shell interativo. (Fica visível na lista de processos (`ps`) durante a carga; na VM só há o `<USUARIO_ADMIN>`.)
5. **`MERGE` da staging na tabela**, sem cláusula `WHEN NOT MATCHED BY SOURCE` (nunca apaga). A lista de colunas sai de `sys.columns` da `dbo.<tabela>` (`ORDER BY column_id`, sem colunas de identidade ou calculadas): o `UPDATE SET` leva todas menos `external_id` e `alterado_em`; o `INSERT` leva todas, com `alterado_em` = `SYSUTCDATETIME()`:
   ```sql
   MERGE dbo.<tabela> AS t
   USING dbo.carga_<tabela> AS s ON t.external_id = s.external_id
   WHEN MATCHED THEN UPDATE SET t.<coluna> = s.<coluna>, ..., alterado_em = SYSUTCDATETIME()
   WHEN NOT MATCHED BY TARGET THEN INSERT (external_id, <colunas>, alterado_em)
        VALUES (s.external_id, s.<colunas>, SYSUTCDATETIME())
   OUTPUT $action;   -- a sessão conta INSERT e UPDATE, sem mostrar as linhas
   ```
6. **Limpar, mesmo com erro:** `DROP TABLE IF EXISTS dbo.carga_<tabela>;` e `shred -u ~/thathyany/carga/<tabela>.{csv,cab,erros}` (ou `rm -f`).
7. **Responder no chat** só as contagens: linhas no arquivo, inseridas, atualizadas e linhas no `.erros` (nenhum dado das linhas).

**Dado pessoal real no CSV** (CPF, nome, telefone ou e-mail de pessoa real): **parar** antes de carregar, apagar o arquivo e avisar o Alexandre, sem copiar o dado para o chat, recado ou log.

Como conferir:
```sql
USE ERP_THATHYANY;
SELECT t.name, SUM(p.rows) AS linhas
FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE t.name LIKE 'tha[_]%' GROUP BY t.name ORDER BY t.name;   -- bate com os external_id distintos já carregados (o MERGE só soma ou atualiza)
SELECT COUNT(*) FROM sys.tables WHERE name LIKE 'carga[_]%';    -- 0 (nenhuma staging sobrando)
SELECT TOP 5 * FROM dbo.vw_macuxi_produto ORDER BY alterado_em DESC;
SELECT TOP 5 * FROM dbo.vw_macuxi_cliente ORDER BY alterado_em DESC;
SELECT external_id, COUNT(*) FROM dbo.tha_produto GROUP BY external_id HAVING COUNT(*) > 1;   -- vazio (idem em cada tabela)
```
Arquivo `.erros` vazio antes de ser apagado; nenhum `external_id` repetido; `ls ~/thathyany/carga` vazio depois de cada carga.

## 7. Usuário do Conector (`macuxi_conector`)

**Fonte:** a seção 7 do `docs/banco/kit-erp/criar-banco.sql` (seção 5), no modelo do `usuario-conector.sql` do kit do FDV (`aloirr/macuxifdv@0b79391`, só consulta), com os mesmos nomes. O login é criado pelo próprio `criar-banco.sql`; não há script separado.

**O que o kit faz** (reexecutável):
- login `macuxi_conector` com `CHECK_POLICY = ON` (no Linux vale a política de senha do SQL Server), `CHECK_EXPIRATION = OFF` e `DEFAULT_DATABASE = ERP_THATHYANY`; se já existir, troca a senha e o habilita. A senha vem de `$(SENHA_CONECTOR)`, nunca do texto;
- usuário `macuxi_conector` no `ERP_THATHYANY`, sem papel de banco nem de servidor (tira o que sobrar de execução anterior, como `db_datareader`, que leria as `tha_*`);
- `GRANT SELECT` só nas 13 views `dbo.vw_macuxi_*` (cadastros e retorno do pedido e do pré-cadastro);
- `GRANT EXECUTE` só nas 5 procedures `dbo.sp_macuxi_*` (a descida de pedido, nota e pré-cadastro, ADR 0014 §13; a v0.3.6 deixava a entrada de pedidos de fora, a v0.3.11 não);
- **nenhuma permissão nas tabelas** (`tha_*` e `macuxi_*`): o acesso vem só pelas views e procedures, que são do `dbo` (encadeamento de dono). Qualquer outra permissão de objeto, de schema ou de banco (além de `CONNECT`) dada antes ao `macuxi_conector` é revogada a cada execução;
- **sem** EXECUTE nas `sp_tha_*` (simulação do ERP do cliente), sem `VIEW SERVER STATE`, `sysadmin`, `db_owner` ou `db_datareader`.

### 7.1 Trocar a senha do conector
Rodar o `criar-banco.sql` de novo (seção 5, passo 3) com a `SENHA_CONECTOR` nova no `~/thathyany/.segredos.env`, depois atualizar a `MACUXI_CONECTOR_ERP_SENHA` do `/etc/macuxi-conector/segredos.env` (seção 7A, passo 4) e reiniciar o serviço (`sudo systemctl restart macuxi-conector`).

### 7.2 Como conferir
Na VM, logado como `macuxi_conector` (`( set -a; . ~/thathyany/.segredos.env; set +a; SQLCMDPASSWORD="$SENHA_CONECTOR" sqlcmd -S 127.0.0.1 -U macuxi_conector -C -d ERP_THATHYANY -Q "<consulta>" )`, sem `-b`, uma consulta por vez):
```sql
SELECT TOP 1 * FROM dbo.vw_macuxi_produto;              -- funciona
SELECT TOP 1 * FROM dbo.vw_macuxi_pedido_status;        -- funciona (ciclo de status)
SELECT TOP 1 * FROM dbo.tha_produto;                    -- erro 229: permissão SELECT negada
SELECT TOP 1 * FROM dbo.macuxi_pedido_entrada;          -- erro 229
INSERT INTO dbo.tha_produto DEFAULT VALUES;             -- erro 229: permissão INSERT negada
EXEC dbo.sp_macuxi_pedido_inserir;                      -- erro 201 (falta parâmetro): o EXECUTE é permitido
EXEC dbo.sp_tha_pedido_status_definir;                  -- erro 229: permissão EXECUTE negada
SELECT * FROM fn_my_permissions(NULL, 'DATABASE');      -- só CONNECT
SELECT COUNT(*) FROM sys.database_role_members WHERE member_principal_id = DATABASE_PRINCIPAL_ID();  -- 0
```
Último passo do arranque (prompt de arranque do PO): `sudo rm -f /etc/sudoers.d/90-arranque`; depois disso `sudo -n true` falha.

### 7.3 Simular o ERP do cliente (teste da mão dupla)
Como `sa`, pela sessão da VM, depois que o Conector gravar um pedido ou um pré-cadastro. Os UUIDs saem de `SELECT pedido_uuid, status FROM dbo.macuxi_pedido_entrada` e de `SELECT cliente_uuid, status FROM dbo.macuxi_cliente_entrada`; a sessão responde só as contagens e os UUIDs, nunca nome, documento ou contato:
```sql
EXEC dbo.sp_tha_pedido_status_definir @pedido_uuid = '<uuid>', @status = 'integrado';
EXEC dbo.sp_tha_pedido_nota_item_gravar @pedido_uuid = '<uuid>', @sequencia = 1, @quantidade = 2, @valor_cents = 1990;
EXEC dbo.sp_tha_pedido_status_definir @pedido_uuid = '<uuid>', @status = 'faturado_total', @nota_numero = 1, @nota_serie = 1,
     @nota_chave = '<44 dígitos fictícios>', @nota_emitida_em = '2026-11-24T16:00:00Z', @nota_total_cents = 1990;
-- pré-cadastro: carregar o cliente fictício em tha_cliente (seção 6) e vincular, ou rejeitar com motivo
EXEC dbo.sp_tha_cliente_pre_cadastro_resolver @cliente_uuid = '<uuid>', @external_id = '<external_id do tha_cliente>';
EXEC dbo.sp_tha_cliente_pre_cadastro_resolver @cliente_uuid = '<uuid>', @motivo = N'documento já cadastrado';
```
O ciclo é `recebido → integrado | rejeitado_erp | cancelado`, `integrado → faturado_parcial | faturado_total | cancelado` e `faturado_parcial → faturado_total | cancelado`; repetir o mesmo status não muda nada. O Conector lê a mudança pela `vw_macuxi_pedido_status` e pela `vw_macuxi_cliente_retorno` e a devolve ao ERP.

## 7A. Instalar o Conector

ADR 0014 §6 e §7. O Conector do ERP (`@macuxierp/conector` 1.0.0, base FDV 1.5.0 @c460e92) roda **na própria VM**, como serviço systemd, lê `127.0.0.1,1433` com o `macuxi_conector` e fala só por **HTTPS de saída** com `https://erp.macuxifdv.com.br` (prefixo `/entrada/v1`), na empresa **AM2808** do ERP de **produção** (só dados fictícios; não há empresa nova nem Hub de teste). Do lado do FDV vale a credencial da Integração FDV já salva na AM2808, no ambiente **Produção** do Hub. O firewall de entrada não muda (seção 3).

**Quem faz:** o Alexandre, pelo SSH. Os passos com `sudo` e a chave do conector **não passam pela sessão do Claude Code da VM**, que já não tem sudo depois do arranque e nunca vê a chave. Os nomes de arquivo e os campos do `conector.json` são os do `LEIA-ME` e do `conector.thathyany.exemplo.json` do pacote; onde divergirem deste roteiro, vale o pacote, e o `banco-dados` corrige o roteiro.

1. **Node 24.7 ou mais novo** (pacote da distribuição, se tiver a versão, ou NodeSource):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh   # ler antes de rodar
   sudo bash /tmp/nodesource_setup.sh && sudo apt install -y nodejs
   node --version   # v24.7 ou mais
   ```
2. **Pacote Linux** `tar.gz` do Conector: o artefato do workflow `conector-montar` (ADR 0014 §10, item 2), baixado pelo Alexandre do GitHub com o `.sha256` e copiado para a VM (`scp` para `/tmp`; o pacote não tem segredo). Conferir e instalar em `/opt/macuxi-conector/<versão>`, com o link `atual`, tudo do root:
   ```bash
   cd /tmp && sha256sum -c macuxierp-conector-<versão>-linux.tar.gz.sha256   # OK; diferente = parar
   sudo install -d -m 755 -o root -g root /opt/macuxi-conector/<versão>
   sudo tar -xzf macuxierp-conector-<versão>-linux.tar.gz -C /opt/macuxi-conector/<versão> --no-same-owner
   sudo ln -sfn /opt/macuxi-conector/<versão> /opt/macuxi-conector/atual
   ```
3. **Usuário próprio, sem login**, e as pastas:
   ```bash
   sudo useradd --system --no-create-home --home-dir /var/lib/macuxi-conector --shell /usr/sbin/nologin macuxi-conector
   sudo install -d -m 750 -o macuxi-conector -g macuxi-conector /var/lib/macuxi-conector   # dados locais (fila de descida, cursores)
   sudo install -d -m 750 -o root -g macuxi-conector /etc/macuxi-conector
   ```
4. **Segredos** em `/etc/macuxi-conector/segredos.env`, **dono root, 0600**, só com as duas variáveis (o systemd lê o arquivo como root e as passa ao serviço; o provedor `env` do Conector as lê):
   - `MACUXI_CONECTOR_ERP_SENHA`: a senha do `macuxi_conector` (a `SENHA_CONECTOR` do `~/thathyany/.segredos.env`);
   - `MACUXI_CONECTOR_HUB_CHAVE`: a chave "via Conector" gerada no `/config` do ERP, aba "Integração" da AM2808 (mostrada uma vez; seção 7B, passo 3).

   Sem valor neste roteiro, na tela ou no histórico (`read -s` não ecoa):
   ```bash
   sudo install -m 600 -o root -g root /dev/null /etc/macuxi-conector/segredos.env
   ( set -a; . ~/thathyany/.segredos.env; set +a
     read -rsp 'Chave do conector (não aparece): ' CHAVE; echo
     printf 'MACUXI_CONECTOR_ERP_SENHA=%s\nMACUXI_CONECTOR_HUB_CHAVE=%s\n' "$SENHA_CONECTOR" "$CHAVE" \
       | sudo tee /etc/macuxi-conector/segredos.env >/dev/null )
   sudo stat -c '%a %U %G' /etc/macuxi-conector/segredos.env          # 600 root root
   sudo grep -c '^MACUXI_CONECTOR_' /etc/macuxi-conector/segredos.env   # 2 (só conta, sem mostrar)
   ```
   Guarde a chave no cofre de senhas, sem colar em chat ou recado.
5. **Configuração** `/etc/macuxi-conector/conector.json` (dono root, grupo `macuxi-conector`, 0640; sem segredo), a partir do exemplo do pacote:
   ```bash
   sudo install -m 640 -o root -g macuxi-conector /opt/macuxi-conector/atual/exemplos/conector.thathyany.exemplo.json /etc/macuxi-conector/conector.json
   sudo nano /etc/macuxi-conector/conector.json
   ```
   Ajustar só: a URL do Hub `https://erp.macuxifdv.com.br` com o prefixo `/entrada/v1`; o `conectorId` da credencial "via Conector" da AM2808 (o do ERP, **nunca** o `thathyany-conector` do FDV); o banco `sqlserver` em `127.0.0.1`, porta `1433`, banco `ERP_THATHYANY`, usuário `macuxi_conector`, com TLS (certificado autoassinado da seção 4, só local); os segredos pelo provedor `env`; a atualização automática **desligada**; os 10 cadastros, `pedidos`, `clientes` e `notas` como vêm no exemplo (sem `reconciliacao`).
6. **Unidade systemd** `/etc/systemd/system/macuxi-conector.service` (se o pacote trouxer a unidade, use a dele; esta é a referência da ADR 0014 §6):
   ```ini
   [Unit]
   Description=Macuxi ERP - Conector (thathyany, cenario B)
   Wants=network-online.target
   After=network-online.target mssql-server.service

   [Service]
   Type=simple
   User=macuxi-conector
   Group=macuxi-conector
   EnvironmentFile=/etc/macuxi-conector/segredos.env
   WorkingDirectory=/var/lib/macuxi-conector
   ExecStart=/usr/bin/node /opt/macuxi-conector/atual/conector.mjs --config /etc/macuxi-conector/conector.json
   Restart=on-failure
   RestartSec=30
   NoNewPrivileges=yes
   ProtectSystem=strict
   ProtectHome=yes
   PrivateTmp=yes
   ReadWritePaths=/var/lib/macuxi-conector
   CapabilityBoundingSet=
   UMask=0077

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl daemon-reload
   ```
   **Ainda não ligue o serviço:** o `systemctl enable --now` é o passo 5 da seção 7B, depois da virada.
7. **`conector status`** (só confere; não envia lote), com o usuário e os segredos do serviço:
   ```bash
   sudo systemd-run --pipe --wait --quiet -p User=macuxi-conector -p EnvironmentFile=/etc/macuxi-conector/segredos.env \
     -p WorkingDirectory=/var/lib/macuxi-conector \
     /usr/bin/node /opt/macuxi-conector/atual/conector.mjs status --config /etc/macuxi-conector/conector.json
   ```

Como conferir:
- `node --version` → 24.7 ou mais; `getent passwd macuxi-conector` termina em `/usr/sbin/nologin`.
- `sudo stat -c '%a %U %G' /etc/macuxi-conector/segredos.env` → `600 root root`; `/etc/macuxi-conector/conector.json` → `640 root macuxi-conector`.
- `systemd-analyze security macuxi-conector` não marca `NoNewPrivileges` nem `ProtectSystem` como inseguros.
- O `conector status` mostra a versão (1.0.0, base FDV 1.5.0), o banco **conectado** (SQL Server, `ERP_THATHYANY`), o ERP **alcançado** (`erp.macuxifdv.com.br`, `/entrada/v1`, credencial aceita) e as entidades configuradas, sem erro. Nenhuma linha mostra senha, chave ou dado de cadastro.
- `sudo ss -tlnp` igual ao da seção 3 (o Conector não abre porta).

## 7B. Virada para o Conector do ERP, sem envio duplicado

ADR 0014 §7 e Riscos (decisão do Alexandre de 23/11, 14h19). Até aqui o FDV pode estar recebendo a thathyany pelo Conector do kit do FDV (`thathyany-conector`). Com os dois conectores ligados, o FDV recebe o mesmo cadastro por dois caminhos. A ordem abaixo é obrigatória, e cada passo só começa com o "como conferir" do anterior feito. O Alexandre anota a data e a hora de cada passo no horário de Manaus (`TZ=America/Manaus date`).

1. **Desligar o `thathyany-conector` do FDV** (Alexandre, no servidor onde ele roda; é operação, nada do código do FDV muda): parar o serviço e deixá-lo desabilitado (no Windows, `sc stop <serviço>` e `sc config <serviço> start= disabled`, ou o painel de serviços), e inativar a credencial dele no portal do FDV, para que um religamento por engano seja recusado.
   Como conferir: o serviço aparece "parado" e "desabilitado"; no portal do FDV, a credencial do `thathyany-conector` está inativa e o último sinal dele não avança por 15 minutos.
2. **Inativar no FDV os cadastros antigos** que vieram do `thathyany-conector` (Alexandre, no FDV, AM2808), nos 10 cadastros da F2.
   Como conferir: no FDV, a AM2808 mostra 0 cadastro ativo de origem `thathyany-conector` em cada uma das 10 entidades.
3. **Preparar o ERP** (Alexandre, superadmin, no `/config` do ERP de produção, AM2808, aba "Integração"):
   - gerar a chave "via Conector" (mostrada uma vez) e gravá-la no `segredos.env` (seção 7A, passo 4);
   - definir o **dono** de cada cadastro que a VM alimenta como `cliente` (ADR 0014 §14; o `cliente_endereco` segue o `cliente`, e o `produto_unidade` segue o `produto`);
   - confirmar que a Integração FDV da AM2808 está no ambiente **Produção** do Hub.

   Como conferir: a coluna "via Conector" mostra o `conector_id` e o prefixo da chave; o dono aparece `cliente` nos cadastros escolhidos; o bloco "Macuxi FDV" mostra Produção.
4. **Conferir antes do 1º lote:** o `conector status` (seção 7A, passo 7) sem erro, as views com as contagens da seção 6 e o `thathyany-conector` ainda parado (passo 1).
5. **Ligar o Conector do ERP** (Alexandre, SSH):
   ```bash
   sudo systemctl enable --now macuxi-conector
   systemctl is-active macuxi-conector          # active
   sudo journalctl -u macuxi-conector -n 50 --no-pager
   ```
   O 1º lote de cada entidade é a **carga completa**. Se ela fosse inativar mais de 30% dos ativos de uma entidade na AM2808 do ERP, o lote fica `aguardando_confirmacao`, e só o superadmin confirma no `/config` (ADR 0014 §3).

   Como conferir:
   - o `journalctl` mostra os lotes aceitos (`lote_id`, entidade e contagens; nunca o corpo, a chave ou o dado);
   - no `/config` da AM2808, cada cadastro mostra o último lote `concluido` (ou `concluido_com_erros`, com os erros por linha sem o dado) e o último sinal recente;
   - no FDV, cada uma das 10 entidades da AM2808 tem os ativos **iguais** às linhas ativas da view correspondente (`SELECT COUNT(*) FROM dbo.vw_macuxi_<entidade> WHERE ativo = 1`), sem `external_id` repetido, e nada novo chegou pelo `thathyany-conector`.
6. **Testar a descida** (mão dupla, ADR 0014 §13): um pedido fictício aprovado no ERP aparece em `macuxi_pedido_entrada`; com a simulação da seção 7.3, o status volta ao ERP e ao FDV; com o faturamento ligado, a nota emitida aparece em `macuxi_nota_entrada`; um pré-cadastro do FDV aparece em `macuxi_cliente_entrada` e, vinculado, volta pela `vw_macuxi_cliente_retorno`. Repetir o mesmo envio (reiniciar o serviço no meio) não cria linha nova.

**Volta atrás:** `sudo systemctl disable --now macuxi-conector`. O `thathyany-conector` do FDV só volta com a decisão do Alexandre por recado, e antes dele os cadastros enviados pelo ERP são tratados no FDV (o mesmo cuidado dos passos 1 e 2, ao contrário).

**Registro:** recado `aviso` ao `gerente-projetos` com a data e a hora de Manaus de cada passo (1 a 6), quem fez e as contagens conferidas (sem dado nem segredo).

## 8. LGPD e encerramento

- **Quem acessa:** o Alexandre (SSH/`sa`); a sessão do Claude Code **da VM**, na conta do Alexandre, via Remote Control (arranque e carga da seção 6), com o `sa` só pelo arquivo `~/thathyany/.segredos.env` (600, gerado por ela, nunca impresso); o Conector, só como `macuxi_conector`, local, com os segredos em `/etc/macuxi-conector/segredos.env` (root, 0600), que a sessão da VM não lê. Nenhum agente do time recebe credencial nem acesso à VM.
- **O que desce do ERP é fictício no teste** (a `macuxi_cliente_entrada` tem o contato do pré-cadastro); o log do Conector e o chat da sessão da VM levam só contagens, UUIDs e códigos.
- **Nada de dado pessoal real na VM.** Se aparecer (num CSV, no catálogo ou num log), **parar**, apagar o arquivo e avisar o Alexandre por recado, sem copiar o dado.
- **Prazo:** a VM **fica enquanto durarem os testes**, até o Alexandre encerrá-los **por recado**. O `gerente-projetos` confere na ronda semanal se o teste segue.

**Encerramento** (só disparado pelo recado do Alexandre): parar e desabilitar o Conector (`sudo systemctl disable --now macuxi-conector`), apagar `/etc/macuxi-conector/segredos.env` (`sudo shred -u`) e trocar ou revogar a chave "via Conector" no `/config` do ERP; parar e desabilitar o Remote Control (`systemctl --user disable --now claude-remote` e `sudo loginctl disable-linger <USUARIO_ADMIN>`, ou `tmux kill-session -t thathyany`); `claude` → `/logout`; apagar `~/thathyany/.segredos.env` (`shred -u ~/thathyany/.segredos.env`); depois, apagar a **VM inteira** no painel do provedor, com volumes, snapshots, imagens e backups; remover a regra do firewall do provedor.

**Registro:** recado `aviso` ao `gerente-projetos` com a data e a hora de Manaus (`TZ=America/Manaus date`), quem fez e a confirmação de cada item acima (sem dado nem segredo).

Como conferir: a sessão da VM não aparece mais no claude.ai/code do Alexandre; o painel do provedor não lista a VM, volumes, snapshots nem backups dela.

## 9. Checklist final e riscos

### Checklist
- [ ] Conferidos os blocos "Como conferir" das seções 2 a 8 (com a 2A)
- [x] Edição Express (decidida pelo Alexandre, R-20261123-151313-alexandre; seção 4)
- [ ] Remote Control no ar: sessão da VM visível no claude.ai/code (seção 2A)
- [ ] `~/thathyany/.segredos.env` gerado pela sessão, permissão 600, nunca impresso nem no repositório (seção 2A)
- [ ] `~/thathyany/CLAUDE.md` da VM com as regras da carga (seção 6)
- [ ] Carga por `MERGE`: nenhuma `carga_*` sobrando e `~/thathyany/carga` vazia (seção 6)
- [ ] Sudoers do arranque removido: `sudo -n true` falha (seções 2A e 7)
- [ ] Kit do ERP com o hash conferido e as contagens 10 / 6 / 13 / 5 / 3 (seção 5); permissões do `macuxi_conector` conferidas (seção 7.2)
- [ ] Conector instalado: `segredos.env` 600 root, `conector status` sem erro, serviço ainda parado antes da virada (seção 7A)
- [ ] Virada na ordem, com data e hora (Manaus) de cada passo: `thathyany-conector` parado e com a credencial inativa → cadastros antigos inativos no FDV → `/config` da AM2808 pronto → 1º lote → descida testada (seção 7B)
- [ ] Data de início do teste: ____ (Manaus) · testes encerrados por recado do Alexandre em ____ (seção 8)
- [ ] Encerramento: data e hora (Manaus) ____ · quem fez ____

### Riscos
| Risco | Mitigação |
|---|---|
| Teste esquecido depois de parado o uso | Seção 8: o gerente confere na ronda semanal se o teste segue; o encerramento sai pelo recado do Alexandre |
| Sessão da VM com acesso ao `sa` | Senhas geradas pela sessão em `~/thathyany/.segredos.env` (600), carregadas só num subshell, nunca impressas no chat, recado ou log (o Alexandre lê pelo SSH, se precisar); o arquivo é apagado no encerramento; firewall de entrada fechado (o Remote Control só sai por HTTPS); login Claude só do Alexandre; sem sudo depois do arranque |
| Carga perder ou duplicar linha | Seção 6: `MERGE` por `external_id` sem `WHEN NOT MATCHED BY SOURCE` (nunca apaga), cabeçalho validado, staging `carga_*` removida; regras em `~/thathyany/CLAUDE.md` da VM |
| CSV com dado pessoal real | Seção 6: parar antes de carregar, apagar o arquivo e avisar o Alexandre, sem copiar o dado |
| Envio duplicado ao FDV (dois conectores ligados) | Seção 7B: o `thathyany-conector` parado e com a credencial inativa e os cadastros antigos inativos **antes** do `enable --now`; conferência por contagem no FDV |
| Layout dos CSVs × colunas do kit do ERP | Seção 5: a validação do cabeçalho da seção 6 para a carga na 1ª diferença; a conferência contra o kit do FDV fica pendente |
| Chave ou senha do Conector exposta | Seção 7A: `segredos.env` root 0600, escrito pelo Alexandre por SSH com `read -s`; a sessão da VM não o lê; o log do Conector não leva segredo |
