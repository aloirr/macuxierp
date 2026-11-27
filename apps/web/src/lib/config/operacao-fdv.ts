/**
 * Operação da Integração FDV no /config (T-0086, desenho `docs/desenho/T-0086.md`), parte pura: Monitor, "Atualizado às hh:mm",
 * textos do Log, CSV dos erros e as frases do Zerar por cadastro. Só códigos, campos e contagens (ADR 0013): nada daqui toca
 * dado de negócio nem a mensagem do Hub.
 */
import { PAGINAS_INTEGRACAO_FDV, ROTULO_ENTIDADE } from '@macuxierp/integracao-fdv/web';
import {
  CADASTRO_ZERAR_POR_ENTIDADE_FDV, plural,
  type EntidadeEnvioFdv, type InativacaoZerarFdv, type LogCadastroFdvPlataforma, type MonitorConectorFdv, type SituacaoConectorFdv, type TomEnvioFdv,
} from '@macuxierp/platform-sdk';
import { ERRO_CAMPOS, FALHA } from '../textos';

/** Retorno de falha sem texto da API: formulário pede para conferir os campos; as demais ações, para tentar de novo. */
export const textoDaFalha = (erro: string, formulario: boolean): string => erro || (formulario ? ERRO_CAMPOS : FALHA);

/** `erro` (marca, R-20261124-183313): selo "Falhou" e o alerta do último envio que falhou; o `Chip` da ui ainda não tem o tom, então a tela usa `SeloTom`. */
export type Tom = TomEnvioFdv;

/** Situação do conector como no Monitor do FDV. O estado nunca vai só por cor: o texto vai junto. */
const SITUACAO_CONECTOR: Readonly<Record<SituacaoConectorFdv, { texto: string; tom: Tom }>> = {
  em_dia: { texto: 'Em dia', tom: 'sucesso' },
  atrasado: { texto: 'Atrasado', tom: 'aviso' },
  desativado: { texto: 'Desativado', tom: 'neutro' },
};

/** Situação do conector com texto e tom (o Monitor vira a Situação da ligação do FDV, v0.3.24). */
export const situacaoDoConector = (s: SituacaoConectorFdv): { texto: string; tom: Tom } => SITUACAO_CONECTOR[s];

/** "Atualizado às 14:39" (hh:mm no fuso da empresa), a partir do `lido_em` da API. */
export function textoAtualizado(lidoEm: string, fuso: string): string {
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(lidoEm));
  return `Atualizado às ${hora}`;
}

/** O Monitor mais recente entre o da página e o lido pelo Atualizar. */
export function maisRecente(a: MonitorConectorFdv | null, b: MonitorConectorFdv | null): MonitorConectorFdv | null {
  if (!a || !b) return a ?? b;
  return Date.parse(b.lido_em) > Date.parse(a.lido_em) ? b : a;
}

/** Faixa do motivo no topo do Log: o último envio que falhou é erro (vermelho do sistema); os demais motivos seguem em aviso. */
export const tomDoMotivoDoLog = (motivo: LogCadastroFdvPlataforma['motivo']): 'erro' | 'aviso' => (motivo === 'lote_falhou' ? 'erro' : 'aviso');

// ---- Rótulos em português dos erros por linha (o CSV leva os códigos crus: `csvErrosLog`) ----

/** Código e campo humanizados de forma genérica (sublinhado vira espaço, inicial maiúscula), sem dicionário: o rótulo curto por código virá dos contracts. */
const legivel = (t: string): string => {
  const x = t.replace(/[_.[\]]+/g, ' ').trim();
  return x === '' ? t : x.charAt(0).toUpperCase() + x.slice(1);
};
export const rotuloDoCodigoErro = (codigo: string): string => legivel(codigo);
export const rotuloDoCampoErro = (campo: string | null): string => (campo === null ? '—' : legivel(campo));

export const textoReprocessarOk = (falhas: number, pendentes: number): string =>
  falhas + pendentes === 0 ? 'Nada a reprocessar.' : `Reprocessando ${plural(falhas, 'falha', 'falhas')} e ${plural(pendentes, 'pendente', 'pendentes')}.`;

/** Nomes dos botões da aba Integração que outros textos citam (uma fonte só, RD-X7). */
export const ROTULOS_FDV = { salvarChave: 'Salvar chave', trocarChave: 'Trocar chave', tentarDeNovo: 'Tentar de novo' } as const;

/** Retornos das ações da aba Integração (36 A, RD-2315..2337): curtos, sem repetir o rótulo do botão. */
export const RETORNOS_FDV = {
  testeIniciado: 'Teste iniciado.', // RD-1110: a Situação da ligação já mostra o resultado
  chaveSalva: 'Chave salva.',
  envioLiberado: 'Envio liberado.',
  naoEstavaParado: 'Este cadastro não estava parado.',
  limiteSalvo: 'Registros por lote salvos.',
  ligado: 'Cadastro ligado.',
  desligado: 'Cadastro desligado.',
} as const;

/** Aviso do Zerar quando o cadastro também é inativado no FDV (RD-2328: sem explicação interna). */
export const TEXTO_INATIVA_NO_FDV = 'Também inativa no Macuxi FDV.';

/** O Log do /config só leva o caminho da tela do BKO (a resposta não traz link): "Abrir no BKO da empresa". */
export const CAMINHO_BKO_INTEGRACAO_FDV: string = (PAGINAS_INTEGRACAO_FDV.find((p) => p.tipo === 'monitor') ?? PAGINAS_INTEGRACAO_FDV[0])!.rota;

export const nomeCsvErrosFdv = (entidade: EntidadeEnvioFdv): string => `erros-${entidade}.csv`;

/** CSV `;` UTF-8 (com BOM) dos grupos de erro: código, campo e quantidade. Só valores dos regex do SDK (sem `;`, aspas ou fórmula). */
export function csvErrosLog(log: Pick<LogCadastroFdvPlataforma, 'erros'>): string {
  const linhas = ['codigo;campo;quantidade', ...log.erros.map((e) => `${e.codigo};${e.campo ?? ''};${e.quantidade}`)];
  return `\uFEFF${linhas.join('\r\n')}\r\n`;
}

/** Quantos erros abertos o Log não lista (o total passa da soma dos grupos). */
export const errosNaoListados = (log: Pick<LogCadastroFdvPlataforma, 'erros' | 'total_erros'>): number =>
  Math.max(0, log.total_erros - log.erros.reduce((s, e) => s + e.quantidade, 0));

// ---- Zerar por cadastro ----

/** O cadastro do Zerar da linha (forma e prazo zeram `condicao_pagamento`; cliente e endereço, `cliente`). */
export const cadastroDoZerar = (e: EntidadeEnvioFdv) => CADASTRO_ZERAR_POR_ENTIDADE_FDV[e];

const JUNTOS: Partial<Record<EntidadeEnvioFdv, string>> = {
  forma_pagamento: 'Zera também as condições de pagamento.',
  prazo_pagamento: 'Zera também as formas de pagamento.',
  cliente: 'Zera também os endereços e os contatos.',
  cliente_endereco: 'Zera também os clientes e os contatos.',
};
export const textoZerarJuntos = (e: EntidadeEnvioFdv): string | null => JUNTOS[e] ?? null;

/** "Produtos: 12, Clientes: 3". Sem nada a inativar, nada aparece. */
export function textoInativacaoFdv(i: InativacaoZerarFdv | undefined): string | null {
  if (!i || i.length === 0) return null;
  return i.map((x) => `${ROTULO_ENTIDADE[x.entidade]}: ${x.quantidade}`).join(', ');
}
