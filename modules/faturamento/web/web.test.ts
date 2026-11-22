import { describe, expect, it } from 'vitest';
import { paginaVisivel } from '@macuxierp/platform-sdk';
import { semEspacoDuro } from '@macuxierp/platform-sdk/testes';
import { manifest } from '../manifest';
import * as publico from './index';
import {
  ACOES_DA_NOTA, PAGINAS_FATURAMENTO, ROTULO_ACAO_NOTA, ROTULO_LINHA, TEXTO_VAZIO, acaoPrincipalDaNota, acoesDoPedidoAFaturar, acoesDoTitulo, badgesDaNota, faixaDoTitulo, rotuloDaForma, colunasDaPagina, confirmacaoReenviar, csvDaPagina,
  contadorDeCaracteres, dialogoCancelar, dialogoCartaCorrecao, dialogoEstornar, dialogoInutilizar, enderecoDaConsulta, faixaDaNota, formularioBaixa, formularioParcial, hojeCivil, motivosDasAcoes, paginaNoFuso, perfilVeFaturamento, urlDaConfiguracaoDaFilial, requisicaoBaixa,
  requisicaoCancelar, requisicaoCartaCorrecao, requisicaoConsultar, requisicaoEmitir, requisicaoEstornar, requisicaoInutilizar, requisicaoReenviar, rotuloReenviar, situacaoDoTitulo, urlDoDanfe, urlDoPedidoAFaturar, urlDoXml,
  type AcaoDaNota, type NotaParaAcao,
} from './index';
import { DANFE_DISPONIVEL } from './notas';
import { paginaNotas, paginaPedidosAFaturar, paginaRejeicoes, paginaTitulos } from './paginas';

const ID = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const AGORA = new Date('2026-11-22T15:00:00Z');
/** Ações liberadas (a lista pública devolve só os motivos das indisponíveis). */
const liberadas = (perfil: Parameters<typeof motivosDasAcoes>[0], n: NotaParaAcao, agora: Date): Record<AcaoDaNota, boolean> => {
  const m = motivosDasAcoes(perfil, n, agora);
  return Object.fromEntries(ACOES_DA_NOTA.map((a) => [a, !(a in m)])) as Record<AcaoDaNota, boolean>;
};
const nota = (extra: Partial<NotaParaAcao> = {}): NotaParaAcao => ({ status: 'autorizada', ambiente: 'producao', autorizada_em: '2026-11-22T12:00:00.000Z', ...extra });

describe('páginas do BKO do faturamento', () => {
  it('RF-FAT-01: todo menu do manifest tem página e toda página aponta para um menu do manifest; rotas únicas sob /faturamento', () => {
    const menus = new Set<string>(manifest.web?.menus);
    for (const p of PAGINAS_FATURAMENTO) {
      expect(menus.has(p.menu), p.menu).toBe(true);
      expect(p.rota.startsWith('/faturamento/'), p.rota).toBe(true);
    }
    for (const m of menus) expect(PAGINAS_FATURAMENTO.some((p) => p.menu === m), m).toBe(true);
    expect(new Set(PAGINAS_FATURAMENTO.map((p) => p.rota)).size).toBe(PAGINAS_FATURAMENTO.length);
    expect(menus.has('Pedidos a faturar')).toBe(true);
  });

  it('RF-FAT-08: o detalhe da nota abre por /:id e não vira item de menu', () => {
    const d = PAGINAS_FATURAMENTO.find((p) => p.rota === '/faturamento/notas/:id');
    expect(d?.ocultaNoMenu).toBe(true);
    expect(d?.menu).toBe('Notas fiscais');
  });

  it('RN-CORE-02: o vendedor não vê nada do faturamento; leitura vê as telas; as listas leem só do /v1/faturamento', () => {
    expect(perfilVeFaturamento('vendedor')).toBe(false);
    for (const perfil of ['administrador', 'gerente', 'faturista', 'fiscal', 'leitura'] as const) {
      expect(perfilVeFaturamento(perfil), perfil).toBe(true);
      for (const p of PAGINAS_FATURAMENTO) expect(paginaVisivel(p, perfil), `${perfil} ${p.rota}`).toBe(true);
    }
    for (const l of [paginaPedidosAFaturar, paginaNotas, paginaRejeicoes, paginaTitulos]) expect(l.api.startsWith('/v1/faturamento/')).toBe(true);
  });

  it('filtros vivem na URL: ida e volta da consulta de notas por status, cliente e período, ignorando o que não é da página', () => {
    const q = enderecoDaConsulta(paginaNotas, new URLSearchParams(`status=rejeitada&cliente_id=${ID}&de=2026-11-01&ate=2026-11-22&lixo=1&pagina=2`));
    expect(q).toBe(`/v1/faturamento/notas?ate=2026-11-22&cliente_id=${ID}&de=2026-11-01&status=rejeitada`);
    expect(paginaNotas.consulta.parse({ status: 'rejeitada', de: '2026-11-01' })).toMatchObject({ status: 'rejeitada', limite: 50 });
    expect(() => paginaNotas.consulta.parse({ status: 'inventado' })).toThrow();
  });
});

