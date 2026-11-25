import { describe, expect, it } from 'vitest';
import { criarPluginIntegracaoFdv } from './index';

describe('plugin de rotas do integracao-fdv (BKO só leitura, ADR 0013 seção 6)', () => {
  const plugin = criarPluginIntegracaoFdv();
  const rotas = plugin.rotas.map((r) => `${r.metodo} ${r.caminho} ${r.acao}`);

  it('RN-CORE-02: declara só as rotas de leitura, todas com a ação integracao-fdv.ver', () => {
    expect(rotas.sort()).toEqual(
      [
        'GET /monitor integracao-fdv.ver',
        'GET /status integracao-fdv.ver',
        'GET /clientes-recebidos integracao-fdv.ver',
        'GET /clientes-recebidos/exportar integracao-fdv.ver',
        'GET /lotes integracao-fdv.ver',
        'GET /lotes/exportar integracao-fdv.ver',
        'GET /lotes/:id/erros integracao-fdv.ver',
      ].sort(),
    );
  });

  it('RF-INF-05: as cinco rotas de escrita saíram do BKO do tenant (viraram 404): a credencial e a operação são do portal', () => {
    for (const escrita of ['PUT /credencial', 'POST /credencial/testar', 'PUT /configuracao', 'POST /entidades/:entidade/carga-completa', 'POST /entidades/:entidade/retomar']) {
      expect(plugin.rotas.some((r) => `${r.metodo} ${r.caminho}` === escrita), escrita).toBe(false);
    }
    expect(plugin.rotas.every((r) => r.metodo === 'GET')).toBe(true);
  });
});
