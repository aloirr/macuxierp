# Macuxi Conector — pacote Linux (systemd)

Pacote oficial do Conector do Macuxi ERP para Linux, ao lado do pacote Windows (ADR 0014, seção 6 item 4). O Conector lê o banco do ERP do cliente e envia os dados por HTTPS para a entrada do Macuxi ERP.

## Requisitos

- Linux com **systemd**.
- **Node.js 24.7 ou mais novo** em `/usr/bin/node` (pacote da distribuição ou NodeSource, conforme o roteiro da VM).
- Acesso de saída HTTPS para o Macuxi ERP e acesso ao banco de origem (por exemplo, `127.0.0.1,1433`).

## Conteúdo do pacote

`macuxi-conector-<versao>-linux.tar.gz`, com o `.sha256` ao lado:

| Arquivo | Para quê |
|---|---|
| `conector.mjs` | o Conector (arquivo único) |
| `exemplos/conector.thathyany.exemplo.json` | exemplo de configuração |
| `macuxi-conector.service` | unidade systemd |
| `instalar.sh` | instalador idempotente |
| `LEIA-ME-LINUX.md` | este guia |

## Instalação

```bash
sha256sum -c macuxi-conector-<versao>-linux.tar.gz.sha256
tar -xzf macuxi-conector-<versao>-linux.tar.gz
cd macuxi-conector-<versao>-linux
sudo bash instalar.sh
```

O instalador (pode rodar de novo sem estrago):

1. confere o Node 24.7+;
2. cria o usuário de sistema `macuxi-conector`, sem login e sem pasta pessoal;
3. copia a aplicação para `/opt/macuxi-conector` (dono root, só leitura para o serviço);
4. cria `/etc/macuxi-conector` (0750) e, **só se ainda não existirem**, o `segredos.env` modelo vazio e o `conector.json` copiado do exemplo;
5. instala a unidade em `/etc/systemd/system/macuxi-conector.service` e roda `systemctl daemon-reload`.

Os dados de trabalho (cursores, fila local) ficam em `/var/lib/macuxi-conector`, a única pasta em que o serviço escreve.

## Configuração

Revise `/etc/macuxi-conector/conector.json` (URL do ERP, `conectorId` da empresa, consultas). Nada de senha ou chave nesse arquivo.

## Segredos

Ficam só em `/etc/macuxi-conector/segredos.env`, dono `root:root`, modo `0600`, lido pelo systemd (`EnvironmentFile`). Variáveis:

- `MACUXI_CONECTOR_ERP_SENHA` — senha do usuário de leitura no banco de origem;
- `MACUXI_CONECTOR_HUB_CHAVE` — chave do conector gerada no portal do Macuxi ERP (aba "Integração").

Edite com `sudo nano /etc/macuxi-conector/segredos.env`. Nunca versione esse arquivo nem cole os valores em chat, recado, commit ou log. O instalador nunca o sobrescreve.

## Ligar o serviço

```bash
sudo systemctl enable --now macuxi-conector
```

## Status e logs

```bash
systemctl status macuxi-conector
journalctl -u macuxi-conector -f          # acompanhar
journalctl -u macuxi-conector --since today
```

O Conector reinicia sozinho em caso de falha, 30 segundos depois (`Restart=on-failure`).

Pelo próprio Conector (como o usuário do serviço; estes dois comandos não leem os segredos):

```bash
sudo -u macuxi-conector /usr/bin/node /opt/macuxi-conector/conector.mjs validar-config --config /etc/macuxi-conector/conector.json
sudo -u macuxi-conector /usr/bin/node /opt/macuxi-conector/conector.mjs status --config /etc/macuxi-conector/conector.json
```

O serviço roda `conector.mjs rodar --config /etc/macuxi-conector/conector.json` (linha `ExecStart` da unidade).

## Atualização (manual)

A atualização automática está **desligada** nesta versão (v0.3.12 do ERP; ligar pede ADR nova, com a chave de assinatura do ERP). Para trocar de versão:

```bash
sha256sum -c macuxi-conector-<nova>-linux.tar.gz.sha256
tar -xzf macuxi-conector-<nova>-linux.tar.gz
cd macuxi-conector-<nova>-linux
sudo bash instalar.sh                     # mantém segredos.env e conector.json
sudo systemctl restart macuxi-conector
journalctl -u macuxi-conector -n 50
```

## Desinstalação

```bash
sudo systemctl disable --now macuxi-conector
sudo rm /etc/systemd/system/macuxi-conector.service
sudo systemctl daemon-reload
sudo rm -rf /opt/macuxi-conector
# Opcional (apaga configuração, segredos e dados locais):
sudo rm -rf /etc/macuxi-conector /var/lib/macuxi-conector
sudo userdel macuxi-conector
```

## Segurança da unidade

Usuário próprio sem login, `NoNewPrivileges=yes`, `ProtectSystem=strict` com escrita só em `/var/lib/macuxi-conector`, `PrivateTmp`, `ProtectHome`, `ProtectKernel*` e rede limitada a `AF_INET`, `AF_INET6` e `AF_UNIX`. Um teste (`scripts/montar-linux.test.mjs`) trava essas diretivas.
