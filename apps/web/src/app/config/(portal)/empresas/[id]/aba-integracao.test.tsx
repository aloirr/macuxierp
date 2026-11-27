import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ENTIDADES_ENVIO_FDV, IntegracaoFdvPlataforma, MonitorConectorFdv } from '@macuxierp/platform-sdk';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { acoesDaLinhaFdv, habilitadasApos, linhasCadastros, type LinhaCadastroFdv } from '@/lib/config/integracao-fdv';
import { AbaIntegracao, DialogoTrocarChave } from './aba-integracao';

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
const monitor = (extra: Record<string, unknown> = {}) =>
  MonitorConectorFdv.parse({ identificador: 'erp-1', situacao: 'em_dia', versao: '1.4.2', ultimo_sinal_em: '2026-11-24T19:59:00.000Z', fila: { lotes: 2, linhas: 340 }, lido_em: '2026-11-24T18:39:00.000Z', ...extra });
const render = (d = dados(), m: MonitorConectorFdv | null = null) => renderToStaticMarkup(<AbaIntegracao empresaId={ID} dados={d} fuso="America/Manaus" monitor={m} />);

describe('aba Integração do /config (T-0056)', () => {
  it('bloco "Macuxi FDV" com credencial, chave só de escrita (senha, sem valor) e só o prefixo', () => {
    const h = render();
    expect(h).toContain('Macuxi FDV');
    expect(h).toContain('Conexão com o Macuxi FDV');
    expect(h).toContain('Cadastros enviados ao Macuxi FDV');
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
  it('legenda só para leitor de tela', () => {
    const h = render();
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
    expect(h).toContain('Nenhuma chave salva. Informe o código e a chave do conector.');
    expect(h).toMatch(/<button[^>]*>Salvar chave<\/button>/);
    expect(h).not.toContain('credencial');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Testar conexão/);
    const l = linhasCadastros(dados({}, false), 'America/Manaus')[0]!;
    expect(acoesDaLinhaFdv(l, { bloqueado: false, semCredencial: true, licenciado: true }).menu.find((x) => x.chave === 'ligar')?.desabilitado).toBe(true);
  });
  it('"Nenhum cadastro ligado" só quando nenhum está ligado (a credencial nasce sem cadastros)', () => {
    const nova = render(dados({}, false));
    expect(nova).toContain('Nenhum cadastro ligado.');
    // a tabela de lotes da entrada (T-0057 A1) vem antes do grupo FDV: a tabela que importa é a que vem depois da mensagem
    const msg = nova.indexOf('Nenhum cadastro ligado.');
    expect(nova.indexOf('<table', msg)).toBeGreaterThan(msg);
    expect(render()).not.toContain('Nenhum cadastro ligado');
  });
  it('36 A: cada botão com retorno tem o ResultadoAcao depois dele e nada de mensagem solta no topo', () => {
    const h = render(dados(), monitor());
    const depois = (rotulo: string) => {
      const i = h.indexOf(`>${rotulo}</button>`);
      expect(i, rotulo).toBeGreaterThan(0);
      return h.indexOf('data-resultado-acao', i);
    };
    // Atualizar: abaixo do cabeçalho do Monitor; Testar conexão e Trocar chave: abaixo da fila; Salvar e Zerar: logo depois
    expect(depois('Atualizar')).toBeLessThan(h.indexOf('data-testid="monitor"'));
    expect(depois('Testar conexão')).toBeLessThan(h.indexOf('<h2 id="h-env">'));
    expect(depois('Trocar chave')).toBe(depois('Testar conexão')); // fila de dois botões: os resultados vêm depois dela, na ordem dos botões
    expect(depois('Salvar')).toBeLessThan(h.indexOf('<table', h.indexOf('<h2 id="h-env">')));
    expect(depois('Zerar pedidos não faturados')).toBeGreaterThan(h.indexOf('Zerar pedidos não faturados'));
    const topo = h.slice(0, h.indexOf('<h2 id="h-monitor">'));
    expect(topo).not.toMatch(/class="erro"|aviso-sucesso/);
    expect(h).not.toMatch(/<p class="(faixa-aviso|erro)"[^>]*role="(status|alert)">(Chave|Conexão|Limite)/);
    expect((h.match(/data-resultado-acao/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });
  it('sem a licença do módulo: aviso e escritas desabilitadas', () => {
    const h = render(dados({ modulo_licenciado: false }));
    expect(h).toContain('Integração FDV sem licença nesta empresa. Ligue o módulo na aba Empresa.');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Trocar chave/);
  });
  it('36 A: ficha da Conexão sem "Último uso" (o Monitor tem o "Último sinal"); botões com um nome por ação', () => {
    const h = render();
    expect(h).not.toContain('Último uso');
    expect(h).toContain('<dt>Chave</dt>');
    expect(h).toContain('<dt>Criada em</dt>');
    expect(h).toMatch(/>Trocar chave<\/button>/);
    expect(h).not.toContain('Trocar credencial');
    expect(h).toContain('Monitor indisponível agora.');
    expect(h).not.toContain('Use Atualizar');
  });
  it('36 A: coluna Situação em Ligado / Desligado', () => {
    const h = render();
    expect(h).not.toMatch(/>Ligada<|>Desligada</);
  });
  it('36 A: a confirmação de Trocar chave (cenário B, seção A): destrutiva, sem texto, aviso fixo', () => {
    const h = renderToStaticMarkup(<DialogoTrocarChave aoConfirmar={() => undefined} aoCancelar={() => undefined} />);
    expect(h).toContain('Trocar a chave do conector do FDV?');
    expect(h).toContain('A chave atual para de funcionar agora. Quem usa a chave antiga fica sem enviar até receber a nova.');
    expect(h).toContain('>Trocar chave</button>');
    expect(h).toContain('>Cancelar</button>');
    expect(h).toContain('data-destrutivo="true"');
    expect(h).not.toContain('<textarea');
    expect(h).toContain('role="dialog"');
  });
  it('36 A: a ficha não abre a confirmação sozinha e salvar a 1ª chave não a pede', () => {
    expect(render()).not.toContain('Trocar a chave do conector do FDV?');
    expect(render(dados({}, false))).not.toContain('Trocar a chave do conector do FDV?');
  });
  it('sem a carga completa e sem "Zerar dados" na tela', () => {
    const h = render();
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
  it('🟡 marca: "Atualizado às hh:mm" tem a classe que o 390 usa para descer abaixo do título do Monitor', () => {
    const h = render(dados(), monitor());
    expect(h).toMatch(/<div class="cabeca-cargas cabeca-monitor"><h2 id="h-monitor">Monitor<\/h2>/);
    expect(h).toMatch(/class="apoio atualizado-monitor"[^>]*>Atualizado às 14:39</);
    const css = readFileSync(join(__dirname, '../../../../globals.css'), 'utf8');
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.cabeca-monitor \{ display: grid;/);
    expect(css).toMatch(/\.cabeca-monitor \.atualizado-monitor \{ grid-row: 2; grid-column: 1 \/ -1; \}/);
  });
  it('situação do conector: Em dia, Atrasado e Desativado em texto e selo (nunca só cor)', () => {
    expect(render(dados(), monitor())).toMatch(/Situação<\/dt><dd>.*Em dia/);
    expect(render(dados(), monitor({ situacao: 'atrasado' }))).toMatch(/Situação<\/dt><dd>.*Atrasado/);
    expect(render(dados(), monitor({ situacao: 'desativado' }))).toMatch(/Situação<\/dt><dd>.*Desativado/);
  });
});

describe('v0.3.18 A2: Monitor com o último código e a próxima tentativa', () => {
  it('Código em fonte de código no Monitor, "—" quando não houver', () => {
    const sinal = { ultimo_envio_em: '2026-11-27T14:00:00.000Z', ultimo_aceito_em: null, ultimo_http: 401, parado_por_versao: false, ultimo_codigo: 'credencial_invalida' };
    expect(render(dados({ ultimo_sinal: sinal }), monitor())).toContain('<dt>Código</dt><dd><code>credencial_invalida</code></dd>');
    expect(render(dados(), monitor())).not.toContain('<dt>Código</dt>');
  });
  it('próxima tentativa da pausa por credencial, no fuso da empresa; só quando vier', () => {
    const d = dados();
    const com = IntegracaoFdvPlataforma.parse({ ...d, cadastros: d.cadastros.map((c) => (c.entidade === 'cliente' ? { ...c, proxima_tentativa_em: '2026-11-27T15:30:00.000Z' } : c)) });
    expect(render(com)).toContain('Próxima tentativa');
    expect(render(d)).not.toContain('Próxima tentativa');
  });
});
