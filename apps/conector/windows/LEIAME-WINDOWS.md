# Macuxi Conector — pacote Windows (WinSW)

Pacote oficial do Conector do Macuxi ERP para Windows Server/Windows 10+ x64, ao lado do pacote Linux (ADR 0014, seção 6). O
serviço do Windows é feito pelo **WinSW** (um executável que lê um XML), como no FDV. Instalação **manual**: o pacote do ERP não
leva o Node nem o WinSW e não tem assinatura (ADR 0014, seção 6 item 3); os dois binários são baixados pelo técnico e conferidos
pelo SHA-256 abaixo.

## Conteúdo do pacote

`macuxi-conector-<versao>-windows.zip`, montado pelo workflow `conector-montar.yml`, com uma pasta `macuxi-conector-<versao>-windows\`:

| Arquivo | Para quê |
|---|---|
| `conector.mjs` | o Conector (arquivo único) |
| `exemplos\` | exemplos de `conector.json` |
| `windows\macuxi-conector.xml` | XML do serviço WinSW (`MacuxiConector`) para a pasta padrão |
| `windows\LEIAME-WINDOWS.md` | este guia |
| `LEIAME.md` | visão geral do Conector |
| `VERSAO.txt`, `SHA256SUMS` | versão, commit e SHA-256 de cada arquivo |

Confira o pacote antes de abrir (PowerShell): `Get-FileHash .\macuxi-conector-<versao>-windows.zip -Algorithm SHA256` e compare
com a linha do `SHA256SUMS` publicado ao lado dos pacotes.

## Requisitos

- **Node.js 24.7 ou mais novo**. Duas opções:
  - instalado no servidor (instalador oficial, caminho padrão `C:\Program Files\nodejs\node.exe`, que é o do XML); ou
  - o **node.exe portátil** do Node **24.21.0**, sem instalar:
    - URL: `https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip`
    - SHA-256 do zip: `158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541`
    - copie só o `node-v24.21.0-win-x64\node.exe` para `C:\ProgramData\Macuxi\Conector\node.exe` e troque o `<executable>` do XML
      por esse caminho.
- **WinSW-x64 2.12.0**:
  - URL: `https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe`
  - SHA-256: `05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da`
- Saída HTTPS para o Macuxi ERP e acesso ao banco do ERP do cliente.

Confira cada download antes de usar; hash diferente = não use o arquivo:

```powershell
(Get-FileHash .\WinSW-x64.exe -Algorithm SHA256).Hash.ToLower()
(Get-FileHash .\node-v24.21.0-win-x64.zip -Algorithm SHA256).Hash.ToLower()
```

## Instalação

PowerShell **como administrador**:

```powershell
# 1. Pasta do Conector: o conteúdo da pasta macuxi-conector-<versao>-windows (zip extraído em C:\Temp)
New-Item -ItemType Directory -Force C:\ProgramData\Macuxi\Conector\servico | Out-Null
Copy-Item C:\Temp\macuxi-conector-<versao>-windows\* C:\ProgramData\Macuxi\Conector\ -Recurse -Force
cd C:\ProgramData\Macuxi\Conector

# 2. Configuração (URL do ERP em hub.url, prefixo /entrada/v1, hub.conectorId e a conexão com o banco)
Copy-Item .\exemplos\conector.exemplo.json .\conector.json
node conector.mjs validar-config --config conector.json

# 3. Segredos no Gerenciador de Credenciais do Windows (provedor "windows"; nunca no conector.json)
"<senha do banco>" | node conector.mjs segredo definir erp_senha --config conector.json
"<chave do conector>" | node conector.mjs segredo definir hub_chave --config conector.json
node conector.mjs testar-conexao --config conector.json

# 4. Serviço WinSW (WinSW-x64.exe baixado e conferido nesta pasta): o exe e o XML com o mesmo nome, em servico\
Copy-Item .\WinSW-x64.exe .\servico\macuxi-conector.exe
Copy-Item .\windows\macuxi-conector.xml .\servico\macuxi-conector.xml
.\servico\macuxi-conector.exe install
.\servico\macuxi-conector.exe start
.\servico\macuxi-conector.exe status
```

(Com o node.exe portátil, troque `node` por `.\node.exe` nos comandos.) O passo 4 também pode ser feito por
`node conector.mjs instalar-servico --winsw .\WinSW-x64.exe --config conector.json`, que gera o mesmo XML na pasta `servico\`.

**Conta do serviço:** a credencial do Gerenciador de Credenciais é do usuário que rodou o `segredo definir`. Em `services.msc`,
serviço "Macuxi Conector", aba "Fazer logon", use essa mesma conta (ou grave os segredos logado com a conta do serviço).

O serviço `MacuxiConector` sobe sozinho com o Windows (início automático atrasado) e reinicia em caso de falha. Logs do serviço
em `C:\ProgramData\Macuxi\Conector\dados\logs`; situação pelo Conector com `node conector.mjs status --config conector.json`.

## Atualização (manual)

A atualização automática está **desligada** no Macuxi ERP (ADR 0014, seção 6 item 3). Para trocar de versão:

```powershell
cd C:\ProgramData\Macuxi\Conector
.\servico\macuxi-conector.exe stop
Copy-Item .\conector.mjs .\conector.mjs.anterior -Force          # volta rápida, se precisar
Copy-Item C:\Temp\macuxi-conector-<nova>-windows\conector.mjs .\ -Force   # zip novo extraído em C:\Temp, já conferido
Copy-Item C:\Temp\macuxi-conector-<nova>-windows\windows .\ -Recurse -Force
node conector.mjs validar-config --config conector.json
.\servico\macuxi-conector.exe start
.\servico\macuxi-conector.exe status
```

O `conector.json`, os segredos e a pasta `dados\` ficam como estão. Se o XML novo mudou, rode `uninstall`, copie o XML para
`servico\` e rode `install` e `start` de novo.

## Desinstalação

```powershell
C:\ProgramData\Macuxi\Conector\servico\macuxi-conector.exe stop
C:\ProgramData\Macuxi\Conector\servico\macuxi-conector.exe uninstall
```

(ou `node conector.mjs desinstalar-servico --config conector.json`). Apagar a pasta remove configuração e dados locais.
