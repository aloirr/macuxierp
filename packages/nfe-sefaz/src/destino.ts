/**
 * Escolha do destino da SEFAZ para uma filial emissora, com a TRAVA DO SIMULADOR (regra 7, RN-CORE-08):
 * filial em produção fiscal nunca recebe o simulador. As três camadas da trava, sem variável de ambiente: desenho
 * T-0045 §2.2. Aqui ficam as duas primeiras (`escolherDestinoSefaz` e `garantirDestinoSimulador`).
 */
import { z } from 'zod';
import { AmbienteFiscal, CUF, C_ORGAO_AN, ModoEmissao, TP_AMB, TP_EMIS, TP_EMIS_ACEITOS, TP_EMIS_EPEC, Uf, type TpAmb } from './ambiente';
import { AUTORIZADOR_DA_UF, ENDERECOS_EPEC, ENDERECOS_SEFAZ, EPEC_DA_UF, SVC_DA_UF, type Autorizador, type UrlsSefaz } from './enderecos';
import { ErroSefaz, SimuladorEmProducaoErro } from './erros';

/** O que o seletor precisa saber da filial emissora (o faturamento lê do core e do cadastros pelos contracts). */
export const FilialEmissoraSefaz = z
  .object({
    filial_id: z.string().uuid(),
    ambiente: AmbienteFiscal,
    uf: Uf,
    modo: ModoEmissao.default('normal'),
  })
  .strict();
export type FilialEmissoraSefaz = z.input<typeof FilialEmissoraSefaz>;

/**
 * Para onde a implantação manda a filial EM HOMOLOGAÇÃO: `simulador` (F4, decisão do Alexandre de 21/11/2026) ou
 * `sefaz` (homologação real, T-0046). Para filial em produção, só `sefaz` é aceito.
 */
export const TransporteHomologacao = z.enum(['simulador', 'sefaz']);
export type TransporteHomologacao = z.infer<typeof TransporteHomologacao>;

interface DestinoComum {
  readonly filial_id: string;
  readonly uf: Uf;
  readonly cUF: number;
  readonly modo: ModoEmissao;
  readonly tpEmis: number;
}

/** Destino do simulador: o tipo só admite homologação (tpAmb 2). */
export interface DestinoSimulador extends DestinoComum {
  readonly tipo: 'simulador';
  readonly ambiente: 'homologacao';
  readonly tpAmb: 2;
}

/** Destino real: o autorizador da UF ou a SVC, com os endereços da tabela. */
export interface DestinoSefazReal extends DestinoComum {
  readonly tipo: 'sefaz';
  readonly ambiente: AmbienteFiscal;
  readonly tpAmb: TpAmb;
  readonly autorizador: Autorizador;
  readonly urls: UrlsSefaz;
  /** `false` enquanto a T-0046 não conferir os endereços no portal oficial (só aceito em homologação). */
  readonly conferido: boolean;
}

export type DestinoSefaz = DestinoSimulador | DestinoSefazReal;

function erroContingenciaSimulada(filialId: string): ErroSefaz {
  return new ErroSefaz(
    'SEFAZ_CONTINGENCIA_SIMULADA',
    `Filial emissora ${filialId} usa o simulador da SEFAZ: não entra em contingência (RN-FAT-10)`,
  );
}

function erroFilial(campos: string): ErroSefaz {
  return new ErroSefaz('SEFAZ_FILIAL_INVALIDA', `Filial emissora fora do contrato: ${campos}`);
}

/** Filial e transporte validados (a mensagem cita só os caminhos dos campos), para os dois seletores de destino. */
function lerPedidoDeDestino<S extends z.ZodTypeAny>(
  schema: S,
  filial: unknown,
  opcoes: { transporte: TransporteHomologacao } | undefined,
): { f: z.output<S>; transporte: TransporteHomologacao } {
  const f = schema.safeParse(filial);
  if (!f.success) throw erroFilial([...new Set(f.error.issues.map((i) => i.path.join('.') || '(raiz)'))].join(', '));
  const t = TransporteHomologacao.safeParse(opcoes?.transporte);
  if (!t.success) throw new ErroSefaz('SEFAZ_TRANSPORTE_NAO_CONFIGURADO', 'Transporte da homologação deve ser "simulador" ou "sefaz"');
  return { f: f.data as z.output<S>, transporte: t.data };
}