describe('selos da nota', () => {
  it('RN-FAT-04: nota de homologação mostra "Homologação — sem valor fiscal" antes do status', () => {
    const b = badgesDaNota({ status: 'autorizada', ambiente: 'homologacao' });
    expect(b[0]).toEqual({ texto: 'Homologação — sem valor fiscal', tom: 'alerta' });
    expect(b[1]?.texto).toBe('Autorizada');
  });
  it('nota de produção só mostra o status, em pt-BR, com o tom certo', () => {
    expect(badgesDaNota({ status: 'autorizada', ambiente: 'producao' })).toEqual([{ texto: 'Autorizada', tom: 'ok' }]);
    expect(badgesDaNota({ status: 'rejeitada', ambiente: 'producao' })[0]).toMatchObject({ texto: 'Rejeitada', tom: 'erro' });
    expect(badgesDaNota({ status: 'autorizada_guarda_pendente', ambiente: 'producao' })[0]?.dica).toBe('Autorizada. Salvando o arquivo da nota');
    expect(badgesDaNota({ status: 'em_autorizacao', ambiente: 'producao' })[0]?.dica).toBe('Aguardando a SEFAZ');
    expect(badgesDaNota({ status: 'denegada', ambiente: 'producao' })[0]?.dica).toBe('A SEFAZ recusou em definitivo. Fale com o fiscal');
    expect(badgesDaNota({ status: 'emitida_contingencia', ambiente: 'producao' })[0]?.dica).toBe('Emitida sem a SEFAZ no ar. Será enviada depois');
    expect(badgesDaNota({ status: 'autorizada_guarda_pendente', ambiente: 'producao' })[0]?.texto).toBe('Autorizada');
  });
});

describe('ações da nota por perfil e status', () => {
  it('RN-FAT-02: cancelar e CC-e só na autorizada, só para quem emite; o cancelamento some depois de 24 h', () => {
    expect(liberadas('faturista', nota(), AGORA)).toMatchObject({ cancelar: true, cartaCorrecao: true, baixarXml: true, baixarDanfe: DANFE_DISPONIVEL, consultar: true, reenviar: false });
    expect(liberadas('faturista', nota({ autorizada_em: '2026-11-21T12:00:00.000Z' }), AGORA)).toMatchObject({ cancelar: false, cartaCorrecao: true });
    expect(liberadas('faturista', nota({ status: 'cancelada' }), AGORA)).toMatchObject({ cancelar: false, cartaCorrecao: false, baixarXml: true });
  });
  it('RN-FAT-07: só a rejeitada (ou o rascunho) reenvia; nunca a autorizada (nota autorizada não se edita)', () => {
    expect(liberadas('fiscal', nota({ status: 'rejeitada' }), AGORA)).toMatchObject({ reenviar: true, cancelar: false, baixarXml: false });
    expect(liberadas('fiscal', nota({ status: 'autorizada' }), AGORA).reenviar).toBe(false);
  });
  it('RN-CORE-02: leitura vê a nota mas não tem nenhuma ação, nem o XML (dado do destinatário); vendedor nada', () => {
    for (const perfil of ['leitura', 'vendedor', 'gerente'] as const) {
      expect(Object.values(liberadas(perfil, nota(), AGORA)).some(Boolean), perfil).toBe(false);
    }
  });
  it('RF-FAT-01: "Emitir nota" (total e parcial) só para quem emite e só com saldo a faturar', () => {
    expect(acoesDoPedidoAFaturar('faturista', 'a_faturar')).toEqual({ emitir: true });
    expect(acoesDoPedidoAFaturar('administrador', 'faturado_parcial').emitir).toBe(true);
    expect(acoesDoPedidoAFaturar('faturista', 'faturado')).toEqual({ emitir: false });
    expect(acoesDoPedidoAFaturar('leitura', 'a_faturar')).toEqual({ emitir: false });
  });
});

describe('requisições (a API revalida; aqui só se monta o pedido)', () => {
  it('RN-CORE-05: emitir leva a Idempotency-Key no cabeçalho e a mesma chave no corpo (total e parcial)', () => {
    const total = requisicaoEmitir({ pedido_id: ID, chave: 'chave-emitir-0001' });
    expect(total).toMatchObject({ ok: true, requisicao: { metodo: 'POST', caminho: '/v1/faturamento/notas', cabecalhos: { 'Idempotency-Key': 'chave-emitir-0001' }, corpo: { pedido_id: ID, idempotencia: 'chave-emitir-0001' } } });
    const parcial = requisicaoEmitir({ pedido_id: ID, chave: 'chave-emitir-0002', itens: [{ sequencia: 2, quantidade: '1,5' }, { sequencia: 3 }] });
    expect(parcial).toMatchObject({ ok: true, requisicao: { corpo: { itens: [{ sequencia: 2, quantidade: 15_000 }, { sequencia: 3 }] } } });
  });
  it('emissão parcial recusa quantidade inválida, item repetido e lista vazia, com a mensagem em pt-BR', () => {
    expect(requisicaoEmitir({ pedido_id: ID, chave: 'chave-emitir-0003', itens: [{ sequencia: 1, quantidade: 'abc' }] })).toMatchObject({ ok: false, erro: expect.stringContaining('quantidade') });
    expect(requisicaoEmitir({ pedido_id: ID, chave: 'chave-emitir-0003', itens: [{ sequencia: 1 }, { sequencia: 1 }] })).toMatchObject({ ok: false });
    expect(requisicaoEmitir({ pedido_id: ID, chave: 'chave-emitir-0003', itens: [] })).toMatchObject({ ok: false });
    expect(requisicaoEmitir({ pedido_id: ID, chave: 'curta' })).toMatchObject({ ok: false });
  });
  it('RN-FAT-02: cancelar e CC-e validam o texto (15 a 255 e 15 a 1000) e levam a Idempotency-Key', () => {
    expect(requisicaoCancelar(ID, 'curto', 'chave-cancela-01')).toMatchObject({ ok: false });
    expect(requisicaoCancelar(ID, '  Cliente desistiu da compra  ', 'chave-cancela-01')).toEqual({
      ok: true, requisicao: { metodo: 'POST', caminho: `/v1/faturamento/notas/${ID}/cancelar`, cabecalhos: { 'Idempotency-Key': 'chave-cancela-01' }, corpo: { justificativa: 'Cliente desistiu da compra' } },
    });
    expect(requisicaoCartaCorrecao(ID, 'x'.repeat(1001), 'chave-cce-00001')).toMatchObject({ ok: false });
    expect(requisicaoCartaCorrecao(ID, 'Corrigir o endereço de entrega informado', 'chave-cce-00001')).toMatchObject({ ok: true, requisicao: { caminho: `/v1/faturamento/notas/${ID}/carta-correcao` } });
  });
  it('reenviar e consultar são POST sem corpo; XML e DANFE são links prontos (a rota do DANFE vem no lote 3)', () => {
    expect(requisicaoReenviar(ID, 'chave-reenvia-01')).toEqual({ ok: true, requisicao: { metodo: 'POST', caminho: `/v1/faturamento/notas/${ID}/reenviar`, cabecalhos: { 'Idempotency-Key': 'chave-reenvia-01' } } });
    expect(requisicaoConsultar(ID, 'chave-consulta-1')).toEqual({ ok: true, requisicao: { metodo: 'POST', caminho: `/v1/faturamento/notas/${ID}/consultar`, cabecalhos: { 'Idempotency-Key': 'chave-consulta-1' } } });
    expect(requisicaoReenviar(ID, 'curta')).toMatchObject({ ok: false });
    expect(requisicaoConsultar(ID, '')).toMatchObject({ ok: false });
    expect(urlDoXml(ID)).toBe(`/v1/faturamento/notas/${ID}/xml`);
    expect(urlDoDanfe(ID)).toBe(`/v1/faturamento/notas/${ID}/danfe`);
  });
});

