# Roteiro da VM de teste do cenário B (v0.3.6)

> T-0057 · autor: `banco-dados` · criado em 2026-11-23, 14h10 (Manaus); revisto em 2026-11-23, 14h20 (Manaus), com a decisão do Alexandre (via PO, 23/11, 14h19): "banco está vazio. vamos começar a thathyany do zero." Vale o banco **fictício**. Revisto em 2026-11-23, 15h15 (Manaus), com a decisão R-20261123-151313-alexandre (banco controlado pelo Claude Code da VM, via Remote Control; SQL Server Express). Revisto em 2026-11-23, 15h23 (Manaus): alinhado ao prompt de arranque do PO (segredos em ~/thathyany/.segredos.env, carga por MERGE, sem 2A.1).
> Cenário B da v0.3.6, aprovado pelo Alexandre. **Só teste, temporário.** Numeração: a seção nova do Claude Code na VM é a **2A**; as demais mantêm o número.
> Sem segredo neste texto: tudo o que é sensível aparece como marcador (`<IP_DO_ALEXANDRE>`, `<HOST_DA_VM>`...). As senhas do `sa` e do conector são geradas pela própria sessão da VM em `~/thathyany/.segredos.env` (seção 2A) e nunca aparecem em doc, chat, recado, commit ou log.

## 1. Objetivo, escopo e o que NÃO é

**Objetivo:** subir uma VM Linux de teste com o banco `ERP_THATHYANY` (cliente thathyany, código FDV `am2808`) **criado do zero** com o esquema do kit do Macuxi FDV e populado com **dados fictícios**, para o conector, que roda na VM, ler as views e enviar ao Macuxi ERP de produção (`erp.macuxifdv.com.br`), na empresa AM2808 (ADR 0014).

**Escopo:** uma VM, o Claude Code da própria VM controlado pelo Alexandre via Remote Control (seção 2A), um SQL Server 2022 Express, o banco criado pelo `criar-banco.sql` do kit (seção 5), a carga dos CSVs fictícios e do catálogo (seção 6), um login **só leitura** para o conector (seção 7), firewall fechado; a VM fica enquanto durarem os testes e é apagada no encerramento (seção 8).

**O que NÃO é:**
- Não é dado de produção: o banco da VM é de teste, só com dados fictícios. O destino é o ERP de produção (`erp.macuxifdv.com.br`), na empresa AM2808 (ADR 0014); nada roda na VM de produção do FDV/ERP e nenhum outro tenant é tocado.
- Não é cópia do banco real do cliente: **não há restore de `.bak`** nem dado de cliente real.
- **Nada do Macuxi FDV muda**: nem código (`aloirr/macuxifdv` é só consulta), nem banco, nem configuração.
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

## 5. Criar o banco com o esquema do kit do FDV

**Fonte (só cópia, sem editar):** kit do Macuxi FDV, `aloirr/macuxifdv@0b79391`, `modules/integracao/kit-thathyany/sql/criar-banco.sql` (gerado por `kit-thathyany/scripts/gerar.ts`). Cópia de consulta em `aloirr/macuxierp-recados@8eef2ae`, `recados/anexos/T-0057/criar-banco-fdv-0b79391.sql`. O arquivo **não** entra no repositório do ERP.

**O que ele cria** (idempotente: roda quantas vezes precisar; sem segredo e sem dado):
- o banco `ERP_THATHYANY` (`IF DB_ID(...) IS NULL CREATE DATABASE`);
- **16 tabelas `dbo.tha_*`**: `filial`, `vendedor`, `catalogo_no`, `forma_pagamento`, `prazo_pagamento`, `produto`, `produto_unidade`, `preco`, `tabela_escalonada`, `estoque`, `cliente`, `cliente_endereco`, `transportadora`, `rota`, `titulo`, `nota` (chave `external_id`, coluna `alterado_em` em UTC, índice `(alterado_em, external_id)`);
- as **views `dbo.vw_macuxi_*`** que o conector lê: uma por tabela `tha_*` (16), mais `vw_macuxi_pedido_status` e `vw_macuxi_pedido_nota_item` (retorno do pedido);
- a **entrada de pedidos** (`macuxi_pedido_entrada`, `macuxi_pedido_entrada_item`, `macuxi_pedido_nota_item`, `sp_macuxi_pedido_inserir`, `sp_macuxi_pedido_item_inserir`, gatilho e `vw_thathyany_pedidos`).

Passos:
1. O arquivo chega a `~/thathyany/criar-banco.sql` na VM como diz o prompt de arranque do PO (nunca pelo repositório do ERP).
2. Conferir o hash contra a cópia de consulta (a mesma conta na cópia de `macuxierp-recados` dá `eecca1aaa144ce46c5fee3bc8259bb3cd0e693e3496ce80df3ec4a6a506fd935`):
   ```bash
   sha256sum ~/thathyany/criar-banco.sql
   ```
   Diferente: **parar** e falar com o Alexandre; não rodar.
