import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ENTIDADES_HUB_F2, MonitorResposta } from '@macuxierp/integracao-fdv/contracts';
import type { Perfil } from '@macuxierp/platform-sdk';
import { montarVista } from '@/lib/integracao-fdv';
import { VistaIntegracaoFdv } from './vista';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const monitor: MonitorResposta = {
  credencial: { id: U(1), conector_id: 'erp-1', ambiente: 'teste', chave_prefixo: 'abcd1234', criada_em: '2026-11-22T14:00:00.000Z', ultimo_uso_em: null },
  configuracao: { entidades_habilitadas: ['produto', 'cliente'], limite_registros_lote: 500 },
  sinal: { ultimo_envio_em: '2026-11-22T14:05:00.000Z', ultimo_aceito_em: '2026-11-22T14:05:00.000Z', ultimo_http: 200, parado_por_versao: false, politica_versao: null },
  entidades: ENTIDADES_HUB_F2.map((entidade) => ({
    entidade, ultimo_envio_em: null, ultimo_sucesso_em: null, pendentes: 3, situacao: entidade === 'produto' ? ('pausada' as const) : ('ok' as const),
    pausada_motivo: entidade === 'produto' ? ('credencial' as const) : null, pausada_mensagem: entidade === 'produto' ? 'Credencial recusada pelo FDV.' : null, habilitada: entidade === 'produto' || entidade === 'cliente', erros_abertos: 0,
  })),
  erros: [{ id: U(2), lote_envio_id: U(3), indice: 0, origem: 'hub', entidade: 'cliente', registro_external_id: 'C-1', codigo: 'CAMPO_INVALIDO' as never, campo: null as never, reprocessavel: false, resolvido_em: null, mensagem: 'Campo inválido.' }],
  conflitos: [],
};

const render = (perfil: Perfil) =>
  renderToStaticMarkup(
    <VistaIntegracaoFdv
      vista={montarVista(monitor, perfil, 'America/Manaus', '/integracao-fdv/integracao-fdv/lotes')}
      acoes={{ testar: vi.fn(), tentarDeNovo: vi.fn(), cargaCompleta: vi.fn(), exportarErros: vi.fn(), salvarCredencial: async () => true, salvarConfiguracao: vi.fn() }}
      estado={{ ocupado: false, mensagem: null, erros: {} }}
    />,
  );

describe('tela Integração FDV (T-0011)', () => {
  it('administrador vê os botões de mudança e a chave em campo de senha, sem valor', () => {
    const h = render('administrador');
    for (const t of ['Salvar credencial', 'Testar conexão', 'Tentar de novo', 'Carga completa', 'Salvar configuração', 'Exportar CSV']) expect(h, t).toContain(t);
    expect(h).toMatch(/<input[^>]*name="chave"[^>]*type="password"|<input[^>]*type="password"[^>]*name="chave"/);
    expect(h).not.toMatch(/name="chave"[^>]*value=/);
    expect(h).toContain('abcd1234…');
    expect(h).toContain('/integracao-fdv/integracao-fdv/lotes');
  });
  it.each<Perfil>(['gerente', 'leitura'])('%s só consulta: sem botões de mudança nem campo de chave', (perfil) => {
    const h = render(perfil);
    for (const t of ['Salvar credencial', 'Testar conexão', 'Tentar de novo', 'Carga completa', 'Salvar configuração', 'type="password"']) expect(h, t).not.toContain(t);
    expect(h).toContain('Credencial recusada pelo FDV.');
    expect(h).toContain('Conexão com o FDV');
  });
});
