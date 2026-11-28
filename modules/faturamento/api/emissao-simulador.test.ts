/**
 * Ponta a ponta do lote 1c com o emissor REAL (`criarEmissorNFe`), um A1 gerado em tempo de execução e o simulador da SEFAZ-AM (T-0045):
 * pedido → nota (API: montada e gravada em rascunho, sem A1) → worker (remonta, assina com o A1, guarda a nfe_assinada, transmite) → protocolo 100 → nfeProc guardado ANTES de
 * a nota passar a autorizada → evento `nota.autorizada@1`. Repositório em memória que imita os gatilhos da 0013 e da 0020.
 */
import { criarSeletorTransporte, validarXsd, verificarAssinaturaNFe } from '@macuxierp/nfe-sefaz';
import { INSTANTE_DE_TESTE } from '@macuxierp/nfe-sefaz/teste';
import { criarFabricaSimulador } from '@macuxierp/sefaz-simulador';
import type { Banco } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { montarDanfe } from '../domain/danfe';
import { IDS } from '../domain/fixtures';
import { exigirAssinaturaDaMarca } from './ativos-marca';
import { renderizarDanfe } from './danfe-pdf';
import { a1DeTeste, depsFake, titulosFake, tx, TENANT, situacaoAprovadaDeTeste } from './apoio-teste';
import { criarServicoEmissao, EVENTO_NOTA_AUTORIZADA } from './emissao';
import { criarTransmissor } from './transmissor';

const banco: Banco = { comTenant: async (_id, fn) => fn(tx), semTenant: async (fn) => fn(tx), ping: async () => true };

function montar(mei = false, ipi = false) {
  const f = depsFake({ ambiente: 'homologacao' });
  if (ipi) {
    // IPI por regra (T-0132): calc_ipi do fiscal + CST/cEnq do grupo ipi; cada item leva 10% sobre a base de 1000 centavos (vIPI 100).
    const calcular = f.deps.calculo.calcular;
    f.deps.calculo.calcular = async (t, e) => {
      const r = await calcular(t, e);
      if (!r.ok) return r;
      const itens = r.saida.itens.map((i) => ({ ...i, regra_aplicada: { st: false, ipi: true }, calc_ipi: { v_bc: 1000, p_aliq: 100_000, v_valor: 100 }, ipi: { cst: '50', c_enq: '999', v_bc: 1000, p_ipi: 100_000, v_ipi: 100 } }));
      const v_ipi = itens.length * 100;
      return { ...r, saida: { ...r.saida, itens, totais: { ...r.saida.totais, v_ipi, v_nf: r.saida.totais.v_nf + v_ipi } } };
    };
  }
  if (mei) {
    // Nota de MEI (CRT 4, NT 2024.001): CSOSN 102 e PIS/COFINS 99 zerados, sem crédito de ICMS.
    f.deps.cadastros.filial = async () => ({
      id: IDS.filial,
      cnpj: '11.222.333/0001-81',
      razao_social: 'EMITENTE MEI',
      nome_fantasia: null,
      ie: '041234561',
      crt: 4,
      endereco: { logradouro: 'Rua E', numero: '1', bairro: 'Centro', municipio_ibge: '1302603', municipio_nome: 'Manaus', uf: 'AM', cep: '69000-000' },
      emissora: true,
      nfe_serie: 1,
    });
    const calcular = f.deps.calculo.calcular;
    f.deps.calculo.calcular = async (t, e) => {
      const r = await calcular(t, e);
      return r.ok
        ? { ...r, saida: { ...r.saida, itens: r.saida.itens.map((i) => ({ ...i, icms: { orig: '0' as const, csosn: '102' }, pis: { cst: '99', v_bc: 0, p_aliq: 0, v_valor: 0 }, cofins: { cst: '99', v_bc: 0, p_aliq: 0, v_valor: 0 } })) } }
        : r;
    };
  }
  const seletor = criarSeletorTransporte({ transporte: 'simulador', simulador: criarFabricaSimulador({ agora: () => new Date(INSTANTE_DE_TESTE.getTime() + 1_000), tMed: 1 }) });
  const tit = titulosFake();
  const transmissor = criarTransmissor({
    log: () => undefined,
    banco,
    notas: f.r.repo, titulos: tit.repo,
    emissor: f.emissor,
    ambiente: { ambiente: async () => 'homologacao' },
    situacao: situacaoAprovadaDeTeste, lerA1: async () => a1DeTeste(),
    sefaz: seletor,
    agora: () => INSTANTE_DE_TESTE,
  });
  return { ...f, ...f.r, tit, transmissor, svc: criarServicoEmissao(f.deps) };
}

