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
import { renderizarDanfe } from './danfe-pdf';
import { a1DeTeste, depsFake, tx, TENANT } from './apoio-teste';
import { criarServicoEmissao, EVENTO_NOTA_AUTORIZADA } from './emissao';
import { criarTransmissor } from './transmissor';

const banco: Banco = { comTenant: async (_id, fn) => fn(tx), semTenant: async (fn) => fn(tx), ping: async () => true };

function montar(mei = false) {
  const f = depsFake({ ambiente: 'homologacao' });
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
  const transmissor = criarTransmissor({
    banco,
    notas: f.r.repo,
    emissor: f.emissor,
    ambiente: { ambiente: async () => 'homologacao' },
    lerA1: async () => a1DeTeste(),
    sefaz: seletor,
    agora: () => INSTANTE_DE_TESTE,
  });
  return { ...f, ...f.r, transmissor, svc: criarServicoEmissao(f.deps) };
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
      expect(danfe.cabecalho.protocolo).toContain(m.notas.get(nota.id)!.protocolo!);
      expect(danfe.marcaDagua).toBe('SEM VALOR FISCAL');
      expect(danfe.paginas[0]!.itens).toHaveLength(2);
      expect(danfe.imposto.find((c) => c.rotulo === 'Valor total da nota')?.valor).toBe('45,00');
      expect((await renderizarDanfe(danfe)).length).toBeGreaterThan(1000);
      expect(m.eventos.map((e) => e.nome)).toEqual([EVENTO_NOTA_AUTORIZADA]);
      expect(m.transmissoes.every((t) => t.destino === 'simulador')).toBe(true);
    });
  }

  it('RN-FAT-01: duas notas em sequência saem com nNF 100 e 101, sem buraco, e o simulador autoriza as duas', async () => {
    const m = montar();
    const a = await m.svc.emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia: 'idem-ponta-seq-1' });
    const b = await m.svc.emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia: 'idem-ponta-seq-2' });
    if (!a.ok || !b.ok) throw new Error('esperava ok');
    expect([a.nota.numero, b.nota.numero]).toEqual([100, 101]);
    expect((await m.transmissor.transmitirNota(TENANT, a.nota.id)).resultado).toBe('autorizada');
    expect((await m.transmissor.transmitirNota(TENANT, b.nota.id)).resultado).toBe('autorizada');
  });
});
