# ADR 0003 — Deploy na VM do FDV: serviço próprio, imagens próprias e trava compartilhada

- **Status:** aceita na parte de desenho; a implementação é a T-0024 (engenheiro-software)
- **Data:** 21/11/2026
- **Dono:** engenheiro-software
- **Base:** prompt de abertura, seção 3 (mesma VM, mesmo proxy, `erp.macuxifdv.com.br`, mesmo grupo de concorrência `producao-vm`)

## Contexto
O ERP roda na **mesma VM de produção** do FDV, atrás do **mesmo proxy** (o túnel do Cloudflare do FDV), com o mesmo fluxo de deploy (liberar → aprovar → publicar) e o mesmo grupo de concorrência `producao-vm`, para os dois nunca publicarem ao mesmo tempo.

**Achado:** no GitHub Actions o grupo de `concurrency` vale **só dentro de um repositório**. O `producao-vm` do `aloirr/macuxierp` e o `producao-vm` do `aloirr/macuxifdv` são grupos diferentes. O nome igual sozinho **não** impede os dois deploys ao mesmo tempo.

## Decisão
1. **Mesmo nome de grupo** (`producao-vm`) nos dois repositórios: ele serializa as publicações dentro de cada repositório, como pedido.
2. **Trava na própria VM**, que é o único ponto comum aos dois: o `implantar.sh` do ERP pega `flock -w 1800 /var/lock/macuxi-producao-vm.lock` antes de qualquer `docker compose` e solta no fim. Se não conseguir em 30 min, sai com erro e não publica.
   - Para a trava valer **nos dois sentidos**, o `implantar.sh` do FDV precisa pegar o mesmo arquivo. Essa mudança é no repositório do FDV, que este time não altera: vai como pedido do Alexandre ao time do FDV.
   - Enquanto o FDV não tiver a trava, o gerente do ERP só aprova "aprovado vX.Y.Z" do ERP sem deploy do FDV em andamento. Ele confere pelo `gh run list -R aloirr/macuxifdv --workflow producao-publicar.yml`.
3. **Serviço próprio na VM**: pasta `/opt/macuxierp`, projeto Compose `macuxierp`, contêineres `api`, `worker` e `web` do ERP, `.env` próprio (modo 600). Nada do ERP fica em `/opt/macuxi`, e nada do FDV fica em `/opt/macuxierp`.
4. **Imagens próprias no GHCR**: `ghcr.io/aloirr/macuxierp-api` e `ghcr.io/aloirr/macuxierp-web-prod`. Nunca `macuxi-api` nem `macuxi-bko-prod`, que são do FDV. Mesmo dono no GHCR, nomes diferentes.
5. **Mesmo proxy**: o túnel do Cloudflare do FDV ganha a rota `erp.macuxifdv.com.br`, com `/v1` para a `api` do ERP e o resto para o `web` do ERP. Os contêineres do ERP entram na rede Docker do túnel como rede externa, só com os nomes `macuxierp-api` e `macuxierp-web`. A rota no painel do Cloudflare e o DNS são do Alexandre.
6. **Banco**: o mesmo servidor (DBaaS) do FDV, banco `macuxierp`, papéis `macuxierp_app`, `macuxierp_worker` e `macuxierp_leitura`. As migrações rodam com o admin do DBaaS, sem superusuário, pelo mesmo cuidado do FDV.
7. **Arquivos**: o mesmo S3 do FDV, com o prefixo `macuxierp/<tenant>/`. O XML autorizado entra no backup e no ensaio de restauração do FDV.

## Estado na F0
- Os workflows `producao-liberar`, `producao-aprovar` e `producao-publicar` foram copiados do FDV com os nomes do ERP.
- O publicar tem o passo "implantação do ERP pronta", que **fica vermelho** enquanto `scripts/deploy/producao/implantar.sh` não existir. Assim nada é publicado pela metade.
- A T-0024 entrega os itens que faltam: Dockerfiles de `apps/api` e `apps/web`, `compose.yml`, `implantar.sh` com a trava, `preparar-vm.sh`, `env.modelo` e `alerta-saude.sh`.

## Consequências
- O primeiro deploy do ERP depende de três coisas: a T-0024, o `.env` de produção criado pelo Alexandre (banco `macuxierp`, chave do A1, S3, SMTP) e a rota `erp.` no túnel.
- Rodar dois serviços na mesma VM divide CPU e memória. A T-0024 mede o consumo e põe limites (`mem_limit`) nos contêineres do ERP, para não derrubar o FDV.
