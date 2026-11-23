import { describe, expect, it } from 'vitest';
import { descontoNaCargaDoPreco } from './desconto';

describe('desconto máximo em qualquer ordem de carga', () => {
  it('RN-CAD-11: item com desconto próprio fica como está, sem aviso, mesmo com desconto no produto', () => {
    expect(descontoNaCargaDoPreco({ desconto_maximo_bp: 500, desconto_herdado: false }, 1250)).toEqual({ desconto_maximo_bp: 500, desconto_herdado: false, semDesconto: false });
    expect(descontoNaCargaDoPreco({ desconto_maximo_bp: 0, desconto_herdado: false }, null)).toEqual({ desconto_maximo_bp: 0, desconto_herdado: false, semDesconto: false });
  });

  it('RN-CAD-11: item novo com desconto no produto recebe o do produto, como herdado', () => {
    expect(descontoNaCargaDoPreco(null, 1250)).toEqual({ desconto_maximo_bp: 1250, desconto_herdado: true, semDesconto: false });
  });

  it('RN-CAD-11: item herdado acompanha o desconto do produto (inclusive 0)', () => {
    expect(descontoNaCargaDoPreco({ desconto_maximo_bp: 1250, desconto_herdado: true }, 0)).toEqual({ desconto_maximo_bp: 0, desconto_herdado: true, semDesconto: false });
  });

  it('RN-CAD-11: sem desconto no produto, item novo fica com 0 e avisa; item herdado mantém o que tem e avisa', () => {
    expect(descontoNaCargaDoPreco(null, null)).toEqual({ desconto_maximo_bp: 0, desconto_herdado: true, semDesconto: true });
    expect(descontoNaCargaDoPreco({ desconto_maximo_bp: 300, desconto_herdado: true }, null)).toEqual({ desconto_maximo_bp: 300, desconto_herdado: true, semDesconto: true });
  });
});
