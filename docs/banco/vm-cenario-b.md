# Roteiro da VM de teste do cenário B (v0.3.6)

> T-0057 · autor: `banco-dados` · criado em 2026-11-23, 14h10 (Manaus); revisto em 2026-11-23, 14h20 (Manaus), com a decisão do Alexandre (via PO, 23/11, 14h19): "banco está vazio. vamos começar a thathyany do zero." Vale o banco **fictício**.
> Cenário B da v0.3.6, aprovado pelo Alexandre. **Só teste, temporário.**
> Sem segredo neste texto: tudo o que é sensível aparece como marcador (`<IP_DO_ALEXANDRE>`, `<SENHA_NO_COFRE>`, `<HOST_DA_VM>`...). O valor real fica no cofre de senhas, nunca em doc, recado, commit ou log.

## 1. Objetivo, escopo e o que NÃO é

**Objetivo:** subir uma VM Linux de teste com o banco `ERP_THATHYANY` (cliente thathyany, código FDV `am2808`) **criado do zero** com o esquema do kit do Macuxi FDV e populado com **dados fictícios**, para o conector ler as views e alimentar o Macuxi ERP em teste.

**Escopo:** uma VM, um SQL Server 2022, o banco criado pelo `criar-banco.sql` do kit (seção 5), a carga dos CSVs fictícios e do catálogo (seção 6), um login **só leitura** para o conector (seção 7), firewall fechado e encerramento com a VM apagada (seção 8).

**O que NÃO é:**
- Não é produção. Nada aqui vai para `erp.macuxifdv.com.br` nem para a VM de produção do FDV/ERP.
- Não é cópia do banco real do cliente: **não há restore de `.bak`** nem dado de cliente real.
- **Nada do Macuxi FDV muda**: nem código (`aloirr/macuxifdv` é só consulta), nem banco, nem configuração.
- **O ERP nunca lê tabela do FDV.** O conector lê só as views deste banco de teste; o banco `macuxierp` não ganha acesso a ele nem ao banco do FDV.
- Não é permanente: tem data para acabar (seção 8).

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

**O conector roda na própria VM** e chega ao SQL Server por `127.0.0.1,1433`: sem IP extra liberado e sem túnel SSH para o conector. A saída dele para o ERP de teste é tráfego de saída (já permitido).

Como conferir:
- `sudo ufw status verbose` → `Default: deny (incoming)`, uma regra só: `22/tcp ALLOW IN <IP_DO_ALEXANDRE>`.
- `sudo ss -tlnp` → `1433` só em `127.0.0.1` (e/ou `::1`), nunca em `0.0.0.0` ou `*`.
- De fora (outro IP qualquer): `nc -vz -w 5 <HOST_DA_VM> 1433` e `nc -vz -w 5 <HOST_DA_VM> 22` → ambos falham (timeout).
- Do IP do Alexandre: `nc -vz -w 5 <HOST_DA_VM> 22` → abre; `1433` → falha.

## 4. SQL Server 2022 no Ubuntu 22.04

**Edição** (decisão do PO, **pendente do ok do Alexandre**): Express ou Developer servem (dados fictícios, bem abaixo de 10 GB). Developer só no teste de 30 dias, sem uso produtivo; uso contínuo = Standard ou Express com ≤10 GB.

