/** Plugin "Zerar dados" (RN-CAD-10, T-0058) com tx e portas falsas. */
import { CAMINHOS_CARGAS_PLATAFORMA, CODIGO_ZERAGEM_BLOQUEADA, ErroApi, MENSAGEM_FRASE_ZERAR, ZeragemPlataformaResposta, corpoErroApi, type ContextoPlataforma, type Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { criarPluginPlataformaCadastrosZerar } from './zeragem';
import type { EstadoEntidadeIntegracao } from './zeragem-portas';

const TENANT = '11111111-1111-4111-8111-111111111111';
const FRASE = 'autorizo zerar os dados';

interface Opcoes {
  emVoo?: string[];
  semChave?: boolean;
  resultado?: unknown;
}

function montar(o: Opcoes = {}) {
  const todas: string[] = [];
  const tirados: string[][] = [];
  const refsUsos: object[] = [];
  const sqls: { sql: string; p: readonly unknown[] }[] = [];
  const fatos = {
    tabelas: [
      { tabela: 'filial', linhas: [{ id: 'f1', com_chave: true }] },
      { tabela: 'vendedor', linhas: [{ id: 'v1', refs: { filial: 'f1' }, com_chave: !o.semChave }] },
      { tabela: 'condicao_pagamento', linhas: [{ id: 'cp1', com_chave: true }] },
      { tabela: 'cliente', linhas: [{ id: 'c1', refs: { filial: 'f1', vendedor: 'v1' }, com_chave: true }] },
    ],
  };
  const tx = {
    async consultar(sql: string, p: readonly unknown[] = []) {
      sqls.push({ sql, p });
      if (sql.includes('portal_zeragem_fatos')) { todas.push('fatos'); return [{ r: fatos }]; }
      if (sql.includes('portal_zerar')) {
        todas.push('portal_zerar');
        return [{ r: o.resultado ?? { apagados: [{ tabela: 'vendedor', quantidade: 1 }], anulados: [{ tabela: 'cliente', coluna: 'vendedor_id', quantidade: 1 }] } }];
      }
      return [];
    },
  } as unknown as Transacao;
  const plugin = criarPluginPlataformaCadastrosZerar({
    usos: { usos: async (_tx, _t, refs) => { todas.push('usos'); refsUsos.push(refs); return { emUso: [], filiaisComNota: [] }; } },
    integracao: {
      async estado(_tx, _t, entidades): Promise<EstadoEntidadeIntegracao[]> {
        return entidades.map((entidade) => ({ entidade, lote_em_voo: o.emVoo?.includes(entidade) ?? false }));
      },
    },
    usuarios: { async tirarFiliais(_tx, _t, ids) { todas.push('tirarFiliais'); tirados.push([...ids]); return 2; } },
  });
  const ctx: ContextoPlataforma = { sessao: { superadmin_id: 'a', sessao_id: 'b' }, tx, request_id: 'req-1', agora: new Date(), auditar: async () => { todas.push('auditar'); } };
  const chamar = (caminho: string, corpo: unknown) => {
    const r = plugin.rotas.find((x) => x.caminho === caminho)!;
    return r.executar(ctx, { corpo: r.corpo ? r.corpo.parse(corpo) : undefined, params: { id: TENANT } } as never);
  };
  return { plugin, chamar, todas, tirados, sqls, refsUsos };
}
const C = CAMINHOS_CARGAS_PLATAFORMA;

describe('plugin de plataforma "Zerar dados" (RN-CAD-10)', () => {
  it('RN-CAD-10: declara previa (sem idempotência) e zerar (obrigatória), ambas com a ação plataforma.cadastros.zerar', () => {
    const { plugin } = montar();
    expect(plugin.rotas.map((r) => `${r.metodo} ${r.caminho} ${r.acao} ${r.idempotencia ?? '-'}`).sort()).toEqual([
      `POST ${C.previa} plataforma.cadastros.zerar -`,
      `POST ${C.zerar} plataforma.cadastros.zerar obrigatoria`,
    ].sort());
  });

  it('RN-CAD-10: o refs das portas de uso vai por tabela (6 chaves do p_refs), só com ids existentes', async () => {
    const m = montar();
    await m.chamar(C.previa, { cadastros: ['vendedor'] });
    expect(m.refsUsos).toEqual([{ filial: ['f1'], vendedor: ['v1'], condicao_pagamento: ['cp1'], cliente: ['c1'] }]);
  });

  it('RN-CAD-10: a prévia é simulado=true, não chama o efeito e lista o lote em andamento como bloqueio', async () => {
    const m = montar({ emVoo: ['vendedor'] });
    const { corpo } = await m.chamar(C.previa, { cadastros: ['vendedor'] });
    const r = ZeragemPlataformaResposta.parse(corpo);
    expect(r.simulado).toBe(true);
    expect(r.bloqueios).toEqual([{ cadastro: 'vendedor', motivo: 'lote_em_andamento' }]);
    expect(m.todas).not.toContain('portal_zerar');
  });

  it('RN-CAD-10: a prévia sem bloqueio traz o plano (apagados e anulados)', async () => {
    const { corpo } = await montar().chamar(C.previa, { cadastros: ['vendedor'] });
    const r = ZeragemPlataformaResposta.parse(corpo);
    expect(r.apagados).toEqual([{ tabela: 'vendedor', quantidade: 1 }]);
    expect(r.anulados).toEqual([{ tabela: 'cliente', coluna: 'vendedor_id', quantidade: 1 }]);
  });

  it('RN-CAD-10 (T-0093): frase errada é 422 de regra frase_nao_confere, sem tocar o banco', async () => {
    const m = montar();
    const e = await m.chamar(C.zerar, { cadastros: ['vendedor'], frase: 'zerar' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroApi);
    expect((e as ErroApi).status).toBe(422);
    expect(corpoErroApi(e as ErroApi)).toEqual({ codigo: 'RN-CAD-10', mensagem: MENSAGEM_FRASE_ZERAR, detalhes: { codigo: 'frase_nao_confere' } });
    expect(m.todas).toEqual([]);
    await expect(m.chamar(C.zerar, { cadastros: ['vendedor'], frase: `  ${FRASE.toUpperCase()}. ` })).resolves.toBeDefined();
  });

  it('RN-CAD-10 (T-0093): corpo malformado segue 400 pelo Zod', () => {
    const rota = montar().plugin.rotas.find((r) => r.caminho === C.zerar)!;
    for (const corpo of [{ cadastros: ['vendedor'] }, { cadastros: ['vendedor'], frase: 1 }, { cadastros: ['vendedor'], frase: 'x'.repeat(201) }]) {
      expect(rota.corpo!.safeParse(corpo).success).toBe(false);
    }
  });

  it('RN-CAD-10: com bloqueio o zerar é 422 zeragem_bloqueada e não chama portal_zerar', async () => {
    const m = montar({ emVoo: ['vendedor'] });
    const e = await m.chamar(C.zerar, { cadastros: ['vendedor'], frase: FRASE }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroApi);
    expect((e as ErroApi).status).toBe(422);
    expect((e as ErroApi).detalhes).toEqual({ codigo: CODIGO_ZERAGEM_BLOQUEADA, bloqueios: ['vendedor:lote_em_andamento'] });
    expect(m.todas).not.toContain('portal_zerar');
  });

  it('RN-CAD-10: condicao_pagamento bloqueia o lote em voo de qualquer das duas entidades do Hub', async () => {
    const m = montar({ emVoo: ['prazo_pagamento'] });
    const { corpo } = await m.chamar(C.previa, { cadastros: ['condicao_pagamento'] });
    expect(ZeragemPlataformaResposta.parse(corpo).bloqueios).toEqual([{ cadastro: 'condicao_pagamento', motivo: 'lote_em_andamento' }]);
  });

  it('RN-CAD-10: zerar vendedor chama fatos, usos e portal_zerar, sem tirarFiliais nem c.auditar', async () => {
    const m = montar();
    const { corpo } = await m.chamar(C.zerar, { cadastros: ['vendedor'], frase: FRASE });
    expect(m.todas).toEqual(['fatos', 'usos', 'portal_zerar']);
    expect(m.tirados).toEqual([]);
    const r = ZeragemPlataformaResposta.parse(corpo);
    expect(r.simulado).toBe(false);
    expect(r.apagados).toEqual([{ tabela: 'vendedor', quantidade: 1 }]);
  });

  it('RN-CAD-10 (T-0086): o resultado traz inativacao_fdv do portal_zerar por entidade; vazio ou ausente é omitido; a prévia não traz', async () => {
    const base = { apagados: [{ tabela: 'vendedor', quantidade: 2 }], anulados: [] };
    const com = await montar({ resultado: { ...base, inativacao_fdv: [{ entidade: 'vendedor', quantidade: 2 }] } }).chamar(C.zerar, { cadastros: ['vendedor'], frase: FRASE });
    expect(ZeragemPlataformaResposta.parse(com.corpo).inativacao_fdv).toEqual([{ entidade: 'vendedor', quantidade: 2 }]);
    for (const resultado of [base, { ...base, inativacao_fdv: [] }]) {
      const { corpo } = await montar({ resultado }).chamar(C.zerar, { cadastros: ['vendedor'], frase: FRASE });
      expect(corpo).not.toHaveProperty('inativacao_fdv');
    }
    const previa = await montar().chamar(C.previa, { cadastros: ['vendedor'] });
    expect(previa.corpo).not.toHaveProperty('inativacao_fdv');
  });

  it('RN-CAD-10: zerar filial chama fatos, usos, tirarFiliais (só ids apagados) e portal_zerar, nessa ordem', async () => {
    const m = montar();
    await m.chamar(C.zerar, { cadastros: ['filial'], frase: FRASE });
    expect(m.todas).toEqual(['fatos', 'usos', 'tirarFiliais', 'portal_zerar']);
    expect(m.tirados).toEqual([['f1']]);
  });

  it('RN-CAD-10: a prévia não chama tirarFiliais nem portal_zerar', async () => {
    const m = montar();
    await m.chamar(C.previa, { cadastros: ['filial'] });
    expect(m.todas).toEqual(['fatos', 'usos']);
  });

  it('RN-CAD-10: o p_plano enviado leva apagar, anular e em_uso', async () => {
    const m = montar();
    await m.chamar(C.zerar, { cadastros: ['vendedor'], frase: FRASE });
    const s = m.sqls.find((x) => x.sql.includes('portal_zerar'))!;
    expect(s.p[0]).toBe(TENANT);
    expect(JSON.parse(s.p[1] as string)).toEqual({
      apagar: [{ tabela: 'vendedor', ids: ['v1'] }],
      anular: [{ tabela: 'cliente', coluna: 'vendedor_id', ids: ['c1'] }],
      em_uso: [],
    });
    expect(s.p[2]).toBe('req-1');
  });

  it('RN-CAD-10: registro sem external_id entra em sem_chave', async () => {
    const { corpo } = await montar({ semChave: true }).chamar(C.zerar, { cadastros: ['vendedor'], frase: FRASE });
    expect(ZeragemPlataformaResposta.parse(corpo).sem_chave).toBe(1);
  });

  it('RN-CAD-10: resposta do banco fora do formato falha (Zod) e o erro do banco sobe cru', async () => {
    await expect(montar({ resultado: { apagados: [{ tabela: 'xpto', quantidade: 1 }], anulados: [] } }).chamar(C.zerar, { cadastros: ['vendedor'], frase: FRASE })).rejects.toThrow();
  });
});
