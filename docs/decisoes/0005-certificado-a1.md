# ADR 0005 — Certificado A1: caminho seguro de envio e guarda criptografada

- **Status:** aceita no desenho; a implementação é a T-0006 (modulo-core) com a T-0003 (banco-dados)
- **Data:** 21/11/2026
- **Dono:** engenheiro-software

## Contexto
A NF-e é assinada com o certificado A1 (arquivo `.pfx` mais a senha) da filial emissora. A mesma chave abre o mTLS com a SEFAZ. Pelo prompt de abertura, o Alexandre fornece o A1 da empresa piloto pelo caminho seguro que a ADR definir, **nunca colado em chat ou recado**.

## Decisão
1. **Único caminho de entrada**: a tela **Empresa → Certificado** do BKO, em `https://erp.macuxifdv.com.br`, com o perfil administrador. O `.pfx` e a senha vão por HTTPS direto para a API (`POST /v1/core/certificados`, multipart), sem passar por nenhum outro lugar.
   - Não vale chat, recado, issue, e-mail, commit, anexo nem pasta compartilhada.
   - Até a F5, a empresa piloto usa o A1 só em homologação, enviado pela mesma tela.
2. **Validação na entrada**: a API abre o `.pfx` com a senha, confere se o CNPJ do certificado é o da filial e se ele está na validade, e grava só se tudo bater.
3. **Guarda**: o `.pfx` e a senha são cifrados com **AES-256-GCM** antes de entrar no banco, cada um com seu nonce e o `tenant_id` como dado associado. A chave mestra fica **só** no secret do servidor (`MACUXIERP_CHAVE_A1`, no `.env` de produção, que só o Alexandre cria). Ela nunca vai para o banco, para o repositório nem para o log.
4. **Uso**: o worker decifra na memória na hora de assinar ou de abrir o mTLS e descarta em seguida. Nada é gravado em disco.
5. **Nunca volta**: a API não devolve o `.pfx` nem a senha. A tela mostra só o titular, o CNPJ, a validade e a impressão digital.
6. **Troca e vencimento**: o certificado novo substitui o antigo, que fica guardado e cifrado até o fim da guarda fiscal, para auditoria. Há alerta 30 dias antes do vencimento, e o certificado vencido bloqueia a emissão (RN-CORE-06).
7. **Rotação da chave mestra**: cada linha cifrada guarda a versão da chave. A troca recifra tudo por um script de manutenção, com o "aprovo" do Alexandre.

## Consequências
- Um vazamento do banco sozinho não expõe o A1. É preciso também a chave do servidor.
- Os testes usam um certificado de teste gerado na hora, autoassinado e com CNPJ fictício, nunca o real. A lista do `.gitguardian.yaml` só cresce para esses arquivos de teste.
