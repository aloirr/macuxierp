import { describe, expect, it } from 'vitest';
import { casarRota, paginaDaRota, paginasDoMenu } from '../paginas';
import { telaDaRota } from '../telas';
import { LISTA_LOTES } from './integracao-fdv';

const LOTE = {
  id: '00000000-0000-4000-8000-000000000001', entidade: 'produto', modo: 'completo', geracao: 1, estado: 'concluido_com_erros', repetido: false, registros: 10, aceitos: 8, com_erro: 2,
  tentativas: 1, ultimo_erro_codigo: null, ultimo_erro_mensagem: null, enviado_em: '2026-11-22T14:00:00.000Z', concluido_em: null,
};

describe('Integração FDV no shell (T-0011)', () => {
  it('o monitor é o item de menu; os envios abrem pela URL e ficam fora do menu', () => {
    expect(paginasDoMenu('integracao-fdv', 'Integração FDV').map((p) => p.rota)).toEqual(['/integracao-fdv/integracao-fdv']);
    expect(paginaDaRota('/integracao-fdv/integracao-fdv/lotes')?.ocultaNoMenu).toBe(true);
    expect(casarRota('/integracao-fdv/integracao-fdv/lotes')?.pagina.rota).toBe('/integracao-fdv/integracao-fdv/lotes');
  });
  it('a lista de envios tem descritor e mostra o horário de Manaus', () => {
    expect(telaDaRota('/integracao-fdv/integracao-fdv/lotes')).toBe(LISTA_LOTES);
    const l = LISTA_LOTES.linha(LOTE, 'America/Manaus');
    expect(l.entidade).toBe('Produtos');
    expect(l.estado).toBe('Concluído com erros');
    expect(l.enviado_em).toBe('22/11/2026 10:00');
    expect(l.concluido_em).toBe('');
  });
});
