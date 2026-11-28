import { describe, expect, it } from 'vitest';
import { paraCsv } from '@macuxierp/platform-sdk/listas';
import { paginaVisivel } from '@macuxierp/platform-sdk';
import { manifest } from '../manifest';
import { regra } from '../domain/fixtures';
import { RegraLinha } from '../contracts';
import { situacaoDaRegra } from '../domain';
import { CAMPOS_REGRA, GRUPOS_REGRA, PAGINAS_FISCAL, acoesDaRegra, corpoDaRegra, inteiro4, paginaCatalogo, paginaRegras, texto4, textoPercentual, valoresDaRegra } from './index';

describe('páginas do fiscal', () => {
  it('RN-CORE-02: o menu do manifesto tem página, a nova só para quem edita e o detalhe fica fora do menu', () => {
    expect(PAGINAS_FISCAL.every((p) => (manifest.web?.menus as readonly string[]).includes(p.menu))).toBe(true);
    const nova = PAGINAS_FISCAL.find((p) => p.tipo === 'nova')!;
    expect(paginaVisivel(nova, 'leitura')).toBe(false);
    expect(paginaVisivel(nova, 'fiscal')).toBe(true);
    expect(PAGINAS_FISCAL.filter((p) => p.ocultaNoMenu).map((p) => p.tipo)).toEqual(['nova', 'detalhe']);
    expect(PAGINAS_FISCAL.findIndex((p) => p.tipo === 'nova')).toBeLessThan(PAGINAS_FISCAL.findIndex((p) => p.tipo === 'detalhe'));
  });
  it('RN-FIS-04: filtros na URL e CSV com as colunas da tela (vigência em dd/mm/aaaa, percentual com vírgula)', () => {
    expect(paginaRegras.chaves).toEqual(expect.arrayContaining(['busca', 'tributo', 'uf_destino', 'crt', 'situacao', 'cursor', 'limite']));
    expect(paginaCatalogo.api).toBe('/v1/fiscal/catalogo');
    const r = regra({ ncm_prefixo: '2202', aliquota_icms: 185000 });
    const linha = RegraLinha.parse({ ...r, situacao: situacaoDaRegra(r, '2026-11-28'), updated_at: '2026-11-28T10:00:00.000Z' });
    const csv = paraCsv(paginaRegras.colunas, [linha]);
    expect(csv).toContain('18,5%');
    expect(csv).toContain('01/01/2024');
    expect(csv).toContain('2202');
  });
  it('RN-FIS-01: percentual de 4 casas e conversões do campo', () => {
    expect(textoPercentual(180000)).toBe('18%');
    expect(textoPercentual(65)).toBe('0,0065%');
    expect(inteiro4('18,5')).toBe(185000);
    expect(inteiro4('0,0065')).toBe(65);
    expect(inteiro4('')).toBeNull();
    expect(inteiro4('1,23456')).toBeUndefined();
    expect(inteiro4('abc')).toBeUndefined();
    expect(texto4(185000)).toBe('18,5');
    expect(texto4(null)).toBe('');
  });
});

describe('formulário da regra (grade de 12 colunas, regra 11)', () => {
  it('regra 11: cada linha do grupo soma até 12 colunas e campo curto não ocupa a linha inteira', () => {
    for (const g of GRUPOS_REGRA) {
      let soma = 0;
      for (const c of g.campos) {
        if (soma + c.colunas > 12) soma = 0;
        soma += c.colunas;
        expect(c.colunas).toBeLessThanOrEqual(8);
      }
    }
    const curto = ['ncm_prefixo', 'cfop', 'uf_origem', 'uf_destino', 'crt', 'codigo', 'vigencia_inicio'];
    for (const n of curto) expect(CAMPOS_REGRA.find((c) => c.nome === n)!.colunas).toBeLessThanOrEqual(2);
  });
  it('RN-FIS-04: o corpo sai do texto digitado; sem fonte ou sem versão o formulário aponta o campo', () => {
    const v = { ...valoresDaRegra(), codigo: '00', aliquota_icms: '18', crt: '3', fonte_tipo: 'convenio', fonte_referencia: 'Convênio ICMS 142/2018', versao: '2026.1', vigencia_inicio: '2026-12-01', cst_pis: '01', aliquota_pis: '0,65', cst_cofins: '01', aliquota_cofins: '3' };
    const r = corpoDaRegra(v);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.corpo).toMatchObject({ aliquota_icms: 180000, aliquota_pis: 6500, crt: 3, ajustar_mva: null, fonte: { tipo: 'convenio' }, c_enq: '999', vigencia_fim: null });
    const sem = corpoDaRegra({ ...v, fonte_referencia: '' });
    expect(sem).toMatchObject({ ok: false, erros: { fonte_referencia: 'Preencha este campo' } });
    expect(corpoDaRegra({ ...v, aliquota_icms: '18,12345' })).toMatchObject({ ok: false, erros: { aliquota_icms: expect.any(String) } });
  });
  it('RN-FIS-05: ST interestadual sem decidir "ajustar a MVA" não passa no formulário (a mesma regra do domain)', () => {
    const v = { ...valoresDaRegra(), codigo: '10', crt: '3', uf_origem: 'AM', uf_destino: 'SP', mva_original: '40', aliquota_interna_destino: '18', fonte_tipo: 'convenio', fonte_referencia: 'Convênio ICMS 142/2018', versao: '1', vigencia_inicio: '2026-12-01' };
    expect(corpoDaRegra(v)).toMatchObject({ ok: false, erros: { ajustar_mva: expect.any(String) } });
    expect(corpoDaRegra({ ...v, ajustar_mva: 'nao' }).ok).toBe(true);
  });
  it('regra 12: botões numa barra só no rodapé, ação à esquerda e destrutiva à direita; quem só vê não tem barra', () => {
    const editar = acoesDaRegra('fiscal', 'editar');
    expect(editar.esquerda.map((a) => a.id)).toEqual(['salvar', 'descartar']);
    expect(editar.direita).toEqual([{ id: 'excluir', rotulo: 'Excluir regra', destrutiva: true }]);
    expect(acoesDaRegra('fiscal', 'criar').direita).toEqual([]);
    expect(acoesDaRegra('leitura', 'editar')).toEqual({ esquerda: [], direita: [] });
  });
  it('RN-FIS-04: os valores de uma regra aberta voltam ao texto (ajustar_mva nulo = não informado)', () => {
    const v = valoresDaRegra({ ...regra({ aliquota_icms: 185000, ajustar_mva: null }), updated_at: 'x', situacao: 'vigente' });
    expect(v).toMatchObject({ aliquota_icms: '18,5', ajustar_mva: '', fonte_tipo: 'convenio', crt: '' });
  });
});
