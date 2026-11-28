import {
  CADASTROS_CARGA_PORTAL, CAMPO_ARQUIVO_CARGA_PORTAL, CAMPO_FRASE_CARGA_PORTAL, GravarCargaPlataformaResposta, MAX_BYTES_ARQUIVO_CARGA_PORTAL, LIMITE_INATIVACAO_FDV_PCT, ValidarCargaPlataformaResposta, ZeragemPlataformaResposta, MOTIVOS_USO, type CadastroZerarPortal,
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
  /** Instante da última carga por planilha (para a Origem: a mais recente entre planilha e lote automático). */
  ultimaEm: string | null;
}

/** Uma linha por cadastro, na ordem da carga. A API manda as 10 linhas (o SDK confere); sem dados, tudo vale "não carregado". */
export function linhasCargas(dados: SituacaoCargasPlataforma | null, fuso: string): LinhaCarga[] {
  const por = new Map((dados?.cadastros ?? []).map((l) => [l.cadastro, l] as const));
  return CADASTROS_CARGA_PORTAL.map((def) => {
    const l = por.get(def.cadastro);
    const situacao = l?.situacao ?? 'nao_carregado';
    // O selo "Carregado" só vale com data: sem `ultima_carga` a linha fica "Não carregado" (a API pode mandar 'carregado' sem ela).
    const chip: LinhaCarga['chip'] =
      situacao === 'carregado' && l?.ultima_carga ? { tom: 'sucesso', texto: 'Carregado' }
      : situacao === 'com_erro' ? { tom: 'aviso', texto: `${l?.erros ?? 0} com erro` }
      // "Cadastro manual": há registro ativo sem carga (feito no BKO ou vindo do FDV). Informação, não alerta: tom neutro.
      : situacao === 'manual' ? { tom: 'neutro', texto: 'Cadastro manual' }
      : { tom: 'neutro', texto: 'Não carregado' };
    const u = l?.ultima_carga;
    const ultima = u ? `${formatarDataHora(u.em, fuso)} · ${plural(u.quantidade, 'registro', 'registros')}` : null;
    return { cadastro: def.cadastro, numero: def.numero, rotulo: rotuloCadastroCarga(def.cadastro), situacao, chip, ultima, ultimaEm: u?.em ?? null };
  });
}

export const tituloImportar = (c: CadastroCargaPortal) => `Importar ${CADASTROS_CARGA_PORTAL.find((x) => x.cadastro === c)?.nome ?? c}`;

/** Rótulo do botão de cada modo; o "Adicionar N" leva as prontas (`rotuloAdicionar`). */
export const ROTULO_MODO: Readonly<Record<ModoGravarCarga, string>> = { adicionar: 'Adicionar', substituir_tudo: 'Substituir tudo' };
export const rotuloAdicionar = (prontas: number): string => (prontas > 0 ? `Adicionar ${prontas}` : 'Adicionar');

/** "Vai inativar 120 de 266 produtos (45%)." O que não vem no arquivo é inativado, nunca apagado. Só na confirmação do Substituir tudo.
 *  Com `enderecos_a_inativar` > 0 (só o cliente, T-0070): "Vai inativar 12 de 40 clientes (30%) e 5 endereços." Sem o campo ou com 0, a frase não muda.
 *  Com 0 a inativar e endereços > 0: "Vai inativar 5 endereços e nenhum cliente." (singular: "1 endereço"). */
