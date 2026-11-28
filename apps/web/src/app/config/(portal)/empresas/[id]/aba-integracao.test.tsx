import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ENTIDADES_ENVIO_FDV, IntegracaoFdvPlataforma, MonitorConectorFdv, PortalEntradaLeitura } from '@macuxierp/platform-sdk';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { situacoes } from '@/lib/config/cargas-fixtures';
import { ROTULO_DESTINO_FDV, ROTULO_FORCA_VENDAS } from '@/lib/config/ligacoes';
import { AbaIntegracao } from './aba-integracao';
import { DialogoTrocarChaveFdv } from './ligacao-saida';

const ID = '11111111-1111-4111-8111-111111111111';
const ENT: readonly string[] = ENTIDADES_ENVIO_FDV;
const dados = (extra: Record<string, unknown> = {}, com = true) =>
  IntegracaoFdvPlataforma.parse({
    empresa_id: ID, modulo_licenciado: true,
    credencial_id: com ? ID : null, conector_id: com ? 'erp-1' : null, ambiente: com ? 'teste' : null, chave_prefixo: com ? 'abcd1234' : null, criada_em: com ? '2026-11-23T12:00:00.000Z' : null,
    entidades_habilitadas: com ? ['produto', 'cliente'] : [], limite_registros_lote: com ? 500 : null, ultimo_sinal: null,
    cadastros: ENT.map((entidade) => ({ entidade, ligada: com && (entidade === 'produto' || entidade === 'cliente'), ultimo_envio_em: null, falha: null, lote_em_voo: false })),
    ...extra,
  });
const monitor = (extra: Record<string, unknown> = {}) =>
  MonitorConectorFdv.parse({ identificador: 'erp-1', situacao: 'em_dia', versao: '1.4.2', ultimo_sinal_em: '2026-11-24T19:59:00.000Z', fila: { lotes: 2, linhas: 340 }, lido_em: '2026-11-24T18:39:00.000Z', ...extra });
const entrada = PortalEntradaLeitura.parse({ credenciais: [{ conector_id: 'erp-cliente', prefixo: 'AbCdEfGh', criada_em: '2026-11-26T15:00:00.000Z', revogada_em: null }], ultimo_sinal: null, lotes: [] });
const render = (d = dados(), m: MonitorConectorFdv | null = null) => renderToStaticMarkup(<AbaIntegracao empresaId={ID} dados={d} fuso="America/Manaus" monitor={m} entrada={entrada} cargas={situacoes({ filial: { situacao: 'carregado', quantidade: 1 } })} />);

