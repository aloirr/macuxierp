import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ENTIDADES_ENVIO_FDV, IntegracaoFdvPlataforma } from '@macuxierp/platform-sdk';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { ROTULO_REENVIAR_TUDO, acoesDaLinhaFdv, avisoCarga, cadastroDaEntidade, entidadesDaCarga, rotuloComLote, estadoCargaCompleta, habilitadasApos, linhasCadastros, menuDaLinha, tituloReenviarTudo, type LinhaCadastroFdv } from '@/lib/config/integracao-fdv';
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

describe('T-0135: um botão por bloco', () => {
  it('sem chave salva o "Salvar" dos registros por lote não aparece (só o "Salvar chave" do cartão); com chave, aparece', () => {
    expect(render(dados({}, false))).not.toMatch(/>Salvar<\/button>/);
    expect(render()).toMatch(/>Salvar<\/button>/);
  });
  it('RD-2423: sem chave salva, uma frase no lugar da tabela de "Desligado"; com chave, a tabela', () => {
    const sem = render(dados({}, false));
    expect(sem).toContain('Salve a chave para enviar os cadastros ao Macuxi FDV.');
    expect(sem).not.toContain('Desligado');
    expect(render()).not.toContain('Salve a chave');
  });
  it('sem último envio a linha "Último envio: —" não sobe para sob o nome', () => {
    expect(render()).not.toContain('Último envio: —');
  });
});

