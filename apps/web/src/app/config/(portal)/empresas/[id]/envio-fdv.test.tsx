import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ENTIDADES_ENVIO_FDV, IntegracaoFdvPlataforma } from '@macuxierp/platform-sdk';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { acoesDaLinhaFdv, habilitadasApos, linhasCadastros, type LinhaCadastroFdv } from '@/lib/config/integracao-fdv';
import { SecaoEnvioFdv } from './envio-fdv';

const ID = '11111111-1111-4111-8111-111111111111';
const ENT: readonly string[] = ENTIDADES_ENVIO_FDV;
const dados = (extra: Record<string, unknown> = {}, com = true) =>
  IntegracaoFdvPlataforma.parse({
    empresa_id: ID, modulo_licenciado: true,
    credencial_id: com ? ID : null, conector_id: com ? 'erp-1' : null, ambiente: com ? 'teste' : null, chave_prefixo: com ? 'abcd1234' : null, criada_em: com ? '2026-11-23T12:00:00.000Z' : null,
    entidades_habilitadas: com ? ['produto', 'cliente'] : [], limite_registros_lote: com ? 500 : null, ultimo_sinal: null,
    cadastros: ENT.map((entidade) => ({ entidade, ligada: com && (entidade === 'produto' || entidade === 'cliente'), ultimo_envio_em: null, falha: entidade === 'cliente' && com ? { motivo: 'credencial', acao: 'corrigir_credencial' } : null, lote_em_voo: false })),
    ...extra,
  });
const render = (d = dados()) => renderToStaticMarkup(<SecaoEnvioFdv empresaId={ID} dados={d} fuso="America/Manaus" />);

