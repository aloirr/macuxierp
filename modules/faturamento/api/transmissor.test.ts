import { FalhaTransporteSefaz } from '@macuxierp/nfe-sefaz';
import type { Banco } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { IDS } from '../domain/fixtures';
import { criarServicoEmissao, EVENTO_NOTA_AUTORIZADA, EVENTO_NOTA_REJEITADA } from './emissao';
import { a1DeTeste, depsFake, protocolo, transporteFake, tx, TENANT, type Roteiro } from './apoio-teste';
import { criarTransmissor } from './transmissor';

function montar(roteiro: Roteiro = {}, o: { ambienteAtual?: 'homologacao' | 'producao'; semA1?: boolean } = {}) {
  const f = depsFake({ ambiente: 'homologacao' });
  const t = transporteFake(roteiro);
  let dentro = 0;
  const banco: Banco = {
    comTenant: async (_id, fn) => {
      dentro++;
      try {
        return await fn(tx);
      } finally {
        dentro--;
      }
    },
    semTenant: async (fn) => fn(tx),
    ping: async () => true,
  };
  // A SEFAZ nunca é chamada dentro de transação (RN-FAT-03, regra 7).
  const foraDeTx = <K extends 'autorizar' | 'consultarRecibo' | 'consultarProtocolo'>(k: K) => {
    const original = t.transporte[k].bind(t.transporte) as (...a: unknown[]) => Promise<unknown>;
    (t.transporte as unknown as Record<string, unknown>)[k] = async (...a: unknown[]) => {
      if (dentro !== 0) throw new Error('SEFAZ chamada dentro da transação');
      return original(...a);
    };
  };
  (['autorizar', 'consultarRecibo', 'consultarProtocolo'] as const).forEach(foraDeTx);
  const a1 = a1DeTeste();
  const filiaisPedidas: unknown[] = [];
  const transmissor = criarTransmissor({
    banco,
    notas: f.r.repo,
    emissor: f.deps.emissor,
    ambiente: { ambiente: async () => o.ambienteAtual ?? 'homologacao' },
    lerA1: async () => (o.semA1 ? null : a1),
    sefaz: (filial, credencial) => {
      expect(credencial).toBe(a1.credencial); // o seletor recebe o pfx + senha, não o certificado aberto
      filiaisPedidas.push(filial);
      return t.transporte;
    },
    agora: () => new Date('2026-11-21T14:30:00Z'),
  });
  return { ...f, ...f.r, t, a1, filiaisPedidas, transmissor, svc: criarServicoEmissao(f.deps) };
}
async function emitir(m: ReturnType<typeof montar>, idempotencia = 'idem-0000001') {
  const r = await m.svc.emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia });
  if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
  return r.nota;
}