describe('v0.3.24: aba Dados, seção "ERP → Macuxi FDV" (a tabela saiu da aba Integração)', () => {
  it('título com a direção, Registros por lote com o Salvar na mesma linha, "Cadastros enviados" e Zerar pedidos', () => {
    const h = render();
    expect(h).not.toContain('<h2'); // o título da ligação é do cartão (ligacao.tsx)
    // regra 11: o campo é curto na grade de 12; regra 12: o Salvar e o Zerar pedidos ficam numa barra só, no pé do bloco
    expect(h).toMatch(/<form[^>]*class="formulario"[^>]*><label class="campo campo-curto"><span>Registros por lote<\/span>/);
    expect(h).not.toMatch(/campo-com-botao|form-lote/);
    expect(h.match(/class="barra-acoes barra-bloco"/g)).toHaveLength(1);
    expect(h).toMatch(/<div class="barra-acoes barra-bloco"><button[^>]*>Salvar<\/button><button[^>]*botao-direita[^>]*>Zerar pedidos…<\/button><\/div>/);
    expect(h).toMatch(/<caption[^>]*>Cadastros enviados<\/caption>/);
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
  it('36 A + regra 12: retornos junto do que os causa; uma barra só no pé', () => {
    const h = render();
    // o retorno do Salvar vem antes da tabela; o do Zerar pedidos, depois dela e antes da barra (uma só)
    expect(h.indexOf('data-resultado-acao')).toBeLessThan(h.indexOf('<table'));
    expect(h.indexOf('data-resultado-acao', h.indexOf('</table>'))).toBeLessThan(h.indexOf('Zerar pedidos…'));
  });
  it('sem a licença do módulo: escritas desabilitadas', () => {
    expect(render(dados({ modulo_licenciado: false }))).toMatch(/<button[^>]*disabled=""[^>]*>Zerar pedidos…/);
  });
  const linha = (entidade: string, extra: Partial<LinhaCadastroFdv> = {}): LinhaCadastroFdv => ({ ...linhasCadastros(dados(), 'America/Manaus').find((l) => l.entidade === entidade)!, ...extra });
  const opcoes = { bloqueado: false, semCredencial: false, licenciado: true };
  it('uma linha, um botão "Ações" e uma ação principal só (nenhuma fileira de botões); a principal muda pela situação', () => {
    const h = render();
    const n = linhasCadastros(dados(), 'America/Manaus').length;
    expect(h.match(/aria-haspopup="menu"/g)).toHaveLength(n);
    expect(h.match(/aria-label="Ações de /g)).toHaveLength(n); // o gatilho, com ou sem a seta ▾
    for (const x of ['Produtos', 'Clientes', 'Estoque']) expect(h).toContain(`aria-label="Ações de ${x}"`);
    expect(h).not.toMatch(/>Zerar<|>Desligar<|>Ligar<|min-width:\s*480px/); // Zerar é perigo no menu, nunca solto na linha (marca, botao-acoes)
    expect(h.slice(h.indexOf('<table'), h.indexOf('</table>'))).not.toContain('botao-perigo-contorno'); // o vermelho é só do Zerar pedidos, na barra
    expect(h).not.toContain('Reenviar tudo');
    expect(h).toContain('Use &quot;Trocar chave&quot;.');
    expect(h).not.toContain('credencial do conector');
    expect(h).not.toMatch(/>(Log|Tentar de novo|Reprocessar)<\/button>/); // regra 12: a principal vai para dentro do "Ações ▾", nada solto na linha
    const clientes = linhasCadastros(dados(), 'America/Manaus').find((l) => l.entidade === 'cliente')!;
    expect(clientes.pausada).toBe(true); // credencial é motivo de pausa: Tentar de novo na frente
    expect(menuDaLinha(acoesDaLinhaFdv(clientes, opcoes), {}).acoes?.[0]).toMatchObject({ rotulo: 'Tentar de novo' }); // a principal vira o primeiro item do menu
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

describe('T-0137: "Reenviar tudo ao FDV" no menu Ações do bloco "ERP → Macuxi FDV"', () => {
  const lig = ['produto', 'cliente', 'cliente_endereco', 'forma_pagamento'];
  const integ = (voo: string[] = [], ligadas: string[] = lig, extra: Record<string, unknown> = {}) => IntegracaoFdvPlataforma.parse({
    ...dados(), entidades_habilitadas: ENTIDADES_ENVIO_FDV.filter((e) => ligadas.includes(e)),
    cadastros: ENTIDADES_ENVIO_FDV.map((entidade) => ({ entidade, ligada: ligadas.includes(entidade), ultimo_envio_em: null, falha: null, lote_em_voo: voo.includes(entidade) })),
    ...extra,
  });
  const base = { bloqueado: false, semCredencial: false, licenciado: true };
  const item = (d: IntegracaoFdvPlataforma, entidade: (typeof ENTIDADES_ENVIO_FDV)[number], o = base) => {
    const l = linhasCadastros(d, 'America/Manaus').find((x) => x.entidade === entidade)!;
    const a = acoesDaLinhaFdv(l, { ...o, reenvio: estadoCargaCompleta(cadastroDaEntidade(entidade), d) });
    return [a.principal, ...a.menu].find((x) => x.chave === 'reenviar-tudo')!;
  };
  it('o item tem o rótulo "Reenviar tudo ao FDV", vem antes do Log e do Zerar e só aparece com o cadastro todo ligado', () => {
    expect(ROTULO_REENVIAR_TUDO).toBe('Reenviar tudo ao FDV');
    const d = integ();
    expect(item(d, 'produto')).toMatchObject({ rotulo: 'Reenviar tudo ao FDV', oculto: false, desabilitado: false });
    expect(item(d, 'filial').oculto).toBe(true); // desligada
    expect(item(d, 'forma_pagamento').oculto).toBe(true); // falta o prazo: o domain recusaria
    const l = linhasCadastros(d, 'America/Manaus').find((x) => x.entidade === 'produto')!;
    const chaves = (a: ReturnType<typeof acoesDaLinhaFdv>) => [a.principal, ...a.menu].map((x) => x.chave);
    expect(chaves(acoesDaLinhaFdv(l, { ...base, reenvio: estadoCargaCompleta('produto', d) }))).toEqual(['log', 'ligar', 'retomar', 'reprocessar', 'reenviar-tudo', 'zerar']);
  });
  it('sem a integração lida, sem licença, sem chave ou em bloqueio: oculto ou desligado', () => {
    expect(acoesDaLinhaFdv(linhasCadastros(dados(), 'America/Manaus').find((x) => x.entidade === 'produto')!, base).menu.find((x) => x.chave === 'reenviar-tudo')?.oculto).toBe(true); // sem o estado, nada de reenvio
    expect(item({ ...integ(), modulo_licenciado: false }, 'produto').oculto).toBe(true);
    expect(item(integ(), 'produto', { ...base, bloqueado: true }).desabilitado).toBe(true);
    expect(item(integ(), 'produto', { ...base, semCredencial: true }).desabilitado).toBe(true);
  });
  it('lote em voo em QUALQUER entidade do cadastro desliga o item, com "Enviando…"; em outro cadastro, não', () => {
    expect(item(integ(['produto']), 'produto')).toMatchObject({ rotulo: 'Enviando…', desabilitado: true });
    expect(item(integ(['cliente_endereco']), 'cliente')).toMatchObject({ rotulo: 'Enviando…', desabilitado: true }); // a linha do cliente, o lote na do endereço
    expect(item(integ(['cliente']), 'cliente_endereco')).toMatchObject({ rotulo: 'Enviando…', desabilitado: true });
    expect(item(integ(['produto']), 'cliente')).toMatchObject({ rotulo: 'Reenviar tudo ao FDV', desabilitado: false });
  });
  it('cadastro com duas entidades: cliente e condição de pagamento (forma + prazo) mandam as duas', () => {
    expect(cadastroDaEntidade('cliente_endereco')).toBe('cliente');
    expect(cadastroDaEntidade('prazo_pagamento')).toBe('condicao_pagamento');
    expect(cadastroDaEntidade('produto_unidade')).toBe('produto_unidade');
    expect(entidadesDaCarga('preco')).toEqual(['preco']);
    expect(entidadesDaCarga('inexistente')).toEqual([]);
    expect(estadoCargaCompleta('filial', integ())).toMatchObject({ visivel: false, loteEmVoo: false });
    expect(rotuloComLote(false, 'Reprocessar')).toBe('Reprocessar');
    const d = integ([], [...lig, 'prazo_pagamento']);
    expect(estadoCargaCompleta('cliente', d).entidades).toEqual(['cliente', 'cliente_endereco']);
    expect(estadoCargaCompleta('condicao_pagamento', d)).toMatchObject({ visivel: true, entidades: ['forma_pagamento', 'prazo_pagamento'] });
    expect(item(d, 'prazo_pagamento').oculto).toBe(false);
    expect(item(integ([], ['cliente']), 'cliente').oculto).toBe(true); // falta o endereço
  });
  it('a confirmação é só "Reenviar <artigo> <cadastro> ao FDV?", com o artigo certo para cada entidade e sem contagem', () => {
    const esperado: Record<string, string> = {
      filial: 'Reenviar todas as Filiais ao FDV?',
      vendedor: 'Reenviar todos os Vendedores ao FDV?',
      forma_pagamento: 'Reenviar todas as Condições de pagamento ao FDV?',
      prazo_pagamento: 'Reenviar todas as Condições de pagamento ao FDV?',
      produto: 'Reenviar todos os Produtos ao FDV?',
      produto_unidade: 'Reenviar todas as Unidades ao FDV?',
      preco: 'Reenviar todas as Tabelas de preço ao FDV?',
      estoque: 'Reenviar todo o Estoque ao FDV?',
      cliente: 'Reenviar todos os Clientes ao FDV?',
      cliente_endereco: 'Reenviar todos os Clientes ao FDV?',
    };
    expect(Object.keys(esperado)).toEqual([...ENTIDADES_ENVIO_FDV]);
    for (const e of ENTIDADES_ENVIO_FDV) {
      const t = tituloReenviarTudo(cadastroDaEntidade(e));
      expect(t).toBe(esperado[e]);
      expect(t).not.toMatch(/\d|opcional/);
    }
    expect(avisoCarga).toBe('Envia tudo de uma vez: pode demorar e inativar cadastros no FDV.');
  });
  it('fechado até o clique: sem diálogo e sem o item solto na linha', () => {
    const h = render(integ());
    expect(h).not.toContain('role="dialog"');
    expect(h).not.toMatch(/>Reenviar tudo ao FDV<\/button>/);
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