3. Rodar como `sa`:
   ```bash
   ( set -a; . ~/thathyany/.segredos.env; set +a; SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" sqlcmd -S 127.0.0.1 -U sa -C -b -i ~/thathyany/criar-banco.sql )
   ```

Como conferir:
```sql
USE ERP_THATHYANY;
SELECT COUNT(*) FROM sys.tables WHERE name LIKE 'tha[_]%';        -- 16
SELECT COUNT(*) FROM sys.views  WHERE name LIKE 'vw[_]macuxi[_]%'; -- 18 (16 de cadastro + 2 do retorno do pedido)
```
Rodar o script de novo não dá erro nem muda as contagens.

## 6. Popular

Executada pela **sessão do Claude Code da VM** (seção 2A), sem sudo. O Alexandre cola no prompt o CSV **fictício** (do PO, ou o catálogo exportado do FDV, que não tem dado pessoal) e diz a tabela `tha_*` de destino. Nada vai por `scp`, ao repositório nem a recado.

Regras da carga:
- **Ordem:** a mesma das tabelas na seção 5 (filial primeiro; título e nota por último).
- **Formato:** UTF-8, separador `;`, primeira linha de cabeçalho; campo vazio = nulo; `linha_hash` pode ficar vazia.
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
3. **Criar a staging vazia**, com a mesma estrutura e um nome que **não** casa com `tha[_]%` (a contagem de 16 da seção 5 continua valendo):
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

## 7. Usuário só leitura do conector

**Fonte:** kit do Macuxi FDV, `aloirr/macuxifdv@0b79391`, `modules/integracao/kit-thathyany/sql/usuario-conector.sql`, só consulta. Este roteiro segue o **mesmo modelo do kit** (mesmos nomes), adaptado ao Linux/`sqlcmd`, com as diferenças abaixo.

**O que o kit faz** (SQL Server no Windows; idempotente):
- login `macuxi_conector` com `CHECK_POLICY = OFF` e `DEFAULT_DATABASE = ERP_THATHYANY`; se já existir, `ALTER LOGIN ... WITH PASSWORD` e `ENABLE`; a senha vem pela variável `sqlcmd` `$(SENHA)`, nunca no texto;
- usuário `macuxi_conector` no `ERP_THATHYANY`;
- `GRANT SELECT` em todas as views `dbo.vw_macuxi_*`;
- entrada de pedidos: `GRANT EXECUTE` nas duas `sp_macuxi_pedido_*` e `GRANT SELECT` em `dbo.macuxi_pedido_entrada`;
- **não** é dono, **não** lê as tabelas `tha_*` direto, sem papéis (roles). Por isso não usamos `db_datareader` (leria as `tha_*` todas).

**Diferenças do cenário B (v0.3.6 é só cadastros):**
1. **Sem a entrada de pedidos:** nenhum `GRANT` nas procedures `sp_macuxi_pedido_*` nem em `macuxi_pedido_entrada`, e sem `SELECT` nas views do retorno do pedido (`vw_macuxi_pedido_*`).
2. **`CHECK_POLICY = ON`**: no Linux vale a política de senha do SQL Server, com senha forte.

### 7.1 Script (Linux, `sqlcmd`)
Salvar como `~/thathyany/usuario-conector-cenario-b.sql` na VM (o arquivo não tem senha):
```sql
SET NOCOUNT ON;
USE master;
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'macuxi_conector')
    CREATE LOGIN macuxi_conector WITH PASSWORD = N'$(SENHA)', CHECK_POLICY = ON, DEFAULT_DATABASE = ERP_THATHYANY;
ELSE
    ALTER LOGIN macuxi_conector WITH PASSWORD = N'$(SENHA)', CHECK_POLICY = ON;
ALTER LOGIN macuxi_conector ENABLE;
GO
USE ERP_THATHYANY;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'macuxi_conector')
    CREATE USER macuxi_conector FOR LOGIN macuxi_conector;
GO
-- SELECT só nas views de cadastro do kit (sem as vw_macuxi_pedido_*)
DECLARE @sql nvarchar(max) = N'';
SELECT @sql = @sql + N'GRANT SELECT ON ' + QUOTENAME(SCHEMA_NAME(schema_id)) + N'.' + QUOTENAME(name)
            + N' TO macuxi_conector;' + CHAR(10)
FROM sys.views
WHERE name LIKE 'vw[_]macuxi[_]%' AND name NOT LIKE 'vw[_]macuxi[_]pedido[_]%'
  AND SCHEMA_NAME(schema_id) = N'dbo';
EXEC sp_executesql @sql;
GO
```
Rodar com as senhas de `~/thathyany/.segredos.env` (seção 2A), carregadas num subshell só; o `sqlcmd` resolve `$(SENHA)` pela variável de ambiente, sem `-v`, e a senha não aparece na lista de processos:
```bash
( set -a; . ~/thathyany/.segredos.env; set +a; SENHA="$SENHA_CONECTOR" SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" \
  sqlcmd -S 127.0.0.1 -U sa -C -b -i ~/thathyany/usuario-conector-cenario-b.sql )
```
- Idempotente: pode rodar de novo (troca a senha e regrava os `GRANT`).
- Sem `VIEW SERVER STATE`, `sysadmin`, `db_owner`, `db_datareader` ou papel de servidor.

