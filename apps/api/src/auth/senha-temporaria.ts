/**
 * Senha temporária do "Esqueci a senha" (T-0076, molde do FDV), comum ao tenant e ao superadmin:
 * - gerada pelo `gerarSenhaTemporaria` do SDK (44 B: 18 letras e números sem os confundíveis, isenta da regra "especial")
 *   com o `crypto.randomInt` (CSPRNG), o mesmo alfabeto do operador.sh; só o hash argon2id (`gerarHashSenha`) vai ao banco; nunca vai a log nem à resposta;
 * - vale por `VALIDADE_SENHA_TEMPORARIA_HORAS` (72 h, contrato `esqueci-senha.ts` do SDK), com o `expiraEm` e o `temporariaValida`
 *   do core (RN-CORE-13, `@macuxierp/core/api`), é de uso único (o consumo zera as duas colunas) e corre em paralelo à senha
 *   atual, que vale até a troca; um pedido novo substitui o anterior;
 * - a entrega é pela porta de e-mail (`email/porta.ts`), agendada só depois da resposta neutra (`agendarEnvioEmail`);
 * - a sessão aberta por ela leva a marca `t<segundos UTC do fim>` num segmento do refresh do tenant e do token do `/config`.
 */
import { randomInt } from 'node:crypto';
import { expiraEm } from '@macuxierp/core/api';
import { emailSenhaTemporaria, gerarSenhaTemporaria as gerarTemporariaSdk, VALIDADE_SENHA_TEMPORARIA_HORAS } from '@macuxierp/platform-sdk';
import type { MensagemEmail } from '../email/porta';
import { gerarHashSenha, type ParametrosArgon2 } from './senha';
import type { TrocaPendente } from './troca-senha';

/** O gerador do SDK (fonte única do alfabeto e do tamanho, 44 B) com o sorteio do CSPRNG do Node. */
export const gerarSenhaTemporaria = (): string => gerarTemporariaSdk((n) => randomInt(n));

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
 * pedido. Sem o código da empresa (ADR 0021 §6): o login é só por e-mail, no tenant e no superadmin.
 */
export function mensagemSenhaTemporaria(para: string, senhaTemporaria: string): MensagemEmail {
  return { para, ...emailSenhaTemporaria({ senha: senhaTemporaria, validade_horas: VALIDADE_SENHA_TEMPORARIA_HORAS, email: para }) };
}