describe('títulos a receber (rotas do lote 5, declaradas contra o caminho combinado)', () => {
  it('declara os caminhos combinados e a dependência do lote 5', () => {
    expect(paginaTitulos.api).toBe('/v1/faturamento/titulos');
  });
  it('RF-FAT-06: baixa em R$ vira centavos sem float, não passa do saldo, nem de hoje, e vira POST com Idempotency-Key', () => {
    expect(formularioBaixa({ valor: '1.234,56', data: '2026-11-20', saldo_centavos: 200_000, hoje: '2026-11-22' })).toEqual({ ok: true, valor_centavos: 123_456, data_baixa: '2026-11-20' });
    expect(formularioBaixa({ valor: '2.500,00', data: '2026-11-20', saldo_centavos: 200_000, hoje: '2026-11-22' })).toMatchObject({ ok: false, erro: expect.stringContaining('Saldo: R$') });
    expect(formularioBaixa({ valor: '0,00', data: '2026-11-20', saldo_centavos: 200_000, hoje: '2026-11-22' })).toMatchObject({ ok: false });
    expect(formularioBaixa({ valor: 'dez', data: '2026-11-20', saldo_centavos: 200_000, hoje: '2026-11-22' })).toMatchObject({ ok: false });
    expect(formularioBaixa({ valor: '10,00', data: '2026-11-23', saldo_centavos: 200_000, hoje: '2026-11-22' })).toMatchObject({ ok: false, erro: expect.stringContaining('futura') });
    expect(requisicaoBaixa(ID, { valor_centavos: 1000, data_baixa: '2026-11-20' }, 'chave-baixa-0001')).toEqual({
      ok: true, requisicao: { metodo: 'POST', caminho: `/v1/faturamento/titulos/${ID}/baixas`, cabecalhos: { 'Idempotency-Key': 'chave-baixa-0001' }, corpo: { valor_centavos: 1000, data_baixa: '2026-11-20' } },
    });
    expect(requisicaoBaixa(ID, { valor_centavos: 1000, data_baixa: '2026-11-20' }, 'curta')).toMatchObject({ ok: false });
    expect(requisicaoBaixa(ID, { valor_centavos: 0, data_baixa: '2026-11-20' }, 'chave-baixa-0001')).toMatchObject({ ok: false });
    expect(requisicaoBaixa(ID, { valor_centavos: 1000, data_baixa: '2026-11-20', forma: 'pix' }, 'chave-baixa-0001')).toMatchObject({ ok: true, requisicao: { corpo: { forma: 'pix' } } });
    expect(requisicaoEstornar(ID, ID, 'curta')).toMatchObject({ ok: false });
    expect(requisicaoEstornar(ID, ID, 'chave-estorno-01')).toMatchObject({ ok: true, requisicao: { metodo: 'POST', caminho: `/v1/faturamento/titulos/${ID}/baixas/${ID}/estornar` } });
  });
  it('"Baixar" só no título aberto com saldo; "Estornar" só com baixa não estornada; leitura não age', () => {
    const aberto = { status: 'aberto' as const, saldo_centavos: 5000, baixas: [] };
    expect(acoesDoTitulo('faturista', aberto)).toEqual({ baixar: true, estornar: false });
    expect(acoesDoTitulo('faturista', { status: 'baixado', saldo_centavos: 0, baixas: [{ id: ID, estornada_em: null }] })).toEqual({ baixar: false, estornar: true });
    expect(acoesDoTitulo('faturista', { status: 'baixado', saldo_centavos: 0, baixas: [{ id: ID, estornada_em: '2026-11-21T10:00:00.000Z' }] }).estornar).toBe(false);
    expect(acoesDoTitulo('leitura', aberto)).toEqual({ baixar: false, estornar: false });
    expect(acoesDoTitulo('fiscal', aberto)).toEqual({ baixar: false, estornar: false });
    expect(acoesDoTitulo('gerente', aberto).baixar).toBe(true);
  });
});

