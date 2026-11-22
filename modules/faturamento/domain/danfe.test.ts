import { describe, expect, it } from 'vitest';
import {
  AVISO_HOMOLOGACAO, caixaDoLogo, formatarChave, formatarDataHoraXml, formatarDecimalXml, formatarFone, LOGO_RESPIRO_PT, montarDanfe,
  ErroDanfe, FONTE_CONTEUDO_PT, MARCA_DAGUA, RODAPE_DANFE,
} from './danfe';
import { CHAVE_DANFE, nfeProcDeTeste } from './fixtures-danfe';

describe('DANFE: formatação pt-BR (RF-FAT-03)', () => {
  it('RF-FAT-03: decimais do XML em pt-BR, arredondando metade para cima sem ponto flutuante', () => {
    expect(formatarDecimalXml('1234567.8', 2)).toBe('1.234.567,80');
    expect(formatarDecimalXml('1.0000', 4)).toBe('1,0000');
    expect(formatarDecimalXml('10.5000000000', 4)).toBe('10,5000');
    expect(formatarDecimalXml('0.005', 2)).toBe('0,01');
    expect(formatarDecimalXml('1.00499', 2)).toBe('1,00');
    expect(formatarDecimalXml('-3.5', 2)).toBe('-3,50');
    expect(formatarDecimalXml('7', 0)).toBe('7');
  });
  it('RF-FAT-03: datas no fuso informado (Manaus UTC-4) e chave em grupos de 4', () => {
    expect(formatarDataHoraXml('2026-11-21T10:31:02-04:00', -240)).toBe('21/11/2026 10:31:02');
    expect(formatarDataHoraXml('2026-11-21T10:31:02-04:00', -180)).toBe('21/11/2026 11:31:02');
    expect(formatarDataHoraXml('2026-11-21T01:00:00Z', -240, true)).toBe('20/11/2026');
    expect(formatarChave(CHAVE_DANFE)).toBe('1326 1104 6415 3800 0145 5500 1000 0001 2312 3456 7890');
  });
});

describe('DANFE: telefone e legenda (design-de-marca, 2ª rodada)', () => {
  it('RF-FAT-03: telefone com máscara "(92) 3333-4444" (10 dígitos) ou "(92) 99999-4444" (11); outro formato volta como veio', () => {
    expect(formatarFone('9233334444')).toBe('(92) 3333-4444');
    expect(formatarFone('92999994444')).toBe('(92) 99999-4444');
    expect(formatarFone('3333-4444')).toBe('33334444');
    expect(formatarFone('+55 (92) 3333-4444')).toBe('559233334444');
    expect(formatarFone('923333444')).toBe('923333444');
    expect(formatarFone('')).toBe('');
    expect(montarDanfe({ nfeProc: nfeProcDeTeste() }).cabecalho.emitente.fone).toBe('(92) 3333-4444');
  });
  it('marca: constantes', () => {
    expect(FONTE_CONTEUDO_PT).toBe(7);
    expect(MARCA_DAGUA).toEqual({ fontePt: 60, anguloGraus: 45, cinza: 0.85 });
  });

  it('marca §3: a legenda do quadro DANFE tem 2 linhas, a 7 pt, e juntas dão o texto do MOC', () => {
    const c = montarDanfe({ nfeProc: nfeProcDeTeste() }).cabecalho;
    expect(c.subtituloLinhas).toHaveLength(2);
    expect(c.subtituloLinhas.join(' ')).toBe('Documento Auxiliar da Nota Fiscal Eletrônica');
  });
});

