import { describe, expect, it } from 'vitest';
import type { NotaDetalhe, TituloDetalhe } from '@macuxierp/faturamento/contracts';
import { semEspacoDuro } from '@macuxierp/platform-sdk/testes';
import { arquivoPermitido } from '../arquivos';
import { EU_FALSO } from '../falso';
import { MANIFESTOS } from '../manifestos';
import { montarMenu, resolverPagina } from '../menu';
import { PAGINAS_REGISTRADAS, casarRota, paginasDoMenu } from '../paginas';
import { escritaDeclarada, executorDaTela, executorDeAcoes, telaDaRota } from '../telas';
import { aposResposta, chaveParaEnvio, ehRespostaDefinitiva, estadoDoClique } from '../descritor/idempotencia';
import { DETALHE_NOTA, DETALHE_TITULO, LISTA_NOTAS, LISTA_PEDIDOS_A_FATURAR, LISTA_REJEICOES, LISTA_TITULOS, validarAcaoDaNota, validarAcaoDoTitulo, vistaDaNota, vistaDoTitulo } from './faturamento';

const ID = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const F = '8a2b6c10-1d3e-4f5a-8b7c-9d0e1f2a3b4c';
const C = 'c4d5e6f7-0a1b-4c2d-9e3f-5a6b7c8d9e0f';
const P = '1b2c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8';
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const FUSO = 'America/Manaus';
/** 22/11/2026 12:00 em Manaus. */
const AGORA = new Date('2026-11-22T16:00:00.000Z');
const ver = (p: Parameters<typeof vistaDaNota>[1], n: NotaDetalhe) => vistaDaNota(n, p, FUSO, AGORA);

const nota = (status: NotaDetalhe['status'], extra: Partial<NotaDetalhe> = {}): NotaDetalhe => ({
  id: ID, filial_id: F, cliente_id: C, pedido_id: P, ambiente: 'producao', serie: 1, numero: 12, chave_acesso: null, status, emitida_em: '2026-11-22T14:00:00.000Z', total_centavos: 123456,
  protocolo: null, c_stat: null, x_motivo: null, cliente_razao_social: 'Bar do Zé', filial_nome: 'Matriz Manaus', pedido_numero: 7, natureza_operacao: 'Venda de mercadoria', tipo_emissao: 1, recibo: null,
  itens: [{ sequencia: 1, quantidade: 20000, valor_centavos: 123456 }], acao_sugerida: null, autorizada_em: '2026-11-22T14:05:00.000Z', ...extra,
}) as NotaDetalhe;

const titulo = (extra: Partial<TituloDetalhe> = {}): TituloDetalhe => ({
  id: ID, nota_id: P, filial_id: F, numero: 12, cliente_id: C, cliente_razao_social: 'Bar do Zé', ambiente: 'producao', parcela: 1, total_parcelas: 2, vencimento: '2026-11-20', valor_centavos: 50000, saldo_centavos: 50000, status: 'aberto',
  baixas: [{ id: B, titulo_id: ID, valor_centavos: 10000, forma: 'manual', baixado_em: '2026-11-21T14:00:00.000Z', estornada_em: null }], ...extra,
}) as TituloDetalhe;

const ids = (v: { acoes: readonly { id: string }[] }) => v.acoes.map((a) => a.id);

