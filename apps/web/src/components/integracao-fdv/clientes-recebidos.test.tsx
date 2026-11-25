import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaginaClientesRecebidosFdv, StatusIntegracaoFdvTenant, ENTIDADES_ENVIO_FDV } from '@macuxierp/platform-sdk';
import { caminhoApiClientesRecebidos, lerConsultaUrl, montarVistaClientesRecebidos } from '@/lib/clientes-recebidos';
import { SecaoClientesRecebidos } from './clientes-recebidos';

const estado = vi.hoisted(() => ({ falha: null as unknown, chamadas: [] as string[], pagina: null as unknown }));
vi.mock('next/navigation', () => ({ redirect: (d: string) => { throw new Error(`REDIRECT ${d}`); } }));
vi.mock('@/lib/api', async () => {
  class NaoAutenticado extends Error {}
  class SemPermissao extends Error {}
  class ApiIndisponivel extends Error {}
  return {
    NaoAutenticado, SemPermissao, ApiIndisponivel,
    getValidado: async (caminho: string) => {
      estado.chamadas.push(caminho);
      if (caminho.includes('clientes-recebidos')) { if (estado.falha) throw estado.falha; return estado.pagina; }
      return status;
    },
  };
});

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { codigo_fdv: null, vendedor_external_id: null, recebido_em: '2026-11-24T14:30:00.000Z', revisao: 1, motivo: null, erros: [], cliente_id: null, retorno: null, documento_mascarado: '12.345.678/****-**' };
const itens = [
  { ...base, id: U(1), cliente_uuid: U(11), razao_social: 'Mercado Rio Branco Ltda', situacao: 'recebido' },
  { ...base, id: U(2), cliente_uuid: U(12), razao_social: 'Padaria Boa Vista ME', situacao: 'aceito', cliente_id: U(99), documento_mascarado: '***.456.789-**', vendedor_external_id: 'V-07' },
  { ...base, id: U(3), cliente_uuid: U(13), razao_social: 'Casa Norte Comércio', situacao: 'recusado', revisao: 2, retorno: 'falhou', motivo: 'Documento inválido e cidade inexistente.', erros: [{ campo: 'documento', codigo: 'documento_invalido', mensagem: 'Documento inválido.' }, { campo: 'cidade', codigo: 'cidade_inexistente', mensagem: 'Cidade não encontrada.' }] },
  { ...base, id: U(4), cliente_uuid: U(14), razao_social: 'Depósito Equatorial', situacao: 'reenviado', revisao: 3, retorno: 'enviado' },
];
const pagina = PaginaClientesRecebidosFdv.parse({ itens, proximo_cursor: U(4) });
const status = StatusIntegracaoFdvTenant.parse({
  conector_id: 'erp-1', ambiente: 'teste', chave_prefixo: 'abcd1234',
  cadastros: ENTIDADES_ENVIO_FDV.map((entidade) => ({ entidade, ligada: true, ultimo_envio_em: null, falha: null })),
  ultimo_sinal: { ultimo_envio_em: null, ultimo_aceito_em: null, ultimo_http: null, parado_por_versao: false },
});
const R = '/integracao-fdv/integracao-fdv';
const html = (c = {}, p = pagina) => renderToStaticMarkup(<SecaoClientesRecebidos vista={montarVistaClientesRecebidos(p, 'America/Manaus')} rota={R} consulta={c} />);

beforeEach(() => { estado.falha = null; estado.chamadas = []; estado.pagina = pagina; });