describe('colunas e CSV', () => {
  it('valores em R$ a partir de centavos, datas no fuso do tenant, e CSV com proteção contra fórmula', () => {
    const csv = csvDaPagina(paginaNotas, [{ id: ID, status: 'autorizada', ambiente: 'homologacao', serie: 1, numero: 12, total_centavos: 123_456, emitida_em: '2026-11-22T02:30:00.000Z', cliente_razao_social: '=CMD()' }], 'America/Manaus');
    expect(csv).toContain('R$');
    expect(csv).toContain('1.234,56');
    expect(csv).toContain('21/11/2026 22:30');
    expect(csv).toContain("'=CMD()");
    expect(csv).toContain(';Homologação;');
    expect(csv).not.toContain('sem valor fiscal');
  });
  it('RF-FAT-08: a lista de notas traz as colunas Pedido e Filial (vazias com travessão quando a nota não tem), no CSV e na tela', () => {
    const base = { id: ID, status: 'autorizada' as const, ambiente: 'producao' as const, serie: 1, numero: 12, total_centavos: 100, emitida_em: '2026-11-22T02:30:00.000Z' };
    const csv = csvDaPagina(paginaNotas, [{ ...base, pedido_numero: 77, filial_nome: 'Matriz Manaus' }, { ...base, pedido_numero: null, filial_nome: null }], 'America/Manaus').split('\r\n');
    expect(csv[0]).toContain('Número/Série;Pedido;Filial;Cliente');
    expect(csv[1]).toContain('12/1;77;Matriz Manaus;');
    expect(csv[2]).toContain('12/1;—;—;');
    expect(colunasDaPagina('notas', 'America/Manaus').map((c) => c.id).slice(0, 3)).toEqual(['numero', 'pedido', 'filial']);
  });
  it('RF-FAT-01: urlDaConfiguracaoDaFilial aponta para a configuração da filial na API', () => {
    expect(urlDaConfiguracaoDaFilial(ID)).toBe(`/v1/faturamento/filiais/${ID}/configuracao`);
  });

  it('RD-0772: paginaNoFuso refaz as colunas de data e hora no fuso pedido; o descritor fica no padrão (Manaus)', () => {
    const n = { numero: 1, serie: 1, emitida_em: '2026-11-21T14:00:00.000Z' } as never;
    const col = (p: { colunas: readonly { id: string; valor: (l: never) => unknown }[] }) => String(p.colunas.find((c) => c.id === 'emitida_em')!.valor(n));
    expect(col(paginaNotas as never)).toBe('21/11/2026 10:00');
    expect(col(paginaNoFuso(paginaNotas, 'America/Rio_Branco') as never)).toBe('21/11/2026 09:00');
    expect(col(paginaNoFuso(paginaNotas, 'America/Sao_Paulo') as never)).toBe('21/11/2026 11:00');
  });

  it('RN-FAT-02: números alinham à direita (tipo numero): Número/Série, Pedido, Nota e Parcela', () => {
    const tipos = (id: string) => Object.fromEntries(colunasDaPagina(id, 'America/Manaus').map((c) => [c.id, c.tipo]));
    expect(tipos('notas')).toMatchObject({ numero: 'numero', pedido: 'numero' });
    expect(tipos('rejeicoes')).toMatchObject({ numero: 'numero' });
    expect(tipos('pedidos-a-faturar')).toMatchObject({ numero: 'numero' });
    expect(tipos('titulos')).toMatchObject({ nota: 'numero', parcela: 'numero' });
  });

  it('RF-FAT-01: urlDoPedidoAFaturar aponta para o detalhe do pedido a faturar na API', () => {
    expect(urlDoPedidoAFaturar(ID)).toBe(`/v1/faturamento/pedidos-a-faturar/${ID}`);
  });
  it('a fila de pedidos e os títulos mostram cliente, total, saldo e vencimento em formato brasileiro', () => {
    const p = csvDaPagina(paginaPedidosAFaturar, [{ id: ID, pedido_id: ID, numero: 7, cliente_razao_social: 'Mercado Boa Vista', total_centavos: 50_000, status: 'a_faturar', ambiente: 'homologacao' as const, recebido_em: '2026-11-22T15:00:00.000Z', filial_id: ID, cliente_id: ID }], 'America/Manaus');
    expect(p).toContain('Mercado Boa Vista');
    expect(p).toContain('500,00');
    expect(p).toContain('Homologação');
    const t = csvDaPagina(paginaTitulos, [{ id: ID, nota_id: ID, cliente_id: ID, cliente_razao_social: 'Mercado Boa Vista', filial_id: ID, ambiente: 'producao' as const, numero: 12, parcela: 1, total_parcelas: 2, vencimento: '2026-12-05', valor_centavos: 10_000, saldo_centavos: 2_500, status: 'aberto' }], 'America/Manaus');
    expect(t).toContain('05/12/2026');
    expect(t).toContain('25,00');
    expect(t).toContain('Produção');
    const pedidos = colunasDaPagina('pedidos-a-faturar', 'America/Manaus');
    const titulos = colunasDaPagina('titulos', 'America/Manaus');
    expect(pedidos.map((c) => c.id)).toContain('ambiente');
    expect(titulos.map((c) => c.id)).toContain('ambiente');
    expect(titulos.find((c) => c.id === 'ambiente')?.selos?.({ ambiente: 'homologacao' })[0]?.tom).toBe('alerta');
    expect(pedidos.find((c) => c.id === 'status')?.selos?.({ status: 'faturado' })[0]).toEqual({ texto: 'Faturado', tom: 'ok' });
  });
});

