# Roteiro da VM de teste do cenário B (v0.3.6)

> T-0057 · autor: `banco-dados` · criado em 2026-11-23, 14h10 (Manaus).
> Cenário B da v0.3.6, aprovado pelo Alexandre. **Só teste, temporário.**
> Sem segredo neste texto: tudo o que é sensível aparece como marcador (`<IP_DO_ALEXANDRE>`, `<SENHA_NO_COFRE>`, `<HOST_DA_VM>`...). O valor real fica no cofre de senhas, nunca em doc, recado, commit ou log.

## 1. Objetivo, escopo e o que NÃO é

**Objetivo:** subir uma VM Linux de teste com uma **cópia** do banco do ERP legado do cliente thathyany (código FDV `am2808`), banco `ERP_THATHYANY`, para o conector ler esses dados e alimentar o Macuxi ERP em teste.

**Escopo:** uma VM, um SQL Server 2022 Express, um banco restaurado de um `.bak`, um login **só leitura** para o conector, firewall fechado e encerramento com destruição dos dados.

**O que NÃO é:**
- Não é produção. Nada aqui vai para `erp.macuxifdv.com.br` nem para a VM de produção do FDV/ERP.
- **Nada do Macuxi FDV muda**: nem código (`aloirr/macuxifdv` é só consulta), nem banco, nem configuração.
- **O ERP nunca lê tabela do FDV.** O conector lê só a cópia do ERP legado nesta VM; o banco `macuxierp` não ganha acesso a ela nem ao banco do FDV.
- Não é cópia permanente: tem data para acabar (seção 7).

## 2. VM

- **Sistema:** Ubuntu Server 22.04 LTS (é a versão suportada pelo SQL Server 2022 no Linux).
- **Tamanho sugerido:** 2 vCPU, 4 GB de RAM (o SQL Server exige no mínimo 2 GB; o Express usa no máximo ~1,4 GB de buffer), disco de dados de **3× o tamanho do `.bak`** (no mínimo 40 GB): cabe o `.bak`, o banco restaurado e o log.
- **Disco cifrado** (é dado pessoal de cliente):
  - **Opção A — LUKS na instalação:** no instalador do Ubuntu, "Use LVM with encryption". A senha de desbloqueio é pedida a cada boot (no console do provedor). Protege mesmo que o provedor ou um snapshot vaze, mas complica reinício remoto.
  - **Opção B — volume cifrado do provedor** (criptografia em repouso do disco, com chave gerenciada pelo provedor ou pelo cliente): ligada na criação do disco, transparente para o sistema, sem senha no boot.
  - **Recomendação:** **Opção B** para este teste curto, com o disco de dados num **volume separado** do disco do sistema (destruir o volume no fim apaga tudo). Se o provedor não oferecer criptografia em repouso, usar a Opção A.
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
- `lsblk -f` (Opção A: aparece `crypto_LUKS`) ou o painel do provedor mostra o disco "encrypted" (Opção B).
- `sudo sshd -T | grep -Ei 'passwordauth|permitroot'` → `no` / `no`.
- De fora: `ssh -o PubkeyAuthentication=no <USUARIO_ADMIN>@<HOST_DA_VM>` deve falhar com `Permission denied (publickey)`.

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

O SQL Server escuta **só em localhost** (seção 4). O conector chega nele por **túnel SSH**, da máquina onde roda:
```bash
ssh -N -L 127.0.0.1:14330:127.0.0.1:1433 <USUARIO_ADMIN>@<HOST_DA_VM>
# o conector aponta para 127.0.0.1,14330 (porta local livre à escolha)
```
O túnel sai de uma máquina cujo IP está liberado na porta 22. Se o conector rodar em outro IP, liberar esse IP também na 22 (com o OK do Alexandre), nunca a 1433.