```bash
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | sudo tee /etc/apt/trusted.gpg.d/microsoft.asc
curl -fsSL https://packages.microsoft.com/config/ubuntu/22.04/mssql-server-2022.list | sudo tee /etc/apt/sources.list.d/mssql-server-2022.list
sudo apt update && sudo apt install -y mssql-server
sudo /opt/mssql/bin/mssql-conf setup     # escolher "Express" (ou "Developer", ver acima); senha do sa = <SENHA_SA_NO_COFRE>
```
- A senha do `sa` é gerada e guardada **no cofre** antes do setup e digitada só no prompt (nunca em variável de ambiente persistida, histórico ou doc). Depois: `history -c`.
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
sqlcmd -S 127.0.0.1 -U sa -C -Q "SELECT SERVERPROPERTY('Edition'), SERVERPROPERTY('ProductVersion');"   # senha pedida no prompt
sqlcmd -S 127.0.0.1 -U sa -C -Q "SELECT encrypt_option FROM sys.dm_exec_connections WHERE session_id=@@SPID;"   # TRUE
sudo ss -tlnp | grep 1433   # só 127.0.0.1
```
Versão `16.x`.

## 5. Criar o banco com o esquema do kit do FDV

**Fonte (só cópia, sem editar):** kit do Macuxi FDV, `aloirr/macuxifdv@0b79391`, `modules/integracao/kit-thathyany/sql/criar-banco.sql` (gerado por `kit-thathyany/scripts/gerar.ts`). Cópia de consulta em `aloirr/macuxierp-recados@8eef2ae`, `recados/anexos/T-0057/criar-banco-fdv-0b79391.sql`. O arquivo **não** entra no repositório do ERP.

**O que ele cria** (idempotente: roda quantas vezes precisar; sem segredo e sem dado):
- o banco `ERP_THATHYANY` (`IF DB_ID(...) IS NULL CREATE DATABASE`);
- **16 tabelas `dbo.tha_*`**: `filial`, `vendedor`, `catalogo_no`, `forma_pagamento`, `prazo_pagamento`, `produto`, `produto_unidade`, `preco`, `tabela_escalonada`, `estoque`, `cliente`, `cliente_endereco`, `transportadora`, `rota`, `titulo`, `nota` (chave `external_id`, coluna `alterado_em` em UTC, índice `(alterado_em, external_id)`);
- as **views `dbo.vw_macuxi_*`** que o conector lê: uma por tabela `tha_*` (16), mais `vw_macuxi_pedido_status` e `vw_macuxi_pedido_nota_item` (retorno do pedido);
- a **entrada de pedidos** (`macuxi_pedido_entrada`, `macuxi_pedido_entrada_item`, `macuxi_pedido_nota_item`, `sp_macuxi_pedido_inserir`, `sp_macuxi_pedido_item_inserir`, gatilho e `vw_thathyany_pedidos`).

Passos:
1. Levar o arquivo à VM, só por `scp`:
   ```bash
   scp criar-banco.sql <USUARIO_ADMIN>@<HOST_DA_VM>:~/
   ```
2. Conferir o hash contra a cópia de consulta (a mesma conta na cópia de `macuxierp-recados` dá `eecca1aaa144ce46c5fee3bc8259bb3cd0e693e3496ce80df3ec4a6a506fd935`):
   ```bash
   sha256sum ~/criar-banco.sql
   ```
   Diferente: **parar** e falar com o Alexandre; não rodar.
3. Rodar como `sa`:
   ```bash
   read -rs -p "Senha do sa: " SQLCMDPASSWORD; echo; export SQLCMDPASSWORD
   sqlcmd -S 127.0.0.1 -U sa -C -b -i ~/criar-banco.sql
   unset SQLCMDPASSWORD
   ```

Como conferir:
```sql
USE ERP_THATHYANY;
SELECT COUNT(*) FROM sys.tables WHERE name LIKE 'tha[_]%';        -- 16
SELECT COUNT(*) FROM sys.views  WHERE name LIKE 'vw[_]macuxi[_]%'; -- 18 (16 de cadastro + 2 do retorno do pedido)
```
Rodar o script de novo não dá erro nem muda as contagens.

## 6. Popular

O time carrega nas tabelas `tha_*`:
- os **CSVs fictícios do PO** (ele passa quando a VM existir);
- o **catálogo real exportado do FDV** (produtos, sem dado pessoal).

Os arquivos vão à VM só por `scp`, numa pasta de carga (`/var/opt/mssql/carga`, dono `mssql:mssql`, permissão 700), e **não** vão ao repositório nem a recado. Regras da carga:
- **Ordem:** a mesma das tabelas na seção 5 (filial primeiro; título e nota por último).
- **Colunas** na ordem da tabela: `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tha_produto') ORDER BY column_id;`. Campo vazio = nulo; `linha_hash` pode ficar vazia.
- **`external_id`** é a chave: único e estável por linha; recarregar a mesma linha usa o mesmo `external_id`.
- **`alterado_em`** em **UTC** (`AAAA-MM-DD HH:MM:SS.mmm`); quem altera uma linha avança o `alterado_em` (é por ele que o conector lê a mudança).