describe('ajustes das revisões da T-0021 (item C)', () => {
  it('RN-FAT-04: faixa fixa só na nota de homologação; o selo continua em primeiro lugar', () => {
    expect(faixaDaNota({ ambiente: 'homologacao' })).toBe('NOTA DE HOMOLOGAÇÃO — SEM VALOR FISCAL');
    expect(faixaDaNota({ ambiente: 'producao' })).toBeNull();
  });
  it('RN-FAT-02: ação indisponível devolve o motivo; rascunho tem "Emitir"; reenviar confirma, mostra o ambiente e carregamento', () => {
    expect(motivosDasAcoes('faturista', nota({ autorizada_em: '2026-11-21T12:00:00.000Z' }), AGORA).cancelar).toBe('prazo de cancelamento encerrado.');
    expect(motivosDasAcoes('faturista', nota({ status: 'rejeitada' }), AGORA).cancelar).toBe('disponível só para nota autorizada.');
    expect(motivosDasAcoes('faturista', nota(), AGORA)).toMatchObject({ reenviar: expect.any(String) });
    expect(Object.keys(motivosDasAcoes('leitura', nota(), AGORA))).toHaveLength(6);
    expect(rotuloReenviar('rascunho')).toBe('Emitir');
    expect(rotuloReenviar('rejeitada')).toBe('Reenviar');
    expect(confirmacaoReenviar({ numero: 5, serie: 1, status: 'rejeitada', ambiente: 'producao' })).toMatchObject({
      rotuloConfirmar: 'Reenviar', textoCarregando: 'Reenviando…', aviso: 'Reenvia com o mesmo número. Corrija a causa da rejeição antes.', ambiente: 'Ambiente: Produção, com valor fiscal', tomAmbiente: 'alerta',
    });
    expect(confirmacaoReenviar({ numero: null, serie: 1, status: 'rascunho', ambiente: 'homologacao' })).toMatchObject({
      aviso: 'A nota será enviada à SEFAZ agora. Confira os dados.', ambiente: 'Ambiente: Homologação, sem valor fiscal', tomAmbiente: 'neutro', textoCarregando: 'Emitindo…',
    });
  });
  it('RN-FAT-02: com cancelamento aguardando a SEFAZ, Cancelar e CC-e ficam bloqueados com o motivo; as outras ações seguem', () => {
    const m = motivosDasAcoes('faturista', nota({ cancelamento_pendente: true }), AGORA);
    expect(m.cancelar).toBe('cancelamento aguardando a SEFAZ.');
    expect(m.cartaCorrecao).toBe('cancelamento aguardando a SEFAZ.');
    expect(m.baixarDanfe).toBeUndefined();
    expect(motivosDasAcoes('faturista', nota({ cancelamento_pendente: false }), AGORA).cancelar).toBeUndefined();
  });
  it('RF-FAT-08: o DANFE está ativo na autorizada e na cancelada (rota do #219) e é a ação principal da autorizada; leitura nunca age', () => {
    expect(DANFE_DISPONIVEL).toBe(true);
    expect(motivosDasAcoes('faturista', nota(), AGORA).baixarDanfe).toBeUndefined();
    expect(motivosDasAcoes('faturista', nota({ status: 'cancelada' }), AGORA).baixarDanfe).toBeUndefined();
    expect(motivosDasAcoes('faturista', nota(), AGORA).baixarXml).toBeUndefined();
    expect(motivosDasAcoes('faturista', nota({ status: 'rejeitada' }), AGORA).baixarDanfe).toBe('disponível só para nota autorizada ou cancelada.');
    expect(acaoPrincipalDaNota('autorizada')).toBe('baixarDanfe');
    expect(acaoPrincipalDaNota('rejeitada')).toBe('reenviar');
    expect(acaoPrincipalDaNota('rascunho')).toBe('reenviar');
    expect(acaoPrincipalDaNota('em_autorizacao')).toBeNull();
  });
  it('ações na ordem da barra, com Cancelar por último e destrutivo; rótulos pedidos pela UX', () => {
    expect(ACOES_DA_NOTA.at(-1)).toBe('cancelar');
    expect(ROTULO_ACAO_NOTA.cancelar).toEqual({ rotulo: 'Cancelar nota', destrutiva: true });
    expect(ACOES_DA_NOTA.filter((a) => ROTULO_ACAO_NOTA[a].destrutiva)).toEqual(['cancelar']);
    expect(ROTULO_ACAO_NOTA.consultar.rotulo).toBe('Consultar na SEFAZ');
    expect(ROTULO_ACAO_NOTA.cartaCorrecao.rotulo).toBe('Carta de correção (CC-e)');
  });
  it('RN-FAT-02: o prazo (cancelamento) dentro de 24 h libera, sem a data da autorização (nota sem autorizada_em) bloqueia', () => {
    expect(liberadas('faturista', nota({ autorizada_em: '2026-11-22T12:00:00.000Z' }), AGORA).cancelar).toBe(true);
    expect(liberadas('faturista', nota({ autorizada_em: null }), AGORA).cancelar).toBe(false);
  });
  it('UX: contador de caracteres no singular com 1 e no plural a partir de 2', () => {
    expect(contadorDeCaracteres('x'.repeat(14), 15, 255)).toBe('falta 1 caractere');
    expect(contadorDeCaracteres('x'.repeat(13), 15, 255)).toBe('faltam 2 caracteres');
    expect(contadorDeCaracteres('x'.repeat(256), 15, 255)).toBe('1 caractere a mais');
    expect(contadorDeCaracteres('x'.repeat(257), 15, 255)).toBe('2 caracteres a mais');
    expect(contadorDeCaracteres('x'.repeat(20), 15, 255)).toBe('20/255');
  });
  it('RN-FAT-02: diálogos de cancelamento (15 a 255) e CC-e (15 a 1000) com os limites do contrato, textos e botões da UX', () => {
    const d = dialogoCancelar({ numero: 123, serie: 1 });
    expect(d).toMatchObject({ titulo: 'Cancelar a nota 123/1?', aviso: 'Não dá para desfazer. O cancelamento só é aceito até 24 h depois da autorização.', rotuloConfirmar: 'Cancelar nota', rotuloFechar: 'Manter a nota', destrutivo: true, minimo: 15, maximo: 255 });
    expect(d.contador('curto')).toBe('faltam 10 caracteres');
    expect(d.contador('x'.repeat(20))).toBe('20/255');
    expect(d.validar({ texto: 'curto' })).toBe('A justificativa do cancelamento deve ter de 15 a 255 caracteres.');
    expect(d.validar({ texto: 'x'.repeat(15) })).toBeNull();
    expect(d.validar({ texto: 'x'.repeat(256) })).not.toBeNull();
    const c = dialogoCartaCorrecao({ numero: 1, serie: 1 });
    expect(c).toMatchObject({ minimo: 15, maximo: 1000, destrutivo: false });
    expect(c.validar({ texto: 'x'.repeat(1001) })).toBe('O texto da carta de correção deve ter de 15 a 1000 caracteres.');
    expect(c.validar({ texto: 'x'.repeat(1000) })).toBeNull();
    expect(requisicaoCancelar(ID, 'curto', 'chave-cancela-01')).toMatchObject({ ok: false, erro: 'A justificativa do cancelamento deve ter de 15 a 255 caracteres.' });
  });
  it('RN-FAT-01: inutilizar faixa monta o POST com Idempotency-Key, recusa faixa invertida e o diálogo diz o que fazer', () => {
    const e = { filial_id: ID, numero_inicial: 10, numero_final: 12, justificativa: 'Falha de numeração no sistema' };
    expect(requisicaoInutilizar(e, 'chave-inutiliza-1')).toMatchObject({ ok: true, requisicao: { caminho: '/v1/faturamento/inutilizacoes' } });
    expect(requisicaoInutilizar({ ...e, numero_inicial: 13 }, 'chave-inutiliza-1')).toMatchObject({ ok: false });
    expect(requisicaoInutilizar(e, 'curta')).toMatchObject({ ok: false });
    const d = dialogoInutilizar(e);
    expect(d).toMatchObject({ titulo: 'Inutilizar os números 10 a 12?', rotuloConfirmar: 'Inutilizar números', destrutivo: true });
    expect(d.aviso).toBe('Use quando um número foi pulado e a nota nunca será emitida. Não dá para desfazer: esses números não poderão mais ser usados.');
    expect(dialogoInutilizar({ numero_inicial: 7, numero_final: 7 }).titulo).toBe('Inutilizar o número 7?');
  });
  it('texto: faixa do título de homologação e rótulo da forma de baixa com maiúscula', () => {
    expect(faixaDoTitulo({ ambiente: 'homologacao' })).toBe('TÍTULO DE NOTA DE HOMOLOGAÇÃO — SEM VALOR FISCAL');
    expect(faixaDoTitulo({ ambiente: 'producao' })).toBeNull();
    expect(rotuloDaForma('manual')).toBe('Manual');
    expect(rotuloDaForma('pix')).toBe('Pix');
    expect(rotuloDaForma('')).toBe('');
  });
  it('textos de lista vazia, rótulo de linha, colunas à direita e "—" no lugar do UUID', () => {
    expect(Object.keys(TEXTO_VAZIO).sort()).toEqual(['notas', 'pedidos-a-faturar', 'rejeicoes', 'titulos']);
    expect(TEXTO_VAZIO.notas).toBe('Nenhuma nota neste filtro. Limpe os filtros.');
    expect(TEXTO_VAZIO.rejeicoes).toBe('Nenhuma nota rejeitada. Está tudo certo.');
    expect(TEXTO_VAZIO.titulos).toBe('Nenhum título neste filtro. Os títulos aparecem quando uma nota a prazo é autorizada.');
    const t = { id: ID, nota_id: ID, cliente_id: ID, numero: 123, filial_id: ID, ambiente: 'producao' as const, parcela: 1, total_parcelas: 2, vencimento: '2026-12-05', valor_centavos: 1, saldo_centavos: 1, status: 'aberto' as const };
    expect(ROTULO_LINHA.titulos({ ...t, cliente_razao_social: null })).toBe('Abrir o título 123 (parcela 1/2)');
    expect(ROTULO_LINHA.notas({ numero: 5, serie: 1 } as never)).toBe('Abrir nota 5/1');
    const cols = colunasDaPagina('titulos', 'America/Manaus');
    expect(cols.filter((c) => c.tipo === 'dinheiro').map((c) => c.id)).toEqual(['valor', 'saldo']);
    expect(cols.find((c) => c.id === 'cliente')?.valor(t)).toBe('—');
    expect(colunasDaPagina('inexistente', 'America/Manaus')).toEqual([]);
    expect(paginaNotas.chaves).toEqual(expect.arrayContaining(['serie', 'numero', 'pedido_id']));
  });
  it('B: a lista de notas e a de rejeições mostram o selo de homologação (produção sem selo); sem Pedido e Filial nas rejeições', () => {
    for (const id of ['notas', 'rejeicoes']) {
      const cols = colunasDaPagina(id, 'America/Manaus');
      const amb = cols.find((c) => c.id === 'ambiente');
      expect(amb?.selos?.({ ambiente: 'homologacao' })).toEqual([{ texto: 'Homologação — sem valor fiscal', tom: 'alerta' }]);
      expect(amb?.selos?.({ ambiente: 'producao' })).toEqual([]);
      if (id === 'rejeicoes') for (const ausente of ['pedido', 'filial']) expect(cols.map((c) => c.id)).not.toContain(ausente);
    }
  });
  it('UX: rejeições com "O que fazer" logo após o número, "Código da SEFAZ" e "Fale com o fiscal" quando falta a ação', () => {
    const cols = colunasDaPagina('rejeicoes', 'America/Manaus');
    expect(cols.map((c) => c.titulo).slice(0, 3)).toEqual(['Número/Série', 'O que fazer', 'Código da SEFAZ']);
    const r = { numero: 1, serie: 1, acao_sugerida: '', codigo: '778' };
    expect(cols.find((c) => c.id === 'acao')?.valor(r)).toBe('Fale com o fiscal');
    expect(cols.find((c) => c.id === 'acao')?.valor({ ...r, acao_sugerida: 'Corrija o NCM' })).toBe('Corrija o NCM');
  });
  it('a fila de pedidos chama a data de "Recebido em" (o contrato não tem aprovado_em)', () => {
    expect(colunasDaPagina('pedidos-a-faturar', 'America/Manaus').at(-1)?.titulo).toBe('Recebido em');
  });
  it('RF-FAT-06: vencido mostra "Vencido há N dias" no tom de erro; hoje civil é o de Manaus; estorno pede confirmação com valor e dia', () => {
    expect(situacaoDoTitulo({ status: 'aberto', vencimento: '2026-11-17' }, '2026-11-22')).toEqual({ texto: 'Vencido há 5 dias', tom: 'erro' });
    expect(situacaoDoTitulo({ status: 'aberto', vencimento: '2026-11-22' }, '2026-11-22').tom).not.toBe('erro');
    expect(hojeCivil(new Date('2026-11-22T02:00:00Z'))).toBe('2026-11-21');
    expect(semEspacoDuro(dialogoEstornar({ valor_centavos: 12_345, baixado_em: '2026-11-20T15:00:00.000Z' }, 'America/Manaus').titulo)).toBe('Estornar a baixa de R$ 123,45 feita em 20/11?');
  });
});

