import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LogCadastroFdvPlataforma } from '@macuxierp/platform-sdk';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { CorpoLog, LogCadastro, RodapeLog } from './log-cadastro';

const log = (extra: Record<string, unknown> = {}) => LogCadastroFdvPlataforma.parse({
  entidade: 'cliente', lido_em: '2026-11-24T20:00:00.000Z', total_erros: 4, motivo: 'erros_por_linha',
  envios: [
    { em: '2026-11-24T19:00:00.000Z', origem: 'ciclo', situacao: 'com_erros', registros: 100, com_erro: 4 },
    { em: '2026-11-24T18:00:00.000Z', origem: 'zerar', situacao: 'enviando', registros: 7, com_erro: 0 },
  ],
  erros: [{ codigo: 'cnpj_invalido', campo: 'documento', quantidade: 3 }],
  ...extra,
});

describe('botão Log do /config (T-0086)', () => {
  it('só códigos, campos e contagens; envios com origem e situação em texto', () => {
    const h = renderToStaticMarkup(<CorpoLog log={log()} fuso="America/Manaus" entidade="cliente" />);
    expect(h).toContain('cnpj_invalido');
    expect(h).toContain('documento');
    expect(h).toContain('Erros abertos: 4');
    expect(h).not.toContain('Há registros com erro neste cadastro.');
    expect(h).not.toContain('O Log do /config');
    expect(h).toContain('Ciclo normal');
    expect(h).toContain('Zerar (inativação)');
    expect(h).toContain('Enviando…');
    expect(h).toContain('24/11/2026 15:00');
    expect(h).toContain('Mais 1 erro não aparece aqui.');
    expect(h).not.toContain('external_id');
    expect(h).not.toContain('nome_curto');
  });
  it('a faixa de aviso mostra o motivo do cadastro, menos o de erros por linha (a tabela já mostra)', () => {
    expect(renderToStaticMarkup(<CorpoLog log={log({ motivo: 'lote_falhou' })} fuso="America/Manaus" entidade="cliente" />)).toContain('O último envio falhou.');
  });
  it('cabe na janela: corpo encolhível, as duas tabelas rolam sozinhas e o rodapé quebra linha', () => {
    const h = renderToStaticMarkup(<CorpoLog log={log()} fuso="America/Manaus" entidade="cliente" />);
    expect(h).toContain('class="corpo-log"');
    expect(h.match(/class="tabela-rolavel/g)).toHaveLength(2);
    expect(renderToStaticMarkup(<RodapeLog log={log()} entidade="cliente" aoFechar={() => undefined} />)).toContain('class="rodape-log"');
  });
  it('sem envios e sem erros: mensagens vazias', () => {
    const h = renderToStaticMarkup(<CorpoLog log={log({ envios: [], erros: [], total_erros: 0, motivo: null })} fuso="America/Manaus" entidade="cliente" />);
    expect(h).toContain('Nenhum envio ainda.');
    expect(h).toContain('Nenhum erro aberto.');
  });
  it('rodapé: link do BKO só com o caminho e "Baixar erros (.csv)" só com erros listados', () => {
    const com = renderToStaticMarkup(<RodapeLog log={log()} entidade="cliente" aoFechar={() => undefined} />);
    expect(com).toContain('href="/integracao-fdv/integracao-fdv"');
    expect(com).toContain('Abrir no BKO da empresa');
    expect(com).toContain('Baixar erros (.csv)');
    const sem = renderToStaticMarkup(<RodapeLog log={log({ erros: [], total_erros: 0 })} entidade="cliente" aoFechar={() => undefined} />);
    expect(sem).not.toContain('Baixar erros');
    expect(renderToStaticMarkup(<RodapeLog log={null} entidade="cliente" aoFechar={() => undefined} />)).not.toContain('Baixar erros');
  });
  it('a janela abre carregando, com o título do cadastro', () => {
    const h = renderToStaticMarkup(<LogCadastro empresaId="11111111-1111-4111-8111-111111111111" entidade="cliente" rotulo="Clientes" fuso="America/Manaus" aoFechar={() => undefined} />);
    expect(h).toContain('Log: Clientes');
    expect(h).toContain('Carregando…');
    expect(h).toContain('Abrir no BKO da empresa');
  });
});