### 7.2 Como conferir
Na VM, logado como `macuxi_conector` (`( set -a; . ~/thathyany/.segredos.env; set +a; SQLCMDPASSWORD="$SENHA_CONECTOR" sqlcmd -S 127.0.0.1 -U macuxi_conector -C -d ERP_THATHYANY -Q "<consulta>" )`, sem `-b`, uma consulta por vez):
```sql
SELECT TOP 1 * FROM dbo.vw_macuxi_produto;              -- funciona
SELECT TOP 1 * FROM dbo.tha_produto;                    -- erro 229: permissão SELECT negada
SELECT TOP 1 * FROM dbo.vw_macuxi_pedido_status;        -- erro 229 (cenário B)
INSERT INTO dbo.tha_produto DEFAULT VALUES;             -- erro 229: permissão INSERT negada
EXEC dbo.sp_macuxi_pedido_inserir;                      -- erro 229: permissão EXECUTE negada (cenário B)
SELECT * FROM fn_my_permissions(NULL, 'DATABASE');      -- só CONNECT
```
Último passo do arranque (prompt de arranque do PO): `sudo rm -f /etc/sudoers.d/90-arranque`; depois disso `sudo -n true` falha.

## 8. LGPD e encerramento

- **Quem acessa:** o Alexandre (SSH/`sa`); a sessão do Claude Code **da VM**, na conta do Alexandre, via Remote Control (arranque e carga da seção 6), com o `sa` só pelo arquivo `~/thathyany/.segredos.env` (600, gerado por ela, nunca impresso); o conector, só como `macuxi_conector`, local. Nenhum agente do time recebe credencial nem acesso à VM.
- **Nada de dado pessoal real na VM.** Se aparecer (num CSV, no catálogo ou num log), **parar**, apagar o arquivo e avisar o Alexandre por recado, sem copiar o dado.
- **Prazo:** a VM **fica enquanto durarem os testes**, até o Alexandre encerrá-los **por recado**. O `gerente-projetos` confere na ronda semanal se o teste segue.

**Encerramento** (só disparado pelo recado do Alexandre): parar e desabilitar o Remote Control (`systemctl --user disable --now claude-remote` e `sudo loginctl disable-linger <USUARIO_ADMIN>`, ou `tmux kill-session -t thathyany`); `claude` → `/logout`; apagar `~/thathyany/.segredos.env` (`shred -u ~/thathyany/.segredos.env`); depois, apagar a **VM inteira** no painel do provedor, com volumes, snapshots, imagens e backups; remover a regra do firewall do provedor.

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
- [ ] Data de início do teste: ____ (Manaus) · testes encerrados por recado do Alexandre em ____ (seção 8)
- [ ] Encerramento: data e hora (Manaus) ____ · quem fez ____

### Riscos
| Risco | Mitigação |
|---|---|
| Teste esquecido depois de parado o uso | Seção 8: o gerente confere na ronda semanal se o teste segue; o encerramento sai pelo recado do Alexandre |
| Sessão da VM com acesso ao `sa` | Senhas geradas pela sessão em `~/thathyany/.segredos.env` (600), carregadas só num subshell, nunca impressas no chat, recado ou log (o Alexandre lê pelo SSH, se precisar); o arquivo é apagado no encerramento; firewall de entrada fechado (o Remote Control só sai por HTTPS); login Claude só do Alexandre; sem sudo depois do arranque |
| Carga perder ou duplicar linha | Seção 6: `MERGE` por `external_id` sem `WHEN NOT MATCHED BY SOURCE` (nunca apaga), cabeçalho validado, staging `carga_*` removida; regras em `~/thathyany/CLAUDE.md` da VM |
| CSV com dado pessoal real | Seção 6: parar antes de carregar, apagar o arquivo e avisar o Alexandre, sem copiar o dado |