describe('DANFE: modelo em blocos (RF-FAT-03, MOC Anexo II)', () => {
  it('RF-FAT-03: monta canhoto, cabeçalho, destinatário, imposto, produtos e dados adicionais do nfeProc (snapshot do modelo)', () => {
    const m = montarDanfe({ nfeProc: nfeProcDeTeste({ duplicatas: true, infCpl: 'Pedido 1 &lt;obs&gt;' }) });
    expect(m.cabecalho.chave).toHaveLength(44);
    expect(m).toMatchSnapshot();
  });

  it('RF-FAT-03: protocolo com data e hora no fuso do tenant; 0 entrada / 1 saída', () => {
    expect(montarDanfe({ nfeProc: nfeProcDeTeste() }).operacao.protocolo).toBe('113260000000001 - 21/11/2026 10:31:02');
    expect(montarDanfe({ nfeProc: nfeProcDeTeste(), fusoMinutos: -180 }).operacao.protocolo).toBe('113260000000001 - 21/11/2026 11:31:02');
    const t = (tpNF: '0' | '1') => montarDanfe({ nfeProc: nfeProcDeTeste({ tpNF }) }).cabecalho.tipoOperacao;
    expect(t('0').codigo).toBe('0');
    expect(t('1').codigo).toBe('1');
    expect(t('1').legendas).toEqual(['0 - ENTRADA', '1 - SAÍDA']);
  });

  it('RF-FAT-03: homologação (tpAmb 2) leva a marca d\'água e o aviso; produção, nunca', () => {
    const h = montarDanfe({ nfeProc: nfeProcDeTeste({ tpAmb: '2' }) });
    expect(h.marcaDagua).toBe('SEM VALOR FISCAL');
    expect(h.avisoHomologacao).toBe(AVISO_HOMOLOGACAO);
    const p = montarDanfe({ nfeProc: nfeProcDeTeste({ tpAmb: '1' }) });
    expect(p.marcaDagua).toBeNull();
    expect(p.avisoHomologacao).toBeNull();
  });

  it('RF-FAT-03: nota cancelada leva a tarja CANCELADA', () => {
    expect(montarDanfe({ nfeProc: nfeProcDeTeste(), cancelada: true }).tarjaCancelada).toBe('CANCELADA');
    expect(montarDanfe({ nfeProc: nfeProcDeTeste() }).tarjaCancelada).toBeNull();
  });

  it('RD-0690: o modelo traz todos os itens em lista única (a paginação é do PDF)', () => {
    const m = montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 60 }) });
    expect(m.itens).toHaveLength(60);
    expect(m.itens[47]!.codigo).toBe('P48');
  });

  it('RF-FAT-03 (defeito: CNPJ alfanumérico saía sem máscara): CNPJ alfanumérico do emitente e do destinatário sai mascarado', () => {
    const base = nfeProcDeTeste();
    const xml = base.replace('<emit><CNPJ>04641538000145', '<emit><CNPJ>12ABC34501DE35').replace('<dest><CNPJ>45723174000110', '<dest><CNPJ>98XYZ76543AB21');
    const m = montarDanfe({ nfeProc: xml });
    expect(m.operacao.cnpj).toBe('12.ABC.345/01DE-35');
    expect(m.destinatario.documento).toBe('98.XYZ.765/43AB-21');
  });

  it('RF-FAT-03: recusa o que não é nfeProc autorizado', () => {
    expect(() => montarDanfe({ nfeProc: '<NFe/>' })).toThrow(ErroDanfe);
    expect(() => montarDanfe({ nfeProc: '<nfeProc><NFe><infNFe Id="NFe1"></infNFe></NFe></nfeProc>' })).toThrow(ErroDanfe);
    expect(() => montarDanfe({ nfeProc: '<a><b></a>' })).toThrow(ErroDanfe);
  });
});