describe('rotas e menu do faturamento no shell (T-0021)', () => {
  it('registra as páginas do módulo; o detalhe da nota e do título ficam fora do menu', () => {
    const rotas = PAGINAS_REGISTRADAS.filter((p) => p.modulo === 'faturamento').map((p) => [p.rota, Boolean(p.ocultaNoMenu)]);
    expect(rotas).toEqual([
      ['/faturamento/pedidos-a-faturar', false], ['/faturamento/notas', false], ['/faturamento/notas/:id', true], ['/faturamento/rejeicoes', false], ['/faturamento/titulos', false], ['/faturamento/titulos/:id', true],
    ]);
    expect(paginasDoMenu('faturamento', 'Notas fiscais').map((p) => p.rota)).toEqual(['/faturamento/notas']);
    expect(paginasDoMenu('faturamento', 'Rejeições').map((p) => p.rota)).toEqual(['/faturamento/rejeicoes']);
    expect(casarRota(`/faturamento/notas/${ID}`)?.params).toEqual({ id: ID });
  });
  it('toda página com tela tem descritor pela rota', () => {
    for (const r of ['/faturamento/pedidos-a-faturar', '/faturamento/notas', '/faturamento/notas/:id', '/faturamento/rejeicoes', '/faturamento/titulos', '/faturamento/titulos/:id']) expect(telaDaRota(r)).toBeDefined();
    expect(telaDaRota('/faturamento/notas')).toBe(LISTA_NOTAS);
    expect(telaDaRota('/faturamento/notas/:id')).toBe(DETALHE_NOTA);
    expect(telaDaRota('/faturamento/titulos/:id')).toBe(DETALHE_TITULO);
  });
  it('vendedor não vê faturamento; administrador, gerente, faturista, fiscal e leitura veem os quatro itens (Rejeições tem item próprio)', () => {
    expect(montarMenu(EU_FALSO.modulos, MANIFESTOS, 'vendedor').some((g) => g.modulo === 'faturamento')).toBe(false);
    for (const perfil of ['administrador', 'gerente', 'faturista', 'fiscal', 'leitura'] as const) {
      const g = montarMenu(EU_FALSO.modulos, MANIFESTOS, perfil).find((x) => x.modulo === 'faturamento');
      expect(g?.itens.map((i) => [i.rotulo, i.href]), perfil).toEqual([['Pedidos a faturar', '/faturamento/pedidos-a-faturar'], ['Notas fiscais', '/faturamento/notas'], ['Rejeições', '/faturamento/rejeicoes'], ['Títulos a receber', '/faturamento/titulos']]);
    }
  });
  it('rota de vendedor não resolve (404) e a de administrador resolve até o detalhe', () => {
    const adm = montarMenu(EU_FALSO.modulos, MANIFESTOS, 'administrador');
    expect(resolverPagina(adm, `/faturamento/notas/${ID}`, 'administrador')?.params).toEqual({ id: ID });
    expect(resolverPagina(adm, '/faturamento/rejeicoes', 'administrador')?.rotulo).toBe('Rejeições');
    expect(resolverPagina(adm, `/faturamento/titulos/${ID}`, 'administrador')?.pagina?.titulo).toBe('Título a receber');
    expect(resolverPagina(montarMenu(EU_FALSO.modulos, MANIFESTOS, 'vendedor'), '/faturamento/notas', 'vendedor')).toBeUndefined();
  });
});

describe('listas do faturamento', () => {
  it('linha da nota sai no fuso do tenant e a rota leva ao detalhe', () => {
    const l = LISTA_NOTAS.linha({ ...nota('autorizada') }, FUSO);
    expect(l).toMatchObject({ numero: '12/1', status: 'Autorizada', ambiente: 'Produção', emitida_em: '22/11/2026 10:00', cliente: 'Bar do Zé' });
    expect(LISTA_NOTAS.rotaDaLinha?.({ id: ID })).toBe(`/faturamento/notas/${ID}`);
    expect(LISTA_NOTAS.colunas('leitura').find((c) => c.id === 'total')?.tipo).toBe('dinheiro');
    expect(LISTA_NOTAS.linha({ ...nota('autorizada') }, 'UTC').emitida_em).toBe('22/11/2026 14:00');
  });
  it('textos de lista vazia vêm do módulo e o CSV vem da API (`/exportar`), sem contorno no shell', () => {
    expect(LISTA_NOTAS.textoVazio).toMatch(/Limpe os filtros/);
    expect(LISTA_REJEICOES.textoVazio).toMatch(/Nenhuma nota rejeitada/);
    for (const l of [LISTA_PEDIDOS_A_FATURAR, LISTA_NOTAS, LISTA_REJEICOES, LISTA_TITULOS]) {
      expect(l.pagina.csv, l.pagina.id).toBeDefined();
      expect(l.pagina.api, l.pagina.id).toMatch(/^\/v1\/faturamento\/[a-z-]+$/);
    }
  });
  it('título vencido vira "Vencido há N dias" e abre o detalhe do título', () => {
    const l = LISTA_TITULOS.linha({ ...titulo() }, FUSO);
    expect(l.parcela).toBe('1/2');
    expect(LISTA_TITULOS.rotaDaLinha?.({ id: ID })).toBe(`/faturamento/titulos/${ID}`);
  });
});