describe('v0.3.24: aba Dados, seção "ERP → Força de vendas" (a tabela saiu da aba Integração)', () => {
  it('título com a direção, Registros por lote com o Salvar na mesma linha, "Cadastros enviados" e Zerar pedidos', () => {
    const h = render();
    expect(h).toMatch(/<h2 id="h-dados-saida">ERP <span class="seta" aria-hidden="true">→<\/span><span class="sr-only"> para a <\/span> Força de vendas<\/h2>/);
    expect(h).toMatch(/<div class="campo-com-botao"><label class="campo"><span>Registros por lote<\/span>[\s\S]*?<\/label><button[^>]*>Salvar<\/button><\/div>/);
    expect(h).toMatch(/<caption[^>]*>Cadastros enviados<\/caption>/);
    expect(h).toContain('>Zerar pedidos não faturados</button>');
    expect(h).not.toContain('Envio por cadastro');
    expect(h).not.toContain('Nenhum cadastro ligado');
    expect(h).not.toMatch(/erro-campo|aria-invalid/); // nenhum erro antes de agir
  });
  it('campo "Registros por lote": valor atual, máximo do SDK e padrão 5000 sem configuração', () => {
    const campo = (x: string) => /<input[^>]*name="limite_registros_lote"[^>]*>/.exec(x)?.[0] ?? '';
    expect(campo(render())).toContain('max="5000"');
    expect(campo(render())).toContain('value="500"');
    expect(campo(render(dados({}, false)))).toContain('value="5000"');
  });
  it('36 A: Salvar, a tabela e Zerar pedidos com o retorno logo abaixo', () => {
    const h = render();
    const depois = (r: string) => h.indexOf('data-resultado-acao', h.indexOf(`>${r}</button>`));
    expect(depois('Salvar')).toBeLessThan(h.indexOf('<table'));
    expect(h.indexOf('data-resultado-acao', h.indexOf('</table>'))).toBeLessThan(h.indexOf('Zerar pedidos não faturados'));
    expect(depois('Zerar pedidos não faturados')).toBeGreaterThan(0);
  });
  it('sem a licença do módulo: escritas desabilitadas', () => {
    expect(render(dados({ modulo_licenciado: false }))).toMatch(/<button[^>]*disabled=""[^>]*>Zerar pedidos não faturados/);
  });
  const linha = (entidade: string, extra: Partial<LinhaCadastroFdv> = {}): LinhaCadastroFdv => ({ ...linhasCadastros(dados(), 'America/Manaus').find((l) => l.entidade === entidade)!, ...extra });
  const opcoes = { bloqueado: false, semCredencial: false, licenciado: true };
  it('uma linha, um botão "Ações" e uma ação principal só (nenhuma fileira de botões); a principal muda pela situação', () => {
    const h = render();
    const n = linhasCadastros(dados(), 'America/Manaus').length;
    expect(h.match(/aria-haspopup="menu"/g)).toHaveLength(n);
    expect(h.match(/>Ações<\/button>/g)).toHaveLength(n);
    for (const x of ['Produtos', 'Clientes', 'Estoque']) expect(h).toContain(`aria-label="Ações de ${x}"`);
    expect(h).not.toMatch(/>Zerar<|>Desligar<|>Ligar<|min-width:\s*480px/); // Zerar é perigo no menu, nunca solto na linha (marca, botao-acoes)
    expect(h).not.toContain('botao-perigo-contorno');
    expect(h).not.toContain('Reenviar tudo');
    expect(h).toContain('Use &quot;Trocar chave&quot;.');
    expect(h).not.toContain('credencial do conector');
    expect(h).toMatch(/>Log<\/button>/); // Produtos está em dia
    const clientes = linhasCadastros(dados(), 'America/Manaus').find((l) => l.entidade === 'cliente')!;
    expect(clientes.pausada).toBe(true); // credencial é motivo de pausa: Tentar de novo na frente
    expect(h).toMatch(/>Tentar de novo<\/button>/);
  });
  it('principal por situação: pausada → Tentar de novo; falha → Reprocessar; senão Log; nunca repetida no menu', () => {
    const emDia = acoesDaLinhaFdv(linha('produto'), opcoes);
    expect(emDia.principal.chave).toBe('log');
    const falha = acoesDaLinhaFdv(linha('produto', { falha: { motivo: 'x', acao: 'y' } }), opcoes);
    expect(falha.principal.chave).toBe('reprocessar');
    const pausada = acoesDaLinhaFdv(linha('produto', { falha: { motivo: 'x', acao: 'y' }, pausada: true }), opcoes);
    expect(pausada.principal).toMatchObject({ chave: 'retomar', rotulo: 'Tentar de novo' });
    for (const a of [emDia, falha, pausada]) expect(a.menu.map((x) => x.chave)).not.toContain(a.principal.chave);
  });
  it('Zerar é perigo, o último do menu; "Tentar de novo" some do menu quando a linha não está pausada', () => {
    const a = acoesDaLinhaFdv(linha('produto'), opcoes);
    expect(a.menu.at(-1)).toMatchObject({ chave: 'zerar', perigo: true });
    expect(a.menu.filter((x) => x.perigo)).toHaveLength(1);
    expect(a.menu.find((x) => x.chave === 'retomar')?.oculto).toBe(true);
    expect(acoesDaLinhaFdv(linha('produto', { pausada: true }), opcoes).principal.chave).toBe('retomar');
  });
  it('desabilitados: sem credencial desliga Ligar e Reprocessar; bloqueio desliga Zerar; sem licença desliga o Log; lote em voo mostra "Enviando…"', () => {
    const sem = acoesDaLinhaFdv(linha('produto'), { ...opcoes, semCredencial: true });
    expect(sem.menu.find((x) => x.chave === 'ligar')?.desabilitado).toBe(true);
    expect(sem.menu.find((x) => x.chave === 'reprocessar')?.desabilitado).toBe(true);
    expect(acoesDaLinhaFdv(linha('produto'), { ...opcoes, bloqueado: true }).menu.find((x) => x.chave === 'zerar')?.desabilitado).toBe(true);
    expect(acoesDaLinhaFdv(linha('produto'), { ...opcoes, licenciado: false }).principal.desabilitado).toBe(true);
    const voo = acoesDaLinhaFdv(linha('produto', { loteEmVoo: true }), opcoes).menu.find((x) => x.chave === 'reprocessar');
    expect(voo).toMatchObject({ rotulo: 'Enviando…', desabilitado: true });
    expect(acoesDaLinhaFdv(linha('produto', { ligada: false }), opcoes).menu.find((x) => x.chave === 'ligar')?.rotulo).toBe('Ligar');
  });
  it('36 A: coluna Situação em Ligado / Desligado', () => {
    const h = render();
    expect(h).not.toMatch(/>Ligada<|>Desligada</);
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

describe('v0.3.18 A2: próxima tentativa na tabela', () => {
  it('próxima tentativa da pausa por credencial, no fuso da empresa; só quando vier', () => {
    const d = dados();
    const com = IntegracaoFdvPlataforma.parse({ ...d, cadastros: d.cadastros.map((c) => (c.entidade === 'cliente' ? { ...c, proxima_tentativa_em: '2026-11-27T15:30:00.000Z' } : c)) });
    expect(render(com)).toContain('Próxima tentativa');
    expect(render(d)).not.toContain('Próxima tentativa');
  });
});