describe('DANFE: regras de marca (docs/marca/danfe-e-pdfs-fiscais.md)', () => {
  it('marca §4: rodapé com 24 pt de altura, 111,4 de largura, 14,9 de proteção e sem o texto "Macuxi ERP"', () => {
    expect(RODAPE_DANFE).toMatchObject({ texto: 'Emitido pelo', alturaAssinaturaPt: 24, larguraAssinaturaPt: 111.4, protecaoPt: 14.9, baseTextoPt: 8.3 });
    expect(JSON.stringify(montarDanfe({ nfeProc: nfeProcDeTeste() }))).not.toMatch(/Macuxi/);
  });

  it('marca §1: logo cabe na caixa de 1/3 da largura por altura menos 1,5 mm em cima e embaixo, proporção preservada e centrado na vertical', () => {
    const quadro = { largura: 200, altura: 100 };
    const c = caixaDoLogo(quadro, { largura: 1000, altura: 500 }); // 2:1, alto resolução
    expect(c.largura / c.altura).toBeCloseTo(2, 6);
    expect(c.largura).toBeCloseTo(200 / 3 - LOGO_RESPIRO_PT, 6); // largura limita
    expect(c.altura).toBeLessThanOrEqual(100 - 2 * LOGO_RESPIRO_PT);
    expect(c.x).toBeCloseTo(LOGO_RESPIRO_PT, 6); // 1,5 mm para dentro da linha esquerda
    expect(c.y).toBeCloseTo((100 - c.altura) / 2, 6);
    const alto = caixaDoLogo(quadro, { largura: 500, altura: 1000 }); // 1:2: altura limita
    expect(alto.altura).toBeCloseTo(100 - 2 * LOGO_RESPIRO_PT, 6);
    expect(alto.y).toBeCloseTo(LOGO_RESPIRO_PT, 6);
  });

  it('marca §1: abaixo de 150 dpi o logo não é ampliado: sai menor, encostado à esquerda (1,5 mm do eixo) e centrado na vertical', () => {
    const c = caixaDoLogo({ largura: 200, altura: 100 }, { largura: 60, altura: 30 });
    expect(c.largura).toBeCloseTo((60 * 72) / 150, 6); // 28,8 pt
    expect(c.x).toBeCloseTo(4.25, 2); // 1,5 mm do eixo da caixa, como todo logo (não centra na horizontal)
    expect(c.x).toBeCloseTo(LOGO_RESPIRO_PT, 6);
    expect(c.y).toBeCloseTo((100 - c.altura) / 2, 6);
    expect((60 / c.largura) * 72).toBeCloseTo(150, 6);
  });
});

describe('fixture base do DANFE (regressão das amostras)', () => {
  it('amostras: a fixture com duplicatas e transportador tem fatura de 2 duplicatas, transportador e volumes "12 · CAIXA · MARCA TESTE · 1 a 12 · 131,250 · 120,500"', () => {
    const m = montarDanfe({ nfeProc: nfeProcDeTeste({ duplicatas: true, transportador: true }) });
    const json = JSON.stringify(m);
    expect(json).toContain('001');
    expect(json).toContain('002');
    expect(json).toContain('21/12/2026');
    expect(json).toContain('TRANSPORTES RIO NEGRO LTDA');
    expect(json).not.toContain('Sem ocorrência de transporte');
    for (const v of ['12', 'CAIXA', 'MARCA TESTE', '1 a 12', '131,250', '120,500']) expect(json).toContain(v);
  });
  it('amostras: duplicatas somam exatamente o vNF e o total de ICMS é a soma dos vICMS dos itens, em todas as variações', () => {
    const cent = (v: string) => Math.round(Number(v) * 100);
    const todas = (x: string, tag: string) => [...x.matchAll(new RegExp(`<${tag}>([0-9.]+)</${tag}>`, 'g'))].map((r) => cent(r[1]!));
    const variacoes = [
      { duplicatas: true },
      { duplicatas: true, itens: 30 },
      { duplicatas: true, item1: { vProd: '987654.32', aliqIcms: '18' } },
      { duplicatas: true, item1: { vProd: '1234567890123.00' } },
      { duplicatas: true, itens: 3, item1: { vProd: '0.03', aliqIcms: '18' } },
    ];
    for (const v of variacoes) {
      const x = nfeProcDeTeste(v);
      const vNF = todas(x, 'vNF')[0]!;
      expect(todas(x, 'vDup').reduce((a, b) => a + b, 0)).toBe(vNF);
      const total = x.match(/<ICMSTot>.*?<vICMS>([0-9.]+)<\/vICMS>/)![1]!;
      const itens = [...x.matchAll(/<ICMS00>.*?<vICMS>([0-9.]+)<\/vICMS>/g)].map((r) => cent(r[1]!));
      expect(cent(total)).toBe(itens.reduce((a, b) => a + b, 0));
    }
    expect(nfeProcDeTeste({ duplicatas: true, transportador: true })).toContain('Galpão 3');
  });
});
