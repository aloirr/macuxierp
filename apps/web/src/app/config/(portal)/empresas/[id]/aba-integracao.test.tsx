import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ENTIDADES_ENVIO_FDV, IntegracaoFdvPlataforma, MonitorConectorFdv } from '@macuxierp/platform-sdk';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { habilitadasApos, linhasCadastros } from '@/lib/config/integracao-fdv';
import { AbaIntegracao } from './aba-integracao';

const ID = '11111111-1111-4111-8111-111111111111';
const ENT: readonly string[] = ENTIDADES_ENVIO_FDV;
const dados = (extra: Record<string, unknown> = {}, com = true) =>
  IntegracaoFdvPlataforma.parse({
    empresa_id: ID, modulo_licenciado: true,
    credencial_id: com ? ID : null, conector_id: com ? 'erp-1' : null, ambiente: com ? 'teste' : null, chave_prefixo: com ? 'abcd1234' : null, criada_em: com ? '2026-11-23T12:00:00.000Z' : null, ultimo_uso_em: null,
    entidades_habilitadas: com ? ['produto', 'cliente'] : [], limite_registros_lote: com ? 500 : null, ultimo_sinal: null,
    cadastros: ENT.map((entidade) => ({ entidade, ligada: com && (entidade === 'produto' || entidade === 'cliente'), ultimo_envio_em: null, falha: entidade === 'cliente' && com ? { motivo: 'credencial', acao: 'corrigir_credencial' } : null, lote_em_voo: false })),
    ...extra,
  });
const monitor = (extra: Record<string, unknown> = {}) =>
  MonitorConectorFdv.parse({ identificador: 'erp-1', situacao: 'em_dia', versao: '1.4.2', ultimo_sinal_em: '2026-11-24T19:59:00.000Z', fila: { lotes: 2, linhas: 340 }, lido_em: '2026-11-24T18:39:00.000Z', ...extra });
const render = (d = dados(), m: MonitorConectorFdv | null = null) => renderToStaticMarkup(<AbaIntegracao empresaId={ID} dados={d} fuso="America/Manaus" monitor={m} />);