describe('lista de notas: selo do ambiente e inutilizar números', () => {
  it('homologação vira selo de alerta com o texto do módulo; produção fica só no texto', () => {
    const homol = LISTA_NOTAS.selos?.({ ...nota('autorizada', { ambiente: 'homologacao' }) }, FUSO);
    expect(homol?.ambiente).toEqual([{ texto: 'Homologação — sem valor fiscal', tom: 'aviso' }]);
    expect(LISTA_NOTAS.selos?.({ ...nota('autorizada') }, FUSO).ambiente).toEqual([]);
    expect(LISTA_NOTAS.selos?.({ ...nota('em_autorizacao') }, FUSO).status?.[0]).toMatchObject({ texto: 'Em autorização', tom: 'aviso', dica: 'Aguardando a SEFAZ' });
    const rej = { ...nota('rejeitada'), acao_sugerida: 'Reenvie', codigo: 539, mensagem: 'x', rejeitada_em: '2026-11-22T14:00:00.000Z', ambiente: 'homologacao' as const };
    expect(LISTA_REJEICOES.selos?.(rej, FUSO).ambiente?.[0]?.tom).toBe('aviso');
  });
  it('as colunas Filial e Pedido saíram da lista de notas; "Aprovado em" virou "Recebido em"', () => {
    expect(LISTA_NOTAS.colunas('administrador').map((c) => c.rotulo)).not.toEqual(expect.arrayContaining(['Filial']));
    expect(LISTA_NOTAS.colunas('administrador').map((c) => c.id)).not.toContain('pedido');
    expect(LISTA_PEDIDOS_A_FATURAR.colunas('administrador').map((c) => c.rotulo)).toContain('Recebido em');
  });
  const barra = (p: Parameters<NonNullable<typeof LISTA_NOTAS.acaoDaBarra>['acao']>[0]) => LISTA_NOTAS.acaoDaBarra?.acao(p);
  it('administrador, faturista e fiscal veem "Inutilizar números"; gerente, leitura e vendedor não', () => {
    for (const p of ['administrador', 'faturista', 'fiscal'] as const) expect(barra(p), p).toMatchObject({ id: 'inutilizar', entrada: 'faixa', destrutivo: true, rotuloFechar: 'Voltar', rotuloConfirmar: 'Inutilizar números', caminho: '/v1/faturamento/inutilizacoes' });
    for (const p of ['gerente', 'leitura', 'vendedor'] as const) expect(barra(p), p).toBeNull();
  });
  it('valida filial, faixa e justificativa pelo módulo e monta o corpo', () => {
    const a = barra('administrador')!;
    const v = (e: Partial<Parameters<NonNullable<typeof LISTA_NOTAS.acaoDaBarra>['validarAcao']>[1]>) => LISTA_NOTAS.acaoDaBarra!.validarAcao(a, { texto: 'Número pulado por falha de rede', filial: F, inicial: '10', final: '12', chave: 'chave-inutilizar-1', ...e });
    expect(v({ filial: '' })).toEqual({ ok: false, erro: 'Escolha a filial.' });
    expect(v({ inicial: 'abc' }).ok).toBe(false);
    expect(v({ inicial: '13' })).toEqual({ ok: false, erro: 'O número inicial não pode ser maior que o final.' });
    expect(v({ texto: 'curta' }).ok).toBe(false);
    expect(v({})).toMatchObject({ ok: true, corpo: { filial_id: F, numero_inicial: 10, numero_final: 12, justificativa: 'Número pulado por falha de rede' } });
  });
  it('a escrita é declarada e o executor da lista de notas existe', () => {
    expect(escritaDeclarada('POST', '/v1/faturamento/inutilizacoes')).toBe(true);
    expect(executorDeAcoes('/faturamento/notas', 'barra')).toBeDefined();
  });
});

