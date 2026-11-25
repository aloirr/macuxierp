import { describe, expect, it } from 'vitest';
import { CAMINHOS_INTEGRACAO_FDV_TENANT } from '@macuxierp/platform-sdk';
import { criarPluginIntegracaoFdv } from './index';
import { CAMINHO_LOG, CAMINHO_LOG_CSV } from './rotas';

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
        // T-0086: Log por cadastro (completo, do administrador da empresa) e o CSV dos erros
        'GET /entidades/:entidade/log integracao-fdv.ver',
        'GET /entidades/:entidade/log.csv integracao-fdv.ver',
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

describe('caminhos do Log (T-0086)', () => {
  it('RF-INF-04: os caminhos relativos do plugin são os do SDK sem o prefixo /integracao-fdv', () => {
    expect(`/integracao-fdv${CAMINHO_LOG}`).toBe(CAMINHOS_INTEGRACAO_FDV_TENANT.log);
    expect(`/integracao-fdv${CAMINHO_LOG_CSV}`).toBe(CAMINHOS_INTEGRACAO_FDV_TENANT.logCsv);
  });
});
