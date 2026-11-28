# E-mail "Esqueci a senha" (senha temporária) — Macuxi ERP

> T-0111 · v0.3.16 · autor: designer-ux · 26/11/2026 (Manaus).
> Modelo visual: simulação aprovada `senha-bloqueio-2511/email-erp.png`, com as duas correções abaixo. Marca: [assinatura-erp.md](../../../marca/assinatura-erp.md). Cores: `packages/ui/src/tokens.ts`, escritas em hex (e-mail não lê CSS var).

## Arquivos
| Arquivo | Para quê |
|---|---|
| `email.html` | Modelo HTML (tabelas e CSS inline, até 600 px, legível em 390 px). Um arquivo só: claro por padrão, escuro por `@media (prefers-color-scheme: dark)` e `<meta name="color-scheme" content="light dark">`. |
| `email.txt` | Versão em texto puro (parte `text/plain` do mesmo e-mail). |
| `logo-macuxi-erp-positivo.png` | Logo A positivo, 372 × 80 px (exibido em 186 × 40 px, acima do mínimo de 32 px do manual para o "ERP" ser lido; o FDV usa 139 × 30). |
| `logo-macuxi-erp-negativo-azul-noite.png` | Logo A negativo azul-noite, mesmo tamanho, para o modo escuro (fundo `azulNoite` #1E3350). |
| `preview-1280-claro.png`, `preview-1280-escuro.png`, `preview-390-claro.png`, `preview-390-escuro.png` | Prévias com os exemplos fictícios. |

## Decisões
- **Logo uma vez só.** Duas imagens se alternam (`mx-claro` e `mx-escuro`); nunca aparecem juntas. Sem CSS (cliente que ignora `@media`), só o claro aparece.
- **Logo é PNG hospedado.** E-mail não carrega SVG de forma confiável. Os PNGs vêm do SVG oficial (`docs/marca/ativos/2026-11-22-v1/macuxi-erp-a-positivo.svg` e `-a-negativo-azul-noite.svg`), renderizados com o Chromium em 2x, fundo transparente. O `alt="Macuxi ERP"` é o texto de reserva quando a imagem não carrega.
  **Pendência:** quem liga o envio (engenheiro-software) precisa servir estes dois PNGs em `https://erp.macuxifdv.com.br/email/logo-macuxi-erp-positivo.png` e `.../logo-macuxi-erp-negativo-azul-noite.png` (os endereços já estão no HTML). Sem hospedagem, o e-mail sai com o `alt`.
- **Rodapé com o domínio do ERP** (`erp.macuxifdv.com.br`). O manual não manda usar `macuxifdv.com.br`.
- **Modo escuro** (mesmas cores do e-mail do FDV `depois-backoffice.html`): fundo e folha #1E3350, título e valores #FFFFFF, texto e rótulos #C9CED5, cartão e borda #3A4D68, filete #C9CED5, botão #FFFFFF com texto #1E3350. Estrutura e classes `mx-*` (`mx-claro`/`mx-escuro` para os dois logos) seguem o FDV.
- **Senha selecionável inteira:** texto puro num único bloco, com `user-select: all` (um toque seleciona tudo). Não separar em partes nem usar imagem.
- **Sem código da empresa (T-0133, v0.3.30):** a empresa some de qualquer tela; o e-mail mostra só e-mail e senha, e o link abre o login já com o e-mail (`/#email=…`). Nenhum prefixo "Erro.", "Aviso." ou "Pronto." nos textos (decisão 125 B).
  **Pendência:** as prévias PNG ainda mostram a linha antiga; regerar na próxima passada com Chromium.
- Sem dado real: os exemplos são fictícios (`EXEMPLO`, `ana.souza@exemplo.com.br`, `Tr4m-Qa7p-Zx2k`).

## Textos exatos (o core copia sem alterar, em `modules/core/domain`)
| Item | String |
|---|---|
| Assunto | `Sua senha temporária do Macuxi ERP` |
| Título | `Sua senha temporária` |
| Abertura | `Recebemos um pedido de senha temporária para entrar no Macuxi ERP. Se não foi você, ignore este e-mail.` |
| Rótulo 1 | `E-mail` |
| Rótulo 2 | `Senha temporária` |
| Aviso | `Vale por 72 horas e serve para entrar uma vez só. Ela também desbloqueia a conta.` |
| Botão | `Abrir o Macuxi ERP` |
| URL do botão | `https://erp.macuxifdv.com.br/#email=<e-mail>` (e-mail codificado com `encodeURIComponent`) |
| Assinatura | `Equipe Macuxi ERP · Boa Vista, RR · erp.macuxifdv.com.br` |
| Alt do logo | `Macuxi ERP` |
| Pré-cabeçalho | `Sua senha temporária para entrar no Macuxi ERP. Vale por 72 horas.` |

## Placeholders (o envio preenche)
| Placeholder | Exemplo | Regra |
|---|---|---|
| `{{assunto}}` | `Sua senha temporária do Macuxi ERP` | Texto fixo do core; vai também no `<title>`. Escape HTML. |
| `{{email}}` | `ana.souza@exemplo.com.br` | Escape HTML. É o e-mail de login do usuário. |
| `{{senha_temporaria}}` | `Tr4m-Qa7p-Zx2k` | Escape HTML, mas o alfabeto do gerador não deve conter `& < > " '`; sem espaços nas pontas; **sem quebra de linha**. Em texto puro, sem escape. |
| `{{url_entrar}}` | `https://erp.macuxifdv.com.br/#email=ana.souza%40exemplo.com.br` | Só `https://`, vinda de configuração do envio (nunca de entrada do usuário). Escape de atributo HTML (`"` e `&`). No `.txt`, sem escape. |

Regras gerais:
- Trocar cada placeholder por substituição de texto simples, só depois do escape. Nenhum outro campo entra no modelo.
- **Remetente:** a cargo de quem liga o envio (engenheiro-software, `apps/api/src/email/envio-apos-resposta.ts`).
- **Nada de dado pessoal em log:** não registrar o corpo do e-mail, nem `{{email}}`, nem `{{senha_temporaria}}`. Logar só o id do envio e o resultado.
- Enviar sempre as duas partes (`text/plain` e `text/html`) do mesmo conteúdo.

## Como gerar as prévias
Chromium com a mídia `prefers-color-scheme` emulada (claro e escuro), larguras 1280 e 390, placeholders trocados pelos exemplos e o caminho dos logos apontando para os PNGs desta pasta.