/**
 * Escolhe o destino. Não lê `process.env`: quem chama passa `transporte` (o worker lê a configuração dele e passa aqui;
 * mesmo errada, ela não liga o simulador em produção).
 *
 * @throws SimuladorEmProducaoErro filial em produção com `transporte: 'simulador'`.
 * @throws ErroSefaz `SEFAZ_FILIAL_INVALIDA`, `SEFAZ_UF_SEM_AUTORIZADOR`, `SEFAZ_CONTINGENCIA_INVALIDA`,
 *   `SEFAZ_CONTINGENCIA_SIMULADA` (RN-FAT-10: contingência com o simulador), `SEFAZ_ENDERECO_NAO_CONFERIDO` (produção
 *   com endereço "a conferir").
 */
export function escolherDestinoSefaz(
  filial: FilialEmissoraSefaz,
  opcoes: { transporte: TransporteHomologacao },
): DestinoSefaz {
  const { f, transporte } = lerPedidoDeDestino(FilialEmissoraSefaz, filial, opcoes);
  const { filial_id, ambiente, uf, modo } = f;

  const autorizadorNormal = AUTORIZADOR_DA_UF[uf];
  if (!autorizadorNormal) throw new ErroSefaz('SEFAZ_UF_SEM_AUTORIZADOR', `UF ${uf} sem autorizador mapeado no ERP`);
  if (modo !== 'normal' && SVC_DA_UF[uf] !== modo) {
    throw new ErroSefaz('SEFAZ_CONTINGENCIA_INVALIDA', `A contingência da UF ${uf} não é ${modo}`);
  }
  const comum: DestinoComum = { filial_id, uf, cUF: CUF[uf], modo, tpEmis: TP_EMIS[modo] };

  if (transporte === 'simulador') {
    // A trava: produção nunca recebe o simulador, venha o pedido de onde vier.
    if (ambiente !== 'homologacao') throw new SimuladorEmProducaoErro(filial_id);
    // RN-FAT-10: a filial com NF-e simulada não entra em contingência (o simulador não cai). Os testes do simulador
    // montam o destino de SVC à mão (`apoio-teste.ts` do sefaz-simulador); o worker nunca chega a ele (ADR 0011).
    if (modo !== 'normal') throw erroContingenciaSimulada(filial_id);
    return Object.freeze({ ...comum, tipo: 'simulador', ambiente: 'homologacao', tpAmb: 2 } satisfies DestinoSimulador);
  }

  const autorizador: Autorizador = modo === 'svc-rs' ? 'SVC-RS' : modo === 'svc-an' ? 'SVC-AN' : autorizadorNormal;
  const enderecos = ENDERECOS_SEFAZ[autorizador][ambiente];
  if (ambiente === 'producao' && !enderecos.conferido) {
    throw new ErroSefaz(
      'SEFAZ_ENDERECO_NAO_CONFERIDO',
      `Endereços do ${autorizador} em produção ainda "a conferir" (T-0046): emissão em produção bloqueada`,
    );
  }
  return Object.freeze({
    ...comum,
    tipo: 'sefaz',
    ambiente,
    tpAmb: TP_AMB[ambiente],
    autorizador,
    urls: enderecos.urls,
    conferido: enderecos.conferido,
  } satisfies DestinoSefazReal);
}

/**
 * Segunda trava: confere, em tempo de execução, que o destino é de simulador em homologação. Cobre destino montado à
 * mão, `as any`, cópia alterada ou JSON vindo de fora. O simulador chama isto na fábrica; o seletor, antes de chamá-la.
 *
 * @throws SimuladorEmProducaoErro se o destino não for `{ tipo: 'simulador', ambiente: 'homologacao', tpAmb: 2 }`.
 */
export function garantirDestinoSimulador(destino: unknown): DestinoSimulador {
  const d = (destino ?? {}) as Partial<Record<string, unknown>>;
  const filialId = typeof d.filial_id === 'string' ? d.filial_id : null;
  if (d.tipo !== 'simulador' || d.ambiente !== 'homologacao' || d.tpAmb !== 2) throw new SimuladorEmProducaoErro(filialId);
  return destino as DestinoSimulador;
}

/**
 * `tpEmis` do documento é um dos que o modo do destino aceita (`TP_EMIS_ACEITOS`)? Senão, `SEFAZ_CONTINGENCIA_INVALIDA`
 * e nada sai: nota de SVC no autorizador normal, nota normal na SVC ou SVC trocada. O transporte real chama antes de
 * enviar; o simulador responde 570 pela mesma tabela.
 */
