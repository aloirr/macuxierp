import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AssinaturaErp,
  assinaturaANegativoGrafite,
  assinaturaCPositivo,
  paraDataUri,
} from './marca.js';

describe('AssinaturaErp com fundo (T-0050 E5, ressalvas da marca)', () => {
  it('A sobre grafite e C sobre pérola renderizam o ativo certo, com alt "Macuxi ERP"', () => {
    const a = renderToStaticMarkup(<AssinaturaErp fundo="grafite" />);
    expect(a).toContain(paraDataUri(assinaturaANegativoGrafite).replace(/&/g, '&amp;'));
    expect(a).toContain('alt="Macuxi ERP"');
    const c = renderToStaticMarkup(<AssinaturaErp variante="C" fundo="perola" altura={100} />);
    expect(c).toContain(paraDataUri(assinaturaCPositivo).replace(/&/g, '&amp;'));
    expect(c).toContain('height="100"');
    expect(c).toContain('alt="Macuxi ERP"');
  });
  it('sem fundo nada muda; fundo azul-noite explícito é o mesmo', () => {
    expect(renderToStaticMarkup(<AssinaturaErp />)).toBe(renderToStaticMarkup(<AssinaturaErp fundo="azul-noite" />));
    expect(renderToStaticMarkup(<AssinaturaErp variante="C" />)).toBe(renderToStaticMarkup(<AssinaturaErp variante="C" fundo="azul-noite" />));
  });
  it('combinação inválida é erro de tipo', () => {
    // @ts-expect-error A não existe sobre pérola
    void (<AssinaturaErp fundo="perola" />);
    // @ts-expect-error C não existe sobre grafite
    void (<AssinaturaErp variante="C" fundo="grafite" />);
  });
});
