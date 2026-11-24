import { describe, expect, it } from 'vitest';
import { semEspacoDuro } from '@macuxierp/platform-sdk/testes';
import { dialogoDaBandeira, requisicaoConfigurarBandeira, situacaoDaBandeira } from './index';

const FILIAL = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const cfg = (ligada: boolean) => ({ faturamento_real_nfe_simulada: ligada, ambiente: 'homologacao' as const });

describe('tela da bandeira de faturamento real com NF-e simulada (RN-FAT-04)', () => {
  it('RN-FAT-04: administrador tem botão ("Ligar" desligada, "Desligar" ligada); os outros perfis ficam com rotuloBotao null', () => {
    expect(situacaoDaBandeira('administrador', cfg(false))).toMatchObject({ selo: { texto: 'Desligada', tom: 'neutro' }, ambiente: { tom: 'alerta' }, rotuloBotao: 'Ligar' });
    expect(situacaoDaBandeira('administrador', cfg(true))).toMatchObject({ selo: { texto: 'Ligada', tom: 'ok' }, rotuloBotao: 'Desligar' });
    for (const perfil of ['faturista', 'fiscal', 'gerente', 'leitura', 'vendedor'] as const) {
      expect(situacaoDaBandeira(perfil, cfg(true)).rotuloBotao, perfil).toBeNull();
    }
  });
  it('RN-FAT-04: o ambiente é o da filial, em selo (a bandeira não muda o ambiente fiscal)', () => {
    expect(situacaoDaBandeira('leitura', { faturamento_real_nfe_simulada: true, ambiente: 'producao' }).ambiente).toEqual({ texto: 'Produção', tom: 'neutro' });
  });
  it('RN-FAT-04: a confirmação é curta: título com a filial, Voltar e Ligar/Desligar', () => {
    const liga = dialogoDaBandeira(true, { nome: 'Matriz Manaus' });
    expect(liga).toEqual({ titulo: 'Ligar a bandeira: Matriz Manaus?', rotuloConfirmar: 'Ligar', rotuloFechar: 'Voltar', destrutivo: false });
    expect(dialogoDaBandeira(false).titulo).toBe('Desligar a bandeira?');
    expect(semEspacoDuro(liga.titulo)).toBe(liga.titulo);
  });
  it('RN-FAT-04: o PUT leva a Idempotency-Key e só a bandeira no corpo; sem chave válida não monta', () => {
    expect(requisicaoConfigurarBandeira(FILIAL, true, 'chave-band-0001')).toEqual({
      ok: true, requisicao: { metodo: 'PUT', caminho: `/v1/faturamento/filiais/${FILIAL}/configuracao`, cabecalhos: { 'Idempotency-Key': 'chave-band-0001' }, corpo: { faturamento_real_nfe_simulada: true } },
    });
    expect(requisicaoConfigurarBandeira(FILIAL, false, 'x')).toMatchObject({ ok: false });
  });
});