export function textoEfeito(cadastro: CadastroCargaPortal, e: Pick<EfeitoSubstituir, 'a_inativar' | 'total' | 'percentual' | 'enderecos_a_inativar'>): string {
  const nome = (CADASTROS_CARGA_PORTAL.find((x) => x.cadastro === cadastro)?.nome ?? cadastro).toLowerCase();
  const nEnd = e.enderecos_a_inativar && e.enderecos_a_inativar > 0 ? e.enderecos_a_inativar : 0;
  // Só o cadastro cliente tem endereços; por isso o "nenhum cliente" é literal.
  if (e.a_inativar === 0) return nEnd > 0 ? `Vai inativar ${plural(nEnd, 'endereço', 'endereços')} e nenhum cliente.` : `Não há ${nome} para inativar.`;
  const enderecos = nEnd > 0 ? ` e ${plural(nEnd, 'endereço', 'endereços')}` : '';
  return `Vai inativar ${e.a_inativar} de ${e.total} ${nome} (${Math.round(e.percentual)}%)${enderecos}.`;
}
/** Aviso depois de gravar: "44 registros gravados." e, quando houver, "5 endereços inativados.". */
export function textoGravado(g: Pick<GravarCargaPlataformaResposta, 'gravadas' | 'enderecos_inativados'>): string {
  const n = g.enderecos_inativados;
  return `${plural(g.gravadas, 'registro gravado', 'registros gravados')}.${n && n > 0 ? ` ${plural(n, 'endereço inativado', 'endereços inativados')}.` : ''}`;
}
/** Aviso único dos 30% do FDV (T-0086, validado pelo designer-ux): aba Dados (Substituir tudo) e prévia do Zerar. */
export const AVISO_LIMITE_FDV = `Acima de ${LIMITE_INATIVACAO_FDV_PCT}% dos registros, o Macuxi FDV pode segurar o envio. Acompanhe no Log.`;
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
export type Retorno<T> = { ok: true; valor: T; } | { ok: false; erro: string; redirecionar?: string; chaveNova: boolean; codigo?: string; bloqueios?: string[] };

const FALHA_CARGA = 'A carga não pôde ser concluída agora. Tente de novo em instantes.';
const SEM_CONEXAO = 'Sem conexão com o servidor. Tente de novo.';

type CorpoPortal = Record<string, unknown> & { ok?: boolean; erro?: string; redirecionar?: string; chaveNova?: boolean; codigo?: string; bloqueios?: string[] };
const falhaDe = (corpo: CorpoPortal | null): Retorno<never> => ({ ok: false, erro: corpo?.erro ?? FALHA_CARGA, ...(corpo?.redirecionar ? { redirecionar: corpo.redirecionar } : {}), chaveNova: corpo?.chaveNova === true, ...(typeof corpo?.codigo === 'string' ? { codigo: corpo.codigo } : {}), ...(Array.isArray(corpo?.bloqueios) ? { bloqueios: corpo.bloqueios.filter((b): b is string => typeof b === 'string') } : {}) });