Como conferir:
- `sudo ufw status verbose` → `Default: deny (incoming)`, uma regra só: `22/tcp ALLOW IN <IP_DO_ALEXANDRE>`.
- `sudo ss -tlnp` → `1433` só em `127.0.0.1` (e/ou `::1`), nunca em `0.0.0.0` ou `*`.
- De fora (outro IP qualquer): `nc -vz -w 5 <HOST_DA_VM> 1433` e `nc -vz -w 5 <HOST_DA_VM> 22` → ambos falham (timeout).
- Do IP do Alexandre: `nc -vz -w 5 <HOST_DA_VM> 22` → abre; `1433` → falha.

## 4. SQL Server 2022 Express no Ubuntu 22.04

```bash
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | sudo tee /etc/apt/trusted.gpg.d/microsoft.asc
curl -fsSL https://packages.microsoft.com/config/ubuntu/22.04/mssql-server-2022.list | sudo tee /etc/apt/sources.list.d/mssql-server-2022.list
sudo apt update && sudo apt install -y mssql-server
sudo /opt/mssql/bin/mssql-conf setup     # escolher "Express"; senha do sa = <SENHA_SA_NO_COFRE>
```
- A senha do `sa` é gerada e guardada **no cofre** antes do setup e digitada só no prompt (nunca em variável de ambiente persistida, histórico ou doc). Depois: `history -c`.
- Ferramentas de linha de comando:
  ```bash
  curl -fsSL https://packages.microsoft.com/config/ubuntu/22.04/prod.list | sudo tee /etc/apt/sources.list.d/mssql-release.list
  sudo apt update && sudo ACCEPT_EULA=Y apt install -y mssql-tools18 unixodbc-dev
  echo 'export PATH="$PATH:/opt/mssql-tools18/bin"' >> ~/.bashrc
  ```
- **Só localhost e TLS:**
  ```bash
  sudo /opt/mssql/bin/mssql-conf set network.ipaddress 127.0.0.1
  # certificado (autoassinado serve para o teste; vale só pelo túnel)
  sudo /opt/mssql/bin/mssql-conf set network.tlscert /etc/ssl/mssql/mssql.pem
  sudo /opt/mssql/bin/mssql-conf set network.tlskey  /etc/ssl/mssql/mssql.key
  sudo /opt/mssql/bin/mssql-conf set network.tlsprotocols 1.2
  sudo /opt/mssql/bin/mssql-conf set network.forceencryption 1
  sudo systemctl restart mssql-server
  ```
  (os arquivos do certificado pertencem a `mssql:mssql`, permissão 600 na chave.)
- **Limites do Express 2022:** limite de tamanho por banco (ver seção 5, passo 4), o menor entre **1 socket ou 4 núcleos**, **~1,4 GB (1410 MB) de buffer pool** por instância. Sem SQL Agent.

Como conferir:
```bash
systemctl status mssql-server --no-pager
sqlcmd -S 127.0.0.1 -U sa -C -Q "SELECT SERVERPROPERTY('Edition'), SERVERPROPERTY('ProductVersion');"   # senha pedida no prompt
sqlcmd -S 127.0.0.1 -U sa -C -Q "SELECT encrypt_option FROM sys.dm_exec_connections WHERE session_id=@@SPID;"   # TRUE
sudo ss -tlnp | grep 1433   # só 127.0.0.1
```
Edição esperada: `Express Edition (64-bit)`, versão `16.x`.

## 5. Restore do `.bak` do `ERP_THATHYANY`