describe('aba Integração do /config (T-0056)', () => {
  it('bloco "Macuxi FDV" com credencial, chave só de escrita (senha, sem valor) e só o prefixo', () => {
    const h = render();
    expect(h).toContain('Macuxi FDV');
    expect(h).toContain('Conexão com o Macuxi FDV');
    expect(h).toContain('Cadastros enviados ao FDV');
    expect(h).not.toContain('Saída do ERP');
    expect(h).not.toContain('(resposta');
    expect(h).toContain('Código do conector');
    expect(h).toContain('Testar conexão');
    expect(h).toMatch(/<input[^>]*name="chave"[^>]*type="password"|<input[^>]*type="password"[^>]*name="chave"/);
    expect(h).not.toMatch(/name="chave"[^>]*value=/);
    expect(h).toContain('abcd1234…');
    expect(h).toContain('<span>Nova chave do conector</span>');
    expect(h).not.toContain('placeholder=');
    expect(h).toContain('Teste');
    expect(h).toContain('Produção');
  });
  it('um botão Ligar ou Desligar por cadastro, mais Reprocessar, Zerar, Log e tentar de novo', () => {
    const h = render();
    expect(h).toContain('aria-label="Desligar: Produtos"');
    expect(h).toContain('aria-label="Ligar: Estoque"');
    expect(h).toContain('aria-label="Reprocessar: Produtos"');
    expect(h).toContain('aria-label="Reprocessar: Estoque"');
    expect(h).toContain('aria-label="Zerar: Produtos"');
    expect(h).toContain('aria-label="Log: Produtos"');
    expect(h).not.toContain('Reenviar tudo');
    expect(h).toContain('aria-label="Tentar de novo: Clientes"');
    expect(h).not.toContain('aria-label="Tentar de novo: Produtos"');
    expect(h).toContain('Corrija a credencial do conector.');
  });
  it('coluna Ações: botões sem quebra, largura mínima 480 e legenda só para leitor de tela', () => {
    const h = render();
    const botoes = h.match(/<button[^>]*aria-label="(?:Desligar|Ligar|Reprocessar|Zerar|Log|Tentar de novo): [^"]*"[^>]*>/g) ?? [];
    expect(botoes.length).toBeGreaterThan(0);
    for (const b of botoes) expect(b).toMatch(/white-space:\s*nowrap/);
    expect(h).toMatch(/min-width:\s*480px/);
    expect(h).toMatch(/<div class="[^"]*legenda-so-leitor[^"]*"[^>]*>\s*<[^>]*>?[\s\S]*?<caption[^>]*>[^<]*Envio por cadastro/);
  });
  it('campo "Registros por lote": valor atual, máximo do SDK e padrão 5000 sem configuração', () => {
    const h = render();
    expect(h).toContain('Registros por lote');
    const campo = (x: string) => /<input[^>]*name="limite_registros_lote"[^>]*>/.exec(x)?.[0] ?? '';
    expect(campo(h)).toContain('max="5000"');
    expect(campo(h)).toContain('value="500"');
    expect(campo(render(dados({}, false)))).toContain('value="5000"');
  });
  it('sem credencial: ligar e testar desabilitados', () => {
    const h = render(dados({}, false));
    expect(h).toContain('Nenhuma credencial cadastrada');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Testar conexão/);
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Ligar: Produtos"|aria-label="Ligar: Produtos"[^>]*disabled=""/);
  });
  it('"Nenhum cadastro ligado" só quando nenhum está ligado (a credencial nasce sem cadastros)', () => {
    const nova = render(dados({}, false));
    expect(nova).toContain('Nenhum cadastro ligado.');
    expect(nova.indexOf('Nenhum cadastro ligado.')).toBeLessThan(nova.indexOf('<table'));
    expect(render()).not.toContain('Nenhum cadastro ligado');
  });
  it('sem a licença do módulo: aviso e escritas desabilitadas', () => {
    const h = render(dados({ modulo_licenciado: false }));
    expect(h).toContain('não está licenciado');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Trocar credencial/);
  });
  it('Reprocessar fica visível e desligado com "Enviando…" enquanto há lote em voo', () => {
    const d = dados();
    d.cadastros[4]!.lote_em_voo = true;
    const h = render(d);
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Reprocessar: Produtos"[^>]*>Enviando…<\/button>/);
    expect(h).toMatch(/aria-label="Reprocessar: Estoque"[^>]*>Reprocessar<\/button>/);
    expect(h).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Reprocessar: Estoque"/);
  });
  it('Zerar ao lado do Reprocessar; sem a carga completa e sem "Zerar dados"', () => {
    const h = render();
    expect(h.indexOf('aria-label="Reprocessar: Produtos"')).toBeLessThan(h.indexOf('aria-label="Zerar: Produtos"'));
    expect(h.indexOf('aria-label="Zerar: Produtos"')).toBeLessThan(h.indexOf('aria-label="Log: Produtos"'));
    expect(h).not.toContain('Zerar dados');
    expect(h).not.toContain('carga completa');
  });
  it('Monitor no topo, antes da conexão e da tabela: Identificador, Situação, Versão, Último sinal e Fila', () => {
    const h = render(dados(), monitor());
    expect(h.indexOf('>Monitor<')).toBeLessThan(h.indexOf('Conexão com o Macuxi FDV'));
    for (const t of ['Identificador', 'Situação', 'Versão', 'Último sinal', 'Fila']) expect(h).toContain(`<dt>${t}</dt>`);
    expect(h).toContain('<dd>erp-1</dd>');
    expect(h).toContain('>Em dia<');
    expect(h).toContain('1.4.2');
    expect(h).toContain('24/11/2026 15:59');
    expect(h).toContain('2 lotes · 340 linhas');
  });
  it('Atualizar com o "Atualizado às" ao lado (a conversão de fuso fica em operacao-fdv.test.ts)', () => {
    const h = render(dados(), monitor());
    expect(h).toContain('>Atualizar</button>');
    expect(h).toContain('data-testid="atualizado-as"');
    expect(h).not.toContain('data-testid="ultimo-sinal"');
  });
  it('situação Atrasado e Desativado em texto; sem Monitor, a aba segue com a mensagem e o Atualizar', () => {
    expect(render(dados(), monitor({ situacao: 'atrasado', ultimo_sinal_em: '2026-11-24T10:00:00.000Z' }))).toContain('>Atrasado<');
    const des = render(dados(), monitor({ identificador: null, versao: null, ultimo_sinal_em: null, situacao: 'desativado', fila: { lotes: 0, linhas: 0 } }));
    expect(des).toContain('>Desativado<');
    expect(des).toContain('0 lotes · 0 linhas');
    const sem = render();
    expect(sem).toContain('Monitor indisponível');
    expect(sem).toContain('>Atualizar</button>');
    expect(sem).not.toContain('Atualizado às');
  });
  it('a confirmação existe para ligar, desligar e retomar (DialogoMotivo no componente)', () => {
    const h = render();
    expect(h).not.toContain('role="dialog"'); // fechado até o clique
  });
  it('habilitadasApos mantém a ordem de carga e linhasCadastros formata o fuso', () => {
    expect(habilitadasApos(['cliente'], 'produto', true)).toEqual(['produto', 'cliente']);
    expect(habilitadasApos(['produto', 'cliente'], 'produto', false)).toEqual(['cliente']);
    const d = dados();
    d.cadastros[0]!.ultimo_envio_em = '2026-11-22T14:05:00.000Z';
    expect(linhasCadastros(d, 'America/Manaus')[0]?.ultimoEnvio).toMatch(/10:05/);
  });
});