Exemplo com `bcp` (UTF-8, separador `;`, primeira linha de cabeçalho; senha pedida no prompt):
```bash
bcp dbo.tha_produto in /var/opt/mssql/carga/<ARQUIVO_PRODUTO>.csv \
  -S 127.0.0.1 -U sa -u -d ERP_THATHYANY -c -C 65001 -t ';' -F 2 \
  -e /var/opt/mssql/carga/<ARQUIVO_PRODUTO>.erros
```
Ou com `BULK INSERT` (o arquivo precisa ser legível pelo usuário `mssql`):
```sql
BULK INSERT dbo.tha_produto FROM N'/var/opt/mssql/carga/<ARQUIVO_PRODUTO>.csv'
  WITH (FORMAT = 'CSV', FIRSTROW = 2, FIELDTERMINATOR = ';', ROWTERMINATOR = '0x0a', TABLOCK);
```
Depois da carga, apagar os arquivos da pasta de carga.

Como conferir:
```sql
USE ERP_THATHYANY;
SELECT t.name, SUM(p.rows) AS linhas
FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE t.name LIKE 'tha[_]%' GROUP BY t.name ORDER BY t.name;   -- bate com as linhas de cada arquivo
SELECT TOP 5 * FROM dbo.vw_macuxi_produto ORDER BY alterado_em DESC;
SELECT TOP 5 * FROM dbo.vw_macuxi_cliente ORDER BY alterado_em DESC;
```
Arquivo `.erros` vazio; nenhum `external_id` repetido.

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
Rodar com a senha lida do cofre para uma variável, sem passar pelo histórico do shell:
```bash
read -rs -p "Senha do macuxi_conector (do cofre): " SENHA_CONECTOR; echo
read -rs -p "Senha do sa: " SQLCMDPASSWORD; echo
export SQLCMDPASSWORD
sqlcmd -S 127.0.0.1 -U sa -C -b -i ~/usuario-conector-cenario-b.sql -v SENHA="$SENHA_CONECTOR"
unset SENHA_CONECTOR SQLCMDPASSWORD
```
- Idempotente: pode rodar de novo (troca a senha e regrava os `GRANT`).
- Sem `VIEW SERVER STATE`, `sysadmin`, `db_owner`, `db_datareader` ou papel de servidor.

### 7.2 Como conferir
Na VM, logado como `macuxi_conector` (`sqlcmd -S 127.0.0.1 -U macuxi_conector -C -d ERP_THATHYANY`, senha no prompt):
```sql
SELECT TOP 1 * FROM dbo.vw_macuxi_produto;              -- funciona
SELECT TOP 1 * FROM dbo.tha_produto;                    -- erro 229: permissão SELECT negada
SELECT TOP 1 * FROM dbo.vw_macuxi_pedido_status;        -- erro 229 (cenário B)
INSERT INTO dbo.tha_produto DEFAULT VALUES;             -- erro 229: permissão INSERT negada
EXEC dbo.sp_macuxi_pedido_inserir;                      -- erro 229: permissão EXECUTE negada (cenário B)
SELECT * FROM fn_my_permissions(NULL, 'DATABASE');      -- só CONNECT
```

## 8. LGPD e encerramento

- **Quem acessa:** só o Alexandre (SSH/`sa`) e o time na carga da seção 6, pelo acesso do Alexandre; o conector, só como `macuxi_conector`, local. Nenhum agente recebe credencial.
- **Nada de dado pessoal real na VM.** Se aparecer (num CSV, no catálogo ou num log), **parar**, apagar o arquivo e avisar o Alexandre por recado, sem copiar o dado.
- **Prazo:** **30 dias** a partir da criação do banco, renovável só por recado do Alexandre. Passou do prazo sem renovação, encerra.

**Encerramento:** apagar a **VM inteira** no painel do provedor, com volumes, snapshots, imagens e backups; remover a regra do firewall do provedor; apagar a senha do `sa` e do conector do cofre.

**Registro:** recado `aviso` ao `gerente-projetos` com a data e a hora de Manaus (`TZ=America/Manaus date`), quem fez e a confirmação de cada item acima (sem dado nem segredo).

Como conferir: o painel do provedor não lista a VM, volumes, snapshots nem backups dela.

## 9. Checklist final e riscos

### Checklist
- [ ] Conferidos os blocos "Como conferir" das seções 2 a 8
- [ ] Edição do SQL Server com o ok do Alexandre (seção 4)
- [ ] Data de início do teste: ____ (Manaus) · prazo final: ____ (seção 8)
- [ ] Encerramento: data e hora (Manaus) ____ · quem fez ____

### Riscos
| Risco | Mitigação |
|---|---|
| Teste esquecido além do prazo | Seção 8 (prazo); o gerente cobra na ronda |