1. **Hash na origem** (quem gera o `.bak`): `sha256sum ERP_THATHYANY.bak` (no Windows: `Get-FileHash -Algorithm SHA256`). Anotar o hash no cofre/recado **sem** o arquivo.
2. **Transferência cifrada** (só scp/sftp pelo SSH; nunca e-mail, chat, link público ou drive compartilhado):
   ```bash
   scp ERP_THATHYANY.bak <USUARIO_ADMIN>@<HOST_DA_VM>:/var/opt/mssql/backup/
   ```
   ```bash
   sudo mkdir -p /var/opt/mssql/backup && sudo chown mssql:mssql /var/opt/mssql/backup
   sudo chown mssql:mssql /var/opt/mssql/backup/ERP_THATHYANY.bak && sudo chmod 600 /var/opt/mssql/backup/ERP_THATHYANY.bak
   sha256sum /var/opt/mssql/backup/ERP_THATHYANY.bak   # igual ao da origem
   ```
3. **Versão de origem:**
   ```sql
   RESTORE HEADERONLY FROM DISK = N'/var/opt/mssql/backup/ERP_THATHYANY.bak';
   ```
   Olhar `SoftwareVersionMajor` (e `DatabaseVersion`). `.bak` de versão **mais nova** que 2022 (16) **não restaura**; de versões antigas (2008 R2 em diante) sobe com upgrade automático do banco (o nível de compatibilidade fica o antigo, e está bom para leitura).
4. **Tamanho dos arquivos:**
   ```sql
   RESTORE FILELISTONLY FROM DISK = N'/var/opt/mssql/backup/ERP_THATHYANY.bak';
   ```
   Somar `Size` das linhas `Type = 'D'` (dados). **Se passar de 10 GB, o Express não restaura.** A edição Developer não serve para dado real de produção (licença só para desenvolvimento e teste sem dado de produção). **Parar e registrar a decisão com o Alexandre** (por exemplo: licença Standard, ou cópia reduzida feita pelo cliente).
5. **Restore** (nomes lógicos vêm do passo 4):
   ```sql
   RESTORE DATABASE ERP_THATHYANY
     FROM DISK = N'/var/opt/mssql/backup/ERP_THATHYANY.bak'
     WITH MOVE N'<NOME_LOGICO_DADOS>' TO N'/var/opt/mssql/data/ERP_THATHYANY.mdf',
          MOVE N'<NOME_LOGICO_LOG>'   TO N'/var/opt/mssql/data/ERP_THATHYANY_log.ldf',
          RECOVERY, STATS = 10;
   ```
6. **Integridade:**
   ```sql
   DBCC CHECKDB (ERP_THATHYANY) WITH NO_INFOMSGS, ALL_ERRORMSGS;
   ```
7. **Apagar o `.bak`** depois do restore e do CHECKDB:
   ```bash
   sudo shred -u /var/opt/mssql/backup/ERP_THATHYANY.bak   # em volume cifrado/SSD o shred é só reforço; vale o rm
   ```

Como conferir: hash igual nos dois lados; `CHECKDB` sem erro; `SELECT name, state_desc FROM sys.databases WHERE name='ERP_THATHYANY';` → `ONLINE`; `ls /var/opt/mssql/backup/` vazio.

## 6. Usuário só leitura do conector

**Fonte:** kit do Macuxi FDV, `aloirr/macuxifdv@0b79391`, `modules/integracao/kit-thathyany/sql/usuario-conector.sql`, só consulta. Este roteiro segue o **mesmo modelo do kit** (mesmos nomes, mesmo escopo), adaptado ao Linux/`sqlcmd`. Se houver diferença, vale o arquivo do kit.

**O que o kit faz** (SQL Server no Windows, pelo `Instalar-Thathyany.ps1`; idempotente):
- login `macuxi_conector` com `CHECK_POLICY = OFF` e `DEFAULT_DATABASE = ERP_THATHYANY`; se já existir, `ALTER LOGIN ... WITH PASSWORD` e `ALTER LOGIN ... ENABLE`; a senha vem pela variável `sqlcmd` `$(SENHA)`, nunca no texto;
- usuário `macuxi_conector` no `ERP_THATHYANY` (`CREATE USER ... FOR LOGIN`, se não existir);
- `GRANT SELECT` em **todas as views `dbo.vw_macuxi_*`** (lista gerada de `sys.views` com `sp_executesql`);
- entrada de pedidos: `GRANT EXECUTE` em `dbo.sp_macuxi_pedido_inserir` e `dbo.sp_macuxi_pedido_item_inserir` e `GRANT SELECT` em `dbo.macuxi_pedido_entrada`;
- **não** é dono, **não** lê as tabelas `tha_*` direto, sem `DENY` e sem papéis (roles).