describe('Config v4: aba Integrações como a simulação aprovada 445e459', () => {
  it('duas ligações na grade, na ordem "Sistema do cliente → ERP" e "ERP → Macuxi FDV", cada uma com a ficha, a tabela e o selo no título', () => {
    const h = render(dados(), monitor());
    expect(h.match(/<section class="bloco ligacao"/g)).toHaveLength(2);
    expect(h).toMatch(/<div class="ligacoes"><section class="bloco ligacao" aria-labelledby="h-ligacao-entrada">/);
    expect(h.indexOf('id="h-ligacao-entrada"')).toBeLessThan(h.indexOf('id="h-ligacao-saida"'));
    expect(h).toMatch(new RegExp(`<h2 id="h-ligacao-saida">ERP <span class="seta" aria-hidden="true">→</span><span class="sr-only"> para o </span> ${ROTULO_FORCA_VENDAS}</h2>`));
    expect(h.match(/class="cabeca-ligacao"/g)).toHaveLength(2); // título e selo na mesma linha
    // as tabelas por ligação moram nos cartões: recebidos, enviados e Envios recentes
    for (const legenda of ['Cadastros recebidos', 'Cadastros enviados', 'Envios recentes']) expect(h).toMatch(new RegExp(`<caption[^>]*>${legenda}</caption>`));
    expect(h.indexOf('Cadastros recebidos')).toBeLessThan(h.indexOf('id="h-ligacao-saida"'));
    expect(h.indexOf('Cadastros enviados')).toBeGreaterThan(h.indexOf('id="h-ligacao-saida"'));
    expect(h.indexOf('id="h-envios-recentes"')).toBeGreaterThan(h.indexOf('Cadastros enviados'));
    for (const fora of ['Monitor', 'Conexão com o Macuxi FDV', 'Integração via API', 'cabeca-ligacoes', 'form-lote', 'campo-com-botao']) expect(h).not.toContain(fora);
  });
  it('um único Atualizar, na barra do bloco Envios recentes (regra 12), com "Atualizado às" ao lado e o retorno logo abaixo', () => {
    const h = render(dados(), monitor());
    expect(h.match(/>Atualizar<\/button>/g)).toHaveLength(1);
    expect(h).toMatch(/<div class="barra-acoes barra-bloco"><button[^>]*>Atualizar<\/button><span class="apoio" data-testid="atualizado-as"[^>]*>Atualizado às 14:39<\/span><\/div><div data-resultado-acao/);
    expect(h.indexOf('>Atualizar</button>')).toBeGreaterThan(h.indexOf('id="h-envios-recentes"'));
    expect(render()).not.toContain('Atualizado às');
  });
  it('uma barra por cartão: no da saída o Salvar e o Zerar pedidos entram na mesma barra do Testar conexão e do Trocar chave', () => {
    const h = render(dados(), monitor());
    const saida = h.slice(h.indexOf('id="h-ligacao-saida"'), h.indexOf('id="h-envios-recentes"'));
    expect(saida.match(/class="barra-acoes barra-bloco"/g)).toHaveLength(1);
    expect(saida).toContain('<div class="barra-destino"></div>'); // o alvo onde o Salvar e o Zerar pedidos entram no navegador
    const entrada = h.slice(h.indexOf('id="h-ligacao-entrada"'), h.indexOf('id="h-ligacao-saida"'));
    expect(entrada.match(/class="barra-acoes barra-bloco"/g)).toHaveLength(1);
    expect(entrada).toMatch(/>Trocar chave<\/button><button[^>]*botao-perigo-contorno botao-direita[^>]*>Revogar chave<\/button>/);
  });
});

describe('ligação "ERP → Macuxi FDV" (o Monitor vira a Situação)', () => {
  it('com chave: selo da Situação no título e ficha com Código, Ambiente, Ligado a Macuxi FDV, Último contato e Chave', () => {
    const h = render(dados(), monitor());
    const saida = h.slice(h.indexOf('id="h-ligacao-saida"'));
    for (const dt of ['Último contato', 'Ligado a', 'Código', 'Chave', 'Ambiente']) expect(saida).toContain(`<dt>${dt}</dt>`);
    expect(saida).not.toContain('<dt>Situação</dt>');
    expect(saida).toContain(`<dd>${ROTULO_DESTINO_FDV}</dd>`);
    expect(saida).toContain('>Em dia<'); // o selo com o texto; as regras da ficha ficam em ligacoes.test.ts
    for (const fora of ['Identificador', 'Versão', 'Criada em', 'Último sinal', '1.4.2', 'name="chave"']) expect(saida).not.toContain(fora);
    expect(saida).toContain('>Trocar chave</button>');
    expect(saida).toContain('>Testar conexão</button>');
    expect(saida).not.toContain('role="dialog"');
  });
  it('sem chave: sem ficha, só o formulário Código / Chave / Ambiente e "Salvar chave"; nenhum erro antes de agir', () => {
    const h = render(dados({}, false));
    const saida = h.slice(h.indexOf('id="h-ligacao-saida"'));
    expect(saida).not.toContain('<dl');
    for (const r of ['Código', 'Chave', 'Ambiente']) expect(saida).toContain(`<span>${r}</span>`);
    expect(saida).toMatch(/<input(?=[^>]*name="chave")(?=[^>]*type="password")[^>]*>/);
    expect(saida).not.toMatch(/name="chave"[^>]*value=/);
    expect(saida).toMatch(/>Salvar chave<\/button>/);
    expect(saida).not.toContain('Testar conexão');
    expect(saida).not.toContain('Nenhuma chave salva');
    expect(saida).not.toMatch(/erro-campo|aria-invalid/);
  });
  it('sem a licença do módulo: o aviso no topo desta ligação (não acima das duas) e as escritas desabilitadas', () => {
    const h = render(dados({ modulo_licenciado: false }));
    const aviso = h.indexOf('Integração FDV sem licença nesta empresa. Ligue o módulo na aba Empresa.');
    expect(aviso).toBeGreaterThan(h.indexOf('id="h-ligacao-saida"'));
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Trocar chave/);
  });
  it('36 A: os retornos de Trocar chave e Testar conexão vêm logo depois da fila de botões', () => {
    const h = render(dados(), monitor());
    const fila = h.indexOf('<div class="barra-destino"></div></div>');
    expect(fila).toBeGreaterThan(0);
    expect(h.indexOf('data-resultado-acao', fila)).toBe(fila + '<div class="barra-destino"></div></div><div '.length);
  });
});