export async function chamarPortal<T>(url: string, init: RequestInit, enviar: Enviar, extrair: (corpo: Record<string, unknown>) => T | null): Promise<Retorno<T>> {
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

// ---- Zerar dados (RN-CAD-10): o superadmin escolhe os cadastros ----

/** Rótulos da lista de escolha: o `nome` da carga no SDK (`condicao_pagamento` vale para forma e prazo juntos). */
export const ROTULO_ZERAR = Object.freeze(Object.fromEntries(CADASTROS_CARGA_PORTAL.map((c) => [c.cadastro, c.nome]))) as Readonly<Record<CadastroZerarPortal, string>>;

const lista = (xs: readonly string[]): string => xs.join(', ');

/** "Leva junto: Unidades, Estoque.": o que a prévia zera além do escolhido (efetivos menos escolhidos), na ordem da API. Vazio = sem linha. */
export function textoLevaJunto(efetivos: readonly CadastroZerarPortal[], escolhidos: readonly CadastroZerarPortal[]): string | null {
  const extra = efetivos.filter((c) => !escolhidos.includes(c)).map((c) => ROTULO_ZERAR[c]);
  return extra.length > 0 ? `Leva junto: ${lista(extra)}.` : null;
}

type Mantido = ZeragemPlataformaResposta['mantidos'][number];
const MOTIVO_EM_USO: Record<(typeof MOTIVOS_USO)[number], string> = { pedido: 'em pedidos', titulo: 'em títulos', nota: 'em notas', fiscal: 'em filial com dado fiscal' };

/** Soma das quantidades mantidas (o "N" de "Mantidos: N"). */
export const somaMantidos = (mantidos: readonly { quantidade: number }[]): number => mantidos.reduce((n, m) => n + m.quantidade, 0);

/** "Mantidos: 5" (a soma) e uma linha por item com quantidade, escrita por `linha`. Sem mantidos = null. Serve ao Zerar por cadastro e ao de pedidos. */
export function textosMantidosCom<M extends { quantidade: number }>(mantidos: readonly M[], linha: (m: M) => string): { total: string; detalhes: string[] } | null {
  const itens = mantidos.filter((m) => m.quantidade > 0);
  if (itens.length === 0) return null;
  return { total: `Mantidos: ${somaMantidos(itens)}`, detalhes: itens.map(linha) };
}

/** "Mantidos: 5" (a soma) e uma linha por cadastro e motivo: "Produtos: 3 em pedidos." Sem mantidos = null. */
export const textosMantidos = (mantidos: readonly Mantido[]) =>
  textosMantidosCom(mantidos, (m) => `${ROTULO_ZERAR[m.cadastro]}: ${m.quantidade} ${MOTIVO_EM_USO[m.motivo]}.`);

const TEXTO_ANULADO: Record<ZeragemPlataformaResposta['anulados'][number]['coluna'], [string, string]> = {
  vendedor_id: ['cliente fica sem vendedor.', 'clientes ficam sem vendedor.'],
  tabela_preco_id: ['cliente fica sem tabela de preço.', 'clientes ficam sem tabela de preço.'],
  condicao_pagamento_id: ['cliente fica sem condição de pagamento.', 'clientes ficam sem condição de pagamento.'],
};
/** "12 clientes ficam sem vendedor." Uma frase por coluna com quantidade. */
export const textosAnulados = (anulados: ZeragemPlataformaResposta['anulados']): string[] =>
  anulados.filter((a) => a.quantidade > 0).map((a) => `${a.quantidade} ${TEXTO_ANULADO[a.coluna][a.quantidade === 1 ? 0 : 1]}`);

export const BLOQUEIO_LOTE = 'Este cadastro está enviando agora. Espere terminar.';
/** Motivos legíveis dos bloqueios (`cadastro` + `motivo`, da prévia ou do 422 em strings 'cadastro:motivo'), sem repetir. */
export function textosBloqueios(bloqueios: readonly { cadastro: string; motivo: string }[]): string[] {
  const out = new Set<string>();
  for (const b of bloqueios) {
    if (b.motivo === 'lote_em_andamento') out.add(BLOQUEIO_LOTE);
  }
  return [...out];
}
/** Os bloqueios do 422 chegam como 'cadastro:motivo'. */
export const bloqueiosDeTextos = (xs: readonly string[]): { cadastro: string; motivo: string }[] =>
  xs.flatMap((x) => { const [cadastro, motivo] = x.split(':'); return cadastro && motivo ? [{ cadastro, motivo }] : []; });

/** `AbortSignal` opcional: cada mudança da seleção cancela a prévia anterior. */
export function pedirPreviaZerar(empresaId: string, cadastros: readonly CadastroZerarPortal[], enviar: Enviar = fetch, signal?: AbortSignal): Promise<Retorno<ZeragemPlataformaResposta>> {
  return chamarPortal(`${baseCargas(empresaId)}/zerar/previa`, { method: 'POST', body: JSON.stringify({ cadastros }), headers: { 'content-type': 'application/json' }, signal }, enviar, (c) => {
    const p = ZeragemPlataformaResposta.safeParse(c.previa);
    return p.success ? p.data : null;
  });
}

export function pedirZerar(empresaId: string, cadastros: readonly CadastroZerarPortal[], frase: string, chave: string, enviar: Enviar = fetch): Promise<Retorno<number>> {
  return chamarPortal(`${baseCargas(empresaId)}/zerar`, { method: 'POST', body: JSON.stringify({ cadastros, frase: frase.trim() }), headers: { 'content-type': 'application/json', 'idempotency-key': chave } }, enviar, (c) => (typeof c.mantidos === 'number' && c.mantidos > 0 ? Math.floor(c.mantidos) : 0));
}

/** Aviso do zerar quando há registros enviados ao FDV sem código de origem (`sem_chave` > 0). */
export function textoSemChave(n: number): string {
  return `${plural(n, 'registro foi', 'registros foram')} ao FDV sem código de origem. Depois de zerar e carregar de novo, o FDV vai inativar ${n === 1 ? 'o antigo e criar o novo' : 'os antigos e criar novos'}.`;
}

/** Uma frase só para o Zerar do cadastro e o dos pedidos (RD-2331). */
export const TEXTO_ANTES_DE_ZERAR = 'Antes de zerar, exporte pelo BKO da empresa.';
export const AVISO_ZERAR = 'Apaga os registros e não tem volta.';
/** "Zerado: Produtos." ou, com mantidos, "Zerado: Produtos. Mantidos: 5." (RD-2328: sem explicação interna). */
export const textoZerado = (cadastro: string, mantidos: number): string => `Zerado: ${cadastro}.${mantidos > 0 ? ` Mantidos: ${mantidos}.` : ''}`;