**Por que não `db_datareader`:** o kit dá `SELECT` só nas views `vw_macuxi_*`, o que é **menor** que `db_datareader` (que lê todas as tabelas, inclusive as `tha_*`, com dado pessoal). Também não há `DENY` genérico: sem papel nem `GRANT` extra, o usuário já não escreve nada, e o `DENY` só afastaria o roteiro do kit.

**Diferenças do cenário B em relação ao kit (recomendação):**
1. **Sem os `GRANT` de entrada de pedidos** (os dois `EXECUTE` e o `SELECT` em `macuxi_pedido_entrada`): o teste é só leitura. Se o Alexandre quiser testar a volta do pedido, ele decide e aplica à parte, com registro.
2. **`CHECK_POLICY = ON`** (o kit usa `OFF` no Windows): no Linux vale a política de senha do SQL Server, com senha forte.

### 6.1 Pré-requisito: as views vieram no `.bak`
As views `vw_macuxi_*` foram instaladas pelo kit no cliente e precisam vir no `.bak`. Conferir (como `sa`):
```sql
USE ERP_THATHYANY;
SELECT name FROM sys.views WHERE name LIKE 'vw[_]macuxi[_]%' ORDER BY name;
```
**Se não vier nenhuma, parar e falar com o Alexandre.** Não criar views na cópia sem decisão.

### 6.2 Script (Linux, `sqlcmd`)
Salvar como `~/usuario-conector-cenario-b.sql` na VM (o arquivo não tem senha):
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
-- SELECT só nas views do kit (mesmo escopo do usuario-conector.sql)
DECLARE @sql nvarchar(max) = N'';
SELECT @sql = @sql + N'GRANT SELECT ON ' + QUOTENAME(SCHEMA_NAME(schema_id)) + N'.' + QUOTENAME(name)
            + N' TO macuxi_conector;' + CHAR(10)
