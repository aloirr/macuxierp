/**
 * Manifesto de módulo do Macuxi ERP (docs/produto/04, "Manifesto"). Mesmo desenho do platform-sdk do Macuxi FDV,
 * sem as partes do app mobile (abas, sync offline). Cada módulo declara o que publica e consome; o shell do BKO e a
 * API montam só os módulos licenciados para o tenant.
 */

/** Ids dos módulos da v1 (docs/produto/02). Módulo novo = ADR + linha aqui + dono no .coord/donos.json. */
export const MODULOS = ['core', 'cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao-fdv'] as const;
export type ModuloId = (typeof MODULOS)[number];

/**
 * Perfis do ERP (docs/produto/03, RN-CORE-01). `analista_implantacao` (RN-CORE-09, v0.3.0): só a Carga de cadastros e a
 * consulta dos cadastros. O CHECK de `plataforma.usuario.perfil` só aceita o valor depois da migração 0033 (ADR 0012).
 */
export const PERFIS_V1 = ['administrador', 'gerente', 'faturista', 'fiscal', 'vendedor', 'leitura'] as const;
export const PERFIS = [...PERFIS_V1, 'analista_implantacao'] as const;
export type Perfil = (typeof PERFIS)[number];

/** Rótulo do perfil para pessoas (BKO, listas, exportação): uma fonte só. */
export const ROTULOS_PERFIL: Readonly<Record<Perfil, string>> = Object.freeze({
  administrador: 'Administrador',
  gerente: 'Gerente',
  faturista: 'Faturista',
  fiscal: 'Fiscal',
  vendedor: 'Vendedor',
  leitura: 'Leitura',
  analista_implantacao: 'Analista de implantação',
});

/** Nome de evento: `<modulo>.<entidade>.<fato>@vN` (regra inegociável 3). */
export const PADRAO_EVENTO = new RegExp(`^(${MODULOS.join('|')})\\.[a-z_]+\\.[a-z_]+@[1-9][0-9]*$`);

export interface ManifestoModulo {
  id: ModuloId;
  versao: string;
  descricao: string;
  depende: readonly ModuloId[];
  opcionais?: readonly ModuloId[];
  perfis: readonly Perfil[];
  web?: { menus: readonly string[] };
  publica: readonly string[];
  consome: readonly string[];
}

export class ManifestoInvalido extends Error {
  override readonly name = 'ManifestoInvalido' as const;
}

/** Valida e congela o manifesto. Erro cedo (no carregamento) em vez de rota quebrada em produção. */
export function defineModule<const M extends ManifestoModulo>(m: M): Readonly<M> {
  if (!/^\d+\.\d+\.\d+$/.test(m.versao)) throw new ManifestoInvalido(`${m.id}: versão "${m.versao}" fora do semver`);
  if (m.id !== 'core' && !m.depende.includes('core')) throw new ManifestoInvalido(`${m.id}: todo módulo depende do core`);
  if (m.depende.includes(m.id)) throw new ManifestoInvalido(`${m.id}: módulo não depende de si mesmo`);
  for (const ev of m.publica) {
    if (!PADRAO_EVENTO.test(ev)) throw new ManifestoInvalido(`${m.id}: evento "${ev}" fora do padrão <modulo>.<entidade>.<fato>@vN`);
    if (!ev.startsWith(`${m.id}.`)) throw new ManifestoInvalido(`${m.id}: só publica eventos do próprio módulo ("${ev}")`);
  }
  for (const ev of m.consome) {
    if (!PADRAO_EVENTO.test(ev)) throw new ManifestoInvalido(`${m.id}: evento consumido "${ev}" fora do padrão`);
  }
  return Object.freeze(m);
}
