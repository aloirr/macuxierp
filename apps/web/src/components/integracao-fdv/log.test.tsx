import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LogCadastroFdvTenant } from '@macuxierp/platform-sdk';
import { caminhoDoLogCsv, colunasDeErrosLog, ROTULO_BAIXAR_ERROS, TEXTO_ESTADO_LOG } from '@macuxierp/integracao-fdv/web';
import { CorpoLogBko, EstadoLog, BotaoLog, caminhoDoDownloadErros } from './log';

vi.mock('@/app/(shell)/[modulo]/[...pagina]/acoes-log-fdv', () => ({ lerLogFdv: async () => ({ ok: false, motivo: 'erro' }) }));

const log = LogCadastroFdvTenant.parse({
  entidade: 'cliente', lido_em: '2026-11-22T15:00:00.000Z', motivo: 'erros_por_linha', total_erros: 3,
  envios: [{ em: '2026-11-22T14:05:00.000Z', origem: 'ciclo', situacao: 'com_erros', registros: 10, com_erro: 2 }],
  erros: [
    { registro_external_id: 'CLI-001', nome_curto: 'Mercado Sol', campo: 'cnpj', codigo: 'cnpj_invalido', motivo_texto: 'O CNPJ é inválido.', acao_texto: 'Corrija o CNPJ no cadastro.', corrigir_href: '/cadastros/clientes/abc' },
    { registro_external_id: 'CLI-002', nome_curto: null, campo: null, codigo: 'apagado', motivo_texto: 'O registro foi apagado.', acao_texto: 'Nada a fazer.', corrigir_href: null },
  ],
});

describe('BKO: Log da Integração FDV (T-0086, D-4)', () => {
  it('mostra as colunas, o registro, o nome curto, o campo, o motivo e a ação', () => {
    const h = renderToStaticMarkup(<CorpoLogBko log={log} entidade="cliente" fuso="America/Manaus" />);
    for (const c of colunasDeErrosLog) expect(h).toContain(c.titulo);
    for (const t of ['CLI-001', 'Mercado Sol', 'cnpj', 'O CNPJ é inválido.', 'Corrija o CNPJ no cadastro.']) expect(h).toContain(t);
  });

  it('"Corrigir" só como link quando há corrigirHref', () => {
    const h = renderToStaticMarkup(<CorpoLogBko log={log} entidade="cliente" fuso="America/Manaus" />);
    expect(h.match(/<a /g)).toHaveLength(1);
    expect(h).toContain('<a href="/cadastros/clientes/abc">Corrigir</a>');
  });

  it('mostra o horário do envio em Manaus (14:05 UTC = 10:05)', () => {
    expect(renderToStaticMarkup(<CorpoLogBko log={log} entidade="cliente" fuso="America/Manaus" />)).toContain('10:05');
  });

  it('o CSV vai pelo proxy do shell, que chama o caminho do módulo', () => {
    expect(caminhoDoDownloadErros('cliente')).toBe('/baixar-erros-fdv?entidade=cliente');
    expect(caminhoDoLogCsv('cliente')).toBe('/v1/integracao-fdv/entidades/cliente/log.csv');
    expect(ROTULO_BAIXAR_ERROS).toBe('Baixar erros (.csv)');
  });

  it('estados: carregando, vazio, erro e sem permissão', () => {
    const e = (r: Parameters<typeof EstadoLog>[0]['r']) => renderToStaticMarkup(<EstadoLog r={r} entidade="cliente" fuso="America/Manaus" />);
    expect(e(null)).toContain(TEXTO_ESTADO_LOG.carregando);
    expect(e({ ok: true, log: { ...log, total_erros: 0, erros: [], envios: [] } })).toContain(TEXTO_ESTADO_LOG.vazio);
    expect(e({ ok: false, motivo: 'erro' })).toContain(TEXTO_ESTADO_LOG.erro);
    expect(e({ ok: false, motivo: 'sem_permissao' })).toContain(TEXTO_ESTADO_LOG.semPermissao);
  });

  it('o botão Log fica escondido sem integracao-fdv.ver e aparece com ela', () => {
    expect(renderToStaticMarkup(<BotaoLog entidade="cliente" fuso="America/Manaus" podeVer={false} />)).toBe('');
    expect(renderToStaticMarkup(<BotaoLog entidade="cliente" fuso="America/Manaus" podeVer />)).toContain('>Log</button>');
  });
});
