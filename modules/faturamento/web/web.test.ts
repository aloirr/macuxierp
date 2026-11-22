import { describe, expect, it } from 'vitest';
import { paginaVisivel } from '@macuxierp/platform-sdk';
import { manifest } from '../manifest';
import {
  PAGINAS_FATURAMENTO, ROTULO_LINHA, TEXTO_VAZIO, FAIXA_HOMOLOGACAO, colunasDaPagina, confirmacaoReenviar, dialogoCancelar, dialogoCartaCorrecao, dialogoEstornar, dialogoInutilizar, faixaDaNota, hojeCivil, motivosDasAcoes, requisicaoInutilizar, rotuloReenviar, situacaoDoTitulo, TEXTO_HOMOLOGACAO, acoesDaNota, acoesDoPedidoAFaturar, acoesDoTitulo, badgesDaNota, csvDaPagina, enderecoDaConsulta, formularioBaixa, paginaNotas,
  paginaPedidosAFaturar, paginaRejeicoes, paginaTitulos, perfilVeFaturamento, requisicaoBaixa, requisicaoCancelar, requisicaoCartaCorrecao, requisicaoConsultar, requisicaoEmitir,
  requisicaoEstornar, requisicaoReenviar, urlDoDanfe, urlDoXml, type NotaParaAcao,
} from './index';

const ID = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const AGORA = new Date('2026-11-22T15:00:00Z');
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
    expect(b[0]).toMatchObject({ texto: TEXTO_HOMOLOGACAO, tom: 'alerta' });
    expect(TEXTO_HOMOLOGACAO).toBe('Homologação — sem valor fiscal');
    expect(b[1]?.texto).toBe('Autorizada');
  });
  it('nota de produção só mostra o status, em pt-BR, com o tom certo', () => {
    expect(badgesDaNota({ status: 'autorizada', ambiente: 'producao' })).toEqual([{ texto: 'Autorizada', tom: 'ok' }]);
    expect(badgesDaNota({ status: 'rejeitada', ambiente: 'producao' })[0]).toMatchObject({ texto: 'Rejeitada', tom: 'erro' });
    expect(badgesDaNota({ status: 'autorizada_guarda_pendente', ambiente: 'producao' })[0]?.texto).toBe('Autorizada (guardando o XML)');
  });
});

