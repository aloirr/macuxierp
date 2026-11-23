import {
  CADASTROS_CARGA_PORTAL, CAMPO_ARQUIVO_CARGA_PORTAL, CAMPO_FRASE_CARGA_PORTAL, GravarCargaPlataformaResposta, MAX_BYTES_ARQUIVO_CARGA_PORTAL, LIMITE_INATIVACAO_FDV_PCT, ValidarCargaPlataformaResposta,
  plural, rotuloCadastroCarga, type CadastroCargaPortal, type EfeitoSubstituir, type LinhaErroValidacao, type ModoGravarCarga, type SituacaoCarga, type SituacaoCargasPlataforma,
} from '@macuxierp/platform-sdk';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { CARGA_GRANDE_DEMAIS } from '../textos';

/** Parte pura da aba Cargas (T-0058): linhas, caixas, textos e as chamadas ao portal. Sem React e sem Next, testada sem rede. */

export interface LinhaCarga {
  cadastro: CadastroCargaPortal;
  /** Posição na ordem de carga (1 a 10). */
  numero: number;
  /** "Unidades (opcional)": sem ponto final. */
  rotulo: string;
  situacao: SituacaoCarga;
  /** Chip: o estado nunca vai só por cor, o texto vai junto. */
  chip: { tom: 'sucesso' | 'aviso' | 'neutro'; texto: string };
  /** "23/11/2026 14:39 · 44 registros", ou null sem carga anterior. */
  ultima: string | null;
  /** Rótulo do cadastro que falta carregar antes (Importar desligado), ou null. */
  antes: string | null;
  podeImportar: boolean;
}

/** Uma linha por cadastro, na ordem da carga. A API manda as 10 linhas (o SDK confere); sem dados, tudo vale "não carregado". */
export function linhasCargas(dados: SituacaoCargasPlataforma | null, fuso: string): LinhaCarga[] {
  const por = new Map((dados?.cadastros ?? []).map((l) => [l.cadastro, l] as const));
  return CADASTROS_CARGA_PORTAL.map((def) => {
    const l = por.get(def.cadastro);
    const situacao = l?.situacao ?? 'nao_carregado';
    const chip: LinhaCarga['chip'] =
      situacao === 'carregado' ? { tom: 'sucesso', texto: 'Carregado' }
      : situacao === 'com_erro' ? { tom: 'aviso', texto: `${l?.erros ?? 0} com erro` }
      : { tom: 'neutro', texto: 'Não carregado' };
    const u = l?.ultima_carga;
    const ultima = u ? `${formatarDataHora(u.em, fuso)} · ${plural(u.quantidade, 'registro', 'registros')}` : null;
    const pendente = l?.depende_de ?? null;
    return { cadastro: def.cadastro, numero: def.numero, rotulo: rotuloCadastroCarga(def.cadastro), situacao, chip, ultima, antes: pendente ? rotuloCadastroCarga(pendente) : null, podeImportar: dados ? (l?.liberado ?? false) : false };
  });
}

export const tituloImportar = (c: CadastroCargaPortal) => `Importar ${CADASTROS_CARGA_PORTAL.find((x) => x.cadastro === c)?.nome ?? c}`;

/** Rótulo do botão de cada modo; o "Adicionar N" leva as prontas (`rotuloAdicionar`). */
export const ROTULO_MODO: Readonly<Record<ModoGravarCarga, string>> = { adicionar: 'Adicionar', substituir_tudo: 'Substituir tudo' };
export const rotuloAdicionar = (prontas: number): string => (prontas > 0 ? `Adicionar ${prontas}` : 'Adicionar');

