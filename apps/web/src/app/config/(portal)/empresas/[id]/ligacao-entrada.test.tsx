import { PortalEntradaLeitura } from '@macuxierp/platform-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock('../acoes-entrada', () => ({ gerarChaveEntradaAcao: vi.fn(), revogarChaveEntradaAcao: vi.fn() }));

import { estadoDaChave, reduzirChave } from '@/lib/config/entrada';
import { DialogoChave, LigacaoEntrada } from './ligacao-entrada';

const EMP = '11111111-1111-4111-8111-111111111111';
const CHAVE = 'Zx9'.repeat(14) + 'Q';
const leitura = (c: Record<string, unknown>[] = [{ conector_id: 'erp-cliente', prefixo: 'AbCdEfGh', criada_em: '2026-11-26T15:00:00.000Z', revogada_em: null }]) =>
  PortalEntradaLeitura.parse({
    credenciais: c,
    ultimo_sinal: null,
    lotes: [{ lote_id: EMP, entidade: 'cliente', modo: 'delta', status: 'falhou', recebidos: 5, com_erro: 5, recebido_em: '2026-11-26T14:00:00.000Z', concluido_em: null }],
  });
const bloco = (d: PortalEntradaLeitura | null) => renderToStaticMarkup(<LigacaoEntrada empresaId={EMP} dados={d} fuso="America/Manaus" />);
const aberto = reduzirChave(estadoDaChave(), { tipo: 'gerada', chave: CHAVE });

describe('v0.3.24: ligação "Sistema do cliente → ERP" (era "Integração via API")', () => {
  it('título "De → Para": a seta só visual e o leitor ouve "Sistema do cliente para o ERP"', () => {
    const h = bloco(leitura());
    expect(h).toMatch(/<h2 id="h-ligacao-entrada">Sistema do cliente <span class="seta" aria-hidden="true">→<\/span><span class="sr-only"> para o <\/span> ERP<\/h2>/);
    expect(h).toContain('aria-labelledby="h-ligacao-entrada"');
    expect(h).not.toContain('Integração via API');
    expect(h).not.toMatch(/\bAPI\b|conector/i);
  });
  it('sem chave: sem ficha, só o formulário (Código, ajuda e Gerar chave); nenhum erro antes de agir', () => {
    const h = bloco(leitura([]));
    expect(h).not.toContain('<dl');
    expect(h).toContain('<span>Código</span>');
    expect(h).toContain('Letras, números, ponto, hífen e sublinhado. Até 100.');
    expect(h).toContain('>Gerar chave</button>');
    expect(h).not.toContain('Revogar chave');
    expect(h).not.toContain('Nenhuma chave gerada');
    expect(h).not.toMatch(/erro-campo|aria-invalid/);
  });
  it('com chave: ficha única (Situação, Último contato, Código, Chave), Trocar e Revogar; sem Versão, Criada em nem a chave inteira', () => {
    const h = bloco(leitura());
    for (const dt of ['Situação', 'Último contato', 'Código', 'Chave']) expect(h).toContain(`<dt>${dt}</dt>`);
    expect(h).toContain('AbCdEfGh…');
    expect(h).toContain('erp-cliente');
    expect(h).toMatch(/Sem envio|Recebendo/);
    for (const fora of ['Versão', 'Criada em', 'Último sinal', 'readonly', '<input']) expect(h.toLowerCase()).not.toContain(fora.toLowerCase());
    expect(h).toContain('>Trocar chave</button>');
    expect(h).toContain('>Revogar chave</button>');
    expect(h).not.toContain('role="dialog"');
  });
  it('36 A: o resultado fica logo depois da fila de botões', () => {
    const h = bloco(leitura());
    const fila = h.indexOf('>Revogar chave</button></div>');
    expect(fila).toBeGreaterThan(0);
    expect(h.indexOf('data-resultado-acao', fila)).toBeGreaterThan(fila);
    expect(h).not.toMatch(/class="(faixa-aviso|erro)"/);
  });
  it('os lotes saíram daqui (aba Dados, "Cadastros recebidos")', () => {
    const h = bloco(leitura());
    expect(h).not.toContain('Lotes recebidos');
    expect(h).not.toContain('<table');
  });
  it('leitura indisponível: segue como sem chave', () => {
    expect(bloco(null)).toContain('>Gerar chave</button>');
  });
  it('diálogos falam do sistema do cliente; o aviso do Revogar fica como validado', async () => {
    const T = await import('@/lib/config/entrada-textos');
    expect([T.TITULO_TROCAR, T.TITULO_REVOGAR, T.TITULO_CHAVE]).toEqual(['Trocar a chave do sistema do cliente?', 'Revogar a chave do sistema do cliente?', 'Chave do sistema do cliente']);
    expect(T.AVISO_REVOGAR).toBe('A chave atual deixa de funcionar agora. Para voltar a enviar, gere uma chave nova.');
  });
});

describe('diálogo da chave (README B)', () => {
  const render = (e = aberto) => renderToStaticMarkup(<DialogoChave estado={e} aoAcionar={() => undefined} />);
  it('aviso fixo, chave, Copiar, região de status vazia e "Já copiei"', () => {
    const h = render();
    expect(h).toContain('role="dialog"');
    expect(h).toContain('Chave do sistema do cliente');
    expect(h).toContain('Esta chave não aparece de novo. Guarde agora.');
    expect(h).toContain(CHAVE);
    expect(h).toContain('>Copiar</button>');
    expect(h).toContain('>Já copiei</button>');
    expect(h).toMatch(/role="status"[^>]*><\/p>/);
    expect(h).not.toContain('Fechar sem copiar a chave?');
    // Copiar vem antes de "Já copiei": é o primeiro foco do Dialogo
    expect(h.indexOf('>Copiar<')).toBeLessThan(h.indexOf('>Já copiei<'));
  });
  it('Copiada e falha do clipboard saem em role="status"', () => {
    expect(render(reduzirChave(aberto, { tipo: 'copiou', ok: true }))).toMatch(/role="status"[^>]*>Copiada<\/p>/);
    expect(render(reduzirChave(aberto, { tipo: 'copiou', ok: false }))).toContain('Não foi possível copiar. Selecione a chave e copie à mão.');
  });
  it('fechar sem copiar abre a confirmação por cima, com Voltar e Fechar sem copiar', () => {
    const h = render(reduzirChave(aberto, { tipo: 'fechar' }));
    expect(h).toContain('Fechar sem copiar a chave?');
    expect(h).toContain('A chave não aparece de novo. Você terá de trocá-la.');
    expect(h).toContain('>Voltar</button>');
    expect(h).toContain('>Fechar sem copiar</button>');
    expect(h).toContain('data-destrutivo="true"');
    expect(h.split('role="dialog"')).toHaveLength(3);
  });
});
