# Módulo core (T-0006)

Empresa, usuários, perfis, licenças (só leitura), certificado A1, ambiente fiscal, auditoria, exportação LGPD e parâmetros.
Fontes: `docs/desenho/T-0002.md` (seção 3), ADR 0002, ADR 0005, RN-CORE-01..08 (doc 03).

## Estrutura
- `modules/core/contracts`: Zod de tudo que cruza a fronteira (rotas e payloads dos eventos).
- `modules/core/domain`: regras puras com teste por RN (`certificado` RN-CORE-06 e RF-CORE-04; `ambiente` RN-CORE-08; `usuarios` RN-CORE-01; sem módulo do Node: a regra do repositório de fronteiras).
- `modules/core/api`: `criarPluginCore(deps)` (rotas em `/v1/core`), `RepositorioCoreSql`, `LeitorPfxTls`, a cifra AES-256-GCM do A1 (`api/cifra.ts`, ADR 0005, que usa `node:crypto`) e `RepositorioCoreMemoria` (testes).
- `modules/core/web`: páginas do BKO em dados (menu, permissão, filtros na URL, colunas, CSV) e o cliente tipado. O shell (T-0005) renderiza.

## Como a API monta o plugin
`apps/api` troca a linha do core em `modulos.ts` por `criarPluginCore({ repo: new RepositorioCoreSql(), hashSenha, leitorPfx: new LeitorPfxTls(), chaveA1: lerChaveA1(process.env.MACUXIERP_CHAVE_A1), armazenamento })`. O `hashSenha` é o argon2id da plataforma.

## Decisões e premissas
- `POST /certificados` recebe multipart (`filial_id` e `senha` como texto, o `.pfx` em `arquivo`); a API barra acima de 50 KB com 413.
- Concorrência: o `PATCH` usa `updated_at` no corpo como token (o SDK não entrega cabeçalhos à rota); o `GET` já devolve o `ETag`.
- O CNPJ da empresa não muda por `PATCH /empresa` (ele amarra a raiz do A1, D4).
- RN-CORE-01 também cobre "o tenant não fica sem administrador ativo".
- O core publica os quatro eventos do catálogo (`empresa`, `usuario`, `certificado`, `ambiente_fiscal`); `versao` do envelope = ms UTC da alteração.
- A auditoria do usuário não leva nome nem e-mail; a do certificado, só CNPJ, validade e impressão digital.
- A filial é um UUID opaco (D4): o core não confere se ela existe em `cadastros`.

## T-0087 — telas de Usuários, Perfis e permissões, Licenças e Auditoria (RF-CORE-02/03/05)
- Só o administrador da empresa (RN-CORE-09): `GET /v1/core/perfis` passou a exigir `core.usuario.gerir` (os outros perfis recebem 403) e a página "Perfis e permissões" some do menu dos demais. O `core` é módulo base: sem linha de licença o administrador ainda entra.
- Listas por descritor do SDK em `modules/core/web/listas.ts` (`paginaUsuarios`, `paginaLicencas`, `paginaAuditoria`): filtros na URL, cursor por id, limite até 200, CSV em `/usuarios/exportar`, `/licencas/exportar` e `/auditoria/exportar`.
- Auditoria: novo filtro `usuario_id`; a lista e o CSV não levam `antes`/`depois` (minimização LGPD); mostra só o id do autor.
- Prints de conferência (1280 e 390, dados fictícios) em `docs/modulos/core/prints/T-0087/`: pré-visualização montada a partir dos descritores e das linhas do módulo; o renderizador do BKO (`apps/web`) é do `engenheiro-apps`, que registra as telas em `apps/web/src/lib/telas/`.