describe('ações da nota por perfil e status', () => {
  it('RN-FAT-02: cancelar e CC-e só na autorizada, só para quem emite; o cancelamento some depois de 24 h', () => {
    expect(acoesDaNota('faturista', nota(), AGORA)).toMatchObject({ cancelar: true, cartaCorrecao: true, baixarXml: true, baixarDanfe: true, consultar: true, reenviar: false });
    expect(acoesDaNota('faturista', nota({ autorizada_em: '2026-11-21T12:00:00.000Z' }), AGORA)).toMatchObject({ cancelar: false, cartaCorrecao: true });
    expect(acoesDaNota('faturista', nota({ status: 'cancelada' }), AGORA)).toMatchObject({ cancelar: false, cartaCorrecao: false, baixarXml: true });
  });
  it('RN-FAT-07: só a rejeitada (ou o rascunho) reenvia; nunca a autorizada (nota autorizada não se edita)', () => {
    expect(acoesDaNota('fiscal', nota({ status: 'rejeitada' }), AGORA)).toMatchObject({ reenviar: true, cancelar: false, baixarXml: false });
    expect(acoesDaNota('fiscal', nota({ status: 'autorizada' }), AGORA).reenviar).toBe(false);
  });
  it('RN-CORE-02: leitura vê a nota mas não tem nenhuma ação, nem o XML (dado do destinatário); vendedor nada', () => {
    for (const perfil of ['leitura', 'vendedor', 'gerente'] as const) {
      expect(Object.values(acoesDaNota(perfil, nota(), AGORA)).some(Boolean), perfil).toBe(false);
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
    expect(requisicaoReenviar(ID)).toEqual({ metodo: 'POST', caminho: `/v1/faturamento/notas/${ID}/reenviar` });
    expect(requisicaoConsultar(ID)).toEqual({ metodo: 'POST', caminho: `/v1/faturamento/notas/${ID}/consultar` });
    expect(urlDoXml(ID)).toBe(`/v1/faturamento/notas/${ID}/xml`);
    expect(urlDoDanfe(ID)).toBe(`/v1/faturamento/notas/${ID}/danfe`);
  });
});

describe('títulos a receber (rotas do lote 5, declaradas contra o caminho combinado)', () => {
  it('declara os caminhos combinados e a dependência do lote 5', () => {
    expect(paginaTitulos.api).toBe('/v1/faturamento/titulos');
    expect(PAGINAS_FATURAMENTO.find((p) => p.rota === '/faturamento/titulos')?.aviso).toBeUndefined();
  });
  it('RF-FAT-06: baixa em R$ vira centavos sem float, não passa do saldo, nem de hoje, e vira POST com Idempotency-Key', () => {
    expect(formularioBaixa({ valor: '1.234,56', data: '2026-11-20', saldo_centavos: 200_000, hoje: '2026-11-22' })).toEqual({ ok: true, valor_centavos: 123_456, data_baixa: '2026-11-20' });
    expect(formularioBaixa({ valor: '2.500,00', data: '2026-11-20', saldo_centavos: 200_000, hoje: '2026-11-22' })).toMatchObject({ ok: false, erro: expect.stringContaining('Saldo: R$') });
    expect(formularioBaixa({ valor: '0,00', data: '2026-11-20', saldo_centavos: 200_000, hoje: '2026-11-22' })).toMatchObject({ ok: false });
    expect(formularioBaixa({ valor: 'dez', data: '2026-11-20', saldo_centavos: 200_000, hoje: '2026-11-22' })).toMatchObject({ ok: false });
    expect(formularioBaixa({ valor: '10,00', data: '2026-11-23', saldo_centavos: 200_000, hoje: '2026-11-22' })).toMatchObject({ ok: false, erro: expect.stringContaining('futura') });
    expect(requisicaoBaixa(ID, { valor_centavos: 1000, data_baixa: '2026-11-20' }, 'chave-baixa-0001')).toEqual({
      metodo: 'POST', caminho: `/v1/faturamento/titulos/${ID}/baixas`, cabecalhos: { 'Idempotency-Key': 'chave-baixa-0001' }, corpo: { valor_centavos: 1000, data_baixa: '2026-11-20' },
    });
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
  it('a fila de pedidos e os títulos mostram cliente, total, saldo e vencimento em formato brasileiro', () => {
    const p = csvDaPagina(paginaPedidosAFaturar, [{ id: ID, pedido_id: ID, numero: 7, cliente_razao_social: 'Mercado Boa Vista', total_centavos: 50_000, status: 'a_faturar', recebido_em: '2026-11-22T15:00:00.000Z', filial_id: ID, cliente_id: ID }], 'America/Manaus');
    expect(p).toContain('Mercado Boa Vista');
    expect(p).toContain('500,00');
    const t = csvDaPagina(paginaTitulos, [{ id: ID, nota_id: ID, cliente_id: ID, cliente_razao_social: 'Mercado Boa Vista', filial_id: ID, ambiente: 'producao' as const, numero: 12, parcela: 1, total_parcelas: 2, vencimento: '2026-12-05', valor_centavos: 10_000, saldo_centavos: 2_500, status: 'aberto' }], 'America/Manaus');
    expect(t).toContain('05/12/2026');
    expect(t).toContain('25,00');
  });
});

describe('ajustes das revisões da T-0021 (item C)', () => {
  it('RN-FAT-04: faixa fixa só na nota de homologação; o selo continua em primeiro lugar', () => {
    expect(faixaDaNota({ ambiente: 'homologacao' })).toBe(FAIXA_HOMOLOGACAO);
    expect(FAIXA_HOMOLOGACAO).toBe('NOTA DE HOMOLOGAÇÃO — SEM VALOR FISCAL');
    expect(faixaDaNota({ ambiente: 'producao' })).toBeNull();
  });
  it('RN-FAT-02: ação indisponível devolve o motivo; rascunho tem "Emitir"; reenviar confirma e mostra carregamento', () => {
    expect(motivosDasAcoes('faturista', nota({ autorizada_em: '2026-11-21T12:00:00.000Z' }), AGORA).cancelar).toBe('Prazo de cancelamento encerrado');
    expect(motivosDasAcoes('faturista', nota({ status: 'rejeitada' }), AGORA).cancelar).toBe('Disponível só para nota autorizada');
    expect(motivosDasAcoes('faturista', nota(), AGORA)).toMatchObject({ reenviar: expect.any(String) });
    expect(Object.keys(motivosDasAcoes('leitura', nota(), AGORA))).toHaveLength(6);
    expect(rotuloReenviar('rascunho')).toBe('Emitir');
    expect(rotuloReenviar('rejeitada')).toBe('Reenviar');
    expect(confirmacaoReenviar({ numero: 5, serie: 1, status: 'rejeitada' })).toMatchObject({ rotuloConfirmar: 'Reenviar', textoCarregando: 'Reenviando…' });
  });
  it('RN-FAT-02: diálogo de cancelamento com título, aviso, contador de 15 a 255 e CC-e de 15 a 1000', () => {
    const d = dialogoCancelar({ numero: 123, serie: 1 });
    expect(d.titulo).toBe('Cancelar a nota 123/1?');
    expect(d.aviso).toBe('Não dá para desfazer. Prazo: 24 h da autorização.');
    expect(d.contador('curto')).toBe('faltam 10 caracteres');
    expect(d.contador('x'.repeat(20))).toBe('20/255');
    expect(d.validar({ texto: 'curto' })).not.toBeNull();
    expect(d.validar({ texto: 'x'.repeat(15) })).toBeNull();
    expect(dialogoCartaCorrecao({ numero: 1, serie: 1 }).validar({ texto: 'x'.repeat(1001) })).not.toBeNull();
    expect(dialogoCartaCorrecao({ numero: 1, serie: 1 }).validar({ texto: 'x'.repeat(1000) })).toBeNull();
  });
  it('RN-FAT-01: inutilizar faixa monta o POST com Idempotency-Key e recusa faixa invertida', () => {
    const e = { filial_id: ID, numero_inicial: 10, numero_final: 12, justificativa: 'Falha de numeração no sistema' };
    expect(requisicaoInutilizar(e, 'chave-inutiliza-1')).toMatchObject({ ok: true, requisicao: { caminho: '/v1/faturamento/inutilizacoes' } });
    expect(requisicaoInutilizar({ ...e, numero_inicial: 13 }, 'chave-inutiliza-1')).toMatchObject({ ok: false });
    expect(dialogoInutilizar(e).titulo).toBe('Inutilizar a faixa 10 a 12?');
  });
  it('textos de lista vazia, rótulo de linha, colunas à direita e "—" no lugar do UUID', () => {
    expect(Object.keys(TEXTO_VAZIO).sort()).toEqual(['notas', 'pedidos-a-faturar', 'rejeicoes', 'titulos']);
    expect(TEXTO_VAZIO['notas']).toBe('Nenhuma nota neste filtro. Limpe os filtros.');
    const t = { id: ID, nota_id: ID, cliente_id: ID, numero: 123, filial_id: ID, ambiente: 'producao' as const, parcela: 1, total_parcelas: 2, vencimento: '2026-12-05', valor_centavos: 1, saldo_centavos: 1, status: 'aberto' as const };
    expect(ROTULO_LINHA['titulos']?.(t as never)).toBe('Abrir a nota 123 do título');
    const cols = colunasDaPagina('titulos', 'America/Manaus');
    expect(cols.filter((c) => c.tipo === 'dinheiro').map((c) => c.id)).toEqual(['valor', 'saldo']);
    expect(cols.find((c) => c.id === 'cliente')?.valor(t)).toBe('—');
    expect(colunasDaPagina('notas', 'America/Manaus').map((c) => c.id)).toEqual(expect.arrayContaining(['filial', 'pedido']));
    expect(paginaNotas.chaves).toEqual(expect.arrayContaining(['serie', 'numero', 'pedido_id']));
  });
  it('RF-FAT-06: vencido mostra "Vencido há N dias" no tom de erro; estorno pede confirmação com valor e dia', () => {
    expect(situacaoDoTitulo({ status: 'aberto', vencimento: '2026-11-17' }, '2026-11-22')).toEqual({ texto: 'Vencido há 5 dias', tom: 'erro' });
    expect(situacaoDoTitulo({ status: 'aberto', vencimento: '2026-11-22' }, '2026-11-22').tom).not.toBe('erro');
    expect(hojeCivil('America/Manaus', new Date('2026-11-22T02:00:00Z'))).toBe('2026-11-21');
    expect(dialogoEstornar({ valor_centavos: 12_345, baixado_em: '2026-11-20T15:00:00.000Z' }, 'America/Manaus').titulo).toBe('Estornar a baixa de R$ 123,45 feita em 20/11?');
  });
});