// XSD e assinatura reais, lentos quando a suíte roda em paralelo (o padrão de 5 s estourou): 30 s. A ordem das escritas fica no transmissor.test.
describe('ponta a ponta: pedido → nota → simulador → nfeProc guardado → autorizada', { timeout: 30_000 }, () => {
  for (const mei of [false, true]) {
    it(`RN-FAT-03: ${mei ? 'nota de MEI (CRT 4, CSOSN 102)' : 'nota do Lucro Presumido/Real (CRT 3, ICMS 00)'} autorizada pelo simulador; o XML assinado vale no XSD e o nfeProc é guardado antes de autorizar`, async () => {
      const m = montar(mei);
      const emissao = await m.svc.emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia: `idem-ponta-${mei ? 'mei' : 'normal'}` });
      if (!emissao.ok) throw new Error(JSON.stringify(emissao.violacoes));
      const nota = emissao.nota;
      expect(nota.status).toBe('rascunho'); // a API não assina (ADR 0005 item 4)
      expect(m.log).toEqual(['trava', 'numero:100', 'gravar']);
      expect(m.assinados).toEqual([]);

      const r = await m.transmissor.transmitirNota(TENANT, nota.id);
      expect(r.resultado).toBe('autorizada');
      const assinado = m.assinados[0]!.xml;
      expect((await validarXsd(assinado, 'nfe')).erros).toEqual([]);
      expect(verificarAssinaturaNFe(assinado, { agora: INSTANTE_DE_TESTE })).toMatchObject({ ok: true });
      expect(assinado).toContain(`<cNF>${nota.cnf}</cNF>`);
      if (mei) expect(assinado).toContain('<CRT>4</CRT>');
      expect(assinado).not.toContain('<IBSCBS>');

      const proc = m.xmls[0]!.conteudo;
      expect((await validarXsd(proc, 'procNFe')).erros).toEqual([]);
      expect(proc).toContain(assinado); // bytes assinados intactos
      expect(proc).toContain(m.notas.get(nota.id)!.protocolo!);
      expect(m.notas.get(nota.id)?.status).toBe('autorizada');
      // RF-FAT-03: o DANFE sai do nfeProc REAL do emissor + simulador (homologação: marca d'água), com o protocolo e o número da nota
      const danfe = montarDanfe({ nfeProc: proc });
      expect(danfe.cabecalho.chave).toBe(nota.chave_acesso);
      expect(danfe.operacao.protocolo).toContain(m.notas.get(nota.id)!.protocolo!);
      expect(danfe.marcaDagua).toBe('SEM VALOR FISCAL');
      expect(danfe.itens).toHaveLength(2);
      expect(danfe.imposto.find((c) => c.rotulo === 'Valor total da nota')?.valor).toBe('45,00');
      expect((await renderizarDanfe(danfe, { assinaturaMarca: await exigirAssinaturaDaMarca() })).length).toBeGreaterThan(1000);
      expect(m.eventos.filter((e) => e.nome.startsWith('faturamento.nota.')).map((e) => e.nome)).toEqual([EVENTO_NOTA_AUTORIZADA]);
      expect(m.transmissoes.every((t) => t.destino === 'simulador')).toBe(true);
    });
  }

  it('RN-FIS-05: IPI por regra (calc_ipi) vai ao XML: vIPI em cada item e no ICMSTot, entra no vNF (soma dos itens), e o XML assinado vale no XSD', async () => {
    const m = montar(false, true);
    const emissao = await m.svc.emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia: 'idem-ponta-ipi' });
    if (!emissao.ok) throw new Error(JSON.stringify(emissao.violacoes));
    expect(emissao.nota.total_centavos).toBe(4500 + 200);
    expect((await m.transmissor.transmitirNota(TENANT, emissao.nota.id)).resultado).toBe('autorizada');
    const assinado = m.assinados[0]!.xml;
    expect((await validarXsd(assinado, 'nfe')).erros).toEqual([]);
    expect(assinado.match(/<IPITrib>/g)).toHaveLength(2);
    expect(assinado).toContain('<pIPI>10.0000</pIPI>');
    expect(assinado).toContain('<vIPI>2.00</vIPI>'); // total = soma dos itens (2 × 1,00)
    expect(assinado).toContain('<vNF>47.00</vNF>');
  });

  it('RF-FAT-07: boleto em 3 prazos (30/60/90): emitir → simulador autoriza → 3 títulos abertos que somam o total da nota, e a nota segue homologação', async () => {
    const m = montar();
    m.deps.cadastros.condicao = async () => ({ forma_tpag: '15', prazos_dias: [30, 60, 90] });
    const emissao = await m.svc.emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia: 'idem-ponta-titulos' });
    if (!emissao.ok) throw new Error(JSON.stringify(emissao.violacoes));
    expect((await m.transmissor.transmitirNota(TENANT, emissao.nota.id)).resultado).toBe('autorizada');
    const ts = [...m.tit.titulos.values()];
    expect(ts.map((t) => [t.parcela, t.total_parcelas, t.status, t.ambiente])).toEqual([[1, 3, 'aberto', 'homologacao'], [2, 3, 'aberto', 'homologacao'], [3, 3, 'aberto', 'homologacao']]);
    expect(ts.reduce((a, t) => a + t.valor_centavos, 0)).toBe(m.notas.get(emissao.nota.id)!.total_centavos);
    expect(ts.map((t) => t.vencimento)).toEqual(['2026-12-21', '2027-01-20', '2027-02-19']);
    expect(m.eventos.filter((e) => e.nome === 'faturamento.titulo.gerado@1')).toHaveLength(3);
  });

  it('RN-FAT-01: duas notas em sequência saem com nNF 100 e 101, sem buraco, e o simulador autoriza as duas', async () => {
    const m = montar();
    const a = await m.svc.emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia: 'idem-ponta-seq-1', itens: [{ sequencia: 1, quantidade: 10_000 }] });
    const b = await m.svc.emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia: 'idem-ponta-seq-2', itens: [{ sequencia: 1, quantidade: 10_000 }] });
    if (!a.ok || !b.ok) throw new Error('esperava ok');
    expect([a.nota.numero, b.nota.numero]).toEqual([100, 101]);
    expect((await m.transmissor.transmitirNota(TENANT, a.nota.id)).resultado).toBe('autorizada');
    expect((await m.transmissor.transmitirNota(TENANT, b.nota.id)).resultado).toBe('autorizada');
  });
});