describe('worker: transmitir a nota em_autorizacao', () => {
  it('RN-FAT-03: lê o XML assinado guardado pela emissão (o worker não assina), envia (recibo), consulta o recibo, guarda o nfeProc e publica nota.autorizada@1; o A1 é zerado', async () => {
    const m = montar();
    const nota = await emitir(m);
    const r = await m.transmissor.transmitirNota(TENANT, nota.id);
    expect(r.resultado).toBe('autorizada');
    expect(m.t.chamadas).toEqual(['autorizar', 'consultarRecibo']);
    expect(m.assinadas[0]).toContain(`Id="NFe${nota.chave_acesso}"`);
    expect(m.assinados.map((a) => [a.id, a.versao])).toEqual([[nota.id, 1]]); // gravado pela emissão, com a nota em rascunho, antes da SEFAZ
    expect(m.notas.get(nota.id)?.status).toBe('autorizada');
    expect(m.xmls[0]?.conteudo).toMatch(/^<nfeProc .*<protNFe/);
    expect(m.xmls[0]?.conteudo).toContain(m.assinadas[0] as string);
    expect(m.eventos.map((e) => e.nome)).toEqual([EVENTO_NOTA_AUTORIZADA]);
    expect(m.transmissoes.map((t) => [t.servico, t.destino, t.cStat])).toEqual([['autorizacao', 'simulador', '103'], ['ret_autorizacao', 'simulador', '104']]);
    expect([...m.a1.credencial.pfx].every((b) => b === 0)).toBe(true);
    expect(m.filiaisPedidas[0]).toEqual({ filial_id: IDS.filial, ambiente: 'homologacao', uf: 'AM', modo: 'normal' });
  });

  it('RN-FAT-07: rejeição da SEFAZ (778) vira rejeitada com nota.rejeitada@1 e uma única chamada de envio', async () => {
    const m = montar({ recibo: (c) => protocolo(c, { cStat: '778', xMotivo: 'Rejeicao: NCM inexistente', nProt: null, digVal: null }) });
    const nota = await emitir(m);
    const r = await m.transmissor.transmitirNota(TENANT, nota.id);
    expect(r).toMatchObject({ resultado: 'rejeitada', codigo: '778' });
    expect(m.eventos.map((e) => e.nome)).toEqual([EVENTO_NOTA_REJEITADA]);
    expect(m.t.chamadas.filter((c) => c === 'autorizar')).toHaveLength(1);
  });

  it('RN-FAT-07: lote rejeitado no envelope (sem recibo) também vira rejeitada', async () => {
    const m = montar({ autorizar: () => ({ cStat: '225', xMotivo: 'Rejeicao: Falha no Schema XML' }) });
    const r = await m.transmissor.transmitirNota(TENANT, (await emitir(m)).id);
    expect(r).toMatchObject({ resultado: 'rejeitada', codigo: '225' });
    expect(m.t.chamadas).toEqual(['autorizar']);
  });

  it('RN-FAT-07: duplicidade (204) → consultarProtocolo FORA da transação → autoriza e NÃO publica rejeição', async () => {
    const m = montar({ autorizar: (c) => protocolo(c, { cStat: '204', xMotivo: 'Rejeicao: Duplicidade de NF-e', nProt: null, digVal: null }) });
    const r = await m.transmissor.transmitirNota(TENANT, (await emitir(m)).id);
    expect(r.resultado).toBe('autorizada');
    expect(m.t.chamadas).toEqual(['autorizar', 'consultarProtocolo']);
    expect(m.eventos.map((e) => e.nome)).toEqual([EVENTO_NOTA_AUTORIZADA]);
  });

  it('RN-FAT-07: duplicidade que a consulta não resolve (217) deixa a nota em_autorizacao, sem evento', async () => {
    const m = montar({ autorizar: (c) => protocolo(c, { cStat: '539', xMotivo: 'Duplicidade com diferenca', nProt: null, digVal: null }), consulta: () => null });
    const nota = await emitir(m);
    expect((await m.transmissor.transmitirNota(TENANT, nota.id)).resultado).toBe('duplicidade');
    expect(m.notas.get(nota.id)?.status).toBe('em_autorizacao');
    expect(m.eventos).toEqual([]);
  });

  it('RN-FAT-03: recibo ainda em processamento (105) registra o recibo e a próxima volta só consulta o recibo (sem novo envio)', async () => {
    let pronto = false;
    const m = montar({ recibo: (c) => (pronto ? protocolo(c) : null) });
    const nota = await emitir(m);
    expect((await m.transmissor.transmitirNota(TENANT, nota.id)).resultado).toBe('aguardando');
    expect(m.notas.get(nota.id)).toMatchObject({ status: 'em_autorizacao', recibo: '131000000000001' });
    pronto = true;
    expect((await m.transmissor.transmitirNota(TENANT, nota.id)).resultado).toBe('autorizada');
    expect(m.t.chamadas).toEqual(['autorizar', 'consultarRecibo', 'consultarRecibo']);
  });

  it('RN-FAT-03: guarda que falhou é reprocessada pela consulta do protocolo, sem reenviar a nota', async () => {
    const m = montar();
    const nota = await emitir(m);
    m.estado.falharGuarda = true;
    expect((await m.transmissor.transmitirNota(TENANT, nota.id)).resultado).toBe('guarda_pendente');
    expect(m.eventos).toEqual([]);
    m.estado.falharGuarda = false;
    expect((await m.transmissor.transmitirNota(TENANT, nota.id)).resultado).toBe('autorizada');
    expect(m.t.chamadas).toEqual(['autorizar', 'consultarRecibo', 'consultarProtocolo']);
    expect(m.eventos).toHaveLength(1);
  });

  it('RN-CORE-06: filial sem A1 ativo não envia nada e a nota continua em_autorizacao', async () => {
    const m = montar({}, { semA1: true });
    const nota = await emitir(m);
    expect((await m.transmissor.transmitirNota(TENANT, nota.id)).resultado).toBe('sem_certificado');
    expect(m.t.chamadas).toEqual([]);
    expect(m.notas.get(nota.id)?.status).toBe('em_autorizacao');
  });

  it('RN-FAT-04: se o ambiente da filial mudou depois da nota, o envio é recusado', async () => {
    const m = montar({}, { ambienteAtual: 'producao' });
    expect((await m.transmissor.transmitirNota(TENANT, (await emitir(m)).id)).resultado).toBe('ambiente_mudou');
    expect(m.t.chamadas).toEqual([]);
  });

  it('RN-FAT-02: nota autorizada ou inexistente é ignorada (idempotente)', async () => {
    const m = montar();
    const nota = await emitir(m);
    await m.transmissor.transmitirNota(TENANT, nota.id);
    expect(await m.transmissor.transmitirNota(TENANT, nota.id)).toEqual({ resultado: 'ignorada', motivo: 'status_nao_transmissivel' });
    expect(await m.transmissor.transmitirNota(TENANT, 'nao-existe')).toEqual({ resultado: 'ignorada', motivo: 'nota_inexistente' });
  });

  it('RF-FAT-08: falha de rede propaga na nota única e a varredura segue com as outras; o A1 é zerado mesmo assim', async () => {
    const m = montar();
    const nota = await emitir(m);
    m.t.transporte.autorizar = async () => {
      throw new FalhaTransporteSefaz('autorizacao', true, 'tempo esgotado');
    };
    await expect(m.transmissor.transmitirNota(TENANT, nota.id)).rejects.toThrow(FalhaTransporteSefaz);
    expect([...m.a1.credencial.pfx].every((b) => b === 0)).toBe(true);
    const varredura = await m.transmissor.transmitirPendentes(TENANT);
    expect(varredura).toEqual([{ nota_id: nota.id, resultado: { resultado: 'falha', codigo: 'FalhaTransporteSefaz' } }]);
    expect(m.notas.get(nota.id)?.status).toBe('em_autorizacao');
  });

  const trocarEmissor = (m: ReturnType<typeof montar>) => {
    // Emissor que mudou entre o envio e o retry (outro verProc/leiaute): remontar daria outro XML e outro digVal (duplicidade 539).
    const antes = m.deps.emissor.montar.bind(m.deps.emissor);
    m.deps.emissor.montar = (n, o) => {
      const r = antes(n, o);
      return { ...r, xml: r.xml.replace('<NFe ', '<NFe data-emissor="v2" ') };
    };
  };

  it('RN-FAT-03: troca do emissor entre o envio e o retry: o retry usa o XML assinado GUARDADO (não remonta, não reassina) e a guarda funciona', async () => {
    let pronto = false;
    const m = montar({ recibo: (c) => (pronto ? protocolo(c) : null) });
    const nota = await emitir(m);
    expect((await m.transmissor.transmitirNota(TENANT, nota.id)).resultado).toBe('aguardando');
    const primeiro = m.assinadas[0] as string;
    const montagens = m.recebidas.length;
    trocarEmissor(m);
    pronto = true;
    expect((await m.transmissor.transmitirNota(TENANT, nota.id)).resultado).toBe('autorizada');
    expect(m.recebidas.length).toBe(montagens);
    expect(m.assinadas).toEqual([primeiro]);
    expect(m.assinados).toHaveLength(1);
    expect(m.xmls[0]?.conteudo).toContain(primeiro);
    expect(m.xmls[0]?.conteudo).not.toContain('data-emissor');
    expect(m.eventos.map((e) => e.nome)).toEqual([EVENTO_NOTA_AUTORIZADA]);
  });

  it('RN-FAT-03: duplicidade e guarda pendente reutilizam o assinado guardado mesmo com o emissor trocado', async () => {
    const m = montar({ autorizar: (c) => protocolo(c, { cStat: '204', xMotivo: 'Rejeicao: Duplicidade de NF-e', nProt: null, digVal: null }) });
    const nota = await emitir(m);
    m.estado.falharGuarda = true;
    trocarEmissor(m);
    expect((await m.transmissor.transmitirNota(TENANT, nota.id)).resultado).toBe('guarda_pendente');
    m.estado.falharGuarda = false;
    expect((await m.transmissor.transmitirNota(TENANT, nota.id)).resultado).toBe('autorizada');
    expect(m.assinados).toHaveLength(1);
    expect(m.xmls[0]?.conteudo).toContain(m.assinadas[0] as string);
  });

  it('RN-FAT-07: o reenvio da rejeitada (conteúdo novo) remonta, assina e grava a versão 2; o retry seguinte reutiliza a 2', async () => {
    const m = montar({ recibo: (c) => protocolo(c, { cStat: '778', xMotivo: 'Rejeicao: NCM inexistente', nProt: null, digVal: null }) });
    const nota = await emitir(m);
    expect((await m.transmissor.transmitirNota(TENANT, nota.id)).resultado).toBe('rejeitada');
    const re = await m.svc.reenviarNota(tx, m.notas.get(nota.id)!);
    expect(re.ok).toBe(true);
    expect(m.notas.get(nota.id)?.revisao).toBe(2);
    await m.transmissor.transmitirNota(TENANT, nota.id);
    expect(m.assinados.map((a) => a.versao)).toEqual([1, 2]);
    expect(m.assinadas).toHaveLength(2);
    await m.transmissor.transmitirNota(TENANT, nota.id); // rejeitada de novo: sem reenvio, nada a fazer
    expect(m.assinados).toHaveLength(2);
  });

  it('RN-FAT-03: nota com outra transmissão em curso (trava da nota) sai sem fazer nada, sem A1 e sem SEFAZ', async () => {
    const m = montar();
    const nota = await emitir(m);
    m.estado.travadas.add(nota.id);
    expect(await m.transmissor.transmitirNota(TENANT, nota.id)).toEqual({ resultado: 'ignorada', motivo: 'em_transmissao' });
    expect(m.t.chamadas).toEqual([]);
    expect(m.assinados).toHaveLength(1); // só o da emissão
    expect(m.notas.get(nota.id)?.status).toBe('em_autorizacao');
  });

  it('RN-FAT-03: a varredura só pega a nota parada há mais de N minutos (padrão 2)', async () => {
    const m = montar();
    const nota = await emitir(m);
    m.estado.agoraBanco = new Date(m.estado.relogio.getTime() + 60_000);
    expect(await m.transmissor.transmitirPendentes(TENANT)).toEqual([]);
    m.estado.agoraBanco = new Date(m.estado.relogio.getTime() + 3 * 60_000);
    expect((await m.transmissor.transmitirPendentes(TENANT)).map((r) => r.nota_id)).toEqual([nota.id]);
    const outra = await emitir(m, 'idem-0000002');
    m.estado.agoraBanco = new Date(m.estado.relogio.getTime() + 61_000);
    expect((await m.transmissor.transmitirPendentes(TENANT, 20, 1)).map((r) => r.nota_id)).toEqual([outra.id]);
  });

  it('RN-FAT-03: o nRec é gravado numa tx curta ANTES de consultar o recibo; se a consulta cai, o retry consulta o recibo e não reenvia', async () => {
    const m = montar();
    const nota = await emitir(m);
    const original = m.t.transporte.consultarRecibo.bind(m.t.transporte);
    m.t.transporte.consultarRecibo = async () => {
      throw new FalhaTransporteSefaz('ret_autorizacao', true, 'tempo esgotado');
    };
    await expect(m.transmissor.transmitirNota(TENANT, nota.id)).rejects.toThrow(FalhaTransporteSefaz);
    expect(m.notas.get(nota.id)).toMatchObject({ status: 'em_autorizacao', recibo: '131000000000001' });
    expect(m.transmissoes.map((t) => t.servico)).toEqual(['autorizacao']);
    m.t.transporte.consultarRecibo = original;
    expect((await m.transmissor.transmitirNota(TENANT, nota.id)).resultado).toBe('autorizada');
    expect(m.t.chamadas.filter((c) => c === 'autorizar')).toHaveLength(1);
  });
});
