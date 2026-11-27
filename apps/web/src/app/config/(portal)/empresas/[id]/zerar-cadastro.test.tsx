import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ZeragemPlataformaResposta } from '@macuxierp/platform-sdk';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));

import { AVISO_LIMITE_FDV, AVISO_ZERAR, BLOQUEIO_LOTE, textoSemChave } from '@/lib/config/cargas';
import { ResumoPrevia, ZerarCadastro } from './zerar-cadastro';

const EMP = '11111111-1111-4111-8111-111111111111';
const zerar = (entidade: 'produto' | 'forma_pagamento' | 'cliente_endereco', previaInicial: ZeragemPlataformaResposta | null = null) =>
  renderToStaticMarkup(<ZerarCadastro empresaId={EMP} entidade={entidade} rotulo="Produtos" aoFechar={() => undefined} aoZerar={() => undefined} previaInicial={previaInicial} />);
const previa = (extra: Record<string, unknown> = {}) => ZeragemPlataformaResposta.parse({
  empresa_id: EMP, simulado: true, efetivos: ['produto'], apagados: [], anulados: [],
  mantidos: [{ cadastro: 'produto', motivo: 'pedido', quantidade: 3 }], bloqueios: [], sem_chave: 0,
  inativacao_fdv: [{ entidade: 'produto', quantidade: 12 }], ...extra,
});

describe('Zerar por cadastro na aba Integração (T-0086)', () => {
  it('prévia sem junto, mantidos, anulados nem sem_chave: não renderiza o contêiner (T-0106)', () => {
    const vazia = previa({ efetivos: ['produto'], mantidos: [], anulados: [], sem_chave: 0 });
    expect(renderToStaticMarkup(<ResumoPrevia previa={vazia} escolhidos={['produto']} />)).toBe('');
    expect(renderToStaticMarkup(<ResumoPrevia previa={previa({ sem_chave: 2 })} escolhidos={['produto']} />)).toContain('previa-zerar');
  });
  it('avisa que apaga, que também inativa no FDV, pede a frase literal e começa desligado', () => {
    const h = zerar('produto', previa());
    expect(h).toContain(AVISO_ZERAR);
    expect(h).toContain('Também inativa no Macuxi FDV.');
    expect(h).not.toContain('serão inativados');
    expect(h).toContain('autorizo zerar os dados');
    expect(h).toContain('Zerar Produtos?');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Zerar<\/button>/);
    expect(h).toContain('role="dialog"');
    expect(h).not.toContain('type="checkbox"');
  });
  it('a prévia traz o aviso dos 30% do FDV uma vez', () => {
    const h = zerar('produto', previa());
    const aviso = AVISO_LIMITE_FDV;
    expect(h).toContain(aviso);
    expect(h.split(aviso)).toHaveLength(2);
    expect(h).toMatch(/<p class="faixa-aviso sem-margem" role="status" data-testid="aviso-30-fdv">/);
    expect(zerar('produto', null)).not.toContain(aviso);
  });
  it('prévia: mantidos e o que será inativado no FDV, por entidade do Hub', () => {
    const h = zerar('produto', previa({ inativacao_fdv: [{ entidade: 'cliente', quantidade: 3 }, { entidade: 'cliente_endereco', quantidade: 5 }] }));
    expect(h).toContain('Mantidos: 3');
    expect(h).toContain('Clientes: 3, Endereços de clientes: 5');
    expect(zerar('produto', previa({ inativacao_fdv: undefined }))).not.toContain('data-testid="inativacao-fdv"');
  });
  it('forma e prazo zeram o mesmo cadastro; cliente e endereço também: a tela diz isso', () => {
    expect(zerar('forma_pagamento', previa())).toContain('Zera também as condições de pagamento.');
    expect(zerar('cliente_endereco', previa())).toContain('Zera também os clientes e os contatos.');
    expect(zerar('forma_pagamento', previa())).not.toContain('mesmo cadastro'); // RD-2328: sem explicação interna
    expect(zerar('produto', previa())).not.toContain('Zera também');
  });
  it('só o lote em andamento bloqueia; sem bloqueio a tela não avisa nada', () => {
    const sem = zerar('produto', previa({ bloqueios: [] }));
    expect(sem).not.toContain('Zerar bloqueado');
    const com = zerar('produto', previa({ bloqueios: [{ cadastro: 'produto', motivo: 'lote_em_andamento' }] }));
    expect(com).toContain(BLOQUEIO_LOTE);
    expect(com).toMatch(/<button[^>]*disabled=""[^>]*>Zerar<\/button>/);
  });
  it('o aviso do FDV sem código de origem continua com sem_chave > 0', () => {
    expect(zerar('produto', previa({ sem_chave: 12 }))).toContain(textoSemChave(12));
  });
});
