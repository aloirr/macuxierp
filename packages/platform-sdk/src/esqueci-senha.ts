/**
 * Contrato do "Esqueci a senha" (RN-CORE-13, T-0076): a apps/api, o modulo-core e a apps/web importam a mesma fonte
 * (regra 3: tipos só de Zod). Rotas em `CAMINHOS_ESQUECI_SENHA`:
 * - `POST /v1/auth/esqueci` (usuário do tenant, `PedirSenhaTemporariaEntrada`) e `POST /v1/plataforma/auth/esqueci`
 *   (superadmin do `/config`, `PedirSenhaTemporariaPlataformaEntrada`): sempre 202 `PedidoSenhaTemporariaResposta`,
 *   tenha ou não a conta; 429 `MuitasTentativasResposta` acima de `LIMITES_ESQUECI_SENHA`;
 * - `GET /v1/auth/esqueci/situacao` (`SituacaoEsqueciResposta`): sem os PROD_SMTP_* o "esqueci" fica indisponível e o
 *   web oculta o link.
 * A senha temporária vai só por e-mail (`emailSenhaTemporaria`), sem link nem token, e segue a regra de
 * `VALIDADE_SENHA_TEMPORARIA_HORAS`; o primeiro uso leva à troca obrigatória (`SenhaATrocarResposta`, `POST /v1/auth/senha`).
 * A 0048 grava em `plataforma.usuario` e `plataforma.superadmin`, nas colunas `senha_temporaria_hash` e
 * `senha_temporaria_expira_em`. Nunca vai para log, recado nem auditoria. Sem Node: serve à apps/web.
 */
import { z } from 'zod';
import { CODIGO_CONTA_BLOQUEADA, MENSAGEM_CONTA_BLOQUEADA, RECUPERAR_CONTA_BLOQUEADA } from './erros';
import { CODIGO_TROCAR_SENHA, MOTIVOS_TROCA_SENHA } from './eu';
import { DestinoLogin } from './login';
import { EmailUsuario, Instante } from './portal-config';
import { MODELO_HTML_SENHA_TEMPORARIA } from './email-senha-temporaria-html';
import { plural } from './texto';

/**
 * Pedido da senha temporária pela tela de login (RN-CORE-13): um pedido novo substitui a temporária anterior. A conta é
 * achada pelo e-mail (ADR 0021): usuário de empresa ou, sem ele, superadmin. `empresa`: opcional e ignorado (§6).
 */
export const PedirSenhaTemporariaEntrada = z.object({ empresa: z.unknown().optional(), email: EmailUsuario });
export type PedirSenhaTemporariaEntrada = z.infer<typeof PedirSenhaTemporariaEntrada>;

/** Pedido da senha temporária do superadmin (RN-CORE-13): um pedido novo substitui a temporária anterior. */
export const PedirSenhaTemporariaPlataformaEntrada = z.object({ email: EmailUsuario });
export type PedirSenhaTemporariaPlataformaEntrada = z.infer<typeof PedirSenhaTemporariaPlataformaEntrada>;

/** Confirmação neutra do BKO e do `/config` (ADR 0021, seção "Textos": travada pelo PO em 28/11/2026, exatamente assim). */
export const MENSAGEM_ESQUECI_NEUTRA = 'Se o e-mail estiver cadastrado, enviamos as instruções.';

/** Corpo do 202 das duas rotas do "esqueci" (RN-CORE-13): igual exista ou não a conta. */
export const PedidoSenhaTemporariaResposta = z.object({ mensagem: z.literal(MENSAGEM_ESQUECI_NEUTRA) });
export type PedidoSenhaTemporariaResposta = z.infer<typeof PedidoSenhaTemporariaResposta>;

/** `GET /v1/auth/esqueci/situacao`: `false` sem os PROD_SMTP_* (o web oculta o link). */
export const SituacaoEsqueciResposta = z.object({ esqueci_disponivel: z.boolean() });
export type SituacaoEsqueciResposta = z.infer<typeof SituacaoEsqueciResposta>;

export const CAMINHOS_ESQUECI_SENHA = Object.freeze({
  tenant: '/v1/auth/esqueci',
  plataforma: '/v1/plataforma/auth/esqueci',
  situacao: '/v1/auth/esqueci/situacao',
} as const);

/**
 * Validade da senha temporária (RN-CORE-13), em `senha_temporaria_expira_em`: vale em paralelo à senha atual, com uso
 * único, e cai ao vencer. Um pedido novo SUBSTITUI a temporária anterior (há uma coluna só) e recomeça o prazo.
 */
export const VALIDADE_SENHA_TEMPORARIA_HORAS = 72;

/** Rótulo do 1º campo da troca obrigatória quando o motivo é `temporaria` (o `rotuloAtual` do formulário). */
export const ROTULO_SENHA_TEMPORARIA = 'Senha temporária';