describe('pedido a faturar: emitir nota', () => {
  const linha = { id: ID, pedido_id: P, numero: 7, status: 'a_faturar' };
  const acao = (perfil: Parameters<NonNullable<typeof LISTA_PEDIDOS_A_FATURAR.acaoDaLinha>['acao']>[1], l: Record<string, unknown> = linha) => LISTA_PEDIDOS_A_FATURAR.acaoDaLinha?.acao(l, perfil);
  it('administrador, faturista e fiscal veem; leitura, gerente e vendedor não (RN-CORE-02)', () => {
    expect(acao('fiscal')?.id).toBe('emitir');
    expect(acao('administrador')).toMatchObject({ id: 'emitir', metodo: 'POST', caminho: '/v1/faturamento/notas', entrada: 'confirmar', tituloDialogo: 'Emitir a nota do pedido 7?' });
    expect(acao('faturista')?.id).toBe('emitir');
    for (const p of ['leitura', 'gerente', 'vendedor'] as const) expect(acao(p), p).toBeNull();
  });
  it('pedido já faturado não oferece emitir; parcialmente faturado oferece', () => {
    expect(acao('administrador', { ...linha, status: 'faturado' })).toBeNull();
    expect(acao('faturista', { ...linha, status: 'faturado_parcial' })?.id).toBe('emitir');
  });
  it('o corpo leva a Idempotency-Key da tentativa (RN-CORE-05) e a escrita é declarada', () => {
    const a = acao('administrador')!;
    const r = LISTA_PEDIDOS_A_FATURAR.acaoDaLinha!.validarAcao(a, { texto: '', chave: 'chave-da-tentativa-1' });
    expect(r).toEqual({ ok: true, corpo: { pedido_id: P, idempotencia: 'chave-da-tentativa-1' } });
    expect(escritaDeclarada('POST', '/v1/faturamento/notas')).toBe(true);
    expect(executorDeAcoes('/faturamento/pedidos-a-faturar', 'linha')).toBeDefined();
  });
  it('depois de 4xx definitivo (422) o próximo clique gera chave nova, com corpo e cabeçalho iguais; erro de rede reusa a chave (RN-CORE-05)', () => {
    let n = 0;
    const gerar = () => `chave-da-tentativa-${++n}`;
    const exec = LISTA_PEDIDOS_A_FATURAR.acaoDaLinha!;
    const a = acao('administrador')!;
    const clique = (e: ReturnType<typeof estadoDoClique> | undefined) => {
      const atual = estadoDoClique(e, gerar);
      const v = exec.validarAcao(a, { texto: '', chave: atual.chave });
      const corpo = v.ok ? v.corpo : undefined;
      return { estado: chaveParaEnvio(atual, corpo, gerar), corpo: corpo as { idempotencia: string } };
    };
    const um = clique(undefined);
    expect(um.corpo.idempotencia).toBe(um.estado.chave);
    const apos422 = aposResposta(um.estado, ehRespostaDefinitiva(422));
    const dois = clique(apos422);
    expect(dois.estado.chave).not.toBe(um.estado.chave);
    expect(dois.corpo.idempotencia).toBe(dois.estado.chave);
    const rede = aposResposta(dois.estado, ehRespostaDefinitiva(503));
    const tres = clique(rede);
    expect(tres.estado.chave).toBe(dois.estado.chave);
    expect(tres.corpo.idempotencia).toBe(tres.estado.chave);
  });
  it('a lista com ação da barra e da linha valida cada ação pelo validador da própria origem', () => {
    const ok = (marca: string) => ({ validarAcao: () => ({ ok: false as const, erro: marca }), escritas: [], novaChave: () => marca });
    const tela = { ...LISTA_NOTAS, acaoDaLinha: { acao: () => null, ...ok('linha') }, acaoDaBarra: { acao: () => null, ...ok('barra') } };
    expect(executorDaTela(tela, 'linha')?.novaChave()).toBe('linha');
    expect(executorDaTela(tela, 'barra')?.novaChave()).toBe('barra');
    expect(executorDaTela(tela, 'detalhe')).toBeUndefined();
    expect(executorDaTela(LISTA_NOTAS, 'linha')).toBeUndefined();
  });
});

