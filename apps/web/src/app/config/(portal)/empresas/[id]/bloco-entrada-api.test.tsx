import { PortalEntradaLeitura } from '@macuxierp/platform-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock('../acoes-entrada', () => ({ gerarChaveEntradaAcao: vi.fn(), revogarChaveEntradaAcao: vi.fn() }));

import { estadoDaChave, linhasLotes, reduzirChave } from '@/lib/config/entrada';
import { BlocoEntradaApi, DialogoChave, ListaLotes } from './bloco-entrada-api';

const EMP = '11111111-1111-4111-8111-111111111111';
const CHAVE = 'Zx9'.repeat(14) + 'Q';
const leitura = (c: Record<string, unknown>[] = [{ conector_id: 'erp-cliente', prefixo: 'AbCdEfGh', criada_em: '2026-11-26T15:00:00.000Z', revogada_em: null }]) =>
  PortalEntradaLeitura.parse({
    credenciais: c,
    ultimo_sinal: null,
    lotes: [{ lote_id: EMP, entidade: 'cliente', modo: 'delta', status: 'falhou', recebidos: 5, com_erro: 5, recebido_em: '2026-11-26T14:00:00.000Z', concluido_em: null }],
  });
const bloco = (d: PortalEntradaLeitura | null) => renderToStaticMarkup(<BlocoEntradaApi empresaId={EMP} dados={d} fuso="America/Manaus" />);
const aberto = reduzirChave(estadoDaChave(), { tipo: 'gerada', chave: CHAVE });

describe('bloco Integração via API (T-0057 A1)', () => {
  it('sem chave: texto de apoio, ajuda do código, Gerar chave e nada de Revogar', () => {
    const h = bloco(leitura([]));
    expect(h).toContain('Integração via API');
    expect(h).toContain('Nenhuma chave gerada. Informe o código e gere a chave.');
    expect(h).toContain('Letras, números, ponto, hífen e sublinhado. Até 100.');
    expect(h).toContain('>Gerar chave</button>');
    expect(h).not.toContain('Revogar chave');
    expect(h).not.toMatch(/readonly/i);
  });
  it('com chave: ficha com prefixo, código somente leitura, Trocar e Revogar; nunca a chave inteira', () => {
    const h = bloco(leitura());
    expect(h).toContain('AbCdEfGh…');
    expect(h).toContain('Chave criada em');
    expect(h).toContain('ainda sem sinal');
    expect(h).toContain('Não muda com a troca da chave.');
    expect(h).toMatch(/readOnly=""|readonly=""/i);
    expect(h).toContain('>Trocar chave</button>');
    expect(h).toContain('>Revogar chave</button>');
    expect(h).not.toContain('role="dialog"');
  });
  it('sem a coluna via Conector, sem tabela de donos e sem a trava de 30%', () => {
    const h = bloco(leitura());
    expect(h).not.toContain('via Conector');
    expect(h).not.toContain('Dono de');
    expect(h).not.toContain('30%');
  });
  it('leitura indisponível: bloco segue como sem chave, com lista vazia', () => {
    const h = bloco(null);
    expect(h).toContain('>Gerar chave</button>');
    expect(h).toContain('Nenhum lote recebido.');
  });
  it('lista de lotes: cadastro, contagens e situação em texto', () => {
    const h = renderToStaticMarkup(<ListaLotes lotes={linhasLotes(leitura().lotes, 'America/Manaus')} />);
    expect(h).toContain('Clientes');
    expect(h).toContain('Falhou');
    expect(h).toContain('26/11/2026 10:00 (Manaus)');
    expect(h).not.toContain('selo-erro'); // a situação usa o Chip da ui, não o selo do shell
  });
  it('aviso do Revogar, exatamente como validado', async () => {
    const { AVISO_REVOGAR } = await import('@/lib/config/entrada-textos');
    expect(AVISO_REVOGAR).toBe('A chave atual para de funcionar agora. Para voltar a enviar, gere uma chave nova.');
  });
});

describe('diálogo da chave (README B)', () => {
  const render = (e = aberto) => renderToStaticMarkup(<DialogoChave estado={e} aoAcionar={() => undefined} />);
  it('aviso fixo, chave, Copiar, região de status vazia e "Já copiei"', () => {
    const h = render();
    expect(h).toContain('role="dialog"');
    expect(h).toContain('Chave de Integração via API');
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
