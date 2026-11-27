/**
 * v0.3.26: folga de relógio na abertura da sessão do `/config`. A `superadmin_abrir_sessao` (0033) recusa com 23514
 * (422 REGRA_PLATAFORMA) o `p_expira_em` acima de `now() + 8 h` do banco; com o relógio da VM adiantado em relação ao
 * DBaaS, o login do superadmin dava 422 intermitente (27/11/2026). Banco simulado com o teto da 0033.
 */
import { VALIDADE_SESSAO_CONFIG_MS, type BancoPlataformaComLogin, type Transacao } from '@macuxierp/platform-sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { ARGON2_RAPIDO, SENHA_DE_TESTE } from '../apoio-teste';
import { gerarHashSenha } from '../auth/senha';
import { FOLGA_RELOGIO_SESSAO_MS, ServicoPlataforma } from './servico';

const AGORA_BANCO = new Date('2026-11-27T12:00:00.000Z');
const SA_ID = '00000000-0000-4000-8000-000000000001';

/** Banco simulado: o `now()` dele é `AGORA_BANCO`; a abertura da sessão segue a regra da 0033 (l. 303). */
function bancoSimulado(senhaHash: string) {
  const enviados: Date[] = [];
  const tx: Transacao = {
    async consultar<L>(sql: string, p: readonly unknown[] = []): Promise<L[]> {
      if (sql.includes('superadmin_para_login')) {
        return [{ id: SA_ID, senha_hash: senhaHash, ativo: true, falhas_login: 0, bloqueado_ate: null, senha_temporaria_hash: null, senha_temporaria_expira_em: null }] as L[];
      }
      if (sql.includes('superadmin_abrir_sessao')) {
        const expira = p[2] as Date;
        enviados.push(expira);
        if (expira.getTime() <= AGORA_BANCO.getTime() || expira.getTime() > AGORA_BANCO.getTime() + 8 * 3600_000) {
          throw Object.assign(new Error('validade da sessão inválida'), { code: '23514' });
        }
        return [{}] as L[];
      }
      throw new Error(`SQL inesperado: ${sql}`);
    },
  };
  const banco = { antesDaSessao: (fn: (t: Transacao) => Promise<unknown>) => fn(tx) } as unknown as BancoPlataformaComLogin;
  return { banco, enviados };
}

describe('sessão do /config com folga de relógio (v0.3.26, 422 REGRA_PLATAFORMA de 27/11)', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await gerarHashSenha(SENHA_DE_TESTE, ARGON2_RAPIDO);
  });

  it('a folga é de 1 min e a validade enviada é 8 h menos a folga', () => {
    expect(FOLGA_RELOGIO_SESSAO_MS).toBe(60_000);
    expect(VALIDADE_SESSAO_CONFIG_MS).toBe(8 * 3600_000);
  });

  it.each([0, 1_000, 30_000, 59_000])('relógio do app adiantado %i ms: o expira_em enviado fica ≤ now() + 8 h do banco e o login sai', async (adiantado) => {
    const { banco, enviados } = bancoSimulado(hash);
    const agoraApp = new Date(AGORA_BANCO.getTime() + adiantado);
    const s = new ServicoPlataforma(banco, { maxFalhas: 5, argon2: ARGON2_RAPIDO }, { agora: () => agoraApp });
    const r = await s.entrar('sa@exemplo.invalid', SENHA_DE_TESTE);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.getTime()).toBe(agoraApp.getTime() + VALIDADE_SESSAO_CONFIG_MS - FOLGA_RELOGIO_SESSAO_MS);
    expect(enviados[0]!.getTime()).toBeLessThanOrEqual(AGORA_BANCO.getTime() + 8 * 3600_000);
    expect(r).toMatchObject({ superadmin_id: SA_ID, expira_em: enviados[0] });
  });

  it('sem a folga (app + 8 h exatas), o mesmo relógio adiantado 30 s estouraria o teto da 0033', () => {
    const agoraApp = AGORA_BANCO.getTime() + 30_000;
    expect(agoraApp + VALIDADE_SESSAO_CONFIG_MS).toBeGreaterThan(AGORA_BANCO.getTime() + 8 * 3600_000);
  });
});