/**
 * Limite do "Esqueci a senha" (RN-CORE-13, hotfix v0.3.16.1): só o anti-spam por IP, 20 pedidos a cada 15 min. Não há
 * limite por conta: o pedido de recuperação nunca fica travado por tempo (pedido do Alexandre, 26/11 21h21).
 */
export const LIMITES_ESQUECI_SENHA = Object.freeze({
  por_ip: Object.freeze({ maximo: 20, janela_s: 900 } as const),
} as const);

/** Corpo do 429 (`erros.muitasTentativas(mensagem, retry_after_s)`): o envelope de `corpoErroApi`, com o prazo em `detalhes`. */
export const MuitasTentativasResposta = z.object({
  codigo: z.literal('MUITAS_TENTATIVAS'),
  mensagem: z.string().min(1),
  detalhes: z.object({ retry_after_s: z.number().int().min(1) }),
});
export type MuitasTentativasResposta = z.infer<typeof MuitasTentativasResposta>;

/** Texto do 429 na tela (docs/design/login-unico): `retry_after_s` em minutos, arredondado para cima. */
export function textoMuitasTentativas(retryAfterS: number): string {
  if (!Number.isInteger(retryAfterS) || retryAfterS < 1) throw new RangeError('textoMuitasTentativas: retry_after_s precisa ser inteiro ≥ 1');
  return `Muitas tentativas. Tente de novo em ${plural(Math.ceil(retryAfterS / 60), 'minuto', 'minutos')}.`;
}

/**
 * 403 da troca obrigatória (`CODIGO_TROCAR_SENHA`, T-0052), com o motivo (RN-CORE-13): `provisoria` (criada pelo admin)
 * ou `temporaria` (do "esqueci"; `expira_em` = fim das 72 h). `destino` (opcional, login único RN-CORE-12): `bko` leva a
 * `/senha` e `config` a `/config/senha`; ausente = o destino da rota que respondeu.
 */
export const SenhaATrocarResposta = z.object({
  codigo: z.literal(CODIGO_TROCAR_SENHA),
  mensagem: z.string().min(1),
  motivo: z.enum(MOTIVOS_TROCA_SENHA),
  expira_em: Instante.optional(),
  destino: DestinoLogin.optional(),
});
export type SenhaATrocarResposta = z.infer<typeof SenhaATrocarResposta>;

/** Corpo do 423 (`erros.contaBloqueada()`, T-0111): igual para qualquer e-mail e para o tenant e o superadmin. */
export const ContaBloqueadaResposta = z.object({
  codigo: z.literal(CODIGO_CONTA_BLOQUEADA),
  mensagem: z.literal(MENSAGEM_CONTA_BLOQUEADA),
  detalhes: z.object({ recuperar: z.literal(RECUPERAR_CONTA_BLOQUEADA) }),
});
export type ContaBloqueadaResposta = z.infer<typeof ContaBloqueadaResposta>;

/** Endereço do Macuxi ERP no e-mail (botão "Abrir o Macuxi ERP") e no rodapé. */
export const URL_MACUXI_ERP = 'https://erp.macuxifdv.com.br';
export const RODAPE_EMAIL_MACUXI_ERP = `Equipe Macuxi ERP · Boa Vista, RR · ${URL_MACUXI_ERP.replace('https://', '')}`;

/**
 * Rota da tela de login do BKO (a tela única, ADR 0018; o `CAMINHO_LOGIN` de `login.ts` é a rota da API). Login único
 * na raiz (v0.3.27, R-20261127-174120): a tela é "/" sem sessão; o `/login` segue no web só como 308 para "/".
 */
export const ROTA_TELA_LOGIN = '/';

/**
 * Link do botão "Abrir o Macuxi ERP" (44 B): a tela de login com o e-mail preenchido, no fragmento (`#email=…`). Desde
 * a ADR 0021 (§6) o login não pede a empresa, e o link não leva código nem token. LGPD: o fragmento não vai ao
 * servidor, nem ao log da Cloudflare, nem ao Referer. A senha nunca entra no link. Função pura.
 */
export function urlEntrarPreenchida(email: string): string;
/**
 * @deprecated Transição da v0.3.30 (ADR 0021 §6): o código é ignorado e o link leva só o e-mail. A forma com o código
 * sai quando a apps/web deixar de chamá-la (RD-2414).
 */
export function urlEntrarPreenchida(codigo_ignorado: string | null, email: string): string;
export function urlEntrarPreenchida(a: string | null, b?: string): string {
  const email = b ?? a ?? '';
  return `${URL_MACUXI_ERP}${ROTA_TELA_LOGIN}#${new URLSearchParams({ email }).toString()}`;
}