describe('detalhe da nota: ações por perfil e status', () => {
  it('administrador, faturista e fiscal veem as ações da nota autorizada (Cancelar por último) e os arquivos', () => {
    for (const p of ['administrador', 'faturista', 'fiscal'] as const) {
      const v = ver(p, nota('autorizada'));
      expect(ids(v), p).toEqual(['consultar', 'cartaCorrecao', 'cancelar']);
      expect(v.downloads?.map((d) => d.rotulo), p).toEqual(['Baixar DANFE', 'Baixar XML']);
      expect(v.downloads?.find((d) => d.rotulo === 'Baixar DANFE')).toMatchObject({ href: `/v1/faturamento/notas/${ID}/danfe`, principal: true });
      expect(v.downloads?.find((d) => d.rotulo === 'Baixar DANFE')?.desabilitado).toBeUndefined();
      expect(v.downloads?.find((d) => d.rotulo === 'Baixar XML')?.href).toBe(`/v1/faturamento/notas/${ID}/xml`);
      expect(v.downloads?.find((d) => d.rotulo === 'Baixar XML')?.principal).toBeUndefined();
      expect(v.downloads?.find((d) => d.rotulo === 'Baixar XML')?.desabilitado).toBeUndefined();
    }
  });
  it('com cancelamento aguardando a SEFAZ, Cancelar e CC-e saem desabilitados/ausentes com o motivo do módulo', () => {
    const v = ver('administrador', nota('autorizada', { cancelamento_pendente: true }));
    expect(v.acoes.find((a) => a.id === 'cancelar')?.desabilitada).toBe('cancelamento aguardando a SEFAZ.');
    expect(v.acoes.find((a) => a.id === 'cartaCorrecao')).toBeUndefined();
    expect(ver('administrador', nota('autorizada', { cancelamento_pendente: false })).acoes.find((a) => a.id === 'cancelar')?.desabilitada).toBeUndefined();
  });
  it('o cancelamento confirma com o texto explícito da ação e traz "Manter a nota" (rotuloFechar do módulo); a CC-e não é destrutiva', () => {
    const v = ver('administrador', nota('autorizada'));
    expect(v.acoes.find((a) => a.id === 'cancelar')).toMatchObject({ rotuloFechar: 'Manter a nota', rotuloConfirmar: 'Cancelar a nota 12/1' });
    expect(v.acoes.find((a) => a.id === 'cartaCorrecao')).toMatchObject({ destrutivo: false, rotuloFechar: 'Voltar' });
  });
  it('o selo do status leva a dica do módulo quando o status pede explicação', () => {
    expect(ver('administrador', nota('em_autorizacao', { autorizada_em: null })).selo).toEqual({ texto: 'Em autorização', tom: 'aviso', dica: 'Aguardando a SEFAZ' });
    expect(ver('administrador', nota('autorizada')).selo).toEqual({ texto: 'Autorizada', tom: 'ok' });
  });
  it('leitura, gerente e vendedor não veem ação nem download', () => {
    for (const p of ['leitura', 'gerente', 'vendedor'] as const) {
      const v = ver(p, nota('autorizada'));
      expect(v.acoes, p).toEqual([]);
      expect(v.downloads, p).toEqual([]);
    }
  });
  it('rejeitada: reenviar é a principal, mostra código, motivo e o que fazer (RN-FAT-07)', () => {
    const v = ver('faturista', nota('rejeitada', { c_stat: 539, x_motivo: 'Duplicidade de NF-e', acao_sugerida: 'Consulte a chave e reenvie', autorizada_em: null }));
    expect(ids(v)).toEqual(['reenviar', 'consultar']);
    expect(v.acoes[0]).toMatchObject({ principal: true, caminho: `/v1/faturamento/notas/${ID}/reenviar`, entrada: 'confirmar', tituloDialogo: 'Reenviar a nota 12/1 à SEFAZ?' });
    expect(v.pendencias[0]).toMatchObject({ bloqueante: true, codigoRn: 'RN-FAT-07' });
    expect(v.pendencias[0]?.texto).toMatch(/539: Duplicidade de NF-e.*consulte a chave e reenvie/);
    expect(v.downloads?.every((d) => d.desabilitado)).toBe(true);
    expect(ver('fiscal', nota('rejeitada', { autorizada_em: null })).acoes[0]).toMatchObject({ id: 'reenviar', principal: true });
  });
  it('rascunho vira "Emitir"; autorizada com guarda pendente avisa do XML (RN-FAT-03)', () => {
    expect(ver('administrador', nota('rascunho', { numero: null, autorizada_em: null })).acoes[0]?.rotulo).toBe('Emitir');
    expect(ver('administrador', nota('autorizada_guarda_pendente')).pendencias[0]).toMatchObject({ codigoRn: 'RN-FAT-03' });
  });
  it('homologação: faixa "sem valor fiscal" no topo; produção sem faixa (RN-FAT-04)', () => {
    expect(ver('administrador', nota('autorizada', { ambiente: 'homologacao' })).faixa).toBe('NOTA DE HOMOLOGAÇÃO — SEM VALOR FISCAL');
    expect(ver('administrador', nota('autorizada')).faixa).toBeUndefined();
  });
  it('depois de 24 h o cancelamento fica visível e desabilitado, com o motivo (RN-FAT-02)', () => {
    const v = vistaDaNota(nota('autorizada', { autorizada_em: '2026-11-20T14:00:00.000Z' }), 'administrador', FUSO, AGORA);
    expect(v.acoes.find((a) => a.id === 'cancelar')?.desabilitada).toMatch(/prazo de cancelamento encerrado/);
    expect(v.acoes.find((a) => a.id === 'cancelar')?.destrutivo).toBe(true);
    expect(v.acoes.find((a) => a.id === 'cartaCorrecao')?.desabilitada).toBeUndefined();
  });
  it('cabeçalho no fuso do tenant e itens com quantidade e valor formatados', () => {
    const v = ver('administrador', nota('autorizada'));
    expect(v.cabecalho.find((c) => c.rotulo === 'Emitida em')?.valor).toBe('22/11/2026 10:00');
    const l0 = v.tabelas[0]?.linhas[0];
    expect({ ...l0, valor: semEspacoDuro(l0?.valor as string) }).toEqual({ sequencia: '1', quantidade: '2', valor: 'R$ 1.234,56' });
    expect(v.historico).toBeUndefined();
  });
  it('chave de acesso: linha inteira, números tabulares e grupos de 4', () => {
    const chave = '13261111222333000181550010000000121000000125';
    const c = ver('administrador', nota('autorizada', { chave_acesso: chave })).cabecalho.find((x) => x.rotulo === 'Chave de acesso');
    expect(c).toEqual({ rotulo: 'Chave de acesso', valor: '1326 1111 2223 3300 0181 5500 1000 0000 1210 0000 0125', linhaInteira: true, numerico: true });
    expect(c?.valor.replace(/ /g, '')).toBe(chave);
    expect(ver('administrador', nota('rejeitada', { autorizada_em: null })).cabecalho.find((x) => x.rotulo === 'Chave de acesso')?.valor).toBe('');
  });
  it('histórico da nota vem de /notas/:id/eventos, do mais antigo ao mais novo, em Manaus, sem o texto livre', () => {
    expect(DETALHE_NOTA.eventosApi?.(ID)).toBe(`/v1/faturamento/notas/${ID}/eventos`);
    const e = (extra: object) => ({ id: B, nota_id: ID, tipo: 'cce', n_seq_evento: 1, texto: 'Corrigir o endereço de entrega', status: 'registrado', protocolo: '113260000099', c_stat: 135, x_motivo: 'Evento registrado', registrado_em: '2026-11-22T15:00:00.000Z', criado_em: '2026-11-22T14:50:00.000Z', ...extra });
    const corpo = { itens: [e({ tipo: 'cancelamento', status: 'rejeitado', protocolo: null, c_stat: 573, x_motivo: 'Rejeição: duplicidade de evento.', registrado_em: null, criado_em: '2026-11-22T15:30:00.000Z' }), e({})] };
    const v = vistaDaNota(nota('autorizada'), 'administrador', FUSO, AGORA, DETALHE_NOTA.lerEventos?.(corpo) as Parameters<typeof vistaDaNota>[4]);
    expect(v.historico).toEqual([
      { quando: '22/11/2026 11:00', texto: 'Carta de correção nº 1 · registrado · protocolo 113260000099' },
      { quando: '22/11/2026 11:30', texto: 'Cancelamento · rejeitado pela SEFAZ · 573: Rejeição: duplicidade de evento' },
    ]);
    expect(JSON.stringify(v.historico)).not.toContain('endereço');
    expect(vistaDaNota(nota('autorizada'), 'administrador', FUSO, AGORA, { itens: [] }).historico).toEqual([]);
    expect(() => DETALHE_NOTA.lerEventos?.({ itens: [{ id: 'x' }] })).toThrow();
  });
  it('cancelar e carta de correção validam pelo módulo e montam o corpo; os demais não têm corpo', () => {
    const v = ver('administrador', nota('autorizada'));
    const cancelar = v.acoes.find((a) => a.id === 'cancelar')!;
    expect(validarAcaoDaNota(cancelar, { texto: 'curta' })).toEqual({ ok: false, erro: 'A justificativa do cancelamento deve ter de 15 a 255 caracteres.' });
    expect(validarAcaoDaNota(cancelar, { texto: 'Pedido lançado em duplicidade' })).toEqual({ ok: true, corpo: { justificativa: 'Pedido lançado em duplicidade' } });
    const cce = v.acoes.find((a) => a.id === 'cartaCorrecao')!;
    expect(validarAcaoDaNota(cce, { texto: 'x'.repeat(14) }).ok).toBe(false);
    expect(validarAcaoDaNota(cce, { texto: 'Corrigir o endereço de entrega' })).toMatchObject({ ok: true, corpo: { texto: 'Corrigir o endereço de entrega' } });
    expect(validarAcaoDaNota(v.acoes.find((a) => a.id === 'consultar')!, { texto: '' })).toEqual({ ok: true });
  });
  it('as escritas da nota estão declaradas e só elas', () => {
    for (const verbo of ['reenviar', 'consultar', 'cancelar', 'carta-correcao']) expect(escritaDeclarada('POST', `/v1/faturamento/notas/${ID}/${verbo}`), verbo).toBe(true);
    expect(escritaDeclarada('POST', `/v1/faturamento/notas/${ID}/editar`)).toBe(false);
    expect(escritaDeclarada('DELETE', `/v1/faturamento/notas/${ID}`)).toBe(false);
    expect(escritaDeclarada('POST', '/v1/faturamento/notas/nao-e-uuid/cancelar')).toBe(false);
  });
  it('o contrato da resposta é validado pelo módulo (corpo fora do contrato lança)', () => {
    expect(() => DETALHE_NOTA.ler({ id: 'x' })).toThrow();
  });
});

