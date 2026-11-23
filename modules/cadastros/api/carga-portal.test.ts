/**
 * Carga pelo /config (T-0058, v0.3.5a): adicionar e substituir tudo, sobre o dublê em memória. A frase, a inativação em lote
 * (nunca apaga), o "em uso" mantido e os eventos com `inativo` são do RN-CAD-10; o contrato é o do SDK (`portal-cargas.ts`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArquivoRecebido, ErroApi, type ContextoRota } from '@macuxierp/platform-sdk';
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
  const eventos: { nome: string; agregado_id: string; payload: Record<string, unknown> }[] = [];
  const auditoria: unknown[] = [];
  const c = {
    sessao: sessaoDe('administrador'), tx: { consultar: async () => [] }, request_id: 'r', agora: new Date('2026-11-23T15:00:00Z'),
    publicar: async (e: { nome: string; agregado_id: string; payload: Record<string, unknown> }) => void eventos.push(e),
    auditar: async (d: unknown) => void auditoria.push(d), enfileirar: async () => ({ id: 'x' }),
  } as unknown as ContextoRota;
  const deps = { ...m.deps, ...(uso ? { usoCadastros: uso } : {}) };
  const gravar = (cadastro: 'filial' | 'vendedor' | 'produto', conteudo: Buffer, modo: 'adicionar' | 'substituir_tudo' = 'adicionar', frase?: string) =>
    gravarCargaPortal(deps, c, { cadastro, modo, frase, arquivo: arq(conteudo) });
  return { ...m, c, deps, eventos, auditoria, gravar };
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

  it('RF-CAD-11: cadastro cujo dependente não está carregado é 409 dependencia_pendente', async () => {
    const t = montar();
    const e = await falha(t.gravar('vendedor', csv('vendedor')));
    expect(e).toMatchObject({ status: 409, codigo: 'CONFLITO', detalhes: { codigo: 'dependencia_pendente' } });
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
    expect(t.auditoria).toContainEqual(expect.objectContaining({ acao: 'cadastros.carga.substituir_tudo', depois: expect.objectContaining({ inativadas: 1 }) }));
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

  it('RN-CAD-10: forma de pagamento e estoque não têm o que inativar (inativadas 0)', async () => {
    const t = montar();
    await t.gravar('filial', csv('filial'));
    await t.gravar('produto', csv('produto'));
    // estoque exige filial e produto carregados: o plano é vazio, o efeito zerado
    const r = await gravarCargaPortal(t.deps, t.c, { cadastro: 'estoque', modo: 'substituir_tudo', frase: FRASE, arquivo: arq(csv('estoque')) });
    expect(r).toMatchObject({ inativadas: 0, efeito: { total: 0, a_inativar: 0 } });
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
