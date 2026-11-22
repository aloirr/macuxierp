import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssinaturaErp, SHA256_ASSINATURA_C_NEGATIVO_AZUL_NOITE, alturaAssinaturaVariante, assinaturaCNegativoAzulNoite, paraDataUri } from './marca.js';

const src = (svg: string) => `src="${paraDataUri(svg).replace(/&/g, '&amp;')}"`;

describe('assinatura C, vertical de apoio (T-0021)', () => {
  it('o SHA-256 do literal mais quebra de linha é o da constante', () => {
    expect(createHash('sha256').update(assinaturaCNegativoAzulNoite + '\n').digest('hex')).toBe(SHA256_ASSINATURA_C_NEGATIVO_AZUL_NOITE);
  });
  it('variante C usa a imagem C e height 62', () => {
    const h = renderToStaticMarkup(<AssinaturaErp variante="C" />);
    expect(h).toContain(src(assinaturaCNegativoAzulNoite));
    expect(h).toContain('height="62"');
    expect(h).toContain('alt="Macuxi ERP"');
  });
  it('na C, 40 vira 62 e 100 continua 100 (sem teto)', () => {
    expect(alturaAssinaturaVariante('C', 40)).toBe(62);
    expect(alturaAssinaturaVariante('C', 100)).toBe(100);
    expect(renderToStaticMarkup(<AssinaturaErp variante="C" altura={40} />)).toContain('height="62"');
    expect(renderToStaticMarkup(<AssinaturaErp variante="C" altura={100} />)).toContain('height="100"');
  });
  it('sem variante continua igual à A', () => {
    expect(renderToStaticMarkup(<AssinaturaErp />)).toBe(renderToStaticMarkup(<AssinaturaErp variante="A" />));
  });
});