describe('título: baixa e estorno', () => {
  it('administrador, gerente e faturista baixam e estornam; fiscal, leitura e vendedor não (RN-FAT-06)', () => {
    for (const p of ['administrador', 'gerente', 'faturista'] as const) expect(ids(vistaDoTitulo(titulo(), p, FUSO, AGORA)), p).toEqual(['baixar', `estornar-${B}`]);
    for (const p of ['fiscal', 'leitura', 'vendedor'] as const) expect(vistaDoTitulo(titulo(), p, FUSO, AGORA).acoes, p).toEqual([]);
  });
  it('título baixado não oferece baixa; sem baixa vigente não oferece estorno', () => {
    expect(ids(vistaDoTitulo(titulo({ status: 'baixado', saldo_centavos: 0 }), 'faturista', FUSO, AGORA))).toEqual([`estornar-${B}`]);
    expect(ids(vistaDoTitulo(titulo({ baixas: [] }), 'faturista', FUSO, AGORA))).toEqual(['baixar']);
  });
  it('baixa: valor em reais, até o saldo, sem data futura; corpo em centavos', () => {
    const a = vistaDoTitulo(titulo(), 'faturista', FUSO, AGORA).acoes[0]!;
    expect({ ...a.baixa, saldo: semEspacoDuro(a.baixa?.saldo) }).toEqual({ saldo: 'R$ 500,00', valorInicial: '500,00', hoje: '2026-11-22' });
    expect(validarAcaoDoTitulo(a, { texto: '', valor: '0', data: '2026-11-22' }).ok).toBe(false);
    expect(validarAcaoDoTitulo(a, { texto: '', valor: '500,01', data: '2026-11-22' })).toMatchObject({ ok: false, erro: expect.stringMatching(/saldo/) });
    expect(validarAcaoDoTitulo(a, { texto: '', valor: '100,00', data: '2026-11-23' })).toEqual({ ok: false, erro: 'A data da baixa não pode ser futura.' });
    expect(validarAcaoDoTitulo(a, { texto: '', valor: '1.234,56'.replace('1.234,56', '250,50'), data: '2026-11-22' })).toEqual({ ok: true, corpo: { valor_centavos: 25050, data_baixa: '2026-11-22' } });
  });
  it('estorno: confirmação com valor, sem corpo; escritas declaradas com :baixa_id', () => {
    const a = vistaDoTitulo(titulo(), 'faturista', FUSO, AGORA).acoes[1]!;
    expect(a).toMatchObject({ entrada: 'confirmar', caminho: `/v1/faturamento/titulos/${ID}/baixas/${B}/estornar` });
    expect(semEspacoDuro(a.tituloDialogo)).toMatch(/Estornar a baixa de R\$ 100,00/);
    expect(validarAcaoDoTitulo(a, { texto: '' })).toEqual({ ok: true });
    expect(escritaDeclarada('POST', a.caminho)).toBe(true);
    expect(escritaDeclarada('POST', `/v1/faturamento/titulos/${ID}/baixas`)).toBe(true);
  });
  it('homologação: faixa do título do módulo; a forma da baixa sai com maiúscula', () => {
    expect(vistaDoTitulo(titulo({ ambiente: 'homologacao' }), 'administrador', FUSO, AGORA).faixa).toBe('TÍTULO DE NOTA DE HOMOLOGAÇÃO — SEM VALOR FISCAL');
    expect(vistaDoTitulo(titulo(), 'administrador', FUSO, AGORA).faixa).toBeUndefined();
    expect(vistaDoTitulo(titulo(), 'administrador', FUSO, AGORA).tabelas[0]?.linhas[0]?.forma).toBe('Manual');
  });
  it('o estorno não é destrutivo e a linha do título usa o rótulo do módulo', () => {
    expect(vistaDoTitulo(titulo(), 'faturista', FUSO, AGORA).acoes[1]?.destrutivo).toBeUndefined();
    expect(LISTA_TITULOS.rotuloDaLinha?.({ ...titulo(), parcela: 1, total_parcelas: 2 })).toBe('Abrir o título 12 (parcela 1/2)');
  });
  it('a baixa é listada no fuso do tenant e a estornada aparece como tal', () => {
    const v = vistaDoTitulo(titulo({ baixas: [{ id: B, titulo_id: ID, valor_centavos: 10000, forma: 'manual', baixado_em: '2026-11-21T14:00:00.000Z', estornada_em: '2026-11-22T14:00:00.000Z' }] }), 'administrador', FUSO, AGORA);
    expect(v.tabelas[0]?.linhas[0]).toMatchObject({ quando: '21/11/2026 10:00', situacao: 'Estornada em 22/11/2026 10:00' });
  });
});