FROM sys.views
WHERE name LIKE 'vw[_]macuxi[_]%' AND SCHEMA_NAME(schema_id) = N'dbo';
EXEC sp_executesql @sql;
GO
-- Cenário B: SEM os GRANT de entrada de pedidos
-- (EXECUTE em dbo.sp_macuxi_pedido_inserir e dbo.sp_macuxi_pedido_item_inserir; SELECT em dbo.macuxi_pedido_entrada).
-- Só com decisão do Alexandre, aplicada à parte.
```
Rodar com a senha lida do cofre para uma variável, sem passar pelo histórico do shell:
```bash
read -rs -p "Senha do macuxi_conector (do cofre): " SENHA_CONECTOR; echo
read -rs -p "Senha do sa: " SQLCMDPASSWORD; echo
export SQLCMDPASSWORD
sqlcmd -S 127.0.0.1 -U sa -C -b -i ~/usuario-conector-cenario-b.sql -v SENHA="$SENHA_CONECTOR"
unset SENHA_CONECTOR SQLCMDPASSWORD
```
- O script é idempotente: pode rodar de novo (troca a senha e regrava os `GRANT`).
- Sem `VIEW SERVER STATE`, `sysadmin`, `db_owner`, `db_datareader` ou papel de servidor.
- Se o restore trouxe usuários órfãos do ambiente do cliente, **não** reaproveitar: o conector usa só `macuxi_conector`.

### 6.3 Como conferir
Pelo túnel, logado como `macuxi_conector` (`sqlcmd -S 127.0.0.1,14330 -U macuxi_conector -C -d ERP_THATHYANY`, senha no prompt):
```sql
SELECT TOP 1 * FROM dbo.<UMA_VIEW_vw_macuxi>;          -- funciona
SELECT TOP 1 * FROM dbo.<UMA_TABELA_tha>;              -- erro 229: permissão SELECT negada
INSERT INTO dbo.<UMA_VIEW_vw_macuxi> DEFAULT VALUES;   -- erro 229: permissão INSERT negada
INSERT INTO dbo.<UMA_TABELA_tha> DEFAULT VALUES;       -- erro 229: permissão INSERT negada
EXEC dbo.sp_macuxi_pedido_inserir;                     -- erro 229: permissão EXECUTE negada (cenário B)
SELECT * FROM fn_my_permissions(NULL, 'DATABASE');     -- só CONNECT
```

## 7. LGPD e encerramento

A base contém **dado pessoal de clientes da thathyany**. A Macuxi é **operadora**: trata só para o teste combinado, pelo tempo combinado.

- **Quem acessa:** só o Alexandre (SSH/sa) e o conector (`macuxi_conector`, pelo túnel). Nenhum agente recebe credencial; nada de dado copiado para fora da VM além do que o conector envia ao ERP de teste.
- **Sem dado pessoal em log:** o conector loga contagem, tempos e IDs técnicos, nunca nome, CPF/CNPJ de pessoa física, e-mail, telefone ou endereço. Nada de amostra de linha em recado, PR ou chat.
- **Prazo máximo sugerido:** **30 dias** a partir do restore (data no checklist). Passou do prazo sem nova decisão do Alexandre, encerra.

**Encerramento** (nesta ordem):
```sql
ALTER DATABASE ERP_THATHYANY SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
DROP DATABASE ERP_THATHYANY;
DROP LOGIN macuxi_conector;
```
```bash
sudo rm -f /var/opt/mssql/backup/*            # backups
sudo rm -f /var/opt/mssql/log/*               # logs e errorlog do SQL Server
sudo systemctl stop mssql-server
```
Depois: **destruir o volume cifrado de dados** (ou a VM inteira, com snapshots e imagens) no painel do provedor; remover a regra do firewall do provedor; apagar a senha do `sa` e do conector do cofre.

**Registro:** recado `aviso` ao `gerente-projetos` com a data e a hora de Manaus (`TZ=America/Manaus date`), quem executou e a confirmação de cada item acima (sem dado nem segredo).

Como conferir: o painel do provedor não lista a VM/volume nem snapshots; `sqlcmd ... -Q "SELECT name FROM sys.databases"` (se a VM ainda existir) não mostra `ERP_THATHYANY`.

## 8. Checklist final e riscos

### Checklist
- [ ] Conferidos os blocos "Como conferir" das seções 2 a 7
- [ ] Opção de disco cifrado escolhida: A ou B (seção 2)
- [ ] Data de início do teste: ____ (Manaus) · prazo final: ____ (seção 7)
- [ ] Encerramento: data e hora (Manaus) ____ · quem fez ____

### Riscos
| Risco | Mitigação |
|---|---|
| Banco grande demais para o Express | Ver seção 5, passo 4 |
| `.bak` de versão mais nova que 2022 | Ver seção 5, passo 3 |
| 1433 exposta por engano | `network.ipaddress 127.0.0.1` + ufw + firewall do provedor; teste `nc` de fora |
| Vazamento de dado pessoal (log, print, recado) | Logs só técnicos; nada de amostra fora da VM; disco cifrado |
| Teste esquecido além do prazo | Ver seção 7 (prazo); o gerente cobra na ronda |
| Usuário do conector com permissão demais | Ver seção 6 e 6.3 |
| `.bak` sem as views `vw_macuxi_*` | Ver 6.1 |
| Snapshot/backup do provedor sobrevive à destruição | Desligar snapshot automático; conferir no painel no encerramento |