describe('API pública do web', () => {
  it('o index exporta o que o shell importa: páginas, rótulos de status, ambiente, BASE_API e as funções de ação (RD-0679/0680)', () => {
    expect(Object.keys(publico).sort()).toEqual([
      'ACOES_DA_NOTA', 'BASE_API', 'MOTIVO_SEM_ITEM', 'PAGINAS_FATURAMENTO', 'ROTULO_ACAO_NOTA', 'ROTULO_LINHA', 'ROTULO_STATUS_NOTA', 'ROTULO_STATUS_PEDIDO', 'ROTULO_STATUS_TITULO',
      'TEXTO_VAZIO', 'acaoPrincipalDaNota', 'acoesDoPedidoAFaturar', 'acoesDoTitulo', 'ambienteDaConfirmacao', 'badgesDaNota', 'colunasDaPagina', 'confirmacaoReenviar', 'contadorDeCaracteres',
      'csvDaPagina', 'dialogoCancelar', 'dialogoCartaCorrecao', 'dialogoEstornar', 'dialogoInutilizar', 'enderecoDaConsulta', 'faixaDaNota', 'faixaDoTitulo',
      'formularioBaixa', 'formularioParcial', 'hojeCivil', 'motivosDasAcoes', 'numeroSerie', 'paginaNoFuso', 'paginaNotas', 'paginaPedidosAFaturar', 'paginaRejeicoes', 'paginaTitulos',
      'perfilVeFaturamento', 'requisicaoBaixa', 'requisicaoCancelar', 'requisicaoCartaCorrecao', 'requisicaoConsultar', 'requisicaoEmitir', 'requisicaoEstornar', 'requisicaoInutilizar',
      'requisicaoReenviar', 'rotuloDaForma', 'rotuloReenviar', 'seloDoPedido', 'situacaoDoTitulo', 'textoDoAmbiente', 'urlDaConfiguracaoDaFilial', 'urlDoDanfe', 'urlDoPedidoAFaturar', 'urlDoXml',
    ]);
  });
});