describe('download pelo proxy', () => {
  it('só XML e DANFE de nota por UUID', () => {
    expect(arquivoPermitido(`/v1/faturamento/notas/${ID}/xml`)).toBe(true);
    expect(arquivoPermitido(`/v1/faturamento/notas/${ID}/danfe`)).toBe(true);
    for (const ruim of [`/v1/faturamento/notas/${ID}`, `/v1/faturamento/notas/${ID}/xml?x=1`, `/v1/faturamento/notas/../xml`, `/v1/cadastros/clientes`, `/v1/faturamento/notas/${ID}/eventos`]) expect(arquivoPermitido(ruim), ruim).toBe(false);
  });
});

describe('linha "Ambiente:" das confirmações fiscais (RN-FAT-04)', () => {
  const emitir = (l: Record<string, unknown>) => LISTA_PEDIDOS_A_FATURAR.acaoDaLinha?.acao({ id: ID, pedido_id: P, numero: 7, status: 'a_faturar', ...l }, 'administrador');
  it('Emitir com o campo usa os dizeres do módulo (homologação neutro, produção alerta)', () => {
    expect(emitir({ ambiente: 'homologacao' })?.ambiente).toEqual({ texto: 'Ambiente: Homologação, sem valor fiscal', tom: 'neutro' });
    expect(emitir({ ambiente: 'producao' })?.ambiente).toEqual({ texto: 'Ambiente: Produção, com valor fiscal', tom: 'alerta' });
  });
  it('Inutilizar leva a linha de ambiente (o shell não tem o ambiente da filial) e os limites do contador', () => {
    const a = LISTA_NOTAS.acaoDaBarra!.acao('administrador')!;
    expect(a.ambiente).toEqual({ texto: 'Ambiente: confira a configuração da filial emissora', tom: 'alerta' });
    expect(a.limitesTexto).toMatchObject({ min: expect.any(Number), max: expect.any(Number) });
  });
});
