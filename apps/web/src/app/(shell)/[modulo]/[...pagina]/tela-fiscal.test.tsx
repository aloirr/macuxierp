import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DadosInvalidos } from '@/lib/api';
import { QualRegraVale, TelaRegraDetalhe } from './tela-fiscal';

const api = vi.hoisted(() => ({ get: vi.fn(), registro: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), redirect: (d: string) => { throw new Error(`REDIRECT ${d}`); }, notFound: () => { throw new Error('404'); } }));
vi.mock('@/lib/acoes-cliente', () => ({ escrever: vi.fn() }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), getValidado: api.get, buscarRegistro: api.registro }));

const ROTA = '/fiscal/regras-fiscais';
const CONSULTA = 'vale_ncm=22021000&vale_cfop=5102&vale_uf_origem=AM&vale_uf_destino=SP&vale_tipo_cliente=contribuinte&vale_crt=3';
const ok = (v: string) => ({ ok: true, versao: v, fonte: { tipo: 'convenio', referencia: '142/2018' } });
const sem = { ok: false, erros: [{ mensagem: 'Nenhuma regra vigente' }] };

beforeEach(() => { api.get.mockReset(); api.registro.mockReset(); });

describe('"Qual regra vale" (RN-FIS-01)', () => {
  it('sem consulta completa não chama a API e mostra o formulário com rótulo e botão no rodapé do bloco', async () => {
    const h = renderToStaticMarkup(await QualRegraVale({ acesso: 'x', rota: ROTA, busca: new URLSearchParams('vale_ncm=2202') }));
    expect(api.get).not.toHaveBeenCalled();
    expect(h).toContain('Qual regra vale');
    expect(h).toContain('NCM (produto)');
    expect(h).toContain('Regime (CRT)');
    expect(h.match(/barra-bloco/g)).toHaveLength(1);
    expect(h).not.toContain('<table');
    expect(h).not.toContain('Regra que vale<');
  });
  it('consulta completa: uma linha por tributo, com selo e fonte da regra', async () => {
    api.get.mockResolvedValue({ data_emissao: '2026-11-28', icms: ok('7'), ipi: sem, pis: ok('1'), cofins: ok('1') });
    const h = renderToStaticMarkup(await QualRegraVale({ acesso: 'x', rota: ROTA, busca: new URLSearchParams(CONSULTA) }));
    expect(api.get.mock.calls[0]?.[0]).toContain('/v1/fiscal/regras/resolver?');
    expect(h).toContain('142/2018');
    expect(h).toContain('Tipo da fonte');
    expect(h).toContain('Convênio');
    expect(h).not.toContain('convenio 142');
    expect(h).toContain('Regra que vale');
    expect(h).toContain('Nenhuma regra vigente');
    expect(h.match(/Regra encontrada/g)).toHaveLength(3);
  });
  it('a resposta mostra o CST como "código – nome" e a alíquota da regra escolhida; UF e CRT são listas', async () => {
    api.get.mockResolvedValue({ data_emissao: '2026-11-28', icms: { ...ok('7'), regra_id: 'r1' }, ipi: sem, pis: sem, cofins: sem });
    api.registro.mockResolvedValue({ codigo: '00', aliquota_icms: 180000 });
    const h = renderToStaticMarkup(await QualRegraVale({ acesso: 'x', rota: ROTA, busca: new URLSearchParams(CONSULTA) }));
    expect(api.registro).toHaveBeenCalledTimes(1);
    expect(api.registro.mock.calls[0]?.[0]).toBe('/v1/fiscal/regras/r1');
    expect(h).toContain('00 – Tributada integralmente');
    expect(h).toContain('18%');
    expect(h).toContain('>CST<');
    expect(h).toContain('>Alíquota<');
    expect(h).toContain('Informe a operação para ver a regra que o cálculo usa hoje.');
    expect(h).toMatch(/<select name="vale_uf_origem"[^>]*>.*<option value="AM"/);
    expect(h).toMatch(/<select name="vale_uf_destino"/);
    expect(h).not.toMatch(/<input name="vale_uf_/);
  });
  it('dado inválido vira orientação em português', async () => {
    api.get.mockRejectedValue(new DadosInvalidos('x'));
    const h = renderToStaticMarkup(await QualRegraVale({ acesso: 'x', rota: ROTA, busca: new URLSearchParams(CONSULTA) }));
    expect(h).toContain('Confira os dados');
  });
});

describe('regra aberta', () => {
  it('id fora do padrão UUID é 404, sem chamar a API', async () => {
    await expect(TelaRegraDetalhe({ acesso: 'x', perfil: 'fiscal', id: 'nova-x' })).rejects.toThrow('404');
    expect(api.registro).not.toHaveBeenCalled();
  });
  it('regra inexistente é 404', async () => {
    api.registro.mockResolvedValue(null);
    await expect(TelaRegraDetalhe({ acesso: 'x', perfil: 'fiscal', id: '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70' })).rejects.toThrow('404');
  });
});
