/**
 * T-0059 / RN-INT-22: validação do pré-cadastro de cliente vindo do FDV, motivo por campo e situação da linha.
 *
 * Funções puras, sem I/O.
 *
 * ATENÇÃO: a entrada abaixo é a MÍNIMA que a regra usa. O payload exato do `/integracao/v1/clientes/pendentes`
 * ainda não está fechado (T-0059, perguntas 3 a 6, FDV v1.0.29); o adaptador payload -> `PreCadastroEntrada` vem depois.
 */
import { formatarDocumento, normalizarDocumento } from '@macuxierp/platform-sdk';
import { NUMERO_SEM_NUMERO, type ErroPreCadastro, type IndIeDest, type PreCadastroEntrada, type SituacaoPreCadastro } from '../../contracts';
import { validarDocumentoCliente } from '../documento';
import { sugerirIndIeDest, validarIe, validarIndIeDest } from '../ie';
import { CODIGO_UF, normalizarCep, validarMunicipio } from '../municipio';
import { violacao, type Violacao } from '../violacao';

export type ClienteValidado = Omit<PreCadastroEntrada, 'ind_ie_dest' | 'endereco'> & {
  ind_ie_dest: IndIeDest;
  endereco: Required<PreCadastroEntrada['endereco']>;
};

export type ResultadoValidacaoPreCadastro = { ok: true; cliente: ClienteValidado } | { ok: false; erros: ErroPreCadastro[] };

const deViolacao = (v: Violacao, campo = v.campo, mensagem = v.mensagem): ErroPreCadastro => ({ campo, codigo: v.rn, mensagem });
const vazio = (s: string | undefined | null): boolean => s === undefined || s === null || s.trim() === '';

/** RN-CAD-01/02/03 + RN-INT-22: todos os erros de uma vez (o backoffice corrige tudo no FDV em um reenvio). */
export function validarPreCadastro(e: PreCadastroEntrada): ResultadoValidacaoPreCadastro {
  const erros: ErroPreCadastro[] = [];

  const doc = validarDocumentoCliente(e.tipo, e.documento);
  if (!doc.ok) erros.push(deViolacao(doc.violacao));

  if (vazio(e.razao_social)) erros.push({ campo: 'razao_social', codigo: 'RN-INT-22', mensagem: 'Razão social obrigatória' });

  const en = e.endereco;
  for (const campo of ['logradouro', 'bairro'] as const) {
    if (vazio(en[campo])) erros.push(deViolacao(violacao('RN-CAD-03', `endereco.${campo}`, 'Obrigatório no endereço principal')));
  }
  const cep = normalizarCep(en.cep ?? '');
  if (cep === null) erros.push(deViolacao(violacao('RN-CAD-03', 'endereco.cep', 'CEP deve ter 8 dígitos')));

  const ufConhecida = CODIGO_UF[en.uf] !== undefined;
  if (!ufConhecida) {
    erros.push(deViolacao(violacao('RN-CAD-03', 'endereco.uf', 'UF inválida')));
  } else {
    // A mensagem da regra ecoa o código IBGE recebido; aqui ela é fixa.
    const m = validarMunicipio(en.municipio_ibge, en.uf);
    if (!m.ok) erros.push(deViolacao(m.violacao, 'endereco.municipio_ibge', 'Município inválido ou fora da UF informada'));
  }

  const ie = vazio(e.ie) ? null : (e.ie as string);
  const ind = e.ind_ie_dest ?? sugerirIndIeDest(ie);
  if (ufConhecida) {
    const r = validarIndIeDest({ ind_ie_dest: ind, ie, uf: en.uf });
    if (!r.ok) erros.push(deViolacao(r.violacao));
  }

  if (erros.length > 0) return { ok: false, erros };
  const ieNorm = ie === null ? null : (validarIe(en.uf, ie) as { ok: true; ie: string }).ie;
  return {
    ok: true,
    cliente: {
      tipo: e.tipo,
      documento: (doc as { ok: true; documento: string }).documento,
      razao_social: e.razao_social.trim(),
      ie: ieNorm,
      ind_ie_dest: ind,
      endereco: {
        logradouro: en.logradouro.trim(),
        numero: vazio(en.numero) ? NUMERO_SEM_NUMERO : (en.numero as string).trim(),
        bairro: en.bairro.trim(),
        municipio_ibge: en.municipio_ibge,
        uf: en.uf,
        cep: cep as string,
      },
    },
  };
}

/** RN-INT-22: documento mascarado para a seção "Clientes recebidos do FDV" (CNPJ: raiz inicial e filial; CPF: só o miolo). */
export function mascararDocumento(documento: string): string {
  const d = normalizarDocumento(documento);
  const f = formatarDocumento(d);
  if (f === d) return '***';
  return d.length === 14 ? `${f.slice(0, 3)}***.***${f.slice(10, 16)}**` : `***${f.slice(3, 8)}***-**`;
}

export type EventoPreCadastro = 'recusar' | 'aceitar' | 'reenviar';

const TRANSICOES: Readonly<Record<SituacaoPreCadastro, Partial<Record<EventoPreCadastro, SituacaoPreCadastro>>>> = {
  aguardando_vinculo: { recusar: 'recusado', aceitar: 'aceito' },
  recusado: { reenviar: 'reenviado' }, // o reenvio reabre a MESMA linha (T-0059, pergunta 1)
  reenviado: { recusar: 'recusado', aceitar: 'aceito' },
  aceito: {},
};

/** RN-INT-22: próxima situação da linha do pré-cadastro; `aceito` é final e transição fora da tabela é erro. */
export function proximaSituacao(
  atual: SituacaoPreCadastro,
  evento: EventoPreCadastro,
): { ok: true; situacao: SituacaoPreCadastro } | { ok: false; violacao: Violacao } {
  const proxima = TRANSICOES[atual][evento];
  return proxima
    ? { ok: true, situacao: proxima }
    : { ok: false, violacao: violacao('RN-INT-22', 'situacao', `Transição inválida: ${atual} não aceita ${evento}`) };
}
