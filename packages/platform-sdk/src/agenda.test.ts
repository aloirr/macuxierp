/**
 * Id da agenda (contrato C-9): `<modulo>.<agenda>` com `-` ou `_`, como os ids de consumidor. Alargar o padrão do
 * `PADRAO_TIPO_TRABALHO` é compatível: todo id que valia continua valendo.
 */
import { describe, expect, it } from 'vitest';
import { PADRAO_ID_AGENDA } from './agenda';
import { PADRAO_TIPO_TRABALHO } from './trabalhos';

describe('PADRAO_ID_AGENDA', () => {
  it('aceita os ids do integracao-fdv (com hífen) e os do padrão antigo', () => {
    for (const id of ['integracao-fdv.conector', 'integracao-fdv.busca-pedidos', 'integracao-fdv.retorno-pedidos', 'integracao-fdv.envio_lote', 'fiscal.sefaz2', 'core._interno']) {
      expect(PADRAO_ID_AGENDA.test(id), id).toBe(true);
    }
  });

  it('recusa módulo desconhecido, maiúscula, espaço, começo com hífen ou dígito e nome vazio', () => {
    for (const id of ['envio', 'outro.envio', 'integracao-fdv.Envio', 'integracao-fdv.envio pedidos', 'integracao-fdv.-envio', 'integracao-fdv.1envio', 'integracao-fdv.']) {
      expect(PADRAO_ID_AGENDA.test(id), id).toBe(false);
    }
  });

  it('compatível: todo id que passa no PADRAO_TIPO_TRABALHO passa aqui', () => {
    for (const id of ['cadastros.consultar_ie', 'core.exportar', 'integracao-fdv.sinal']) {
      expect(PADRAO_TIPO_TRABALHO.test(id)).toBe(true);
      expect(PADRAO_ID_AGENDA.test(id)).toBe(true);
    }
  });
});