describe('diálogo "Trocar chave" da força de vendas', () => {
  const dialogo = (campos: Record<string, string> = {}) => renderToStaticMarkup(<DialogoTrocarChaveFdv campos={campos} ambiente="teste" aoConfirmar={() => undefined} aoCancelar={() => undefined} />);
  it('Nova chave e Ambiente (o código fica fixo), aviso fixo e confirmação destrutiva', () => {
    const h = dialogo();
    expect(h).toContain('role="dialog"');
    expect(h).toContain(`Trocar a chave do ${ROTULO_DESTINO_FDV}?`);
    expect(h).toContain('A chave atual deixa de funcionar agora. Quem usa a chave antiga fica sem enviar até receber a nova.');
    expect(h).toContain('<span>Nova chave</span>');
    expect(h).toContain('<span>Ambiente</span>');
    expect(h).not.toContain('name="conector_id"');
    expect(h).toMatch(/data-destrutivo="true"[^>]*>Trocar chave<\/button>/);
    expect(h).toContain('>Cancelar</button>');
    expect(h).not.toMatch(/erro-campo|aria-invalid/);
  });
  it('o erro de campo aparece dentro do diálogo, embaixo do campo, só depois de confirmar', () => {
    const h = dialogo({ chave: 'A chave não confere.' });
    expect(h).toMatch(/<input(?=[^>]*name="chave")(?=[^>]*aria-invalid="true")[^>]*>/);
    expect(h).toMatch(/<\/label><p id="[^"]+" class="erro-campo" role="alert">A chave não confere\.<\/p>/);
  });
});

describe('CSS das ligações (docs/design/integracao-duas-ligacoes)', () => {
  const css = readFileSync(join(__dirname, '../../../../globals.css'), 'utf8');
  it('telas horizontais (R-20261127-110345): 2 colunas, 1 só no celular; seta em texto-secundario; /config na largura toda; rótulo da ficha em destaque', () => {
    expect(css).toMatch(/\.ligacoes \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 16px; align-items: start; \}/);
    expect(css).toMatch(/@media \(max-width: 767px\) \{ \.ligacoes \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
    expect(css).not.toMatch(/\.grade-cartoes|\.cartao-campos|\.cartao-largo|\.campo-ficha|\.form-lote|\.campo-com-botao|\.campos-linha|width: 280px|min\(280px/); // regras 11 e 12: tudo na grade de 12 e nas barras
    expect(css).toMatch(/\.ligacao h2 \.seta, \.direcao h2 \.seta \{ color: var\(--mx-cor-texto-secundario\); font-weight: 400; \}/);
    expect(css).not.toMatch(/\.conteudo \{[^}]*max-width/); // T-0121: sem teto no contêiner, o /config e o BKO preenchem a largura
    expect(css).toMatch(/\.ligacao \.ficha dt \{[^}]*color: var\(--mx-cor-rotulo-destaque\); text-transform: uppercase;/);
  });
  it('.so-leitor não tem mais dois sentidos: a camada clicável ganhou nome próprio', () => {
    expect(css.match(/^\.so-leitor\s*\{/gm) ?? []).toHaveLength(1);
    expect(css).toMatch(/^\.sr-only[\s,{]/m);
  });
});
