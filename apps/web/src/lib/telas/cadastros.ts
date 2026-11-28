/**
 * Adaptador do cadastros no BKO (v0.3.28): só a tela de Clientes (lista, novo e edição). Nenhuma regra de negócio aqui: colunas, filtros,
 * campos por perfil e modo, validação (RN-CAD-01, RN-CAD-02) e o corpo do POST e do PATCH vêm de `@macuxierp/cadastros/web`; a API revalida
 * perfil, tenant e licença do módulo (regra 6). As demais telas do cadastros (produtos, preços, filiais...) entram na T-0123 (v0.3.29).
 * Sem dado pessoal em log.
 */
import {
  API_CLIENTES, ClienteResumo, ROTA_CLIENTE, ROTA_CLIENTE_NOVO, ROTA_CLIENTES, camposDoCliente, corpoAlterarCliente, corpoCriarCliente, paginaClientes, validarCliente, valoresDoCliente,
  type CampoEdicao, type Modo,
} from '@macuxierp/cadastros/web';
import { colunasDoPerfil } from '@macuxierp/platform-sdk/listas';
import type { Perfil } from '@macuxierp/platform-sdk';
import type { CampoFormulario, FiltroTela, TelaDescrita, TelaFormulario, TelaLista } from '../descritor/tipos';
import { colunasDoModulo, novaChave } from './comum';

export { ROTA_CLIENTES, ROTA_CLIENTE_NOVO, ROTA_CLIENTE };

const EDITAR = 'cadastros.cliente.editar' as const;
/** Sem o perfil (nunca acontece no shell, que sempre o passa) vale o de menos privilégio. */
const MENOS_PRIVILEGIADO: Perfil = 'vendedor';

// ---- Lista ----

/** Filtros do descritor (`filial_id`, `vendedor_id`) mais o "inativos" que a página declara; os seletores leem do próprio cadastros. */
const FILTROS_CLIENTES: readonly FiltroTela[] = [
  { chave: 'filial_id', rotulo: 'Filial', tipo: 'cadastro', fonte: '/v1/cadastros/filiais' },
  { chave: 'vendedor_id', rotulo: 'Vendedor', tipo: 'cadastro', fonte: '/v1/cadastros/vendedores' },
  { chave: 'inativos', rotulo: 'Situação', tipo: 'selecao', vazio: 'Só ativos', opcoes: [{ valor: 'true', rotulo: 'Ativos e inativos' }] },
];

export const LISTA_CLIENTES: TelaLista = {
  tipo: 'lista',
  pagina: paginaClientes as unknown as TelaLista['pagina'],
  rotuloBusca: 'Razão social, fantasia ou CNPJ/CPF',
  filtrosTela: FILTROS_CLIENTES,
  /** Colunas que o perfil vê (o limite só com `cadastros.cliente.credito`); números à direita e a situação em selo. */
  colunas: (perfil) => colunasDoModulo(colunasDoPerfil(paginaClientes, perfil), { prazo_medio_dias: 'numero', limite_credito_centavos: 'dinheiro', inativo: 'status' }),
  linha: (item) => Object.fromEntries(paginaClientes.colunas.map((c) => [c.id, String((c.valor as (l: unknown) => unknown)(item) ?? '')])),
  selos: (item) => ({ inativo: [item.inativo === true ? { texto: 'Inativo', tom: 'neutro' } : { texto: 'Ativo', tom: 'ok' }] }),
  novo: { rota: ROTA_CLIENTE_NOVO, rotulo: 'Novo cliente', criar: EDITAR },
  rotaDaLinha: (l) => ROTA_CLIENTE.replace(':id', String(l.id)),
  rotuloDaLinha: (l) => `Abrir cliente ${String(l.razao_social ?? '')}`.trim(),
};

// ---- Formulário (novo e edição) ----

/** Campo do descritor do módulo no campo do formulário genérico (dinheiro digita como número, em reais). */
const paraCampo = (c: CampoEdicao): CampoFormulario => ({
  nome: c.nome, rotulo: c.rotulo, tipo: c.tipo === 'dinheiro' ? 'numero' : c.tipo === 'booleano' ? 'texto' : c.tipo,
  ...(c.obrigatorio ? { obrigatorio: true } : {}), ...(c.fonte ? { fonte: c.fonte } : {}), ...(c.opcoes ? { opcoes: c.opcoes } : {}), ...(c.ajuda ? { ajuda: c.ajuda } : {}),
});
const camposDe = (modo: Modo) => (perfil: Perfil): readonly CampoFormulario[] => camposDoCliente(perfil, modo).map(paraCampo);

export const NOVO_CLIENTE: TelaFormulario = {
  tipo: 'formulario',
  campos: camposDe('criar')(MENOS_PRIVILEGIADO),
  camposDoPerfil: camposDe('criar'),
  validar: (v, _i, perfil) => ({ ...validarCliente(v, 'criar', perfil ?? MENOS_PRIVILEGIADO) }),
  montar: (v, _i, perfil) => {
    const corpo = corpoCriarCliente(v, perfil ?? MENOS_PRIVILEGIADO);
    if (!corpo) throw new Error('formulário inválido');
    return corpo;
  },
  api: API_CLIENTES,
  depois: () => ROTA_CLIENTES,
  voltar: ROTA_CLIENTES,
  enviar: 'Salvar cliente',
  novaChave,
};

/** Edição: abre com os valores do cliente e envia só o que mudou (PATCH `/v1/cadastros/clientes/:id`); endereços e contatos têm rota própria. */
export const EDITAR_CLIENTE: TelaFormulario = {
  tipo: 'formulario',
  campos: camposDe('editar')(MENOS_PRIVILEGIADO),
  camposDoPerfil: camposDe('editar'),
  validar: (v, _i, perfil) => ({ ...validarCliente(v, 'editar', perfil ?? MENOS_PRIVILEGIADO) }),
  montar: () => { throw new Error('edição usa montarPatch'); },
  edicao: {
    ler: (id) => `${API_CLIENTES}/${encodeURIComponent(id)}`,
    abrir: (corpo) => {
      const c = ClienteResumo.parse(corpo);
      return { valores: valoresDoCliente(c), original: c };
    },
    montarPatch: (v, original, perfil) => corpoAlterarCliente(v, original as ClienteResumo, perfil),
  },
  api: API_CLIENTES,
  depois: () => ROTA_CLIENTES,
  voltar: ROTA_CLIENTES,
  enviar: 'Salvar alterações',
  novaChave,
};

export const TELAS_CADASTROS: Readonly<Record<string, TelaDescrita>> = {
  [ROTA_CLIENTES]: LISTA_CLIENTES,
  [ROTA_CLIENTE_NOVO]: NOVO_CLIENTE,
  [ROTA_CLIENTE]: EDITAR_CLIENTE,
};