/** "Vai inativar 120 de 266 produtos (45%)." O que não vem no arquivo é inativado, nunca apagado. Só na confirmação do Substituir tudo. */
export function textoEfeito(cadastro: CadastroCargaPortal, e: Pick<EfeitoSubstituir, 'a_inativar' | 'total' | 'percentual'>): string {
  const nome = (CADASTROS_CARGA_PORTAL.find((x) => x.cadastro === cadastro)?.nome ?? cadastro).toLowerCase();
  if (e.a_inativar === 0) return `Não há ${nome} para inativar.`;
  return `Vai inativar ${e.a_inativar} de ${e.total} ${nome} (${Math.round(e.percentual)}%).`;
}
export const AVISO_LIMITE_FDV = `Acima de ${LIMITE_INATIVACAO_FDV_PCT}%, o FDV pede confirmação no monitor de integração dele antes de aplicar.`;
export const TEXTO_SUBSTITUIR = 'O que não vier no arquivo fica inativo; nada é apagado.';

/** As duas caixas da conferência: verde (prontas) e vermelha (com erro, que ficam de fora). */
export function caixasDaConferencia(c: Pick<ValidarCargaPlataformaResposta, 'prontas' | 'com_erro'>) {
  return {
    prontas: { n: c.prontas, texto: c.prontas === 1 ? 'pronta para gravar' : 'prontas para gravar' },
    erros: { n: c.com_erro, texto: c.com_erro === 1 ? 'com erro (fica de fora)' : 'com erro (ficam de fora)' },
  };
}

/** "Linha 21:" (ou "Arquivo:" quando o erro é do arquivo inteiro). */
export const rotuloLinhaErro = (l: Pick<LinhaErroValidacao, 'linha'>): string => (l.linha === null ? 'Arquivo:' : `Linha ${l.linha}:`);
/** O motivo vem pronto do domain ("O NCM ... exige CEST: preencha a coluna cest."); a ação só entra se não estiver dentro dele. */
export function textoLinhaErro(l: Pick<LinhaErroValidacao, 'motivo' | 'acao'>): string {
  const m = l.motivo.trim();
  const a = l.acao.trim().replace(/\.+$/, '');
  return a && !m.toLowerCase().includes(a.toLowerCase()) ? `${m} ${l.acao}` : m;
}

/** Aviso dos erros que a lista não traz (o teto da resposta): diz quantos faltam e onde ver. */
export const textoErrosOmitidos = (n: number) => `Mais ${plural(n, 'erro', 'erros')} não ${n === 1 ? 'aparece' : 'aparecem'} aqui. Baixe os erros para ver todos.`;

/** Adicionar e Substituir tudo só valem com ao menos uma linha pronta. */
export const podeGravar = (c: Pick<ValidarCargaPlataformaResposta, 'prontas'> | null): boolean => !!c && c.prontas > 0;

/** Confere o arquivo antes de enviar (a API revalida). Mensagens fixas, sem ler o conteúdo. */
export function problemaDoArquivo(arquivo: { name: string; size: number }): string | null {
  if (!arquivo.name.toLowerCase().endsWith('.csv')) return 'Escolha um arquivo .csv.';
  if (arquivo.size === 0) return 'O arquivo está vazio.';
  if (arquivo.size > MAX_BYTES_ARQUIVO_CARGA_PORTAL) return CARGA_GRANDE_DEMAIS;
  return null;
}

export const baseCargas = (empresaId: string) => `/config/empresas/${encodeURIComponent(empresaId)}/cargas`;
export const enderecoModelo = (empresaId: string, c: CadastroCargaPortal) => `${baseCargas(empresaId)}/${c}/modelo`;

export type Enviar = (url: string, init: RequestInit) => Promise<Response>;
export type Retorno<T> = { ok: true; valor: T; } | { ok: false; erro: string; redirecionar?: string; chaveNova: boolean };

const FALHA_CARGA = 'A carga não pôde ser concluída agora. Tente de novo em instantes.';
const SEM_CONEXAO = 'Sem conexão com o servidor. Tente de novo.';

type CorpoPortal = Record<string, unknown> & { ok?: boolean; erro?: string; redirecionar?: string; chaveNova?: boolean };
const falhaDe = (corpo: CorpoPortal | null): Retorno<never> => ({ ok: false, erro: corpo?.erro ?? FALHA_CARGA, ...(corpo?.redirecionar ? { redirecionar: corpo.redirecionar } : {}), chaveNova: corpo?.chaveNova === true });

