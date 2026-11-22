import { describe, expect, it } from 'vitest';
import { paginaVisivel } from '@macuxierp/platform-sdk';
import { manifest } from '../manifest';
import * as publico from './index';
import {
  ACOES_DA_NOTA, PAGINAS_FATURAMENTO, ROTULO_ACAO_NOTA, ROTULO_LINHA, TEXTO_VAZIO, acaoPrincipalDaNota, acoesDoPedidoAFaturar, acoesDoTitulo, badgesDaNota, faixaDoTitulo, rotuloDaForma, colunasDaPagina, confirmacaoReenviar, csvDaPagina,
  dialogoCancelar, dialogoCartaCorrecao, dialogoEstornar, dialogoInutilizar, enderecoDaConsulta, faixaDaNota, formularioBaixa, hojeCivil, motivosDasAcoes, perfilVeFaturamento, requisicaoBaixa,
  requisicaoCancelar, requisicaoCartaCorrecao, requisicaoConsultar, requisicaoEmitir, requisicaoEstornar, requisicaoInutilizar, requisicaoReenviar, rotuloReenviar, situacaoDoTitulo, urlDoDanfe, urlDoXml,
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
    expect(csv).not.toContain('Filial');
    expect(csv).not.toContain('Pedido');
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
  it('RF-FAT-08: DANFE sem rota (lote 3) fica desabilitado com o motivo, e o XML é a ação principal da autorizada; leitura nunca age', () => {
    expect(DANFE_DISPONIVEL).toBe(false);
    expect(motivosDasAcoes('faturista', nota(), AGORA).baixarDanfe).toBe('DANFE em breve; por enquanto, baixe o XML.');
    expect(motivosDasAcoes('faturista', nota(), AGORA).baixarXml).toBeUndefined();
    expect(motivosDasAcoes('faturista', nota({ status: 'rejeitada' }), AGORA).baixarDanfe).toBe('disponível só para nota autorizada ou cancelada.');
    expect(acaoPrincipalDaNota('autorizada')).toBe('baixarXml');
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
  it('B: a lista de notas e a de rejeições mostram o selo de homologação (produção sem selo); só Número/Série, sem Filial e Pedido', () => {
    for (const id of ['notas', 'rejeicoes']) {
      const cols = colunasDaPagina(id, 'America/Manaus');
      const amb = cols.find((c) => c.id === 'ambiente');
      expect(amb?.selos?.({ ambiente: 'homologacao' })).toEqual([{ texto: 'Homologação — sem valor fiscal', tom: 'alerta' }]);
      expect(amb?.selos?.({ ambiente: 'producao' })).toEqual([]);
      expect(cols.map((c) => c.id)).not.toEqual(expect.arrayContaining(['filial']));
      expect(cols.map((c) => c.id)).not.toContain('pedido');
      expect(cols[0]?.id).toBe('numero');
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
    expect(dialogoEstornar({ valor_centavos: 12_345, baixado_em: '2026-11-20T15:00:00.000Z' }, 'America/Manaus').titulo).toBe('Estornar a baixa de R$ 123,45 feita em 20/11?');
  });
});

describe('API pública do web', () => {
  it('o index exporta só o que o shell importa (valores), mais as duas funções de ação da tela (rótulos e ação principal)', () => {
    expect(Object.keys(publico).sort()).toEqual([
      'ACOES_DA_NOTA', 'PAGINAS_FATURAMENTO', 'ROTULO_ACAO_NOTA', 'ROTULO_LINHA', 'TEXTO_VAZIO', 'acaoPrincipalDaNota', 'acoesDoPedidoAFaturar', 'acoesDoTitulo', 'badgesDaNota', 'colunasDaPagina',
      'confirmacaoReenviar', 'contadorDeCaracteres', 'csvDaPagina', 'dialogoCancelar', 'dialogoCartaCorrecao', 'dialogoEstornar', 'dialogoInutilizar', 'enderecoDaConsulta', 'faixaDaNota', 'faixaDoTitulo',
      'formularioBaixa', 'hojeCivil', 'motivosDasAcoes', 'numeroSerie', 'perfilVeFaturamento', 'requisicaoBaixa', 'requisicaoCancelar', 'requisicaoCartaCorrecao', 'requisicaoConsultar',
      'requisicaoEmitir', 'requisicaoEstornar', 'requisicaoInutilizar', 'requisicaoReenviar', 'rotuloDaForma', 'rotuloReenviar', 'situacaoDoTitulo', 'urlDoDanfe', 'urlDoXml',
    ]);
  });
});