export function tpEmisAceito(modo: ModoEmissao, tpEmis: number): boolean {
  return (TP_EMIS_ACEITOS[modo] as readonly number[]).includes(tpEmis);
}

export function garantirTpEmisDoDestino(modo: ModoEmissao, tpEmis: number, documento: string): void {
  if (tpEmisAceito(modo, tpEmis)) return;
  throw new ErroSefaz('SEFAZ_CONTINGENCIA_INVALIDA', `${documento}: tpEmis ${tpEmis || '(ausente)'} não é aceito no modo ${modo}`);
}

// ---------- EPEC (evento 110140 no Ambiente Nacional) ----------

/** O que o seletor da EPEC precisa saber da filial emissora (sem `modo`: a EPEC tem destino próprio). */
export const FilialEmissoraEpec = z
  .object({
    filial_id: z.string().uuid(),
    ambiente: AmbienteFiscal,
    uf: Uf,
  })
  .strict();
export type FilialEmissoraEpec = z.input<typeof FilialEmissoraEpec>;

/**
 * Destino do evento EPEC: o Ambiente Nacional (`cOrgao` 91), com a URL de recepção do ambiente da filial. Não há
 * destino EPEC de simulador (RN-FAT-10); os testes chamam o `epec` do simulador direto (ADR 0011).
 */
export interface DestinoEpec {
  readonly tipo: 'epec';
  readonly filial_id: string;
  readonly uf: Uf;
  /** `cUF` da filial: vai no `cOrgaoAutor` do `detEvento`. */
  readonly cUF: number;
  readonly ambiente: AmbienteFiscal;
  readonly tpAmb: TpAmb;
  readonly tpEmis: typeof TP_EMIS_EPEC;
  readonly cOrgao: typeof C_ORGAO_AN;
  readonly autorizador: 'AN';
  readonly url: string;
  /** `false` enquanto o fiscal (T-0046) não conferir o endereço no Portal Nacional (só aceito em homologação). */
  readonly conferido: boolean;
}

/**
 * Escolhe o destino do evento EPEC. Mesmas travas do `escolherDestinoSefaz`: o simulador não recebe contingência
 * (RN-FAT-10) e produção exige o endereço conferido.
 *
 * @throws SimuladorEmProducaoErro filial em produção com `transporte: 'simulador'`.
 * @throws ErroSefaz `SEFAZ_FILIAL_INVALIDA`, `SEFAZ_TRANSPORTE_NAO_CONFIGURADO`, `SEFAZ_CONTINGENCIA_SIMULADA`,
 *   `SEFAZ_CONTINGENCIA_INVALIDA` (UF sem EPEC), `SEFAZ_ENDERECO_NAO_CONFERIDO`.
 */
export function escolherDestinoEpec(filial: FilialEmissoraEpec, opcoes: { transporte: TransporteHomologacao }): DestinoEpec {
  const { f, transporte } = lerPedidoDeDestino(FilialEmissoraEpec, filial, opcoes);
  const { filial_id, ambiente, uf } = f;
  if (transporte === 'simulador') {
    if (ambiente !== 'homologacao') throw new SimuladorEmProducaoErro(filial_id);
    throw erroContingenciaSimulada(filial_id);
  }
  if (!EPEC_DA_UF[uf]) throw new ErroSefaz('SEFAZ_CONTINGENCIA_INVALIDA', `A UF ${uf} não tem EPEC no ERP`);
  const endereco = ENDERECOS_EPEC[ambiente];
  if (ambiente === 'producao' && !endereco.conferido) {
    throw new ErroSefaz('SEFAZ_ENDERECO_NAO_CONFERIDO', 'Endereço da EPEC no Ambiente Nacional ainda "a conferir": EPEC em produção bloqueada');
  }
  return Object.freeze({
    tipo: 'epec',
    filial_id,
    uf,
    cUF: CUF[uf],
    ambiente,
    tpAmb: TP_AMB[ambiente],
    tpEmis: TP_EMIS_EPEC,
    cOrgao: C_ORGAO_AN,
    autorizador: 'AN',
    url: endereco.url,
    conferido: endereco.conferido,
  } satisfies DestinoEpec);
}