async function chamarPortal<T>(url: string, init: RequestInit, enviar: Enviar, extrair: (corpo: Record<string, unknown>) => T | null): Promise<Retorno<T>> {
  try {
    const r = await enviar(url, init);
    const corpo = (await r.json().catch(() => null)) as CorpoPortal | null;
    if (r.ok && corpo?.ok) {
      const v = extrair(corpo);
      if (v !== null) return { ok: true, valor: v };
    }
    return falhaDe(corpo);
  } catch {
    return { ok: false, erro: SEM_CONEXAO, chaveNova: false };
  }
}

const formulario = (arquivo: File, frase?: string): FormData => {
  const f = new FormData();
  f.append(CAMPO_ARQUIVO_CARGA_PORTAL, arquivo, arquivo.name);
  if (frase !== undefined) f.append(CAMPO_FRASE_CARGA_PORTAL, frase);
  return f;
};

/** A conferência roda sozinha ao escolher o arquivo (sem botão Validar): primeiro a checagem local, depois o envio (modo adicionar). */
export async function conferirArquivoEscolhido(empresaId: string, cadastro: CadastroCargaPortal, arquivo: File, enviar: Enviar = fetch): Promise<Retorno<ValidarCargaPlataformaResposta>> {
  const problema = problemaDoArquivo(arquivo);
  if (problema) return { ok: false, erro: problema, chaveNova: false };
  return pedirConferencia(empresaId, cadastro, arquivo, 'adicionar', enviar);
}

/** `modo` `substituir_tudo` devolve também o `efeito`: a tela o pede só ao abrir a confirmação do Substituir tudo. */
export function pedirConferencia(empresaId: string, cadastro: CadastroCargaPortal, arquivo: File, modo: ModoGravarCarga = 'adicionar', enviar: Enviar = fetch): Promise<Retorno<ValidarCargaPlataformaResposta>> {
  return chamarPortal(`${baseCargas(empresaId)}/${cadastro}/validar?modo=${modo}`, { method: 'POST', body: formulario(arquivo) }, enviar, (c) => {
    const p = ValidarCargaPlataformaResposta.safeParse(c.conferencia);
    return p.success ? p.data : null;
  });
}

/** Grava o mesmo arquivo da conferência, com a `Idempotency-Key` da ação (repetição de rede reaproveita a chave). No `substituir_tudo` leva a frase digitada; quem confere é o SDK/API. */
export function pedirGravacao(empresaId: string, cadastro: CadastroCargaPortal, arquivo: File, chave: string, modo: ModoGravarCarga = 'adicionar', frase = '', enviar: Enviar = fetch): Promise<Retorno<GravarCargaPlataformaResposta>> {
  return chamarPortal(`${baseCargas(empresaId)}/${cadastro}/gravar?modo=${modo}`, { method: 'POST', body: formulario(arquivo, modo === 'substituir_tudo' ? frase : undefined), headers: { 'idempotency-key': chave } }, enviar, (c) => {
    const p = GravarCargaPlataformaResposta.safeParse(c.gravacao);
    return p.success ? p.data : null;
  });
}

/** "Baixar erros": POST com o mesmo arquivo; volta o CSV como Blob para o navegador salvar. */
export async function pedirErros(empresaId: string, cadastro: CadastroCargaPortal, arquivo: File, enviar: Enviar = fetch): Promise<Retorno<Blob>> {
  try {
    const r = await enviar(`${baseCargas(empresaId)}/${cadastro}/erros`, { method: 'POST', body: formulario(arquivo) });
    if (r.ok) return { ok: true, valor: await r.blob() };
    return falhaDe((await r.json().catch(() => null)) as CorpoPortal | null);
  } catch {
    return { ok: false, erro: SEM_CONEXAO, chaveNova: false };
  }
}
