/**
 * Adaptador da bandeira "faturamento real com NF-e simulada" por filial (T-0088, RN-FAT-04). Só descreve e monta: a situação, o diálogo e a
 * requisição (PUT com Idempotency-Key) vêm de `@macuxierp/faturamento/web`; a API revalida o perfil (só o administrador liga e desliga) e
 * audita. A página NÃO muda o ambiente fiscal: a nota segue em homologação. A lista de filiais é do cadastros (o faturamento não lista filiais).
 */
import { dialogoDaBandeira, requisicaoConfigurarBandeira, situacaoDaBandeira, urlDaConfiguracaoDaFilial } from '@macuxierp/faturamento/web';
import type { ConfiguracaoFilialResposta } from '@macuxierp/faturamento/contracts';
import type { Perfil } from '@macuxierp/platform-sdk';
import type { AcaoVista, EntradaAcao, ResultadoAcao, SeloVista, TelaDescrita, TelaQuadro } from '../descritor/tipos';
import { novaChave, seloDoModulo as selo } from './comum';

export const ROTA_BANDEIRA = '/faturamento/filiais/bandeira';

/** Chave só para validar o diálogo (o envio usa a Idempotency-Key real da tentativa). */
const CHAVE_DE_VALIDACAO = 'validacao-do-dialogo';

export interface CartaoDaBandeira {
  filial_id: string;
  nome: string;
  /** Ausente quando a configuração da filial não pôde ser lida (`indisponivel` traz o texto). */
  selo?: SeloVista;
  ambiente?: SeloVista;
  /** Ligar ou desligar: só o administrador (a regra é do módulo, `situacaoDaBandeira`); os outros perfis veem sem botão. */
  acao: AcaoVista | null;
  indisponivel?: string;
}

/** Um cartão por filial; `configs[id]` nulo = a leitura da configuração falhou (a página segue, só esse cartão avisa). */
export function cartoesDaBandeira(perfil: Perfil, filiais: readonly { id: string; nome: string }[], configs: Readonly<Record<string, ConfiguracaoFilialResposta | null>>): CartaoDaBandeira[] {
  return filiais.map((f) => {
    const c = configs[f.id];
    if (!c) return { filial_id: f.id, nome: f.nome, acao: null, indisponivel: 'Não foi possível ler a configuração desta filial agora.' };
    const s = situacaoDaBandeira(perfil, c);
    const ligar = !c.faturamento_real_nfe_simulada;
    const d = dialogoDaBandeira(ligar, { nome: f.nome });
    const acao: AcaoVista | null = s.rotuloBotao === null ? null : {
      id: `bandeira-${f.id}`, rotulo: s.rotuloBotao, metodo: 'PUT', caminho: urlDaConfiguracaoDaFilial(f.id), entrada: 'confirmar', tituloDialogo: d.titulo, rotuloConfirmar: d.rotuloConfirmar,
      rotuloFechar: d.rotuloFechar, destrutivo: d.destrutivo, textoCarregando: ligar ? 'Ligando…' : 'Desligando…', ...(ligar ? { principal: true } : {}), dados: { filial_id: f.id, ligar: String(ligar) },
    };
    return { filial_id: f.id, nome: f.nome, selo: selo(s.selo), ambiente: selo(s.ambiente), acao };
  });
}

/** Validação do diálogo pela regra do módulo: o corpo é o do PUT e a mesma Idempotency-Key vai no cabeçalho (`requisicaoConfigurarBandeira`). */
export function validarAcaoBandeira(a: AcaoVista, e: EntradaAcao): ResultadoAcao {
  const m = requisicaoConfigurarBandeira(a.dados?.filial_id ?? '', a.dados?.ligar === 'true', e.chave ?? CHAVE_DE_VALIDACAO);
  return m.ok ? { ok: true, corpo: m.requisicao.corpo } : { ok: false, erro: m.erro };
}

export const TELA_BANDEIRA: TelaQuadro = {
  tipo: 'quadro',
  validarAcao: validarAcaoBandeira,
  escritas: [{ metodo: 'PUT', caminho: urlDaConfiguracaoDaFilial(':id') }],
  novaChave,
};

export const TELAS_BANDEIRA: Readonly<Record<string, TelaDescrita>> = { [ROTA_BANDEIRA]: TELA_BANDEIRA };
