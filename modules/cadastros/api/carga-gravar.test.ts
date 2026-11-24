/**
 * ADR 0014 §1: a `gravarLinhas` recebe as `linhas` do `adaptarLote` (a /entrada/v1) do mesmo jeito que as do CSV.
 * Aqui, 1 filial e 1 vendedor do Hub no dublê em memória; o `validar` não grava, o `gravar` grava e o erro não leva o dado.
 */
import type { ContextoRota } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { adaptarLote, indexarFormas, type ContextoAdaptacao } from '../domain';
import { sessaoDe } from './apoio-teste';
import { gravarLinhas, type EntradaGravacao } from './carga-gravar';
import { dependenciasEmMemoria } from './memoria';

const base = { ativo: true, alterado_em: '2026-11-23T14:00:00.000Z' };
const ctxAdaptar: ContextoAdaptacao = { municipiosDaUf: (uf) => (uf === 'AM' ? [{ ibge: '1302603', nome: 'Manaus' }] : []), formas: indexarFormas([]) };

function montar() {
  const m = dependenciasEmMemoria();
  const eventos: unknown[] = [];
  const c = {
    sessao: sessaoDe('administrador'), tx: { consultar: async () => [] }, request_id: 'r', agora: new Date('2026-11-23T15:00:00Z'),
    publicar: async (e: unknown) => void eventos.push(e), auditar: async () => undefined, enfileirar: async () => ({ id: 'x' }),
  } as unknown as ContextoRota;
  const entrada = (entidade: string, registros: unknown[]): EntradaGravacao => {
    const r = adaptarLote(entidade, registros, ctxAdaptar);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.erros).toEqual([]);
    return { entidade: r.entidade_carga, linhas: r.linhas };
  };
  // O payload `FilialHub` não traz `crt`, que a carga exige para CRIAR a filial (CARGA_OBRIGATORIO): a /entrada/v1 só cria filial se o
  // worker completar o dado (pendência da etapa 5). Aqui o teste completa a linha, como o CSV faria.
  const comCrt = (e: EntradaGravacao): EntradaGravacao => ({ ...e, linhas: e.linhas.map((l) => ({ ...l, dados: { ...(l as { dados: object }).dados, crt: '1' } }) as typeof l) });
  const filial = { ...base, external_id: 'F1', codigo: '01', nome: 'Matriz', cidade: 'Manaus', uf: 'AM', cnpj: '11.222.333/0001-81', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cep: '69000000' };
  const vendedor = { ...base, external_id: 'V1', nome: 'Ana', filial_external_id: 'F1' };
  return { ...m, c, eventos, entradas: [comCrt(entrada('filial', [filial])), entrada('vendedor', [vendedor])] };
}

describe('gravarLinhas com as linhas do adaptarLote (ADR 0014 §1)', () => {
  it('validar: prevê 1 filial e 1 vendedor inseridos e não grava nem publica', async () => {
    const t = montar();
    const s = await gravarLinhas(t.deps, t.c, 'validar', 'lote-1', t.entradas);
    expect(s.erros).toEqual([]);
    expect(s.resultados.filial).toMatchObject({ inseridas: 1, atualizadas: 0 });
    expect(s.resultados.vendedor).toMatchObject({ inseridas: 1, atualizadas: 0 });
    expect(t.repos.filiais.linhas).toHaveLength(0);
    expect(t.eventos).toHaveLength(0);
  });

  it('gravar: grava a filial e o vendedor (referência resolvida pelo lote) e a repetição não muda nada', async () => {
    const t = montar();
    const s = await gravarLinhas(t.deps, t.c, 'gravar', 'lote-1', t.entradas);
    expect(s.erros).toEqual([]);
    expect(t.repos.filiais.linhas).toHaveLength(1);
    expect(t.repos.vendedores.linhas).toHaveLength(1);
    const de = await gravarLinhas(t.deps, t.c, 'gravar', 'lote-2', t.entradas);
    expect(de.resultados.filial).toMatchObject({ inseridas: 0, sem_mudanca: 1 });
    expect(de.resultados.vendedor).toMatchObject({ inseridas: 0, sem_mudanca: 1 });
  });

  it('RN-CAD-04: vendedor que cita filial desconhecida volta como erro de linha sem o valor do dado', async () => {
    const t = montar();
    const so = [t.entradas[1] as EntradaGravacao];
    const s = await gravarLinhas(t.deps, t.c, 'gravar', 'lote-1', so);
    expect(s.erros).toHaveLength(1);
    expect(s.erros[0]).toMatchObject({ entidade: 'vendedor', erro: { linha: 2 } });
    expect(t.repos.vendedores.linhas).toHaveLength(0);
    expect(JSON.stringify(s.erros)).not.toContain('Ana');
  });
});
