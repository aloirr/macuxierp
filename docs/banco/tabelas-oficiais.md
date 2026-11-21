# Tabelas oficiais (D9, RF-CAD-10)

> Dono: `banco-dados`. Carga: `db/src/oficiais.ts`, a partir de `db/tabelas-fiscais/fontes.json`. Primeira carga na T-0003 (21/11/2026, horário de Manaus).

## Como funciona
- Cada **carga** (`fontes.json`) diz a tabela, a versão, o CSV, a chave, a **fonte**, a **URL oficial**, a **data de referência**, o **sha256** e o nº de **registros**. A carga confere o sha256 e a contagem antes de gravar e roda numa transação, uma vez por (carga, versão), registrada em `cadastros.tabela_oficial_versao`.
- Cada linha das tabelas oficiais aponta para a versão que a trouxe (`versao_id`). Versão nova: atualiza o código que continua, insere o novo e **fecha** (`vigencia_fim` = data de referência) o que sumiu; nada é apagado (nota antiga continua achando o código).
- Quando a fonte traz a vigência (CST e cClassTrib do IBS/CBS), ela vai no CSV; senão, `vigencia_inicio` = data de referência da primeira versão que trouxe o código.
- O `pnpm --filter @macuxierp/db migrar` roda a carga depois das migrações. CSV publicado é imutável: versão nova = arquivo novo + carga nova.

## Primeira carga
Fonte oficial, URL, data de referência, sha256 e nº de registros de cada carga ficam no `db/tabelas-fiscais/fontes.json`, que é a fonte da verdade (a carga confere o arquivo contra ele, e o teste também). Aqui fica só o que o `fontes.json` não diz:

| Carga | Como chegou ao repositório |
|---|---|
| `uf` | cópia do pacote npm `@br-validators/core` 1.10.0-data.46 (MIT) |
| `municipio` | `github.com/kelvins/municipios-brasileiros` (`csv/municipios.csv`); dígito verificador conferido no teste |
| `ncm` | `@br-validators/core` |
| `cest` e `cest-ncm` | `@br-validators/core` |
| `cfop` | `@br-validators/core` |
| `cst-tradicionais` | ICMS transcrito; o resto de `@br-validators/core` |
| `cst-ibs-cbs` | pacote npm `@sinete/ibs-cbs-dados` 2026.9.3 |
| `classificacao-tributaria` | `@sinete/ibs-cbs-dados` |

**Por que por cópia:** a sessão da nuvem não alcança os sites oficiais (o proxy recusa IBGE, Siscomex e Portal da NF-e; ADR 0002). Os arquivos foram lidos como **dados** (JSON e CSV, sem executar código dos pacotes), convertidos para CSV e conferidos (formato dos códigos, contagens, sem código repetido e o dígito verificador do IBGE, com só as 9 exceções conhecidas do próprio IBGE).

## Pendências
1. **Conferir com a fonte oficial** (municípios, NCM, CEST e CFOP) numa máquina que alcance os sites (a VM ou a do Alexandre) e, se houver diferença, publicar uma versão nova pelo fluxo acima. Até lá, a fonte registrada em `tabela_oficial_versao.fonte` diz de onde veio a cópia.
2. **Rotina de atualização** (NCM do Siscomex, cClassTrib a cada IT nova): script que baixa da fonte oficial, gera o CSV e a carga no `fontes.json`. Fica para quando houver acesso às fontes a partir do worker ou da VM.
3. **IBPT** (carga aproximada) é do módulo fiscal (F3), fora desta carga.
