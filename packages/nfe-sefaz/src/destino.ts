/**
 * Escolha do destino da SEFAZ para uma filial emissora, com a TRAVA DO SIMULADOR (regra 7, RN-CORE-08):
 * filial em produção fiscal nunca recebe o simulador. As três camadas da trava, sem variável de ambiente: desenho
 * T-0045 §2.2. Aqui ficam as duas primeiras (`escolherDestinoSefaz` e `garantirDestinoSimulador`).
 */
import { z } from 'zod';
import { AmbienteFiscal, CUF, ModoEmissao, TP_AMB, TP_EMIS, Uf, type TpAmb } from './ambiente';
import { AUTORIZADOR_DA_UF, ENDERECOS_SEFAZ, SVC_DA_UF, type Autorizador, type UrlsSefaz } from './enderecos';
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

function erroFilial(campos: string): ErroSefaz {
  return new ErroSefaz('SEFAZ_FILIAL_INVALIDA', `Filial emissora fora do contrato: ${campos}`);
}

/**
 * Escolhe o destino. Não lê `process.env`: quem chama passa `transporte` (o worker lê a configuração dele e passa aqui;
 * mesmo errada, ela não liga o simulador em produção).
 *
 * @throws SimuladorEmProducaoErro filial em produção com `transporte: 'simulador'`.
 * @throws ErroSefaz `SEFAZ_FILIAL_INVALIDA`, `SEFAZ_UF_SEM_AUTORIZADOR`, `SEFAZ_CONTINGENCIA_INVALIDA`,
 *   `SEFAZ_ENDERECO_NAO_CONFERIDO` (produção com endereço "a conferir").
 */
export function escolherDestinoSefaz(
  filial: FilialEmissoraSefaz,
  opcoes: { transporte: TransporteHomologacao },
): DestinoSefaz {
  const f = FilialEmissoraSefaz.safeParse(filial);
  if (!f.success) throw erroFilial([...new Set(f.error.issues.map((i) => i.path.join('.') || '(raiz)'))].join(', '));
  const t = TransporteHomologacao.safeParse(opcoes?.transporte);
  if (!t.success) throw new ErroSefaz('SEFAZ_TRANSPORTE_NAO_CONFIGURADO', 'Transporte da homologação deve ser "simulador" ou "sefaz"');
  const { filial_id, ambiente, uf, modo } = f.data;

  const autorizadorNormal = AUTORIZADOR_DA_UF[uf];
  if (!autorizadorNormal) throw new ErroSefaz('SEFAZ_UF_SEM_AUTORIZADOR', `UF ${uf} sem autorizador mapeado no ERP`);
  if (modo !== 'normal' && SVC_DA_UF[uf] !== modo) {
    throw new ErroSefaz('SEFAZ_CONTINGENCIA_INVALIDA', `A contingência da UF ${uf} não é ${modo}`);
  }
  const comum: DestinoComum = { filial_id, uf, cUF: CUF[uf], modo, tpEmis: TP_EMIS[modo] };

  if (t.data === 'simulador') {
    // A trava: produção nunca recebe o simulador, venha o pedido de onde vier.
    if (ambiente !== 'homologacao') throw new SimuladorEmProducaoErro(filial_id);
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
