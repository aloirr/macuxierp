/**
 * Regra única de senha do ERP, alinhada à RN-CORE-32 do Macuxi FDV: "no mínimo 8 caracteres, com pelo menos uma letra,
 * um número e um caractere especial; vale na criação e na troca; senhas já gravadas continuam valendo" (T-0052;
 * Alexandre, 23/11 10h01 de Manaus: "padrão para todo o ERP"). Vale para toda senha NOVA (usuário do tenant e
 * superadmin do portal `/config`); a regra não é conferida no login. Ids e textos iguais aos do FDV.
 *
 * - letra: `\p{L}` (qualquer letra Unicode, com acento: "ç", "ã" contam);
 * - número: só os dígitos ASCII `0-9` (escolha da T-0052: previsível e igual ao que o teclado mostra; "²" ou "½" não
 *   contam como número e, por não serem letra nem espaço, contam como especial);
 * - especial: qualquer caractere que não seja letra, número (0-9) nem espaço em branco (`\s`).
 *
 * Sem Node: serve à apps/web (checklist da tela) e à apps/api (revalidação e o 400 `VALIDACAO`).
 * A senha nunca vai para log, recado nem auditoria.
 */
import { z } from 'zod';

export const SENHA_MINIMA = 8;
export const SENHA_MAXIMA = 200;

export type RegraSenhaId = 'caracteres' | 'letra' | 'numero' | 'especial';
export interface RegraSenha {
  readonly id: RegraSenhaId;
  readonly texto: string;
}

const LETRA = /\p{L}/u;
const NUMERO = /[0-9]/;
const ESPECIAL = /[^\p{L}0-9\s]/u;

const CUMPRE: Readonly<Record<RegraSenhaId, (senha: string) => boolean>> = {
  caracteres: (s) => s.length >= SENHA_MINIMA,
  letra: (s) => LETRA.test(s),
  numero: (s) => NUMERO.test(s),
  especial: (s) => ESPECIAL.test(s),
};

/** As regras na ordem em que a tela mostra e a API devolve. */
export const REGRAS_SENHA: readonly RegraSenha[] = Object.freeze(
  [
    { id: 'caracteres', texto: `${SENHA_MINIMA} caracteres ou mais` },
    { id: 'letra', texto: 'Uma letra' },
    { id: 'numero', texto: 'Um número' },
    { id: 'especial', texto: 'Um caractere especial' },
  ].map((r) => Object.freeze(r as RegraSenha)),
);

/** Textos da tela (checklist e campo de senha), iguais aos do FDV. */
export const TITULO_REGRAS_SENHA = 'A senha precisa ter';
export const MENSAGEM_SENHA_OK = 'A senha atende às regras.';
export const EXEMPLO_ESPECIAIS = '! @ # $';
export const ROTULOS_OLHO_SENHA = Object.freeze({ mostrar: 'Mostrar senha', ocultar: 'Ocultar senha' } as const);

export const MENSAGEM_SENHA_FORA_DA_REGRA = 'A senha não atende às regras';
export const MENSAGEM_SENHA_IGUAL = 'A senha nova precisa ser diferente da atual';
/** Texto da marca para o 400 com `campos.senha_atual` (POST /v1/auth/senha e troca do superadmin). */
export const MENSAGEM_SENHA_ATUAL_INCORRETA = 'Senha atual incorreta. Confira e digite de novo.';

/** Ids das regras que a senha descumpre, na ordem de `REGRAS_SENHA` (vazio = senha válida). Função pura. */
export function regrasDescumpridas(senha: string): RegraSenhaId[] {
  return REGRAS_SENHA.filter((r) => !CUMPRE[r.id](senha)).map((r) => r.id);
}

/** Senha nova: até `SENHA_MAXIMA` e um issue por regra descumprida (mensagem = texto, `params.regra` = id). */
export const SenhaNova = z
  .string()
  .max(SENHA_MAXIMA)
  .superRefine((senha, ctx) => {
    for (const r of REGRAS_SENHA) {
      if (!CUMPRE[r.id](senha)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.texto, params: { regra: r.id } });
    }
  });

/** Senha informada (login e senha atual na troca): só 1–`SENHA_MAXIMA`, sem a regra (senhas já gravadas valem). */
export const SenhaInformada = z.string().min(1).max(SENHA_MAXIMA);

export interface ErroSenhaForaDaRegra {
  mensagem: string;
  campo: 'senha_nova';
  texto: string;
  detalhes: RegraSenhaId[];
}

/**
 * Dados do 400 `{ codigo: 'VALIDACAO', mensagem, campos: { senha_nova: texto }, detalhes }` da API, sem repetir regra;
 * `null` quando a senha cumpre todas. Função pura.
 */
export function erroSenhaForaDaRegra(senha: string): ErroSenhaForaDaRegra | null {
  const detalhes = regrasDescumpridas(senha);
  if (detalhes.length === 0) return null;
  const texto = REGRAS_SENHA.filter((r) => detalhes.includes(r.id))
    .map((r) => r.texto)
    .join('; ');
  return { mensagem: MENSAGEM_SENHA_FORA_DA_REGRA, campo: 'senha_nova', texto, detalhes };
}