describe('BKO: Clientes recebidos do FDV (T-0059)', () => {
  it('quatro selos de situação', () => {
    const h = html();
    for (const t of ['Recebido', 'Aceito', 'Recusado', 'Reenviado']) expect(h).toContain(`>${t}</span>`);
    expect(h).toContain('selo selo-erro');
  });
  it('documento só mascarado, vendedor "—" quando nulo, data no fuso do tenant', () => {
    const h = html();
    expect(h).toContain('12.345.678/****-**');
    expect(h).toContain('***.456.789-**');
    expect(h).not.toMatch(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    expect(h).toContain('V-07');
    expect(h).toContain('>—<');
    expect(h).toMatch(/24\/11\/2026,? 10:30/);
  });
  it('Revisão só quando maior que 1; Retorno só quando falhou', () => {
    const v = montarVistaClientesRecebidos(pagina, 'America/Manaus').linhas;
    expect(v.map((l) => l.revisao)).toEqual([null, null, 2, 3]);
    expect(v.map((l) => l.retorno)).toEqual([null, null, 'Não voltou ao FDV', null]);
    const h = html();
    expect(h.match(/Não voltou ao FDV/g)).toHaveLength(1);
  });
  it('recusado abre os erros por campo, o motivo e o texto de reenvio', () => {
    const h = html();
    expect(h).toContain('<details');
    expect(h).not.toContain('Documento inválido e cidade inexistente.');
    expect(h).toContain('<li>Documento inválido.</li>');
    expect(h).toContain('<li>Cidade não encontrada.</li>');
    expect(h).not.toContain('documento:');
    expect(h).toContain('Corrija no Macuxi FDV e reenvie.');
    expect(h.match(/<details/g)).toHaveLength(1);
  });
  it('recusado sem erros por campo mostra o motivo', () => {
    const sem = PaginaClientesRecebidosFdv.parse({ itens: [{ ...itens[2], erros: [] }], proximo_cursor: null });
    expect(html({}, sem)).toContain('Documento inválido e cidade inexistente.');
  });
  it('aceito leva "Abrir cliente" ao cadastro; os demais não', () => {
    const h = html();
    expect(h.match(/Abrir cliente/g)).toHaveLength(1);
    expect(h).toContain(`href="/cadastros/clientes/${U(99)}"`);
  });
  it('filtro por situação e página na URL: links e aria-current', () => {
    const h = html({ situacao: 'recusado', cursor: U(5) });
    expect(h).toContain(`href="${R}?situacao=recusado" aria-current="true"`);
    expect(h).toContain(`href="${R}?situacao=aceito"`);
    expect(h).toContain(`href="${R}?cursor=${U(4)}&amp;situacao=recusado">Próxima página`);
    expect(h).toContain(`href="${R}?situacao=recusado">Voltar ao início`);
    expect(html()).not.toContain('Voltar ao início');
    expect(html({}, PaginaClientesRecebidosFdv.parse({ itens, proximo_cursor: null }))).toContain('Fim da lista.');
  });
  it('lerConsultaUrl ignora valor inválido e a API recebe limite 50, situação e cursor', () => {
    expect(lerConsultaUrl({ situacao: 'x', cursor: 'abc' })).toEqual({});
    expect(lerConsultaUrl({ situacao: ['aceito'] })).toEqual({});
    expect(caminhoApiClientesRecebidos(lerConsultaUrl({ situacao: 'aceito', cursor: U(5) }))).toBe(`/v1/integracao-fdv/clientes-recebidos?cursor=${U(5)}&limite=50&situacao=aceito`);
    expect(caminhoApiClientesRecebidos({})).toBe('/v1/integracao-fdv/clientes-recebidos?limite=50');
  });
  it('vazio e sem próxima página: sem paginação', () => {
    const h = html({}, PaginaClientesRecebidosFdv.parse({ itens: [], proximo_cursor: null }));
    expect(h).toContain('Nenhum cliente recebido.');
    expect(h).not.toContain('Próxima página');
  });

  describe('tela (servidor)', () => {
    const render = async (busca = {}) => {
      const { TelaIntegracaoFdv } = await import('@/app/(shell)/[modulo]/[...pagina]/tela-integracao-fdv');
      return renderToStaticMarkup(await TelaIntegracaoFdv({ acesso: 't', fuso: 'America/Manaus', perfil: 'administrador', rota: R, busca }));
    };
    it('mostra a seção abaixo da tabela de cadastros e pede a página filtrada', async () => {
      const h = await render({ situacao: 'aceito' });
      expect(h.indexOf('Cadastros enviados ao FDV')).toBeLessThan(h.indexOf('Clientes recebidos'));
      expect(estado.chamadas).toContain('/v1/integracao-fdv/clientes-recebidos?limite=50&situacao=aceito');
      expect(h).not.toContain('Clientes recebidos do FDV');
    });
    it('403 (sem perfil ou licença): a seção some e o resto fica', async () => {
      const { SemPermissao } = await import('@/lib/api');
      estado.falha = new SemPermissao();
      const h = await render();
      expect(h).not.toContain('Clientes recebidos');
      expect(h).toContain('Cadastros enviados ao FDV');
    });
    it('API fora do ar: mensagem só na seção', async () => {
      const { ApiIndisponivel } = await import('@/lib/api');
      estado.falha = new ApiIndisponivel('x');
      const h = await render();
      expect(h).toContain('Não foi possível carregar os clientes recebidos agora.');
      expect(h).toContain('Cadastros enviados ao FDV');
    });
  });
});
