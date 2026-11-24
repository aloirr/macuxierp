/**
 * Carga pelo /config (T-0058, v0.3.5a): adicionar e substituir tudo, sobre o dublê em memória. A frase, a inativação em lote
 * (nunca apaga), o "em uso" mantido e os eventos com `inativo` são do RN-CAD-10; o contrato é o do SDK (`portal-cargas.ts`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArquivoRecebido, ErroApi, type CadastroCargaPortal, type ContextoRota } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { sessaoDe } from './apoio-teste';
import { gravarCargaPortal, validarCargaPortal } from './carga-portal';
import { dependenciasEmMemoria } from './memoria';
import type { ConsultaUsoCadastros } from './zeragem-portas';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'domain', 'carga', '__fixtures__');
const csv = (nome: string, linhas?: number[]) => {
  const l = readFileSync(join(pasta, `${nome}.csv`), 'utf8').trim().split('\n');
  return Buffer.from([l[0], ...(linhas ?? l.slice(1).map((_, i) => i)).map((i) => l[i + 1])].join('\n'));
};
const arq = (conteudo: Buffer, nome = 'arquivo-do-navegador.csv') => new ArquivoRecebido('arquivo', nome, 'text/csv', conteudo);
const FRASE = 'autorizo substituir tudo';

function montar(uso?: ConsultaUsoCadastros) {
  const m = dependenciasEmMemoria();
  m.repos.oficiais.ncms.add('21069030');
  m.repos.oficiais.municipiosPorUf.set('AM', [{ ibge: '1302603', nome: 'Manaus' }]);
  m.repos.oficiais.municipiosPorUf.set('SP', [{ ibge: '3550308', nome: 'São Paulo' }]);
  const eventos: { nome: string; agregado_id: string; payload: Record<string, unknown> }[] = [];
  const c = {
    sessao: sessaoDe('administrador'), tx: { consultar: async () => [] }, request_id: 'r', agora: new Date('2026-11-23T15:00:00Z'),
    publicar: async (e: { nome: string; agregado_id: string; payload: Record<string, unknown> }) => void eventos.push(e),
    auditar: async () => undefined, enfileirar: async () => ({ id: 'x' }),
  } as unknown as ContextoRota;
  const deps = { ...m.deps, ...(uso ? { usoCadastros: uso } : {}) };
  const gravar = (cadastro: CadastroCargaPortal, conteudo: Buffer, modo: 'adicionar' | 'substituir_tudo' = 'adicionar', frase?: string) =>
    gravarCargaPortal(deps, c, { cadastro, modo, frase, arquivo: arq(conteudo) });
  return { ...m, c, deps, eventos, gravar };
}
const falha = async (p: Promise<unknown>): Promise<ErroApi> => {
  try { await p; } catch (e) { if (e instanceof ErroApi) return e; throw e; }
  throw new Error('devia falhar');
};
const ativos = (t: { repos: { produtos: { linhas: { inativo: boolean }[] } } }) => t.repos.produtos.linhas.filter((l) => !l.inativo).length;

describe('carga no /config: adicionar (RN-CAD-10)', () => {
  it('RN-CAD-10: adicionar é a carga de hoje: grava, não inativa e a resposta não traz inativadas nem efeito', async () => {
    const t = montar();
    const r = await t.gravar('produto', csv('produto'));
    expect(r).toEqual({ cadastro: 'produto', modo: 'adicionar', gravadas: 2, com_erro: 0 });
    expect(ativos(t)).toBe(2);
  });

  it('RN-CAD-10: o nome do arquivo do navegador não importa (vira <cadastro>.csv)', async () => {
    const t = montar();
    expect((await t.gravar('filial', csv('filial'))).gravadas).toBe(1);
  });

  it('RN-CAD-10: adicionar com frase é recusado (400)', async () => {
    const t = montar();
    expect((await falha(t.gravar('produto', csv('produto'), 'adicionar', FRASE))).status).toBe(400);
    expect(t.repos.produtos.linhas).toHaveLength(0);
  });

  it('RF-CAD-11 (decisão de 23/11, v0.3.7): nenhuma carga depende de outra; vendedor sem filial cai como erro da linha (409 nada_a_gravar), sem dependencia_pendente', async () => {
    const t = montar();
    const e = await falha(t.gravar('vendedor', csv('vendedor')));
    // o arquivo foi processado: a filial ausente é erro da linha (nada_a_gravar), não bloqueio por dependência
    expect(e).toMatchObject({ status: 409, detalhes: { codigo: 'nada_a_gravar' } });
    await t.gravar('filial', csv('filial'));
    expect((await t.gravar('vendedor', csv('vendedor'))).gravadas).toBe(1);
  });

  it('RN-CAD-10: arquivo sem nenhuma linha pronta é 409 nada_a_gravar', async () => {
    const t = montar();
    expect(await falha(t.gravar('produto', Buffer.from('coluna_errada\nx\n')))).toMatchObject({ status: 409, detalhes: { codigo: 'nada_a_gravar' } });
  });
});

describe('carga no /config: substituir tudo (RN-CAD-10)', () => {
  it('RN-CAD-10: frase inválida é 422 e nada é lido nem gravado', async () => {
    const t = montar();
    for (const frase of [undefined, '', 'autorizo', 'autorizo zerar os dados']) {
      const e = await falha(t.gravar('produto', csv('produto'), 'substituir_tudo', frase));
      expect(e).toMatchObject({ status: 422, codigo: 'RN-CAD-10', detalhes: { codigo: 'frase_nao_confere' } });
    }
    expect(t.repos.produtos.linhas).toHaveLength(0);
    expect(t.eventos).toHaveLength(0);
  });

  it('RN-CAD-10: a frase é normalizada (maiúsculas, espaços e ponto final)', async () => {
    const t = montar();
    expect((await t.gravar('produto', csv('produto'), 'substituir_tudo', '  Autorizo   SUBSTITUIR tudo. ')).gravadas).toBe(2);
  });

  it('RN-CAD-10: inativa os que faltam no arquivo (nunca apaga) e publica o evento com inativo', async () => {
    const t = montar();
    await t.gravar('produto', csv('produto'));
    t.eventos.length = 0;
    const r = await t.gravar('produto', csv('produto', [0]), 'substituir_tudo', FRASE);
    expect(r).toMatchObject({ modo: 'substituir_tudo', gravadas: 1, inativadas: 1, efeito: { total: 2, a_inativar: 1, percentual: 50, acima_limite_fdv: true } });
    expect(t.repos.produtos.linhas).toHaveLength(2);
    expect(ativos(t)).toBe(1);
    const inativado = t.repos.produtos.linhas.find((l) => l.inativo) as { id: string };
    const ev = t.eventos.filter((e) => e.nome === 'cadastros.produto.alterado@1' && e.agregado_id === inativado.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]?.payload.inativo).toBe(true);
  });

  it('RN-CAD-10: no cliente, a prévia e o gravar contam os endereços inativados (o do cliente ausente e a entrega do que ficou)', async () => {
    const t = montar();
    for (const dep of ['filial', 'vendedor', 'condicao_pagamento', 'produto', 'preco', 'cliente'] as const) await t.gravar(dep, csv(dep === 'condicao_pagamento' ? 'condicoes_pagamento' : dep));
    const entrada = { cadastro: 'cliente', modo: 'substituir_tudo', arquivo: arq(csv('cliente', [0])) } as const; // só a linha principal do C-EX-01
    const v = await validarCargaPortal(t.deps, t.c, entrada);
    expect(v.efeito).toMatchObject({ a_inativar: 1, enderecos_a_inativar: 2 });
    const r = await gravarCargaPortal(t.deps, t.c, { ...entrada, frase: FRASE });
    expect(r).toMatchObject({ modo: 'substituir_tudo', gravadas: 1, inativadas: 1, enderecos_inativados: 2 });
    expect(r.efeito).toEqual(v.efeito); // a prévia e o gravar contam o mesmo
  });

  it('RN-CAD-10: o percentual do gravar é o do validar; registro sem chave não é inativado nem conta no total', async () => {
    const t = montar();
    await t.gravar('produto', csv('produto'));
    // um ativo sem external_id (cadastro manual): fica de fora do plano, do total e do percentual
    t.repos.produtos.linhas.push({ ...(t.repos.produtos.linhas[0] as object), id: 'sem-chave', external_id: null, inativo: false } as never);
    const entrada = { cadastro: 'produto', modo: 'substituir_tudo', arquivo: arq(csv('produto', [0])) } as const;
    const v = await validarCargaPortal(t.deps, t.c, entrada);
    const g = await gravarCargaPortal(t.deps, t.c, { ...entrada, frase: FRASE });
    expect(v.efeito).toMatchObject({ total: 2, a_inativar: 1, percentual: 50, sem_chave: 1 });
    expect(g.efeito).toEqual(v.efeito);
    expect(t.repos.produtos.linhas.find((l) => (l as { id: string }).id === 'sem-chave')).toMatchObject({ inativo: false });
  });

  it('RN-CAD-10: fora do cliente, nem o validar nem o gravar trazem as contagens de endereço', async () => {
    const t = montar();
    await t.gravar('produto', csv('produto'));
    const entrada = { cadastro: 'produto', modo: 'substituir_tudo', arquivo: arq(csv('produto', [0])) } as const;
    const v = await validarCargaPortal(t.deps, t.c, entrada);
    const g = await gravarCargaPortal(t.deps, t.c, { ...entrada, frase: FRASE });
    expect(v.efeito).not.toHaveProperty('enderecos_a_inativar');
    expect(g.efeito).not.toHaveProperty('enderecos_a_inativar');
    expect(g).not.toHaveProperty('enderecos_inativados');
  });

  it('RN-CAD-10: arquivo com todos os existentes não inativa ninguém', async () => {
    const t = montar();
    await t.gravar('produto', csv('produto'));
    const r = await t.gravar('produto', csv('produto'), 'substituir_tudo', FRASE);
    expect(r).toMatchObject({ inativadas: 0, efeito: { a_inativar: 0, percentual: 0, acima_limite_fdv: false } });
    expect(ativos(t)).toBe(2);
  });

  it('RN-CAD-10: o que está em uso também é inativado, só entra no aviso (o histórico fica) e a consulta recebe os candidatos', async () => {
    const chamadas: { cadastro: string; ids: readonly string[] }[] = [];
    const uso: ConsultaUsoCadastros = {
      async emUso(_tx, cadastro, ids) {
        chamadas.push({ cadastro, ids });
        return new Map(ids.map((id) => [id, 'pedido']));
      },
    };
    const t = montar(uso);
    await t.gravar('produto', csv('produto'));
    const r = await t.gravar('produto', csv('produto', [0]), 'substituir_tudo', FRASE);
    expect(r.inativadas).toBe(1);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ cadastro: 'produto' });
    expect(chamadas[0]?.ids).toHaveLength(1);
    expect(ativos(t)).toBe(1);
  });

  it('RN-CAD-10: linha recusada do arquivo ainda protege o existente de ser inativado', async () => {
    const t = montar();
    await t.gravar('produto', csv('produto'));
    const linhas = readFileSync(join(pasta, 'produto.csv'), 'utf8').trim().split('\n');
    const ruim = (linhas[2] as string).replace(';21069030;', ';00000000;'); // NCM inexistente: a linha é recusada, mas o external_id veio
    const r = await t.gravar('produto', Buffer.from([linhas[0], linhas[1], ruim].join('\n')), 'substituir_tudo', FRASE);
    expect(r).toMatchObject({ gravadas: 1, com_erro: 1, inativadas: 0 });
    expect(ativos(t)).toBe(2);
  });

  it('RN-CAD-10: arquivo sem nenhuma linha pronta não inativa nada (409 nada_a_gravar)', async () => {
    const t = montar();
    await t.gravar('produto', csv('produto'));
    expect(await falha(t.gravar('produto', Buffer.from('coluna_errada\nx\n'), 'substituir_tudo', FRASE))).toMatchObject({ status: 409, detalhes: { codigo: 'nada_a_gravar' } });
    expect(ativos(t)).toBe(2);
  });

  it('RN-CAD-10: Substituir tudo da condição inativa a que não veio, publica a alteração com inativo e a forma não é entidade', async () => {
    const t = montar();
    await t.gravar('condicao_pagamento', csv('condicoes_pagamento'));
    const ativas = () => t.repos.condicoesPagamento.linhas.filter((l) => !l.inativo).length;
    const antes = ativas();
    expect(antes).toBeGreaterThan(1);
    t.eventos.length = 0;
    const r = await t.gravar('condicao_pagamento', csv('condicoes_pagamento', [0]), 'substituir_tudo', FRASE);
    expect(r).toMatchObject({ gravadas: 1, inativadas: antes - 1 });
    expect(ativas()).toBe(1);
    expect(t.eventos.filter((e) => e.nome === 'cadastros.condicao_pagamento.alterada@1' && e.payload.inativo === true)).toHaveLength(antes - 1);
  });

  it('RN-CAD-10: estoque só aceita o Adicionar: substituir_tudo é 400 VALIDACAO no campo modo (gravar e validar)', async () => {
    const t = montar();
    await t.gravar('filial', csv('filial'));
    await t.gravar('produto', csv('produto'));
    const g = await falha(gravarCargaPortal(t.deps, t.c, { cadastro: 'estoque', modo: 'substituir_tudo', frase: FRASE, arquivo: arq(csv('estoque')) }));
    expect(g).toMatchObject({ status: 400, codigo: 'VALIDACAO' });
    expect(JSON.stringify(g.campos)).toContain('modo');
    expect((await falha(validarCargaPortal(t.deps, t.c, { cadastro: 'estoque', modo: 'substituir_tudo', arquivo: arq(csv('estoque')) }))).status).toBe(400);
    expect((await gravarCargaPortal(t.deps, t.c, { cadastro: 'estoque', modo: 'adicionar', arquivo: arq(csv('estoque')) })).modo).toBe('adicionar');
  });

  it('RN-CAD-10: validar não grava nada e prevê o efeito do substituir tudo', async () => {
    const t = montar();
    await t.gravar('produto', csv('produto'));
    t.eventos.length = 0;
    const r = await validarCargaPortal(t.deps, t.c, { cadastro: 'produto', modo: 'substituir_tudo', arquivo: arq(csv('produto', [0])) });
    expect(r).toMatchObject({ prontas: 1, com_erro: 0, efeito: { total: 2, a_inativar: 1 } });
    expect(ativos(t)).toBe(2);
    expect(t.eventos).toHaveLength(0);
    expect((await validarCargaPortal(t.deps, t.c, { cadastro: 'produto', modo: 'adicionar', arquivo: arq(csv('produto')) })).efeito).toBeUndefined();
  });
});
