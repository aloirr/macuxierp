# Login único (T-0076)

Uma tela só de entrada, no molde do login do Macuxi FDV, para empresa e superadmin. Cartão central do ERP (`.cartao-central`, C negativa sobre azul-noite, 100 px), só tokens de `packages/ui`. Base: `docs/design/portal-config.md` (tela 1) e `apps/web/src/app/login/`. Sem código em `packages/ui`.

**Premissa:** o repositório do FDV não está acessível (guardião); o desenho segue o resumo de decisões do Alexandre e do PO (R-T-0076), não o código do FDV.

## O que sai (o código é do `engenheiro-apps`)
- O link "Sou de uma empresa" e a rota `/config/entrar` (`apps/web/src/app/config/entrar/`). O superadmin entra aqui, com o código de empresa **MACUXI**. O código MACUXI não aparece em ajuda, placeholder nem texto da tela.
- O texto de `portal-config.md` §1 ("Sem esqueci a senha", "Sou de uma empresa") fica superado por este documento (atualização do `portal-config.md` a pedido do gerente).

## Anatomia (de cima para baixo)
1. Faixa de marca (C negativa, azul-noite) e título **Acesse sua conta**.
2. Região de erro de login (`.erro`), só quando há erro.
3. **Código da empresa**. Aceita só letras, números e hífen; sem diferença de maiúscula.
4. **E-mail** (`type="email"`, `autocomplete="username"`).
5. **Senha**, com o botão do olho (ícone de olho, como no FDV; `aria-label` "Mostrar senha" / "Ocultar senha", `aria-pressed`; não é botão de texto). O olho existe só aqui.
6. Botão principal **Entrar**.
7. Link **Esqueci a senha**, abaixo do botão.

Prints: `login-1280x800.png` (vazio), `login-390x800.png` (código lembrado).

## Memória do navegador
Só o código da empresa fica salvo (preferência local, nunca cookie de sessão). E-mail e senha nunca (`autocomplete` do navegador à parte). Sem dado pessoal em log.

## Estados e textos exatos
| Estado | Tela |
|---|---|
| Vazio | três campos vazios |
| Código lembrado | Código preenchido |
| Carregando | botão desabilitado com o texto "Entrando…"; campos mantêm os valores |
| Erro de campo | texto vermelho embaixo do campo (`.erro-campo`), borda vermelha; vazio: "Informe o código da empresa." / "Informe o e-mail." / "Informe a senha."; código inválido: "Use só letras, números e hífen."; e-mail inválido: "E-mail inválido. Confira o endereço." |
| Erro de login | região `.erro`: **Empresa, e-mail ou senha incorretos.** Neutra: nunca diz qual campo, nem se a conta está travada ou a empresa suspensa |
| 429 | **Muitas tentativas. Tente de novo em N minutos.** (N vem da API, em minutos inteiros; 1 vira "em 1 minuto") |
| Serviço indisponível | "Serviço indisponível no momento. Tente de novo em instantes." |

Prints: erro de login `login-erro-1280x800.png`; 429 `login-429-1280x800.png`.

## Foco e teclado
- Enter em qualquer campo envia. Tab segue a ordem da anatomia; o olho entra na ordem, depois Entrar e o link.
- Ao abrir: foco no primeiro campo vazio (Código, ou E-mail se o código foi lembrado).
- Após erro de login: foco na Senha, já limpa; Código e E-mail mantêm o valor.
- Após erro de campo: foco no primeiro campo com erro. Cada erro é ligado ao campo por `aria-describedby` e `aria-invalid`.
- Erro de login e 429 na região `.erro` com `role="alert"` (anunciada uma vez). Carregando: `aria-busy` no formulário.

## Esqueci a senha (mesma tela)
O link troca o conteúdo do cartão (sem nova rota de redefinição; não existe tela por link). Título **Esqueci a senha**; campos **Código da empresa** (preenchido se lembrado) e **E-mail**; botão **Enviar senha temporária**; link **Voltar ao login** (devolve o foco ao link "Esqueci a senha").
- **Confirmação, sempre igual e neutra** (`role="status"`, o formulário some, fica "Voltar ao login"): "Se o e-mail estiver cadastrado nesta empresa, você vai receber uma senha temporária em alguns minutos. Ela vale por 72 horas." Vale também para empresa ou e-mail inexistente.
- **429:** como no login, formulário mantido.
- Erros de campo, como no login.
- **Link oculto** quando o e-mail da plataforma não está configurado: "Esqueci a senha" não é renderizado (nem desabilitado, nem com aviso). Sem o link, nada muda no resto do cartão. O estado vem de uma configuração do servidor lida pela tela (a definir no contrato pelo engenheiro).
- Foco: ao abrir o painel, no primeiro campo vazio; na confirmação, no texto de confirmação.

Prints: `esqueci-1280x800.png`, `esqueci-confirmacao-390x800.png`.

## Do login à troca de senha
Senha temporária entra normalmente e a API responde 403 `SENHA_A_TROCAR`; a web leva à tela de troca obrigatória que já existe (`/senha`, `apps/web/src/app/senha/page.tsx`; superadmin: `/config/senha`). Ver `apps/web/src/app/senha/page.tsx` e `components/formulario-troca-senha.tsx`.

**Pendências para o gerente decidir (tela não alterada):**
1. O título da tela é "Trocar senha" (`senha/page.tsx:16`), não "Crie sua senha". Sugestão: manter; o aviso já explica.
2. O rótulo do primeiro campo é "Senha atual" (`formulario-troca-senha.tsx:15`); após o "Esqueci a senha" o melhor seria "Senha temporária" (o componente já aceita `rotuloAtual`).
3. O login atual (`app/login/formulario.tsx`) usa o rótulo "Empresa", sem ajuda nem memória do código, e junta tudo no texto "Dados inválidos. Confira empresa, e-mail e senha." para erro de campo; passa a seguir esta especificação.
4. Conferir `/config/senha`: o portal pede 14 caracteres (`portal-config.md` §1); o superadmin com o login único e a temporária continua nessa regra (não é a de 8).

## IDs reservados
RD-1311 a RD-1313.
