import { describe, expect, it } from 'vitest';
import { A1ValidoDaFilial } from '../contracts';
import { criarPortaA1 } from './porta-a1';
import { RepositorioCoreMemoria } from './repositorio-memoria';

const FILIAL = '22222222-2222-4222-8222-222222222222';
const AGORA = new Date('2026-11-21T15:00:00Z');

function montar(validoAte: string | null, ativo = true) {
  const repo = new RepositorioCoreMemoria();
  repo.empresaLinha = { id: 'x', razao_social: 'E', nome_fantasia: null, cnpj: '11222333000181', ie: null, fuso: 'America/Manaus', updated_at: AGORA };
  if (validoAte) {
    repo.certificadosLinhas.push({
      id: '33333333-3333-4333-8333-333333333333',
      filial_id: FILIAL,
      titular: 'T',
      cnpj: '11222333000181',
      valido_de: new Date('2026-01-01T00:00:00Z'),
      valido_ate: new Date(validoAte),
      impressao_digital: 'ab',
      ativo,
    });
  }
  return criarPortaA1({ repo, agora: () => AGORA, noTenant: (fn) => fn({ consultar: async () => [] }) });
}

describe('RN-CORE-06: porta a1ValidoDaFilial', () => {
  it('RN-CORE-06: A1 ativo na validade é válido e o retorno obedece o contrato', async () => {
    const r = await montar('2026-12-21T15:00:00Z').a1ValidoDaFilial(FILIAL);
    expect(A1ValidoDaFilial.parse(r)).toMatchObject({ valido: true, dias_para_vencer: 30 });
  });
  it('RN-CORE-06: A1 vencido não é válido', async () => {
    expect(await montar('2026-11-01T00:00:00Z').a1ValidoDaFilial(FILIAL)).toMatchObject({ valido: false, motivo: 'vencido' });
  });
  it('RN-CORE-06: filial sem A1 ativo (ou só substituído) não é válida', async () => {
    expect(await montar(null).a1ValidoDaFilial(FILIAL)).toMatchObject({ valido: false, motivo: 'sem_certificado' });
    expect(await montar('2026-12-21T15:00:00Z', false).a1ValidoDaFilial(FILIAL)).toMatchObject({ motivo: 'sem_certificado' });
  });
  it('RN-CORE-06: o veredito não expõe certificado, CNPJ nem impressão digital', async () => {
    const txt = JSON.stringify(await montar('2026-12-21T15:00:00Z').a1ValidoDaFilial(FILIAL));
    expect(txt).not.toMatch(/11222333|impressao|titular/);
  });
  it('filial que não é UUID é rejeitada', async () => {
    await expect(montar(null).a1ValidoDaFilial('abc')).rejects.toThrow();
  });
});