describe('formularioParcial (RF-FAT-01, nota parcial)', () => {
  const itens = [
    { sequencia: 1, descricao: 'Água 500 ml', saldo: 125_000 }, // 12,5
    { sequencia: 2, descricao: null, saldo: 30_000 }, // 3
    { sequencia: 3, descricao: 'Sem saldo', saldo: 0 },
  ];
  const f = formularioParcial({ itens });

  it('campos pré-preenchidos com o saldo; item sem saldo não ganha campo', () => {
    expect(f.campos.map((c) => [c.sequencia, c.valorInicial, c.saldo])).toEqual([[1, '12,5', 125_000], [2, '3', 30_000]]);
    expect(f.campos[0]?.rotulo).toBe('1 - Água 500 ml');
    expect(f.campos[1]?.rotulo).toBe('Item 2');
  });

  it('regra do campo vazio: vazio = item fora da nota; parcial devolve só os que entram, em qtd4', () => {
    expect(f.validar({ 1: '1,5', 2: '' })).toEqual({ ok: true, itens: [{ sequencia: 1, quantidade: '1,5', qtd4: 15_000 }] });
    expect(f.validar({ 1: '  ', 2: '3' })).toEqual({ ok: true, itens: [{ sequencia: 2, quantidade: '3', qtd4: 30_000 }] }); // item 1 fora: parcial
  });

  it('todos pelo saldo inteiro: nota total (sem itens, o que o requisicaoEmitir aceita)', () => {
    const r = f.validar({ 1: '12,5', 2: '3,0000' });
    expect(r).toEqual({ ok: true });
    expect(requisicaoEmitir({ pedido_id: ID, chave: 'chave-parcial-1', ...(r.ok && r.itens ? { itens: r.itens } : {}) }).ok).toBe(true);
  });

  it('a saída parcial alimenta o requisicaoEmitir', () => {
    const r = f.validar({ 1: '1,2345', 2: '' });
    if (!r.ok || !r.itens) throw new Error('esperava parcial');
    const m = requisicaoEmitir({ pedido_id: ID, chave: 'chave-parcial-2', itens: r.itens });
    expect(m).toMatchObject({ ok: true, requisicao: { corpo: { itens: [{ sequencia: 1, quantidade: 12_345 }] } } });
  });

  it('erros por campo: acima do saldo, zero e texto inválido', () => {
    expect(f.validar({ 1: '12,5001', 2: '0', })).toEqual({ ok: false, erros: { 1: 'Máximo 12,5.', 2: 'Informe uma quantidade maior que zero ou deixe em branco.' } });
    expect(f.validar({ 1: '1,23456', 2: 'abc' })).toEqual({ ok: false, erros: { 1: expect.stringContaining('4 casas'), 2: expect.stringContaining('4 casas') } });
    expect(f.validar({ 2: '3,0001' })).toMatchObject({ ok: false, erros: { 2: 'Máximo 3.' } });
  });

  it('RD-0780: saldo >= 1.000 não quebra a nota parcial (valorInicial sem milhar; milhar digitado bem formado aceito)', () => {
    const g = formularioParcial({ itens: [{ sequencia: 1, descricao: 'Caixa', saldo: 12_000_000 }, { sequencia: 2, descricao: 'Lata', saldo: 10_000_000 }] });
    expect(g.campos.map((c) => [c.valorInicial, c.saldoTexto])).toEqual([['1200', '1.200'], ['1000', '1.000']]);
    const inicial = Object.fromEntries(g.campos.map((c) => [c.sequencia, c.valorInicial]));
    expect(g.validar(inicial)).toEqual({ ok: true }); // pré-preenchido: nota total, itens omitidos
    expect(g.validar({ 1: '1.200', 2: '1.000' })).toEqual({ ok: true }); // milhar digitado
    expect(g.validar({ 1: '1.200,5', 2: '' })).toMatchObject({ ok: false, erros: { 1: 'Máximo 1.200.' } });
    const parcial = g.validar({ 1: '1.000,5', 2: '' });
    expect(parcial).toEqual({ ok: true, itens: [{ sequencia: 1, quantidade: '1000,5', qtd4: 10_005_000 }] }); // saída sem milhar
    const m = requisicaoEmitir({ pedido_id: ID, chave: 'chave-parcial-3', itens: parcial.ok && parcial.itens ? parcial.itens : [] });
    expect(m).toMatchObject({ ok: true, requisicao: { corpo: { itens: [{ sequencia: 1, quantidade: 10_005_000 }] } } });
    const mil = g.validar({ 1: '1000', 2: '' });
    expect(mil).toEqual({ ok: true, itens: [{ sequencia: 1, quantidade: '1000', qtd4: 10_000_000 }] });
    expect(requisicaoEmitir({ pedido_id: ID, chave: 'chave-parcial-4', itens: mil.ok && mil.itens ? mil.itens : [] }).ok).toBe(true);
    expect(g.validar({ 1: '1.2000' })).toMatchObject({ ok: false, erros: { 1: expect.stringContaining('4 casas') } });
    expect(g.validar({ 1: '1.20' })).toMatchObject({ ok: false });
  });

  it('o botão liga com "0" ou texto inválido (o validar mostra o erro no campo); só campo vazio desliga', () => {
    expect(f.emitirHabilitado({ 1: '0' })).toBe(true);
    expect(f.emitirHabilitado({ 1: 'abc', 2: '' })).toBe(true);
  });

  it('nenhum item com quantidade: erro geral e botão desligado com o mesmo texto único', () => {
    expect(f.motivoBotaoDesligado).toBe('Informe a quantidade de pelo menos um item');
    expect(f.validar({})).toEqual({ ok: false, erros: {}, geral: 'Informe a quantidade de pelo menos um item' });
    expect(f.validar({ 1: '', 2: ' ' })).toMatchObject({ ok: false, geral: f.motivoBotaoDesligado });
    expect(f.emitirHabilitado({})).toBe(false);
    expect(f.emitirHabilitado({ 1: '' })).toBe(false);
    expect(f.emitirHabilitado({ 2: '1' })).toBe(true);
  });
});
