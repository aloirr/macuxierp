/**
 * Senha temporária do "Esqueci a senha" (T-0076, molde do FDV), comum ao tenant e ao superadmin:
 * - gerada com `crypto.randomInt` (CSPRNG), com o alfabeto e o tamanho da senha provisória do operador.sh (16 caracteres,
 *   um de cada classe, sem 0/O, 1/l/I); só o hash argon2id (`gerarHashSenha`) vai ao banco; nunca vai a log nem à resposta;
 * - vale por `VALIDADE_SENHA_TEMPORARIA_HORAS` (72 h, contrato `esqueci-senha.ts` do SDK), com o `expiraEm` e o `temporariaValida`
 *   do core (RN-CORE-13, `@macuxierp/core/api`), é de uso único (o consumo zera as duas colunas) e corre em paralelo à senha
 *   atual, que vale até a troca; um pedido novo substitui o anterior;
 * - a entrega é pela porta de e-mail (`email/porta.ts`), agendada só depois da resposta neutra (`agendarEnvioEmail`);
 * - a sessão aberta por ela leva a marca `t<segundos UTC do fim>` num segmento do refresh do tenant e do token do `/config`.
 */
import { randomInt } from 'node:crypto';
import { expiraEm, temporariaValida } from '@macuxierp/core/api';
import { emailSenhaTemporaria, VALIDADE_SENHA_TEMPORARIA_HORAS } from '@macuxierp/platform-sdk';
import type { MensagemEmail } from '../email/porta';
import { conferirSenha, gerarHashSenha, type ParametrosArgon2 } from './senha';
import type { TrocaPendente } from './troca-senha';

// Mesmas classes do gerador do scripts/deploy/producao/operador.sh e de modules/core/domain/usuarios.ts (o teste trava).
const MAIUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnopqrstuvwxyz';
const DIGITOS = '23456789';
const SIMBOLOS = '!@#%+=?';
export const CLASSES_TEMPORARIA = [MAIUSCULAS, MINUSCULAS, DIGITOS, SIMBOLOS] as const;
const ALFABETO = CLASSES_TEMPORARIA.join('');
export const TAMANHO_TEMPORARIA = 16;

const sortear = (alfabeto: string): string => alfabeto[randomInt(alfabeto.length)]!;

/** Um de cada classe, o resto do alfabeto inteiro e Fisher-Yates, como o `gerar_senha` do operador.sh. */
export function gerarSenhaTemporaria(): string {
  const c = [...CLASSES_TEMPORARIA.map(sortear), ...Array.from({ length: TAMANHO_TEMPORARIA - CLASSES_TEMPORARIA.length }, () => sortear(ALFABETO))];
  for (let i = c.length - 1; i > 0; i--) {
    const k = randomInt(i + 1);
    [c[i], c[k]] = [c[k]!, c[i]!];
  }
  return c.join('');
}

/** Uma temporária nova (pedido do "esqueci", tenant e superadmin): a senha em claro (só para o e-mail), o hash argon2id e o fim da validade (RN-CORE-13). */
export async function emitirTemporaria(argon2: ParametrosArgon2, agora: Date): Promise<{ senha: string; hash: string; expira_em: Date }> {
  const senha = gerarSenhaTemporaria();
  return { senha, hash: await gerarHashSenha(senha, argon2), expira_em: expiraEm(agora, VALIDADE_SENHA_TEMPORARIA_HORAS) };
}

/**
 * O custo de argon2 de um pedido com o e-mail desligado: emite e descarta uma temporária, como o pedido de verdade, para
 * o 202 neutro demorar o mesmo (nada vai ao banco nem ao e-mail).
 */
export async function custoTemporariaDescartada(argon2: ParametrosArgon2): Promise<null> {
  await emitirTemporaria(argon2, new Date());
  return null;
}

/**
 * A senha informada é a temporária vigente? Devolve o fim dela (o `expira_em` do 403 `TROCAR_SENHA`) ou `null` (sem
 * temporária, vencida ou errada). O banco revalida no consumo atômico.
 */
export async function conferirTemporaria(senha: string, hash: string | null | undefined, fim: Date | null | undefined, agora: Date): Promise<Date | null> {
  if (!hash || !fim || !temporariaValida(fim, agora)) return null;
  return (await conferirSenha(senha, hash)) ? fim : null;
}

const MARCA_TEMPORARIA = /^t(\d{1,12})$/;

/**
 * O segmento da sessão de motivo 'temporaria' (`t<segundos UTC do fim>`), ou `null` fora dela; o hash gravado no banco
 * cobre o texto todo (adulterar = sessão inexistente). A posição é de cada token: no fim do refresh do tenant (o
 * `<tenant_id>.` tem de vir primeiro, para a busca na RLS) e no começo do token do `/config` (o formato que o cookie já tem).
 */
export const marcaTemporaria = (t: TrocaPendente): string | null =>
  t.motivo_troca === 'temporaria' && t.temporaria_expira_em ? `t${Math.floor(t.temporaria_expira_em.getTime() / 1000)}` : null;

/** A troca pendente lida do segmento da marca (`{}` sem ela). Só vale com `deve_trocar_senha` ligada. */
export function lerMarcaTemporaria(segmento: string | undefined): TrocaPendente {
  const m = segmento ? MARCA_TEMPORARIA.exec(segmento) : null;
  return m ? { motivo_troca: 'temporaria', temporaria_expira_em: new Date(Number(m[1]) * 1000) } : {};
}

/**
 * O e-mail da temporária (`emailSenhaTemporaria` do contrato): o único lugar em que ela existe em claro além da memória do
 * pedido. `codigoEmpresa` = o código digitado no login (maiúsculo); no superadmin, `CODIGO_SUPERADMIN_LOGIN`.
 */
export function mensagemSenhaTemporaria(para: string, senhaTemporaria: string, codigoEmpresa: string): MensagemEmail {
  return { para, ...emailSenhaTemporaria({ senha: senhaTemporaria, validade_horas: VALIDADE_SENHA_TEMPORARIA_HORAS, codigo_empresa: codigoEmpresa, email: para }) };
}