/** O que a tela de login preenche a partir do fragmento: só o e-mail, normalizado como no login (ADR 0021 §6). */
export const PreenchimentoLogin = z.object({ email: EmailUsuario.optional() });
export type PreenchimentoLogin = z.infer<typeof PreenchimentoLogin> & {
  /** @deprecated Sempre ausente (ADR 0021 §6): o `#codigo` de link antigo é ignorado. Sai com a apps/web (RD-2414). */
  codigo?: undefined;
};

/**
 * Lê o fragmento do link (`location.hash`, com ou sem o `#`): só o `email`, se válido (o inválido fica de fora, sem
 * erro); o `codigo` de link antigo e o resto são ignorados. A tela limpa o fragmento depois de ler
 * (`history.replaceState`), para o e-mail não ficar no histórico. Função pura.
 */
export function lerPreenchimentoLogin(hash: string): PreenchimentoLogin {
  const email = EmailUsuario.safeParse(new URLSearchParams(hash.replace(/^#/, '')).get('email') ?? '');
  return email.success ? { email: email.data } : {};
}

export interface EmailSenhaTemporaria {
  assunto: string;
  /** Parte `text/plain` (o `email.txt` do design). */
  texto: string;
  /** Parte `text/html` (o `email.html` do design, `MODELO_HTML_SENHA_TEMPORARIA`), com os campos escapados. */
  html: string;
}

/** Escape de texto e atributo HTML (`& < > " '`), antes da troca do placeholder (regra do README do design). */
const escaparHtml = (v: string): string => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * As duas linhas do cartão de dados com o código da empresa no `MODELO_HTML_SENHA_TEMPORARIA` (rótulo e valor), que
 * saem sempre do HTML (ADR 0021 §6, RD-2403). A cópia do design (`docs/design/emails/redefinir-senha/email.html`) muda
 * com o designer-ux; então este recorte deixa de achar nada e sai (o teste do SDK avisa).
 */
const LINHAS_CODIGO_EMPRESA_HTML =
  /\n {4}<tr><td class="mx-rotulo"[^\n]*>Código da empresa<\/td><\/tr>\n {4}<tr><td class="mx-valor"[^\n]*>\{\{codigo_empresa\}\}<\/td><\/tr>/;

/**
 * E-mail da senha temporária (RN-CORE-13; T-0111): fonte única, com os textos exatos do design
 * (`docs/design/emails/redefinir-senha/`, #705), em texto e HTML (multipart). Leva o e-mail da conta (o próprio
 * destinatário), a senha e o botão; diz que ela também desbloqueia a conta (RN-CORE-15). Sem nome do destinatário e,
 * desde a ADR 0021 (§6), sem o código da empresa. Função pura.
 */
export function emailSenhaTemporaria(e: { senha: string; validade_horas: number; email: string }): EmailSenhaTemporaria {
  if (e.senha.trim() === '' || /[\r\n]/.test(e.senha)) throw new RangeError('emailSenhaTemporaria: senha vazia ou com quebra de linha');
  if (!Number.isInteger(e.validade_horas) || e.validade_horas < 1) throw new RangeError('emailSenhaTemporaria: validade_horas precisa ser inteiro ≥ 1');
  if (e.email.trim() === '') throw new RangeError('emailSenhaTemporaria: o e-mail é obrigatório');
  const assunto = 'Sua senha temporária do Macuxi ERP';
  const email = e.email.trim();
  const campos = { email, senha_temporaria: e.senha, url_entrar: urlEntrarPreenchida(email) };
  const aviso = `Vale por ${e.validade_horas} horas e serve para entrar uma vez só. Ela também desbloqueia a conta.`;
  const texto = [
    'Sua senha temporária',
    '',
    'Recebemos um pedido de senha temporária para entrar no Macuxi ERP. Se não foi você, ignore este e-mail.',
    '',
    `E-mail: ${campos.email}`,
    `Senha temporária: ${campos.senha_temporaria}`,
    '',
    aviso,
    '',
    `Abrir o Macuxi ERP: ${campos.url_entrar}`,
    '',
    '--',
    RODAPE_EMAIL_MACUXI_ERP,
  ].join('\n');
  // Troca simples de texto, só depois do escape; nenhum outro campo entra no modelo (README do design).
  const valores: Record<string, string> = { assunto, ...campos };
  const html = MODELO_HTML_SENHA_TEMPORARIA.replace(LINHAS_CODIGO_EMPRESA_HTML, '')
    .replace(/\{\{(assunto|email|senha_temporaria|url_entrar)\}\}/g, (_m, k: string) => escaparHtml(valores[k]!))
    .replace('Vale por 72 horas e serve para entrar uma vez só. Ela também desbloqueia a conta.', escaparHtml(aviso))
    .replace('Vale por 72 horas.', `Vale por ${e.validade_horas} horas.`);
  return { assunto, texto, html };
}
