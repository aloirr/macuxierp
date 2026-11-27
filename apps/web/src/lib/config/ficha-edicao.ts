import { EdicaoFicha, FORMATO_FICHA, type FichaReceitaPlanaMascarada, type RegimeFicha } from '@macuxierp/core/contracts';

/**
 * Ficha da Receita editável (RN-CORE-16, v0.3.24): o formulário da aba Empresa do /config. "Atualizar pela Receita" só
 * preenche o formulário (a prévia não grava); "Salvar" grava com auditoria. Puro: sem rede e sem log (o formulário pode
 * ter dado pessoal de MEI). Tipos e limites só do contrato do core.
 */

export const CAMPOS_FICHA = [
  'razao_social', 'nome_fantasia', 'ie',
  'logradouro', 'numero', 'complemento', 'bairro', 'cep', 'municipio_ibge', 'uf',
  'situacao_cadastral', 'situacao_cadastral_data', 'data_abertura', 'natureza_juridica', 'porte', 'regime_receita',
  'cnae_principal', 'cnae_secundarios',
  'email', 'telefone',
] as const;
export type CampoFicha = (typeof CAMPOS_FICHA)[number];
export type FormFicha = Record<CampoFicha, string>;

type TipoCampo = 'texto' | 'data' | 'regime' | 'lista' | 'email' | 'telefone';
export interface DefCampo {
  campo: CampoFicha;
  rotulo: string;
  tipo: TipoCampo;
  max?: number;
  /** Campo curto (CEP, UF, datas…): no computador divide a linha com outro (docs/design/telas-horizontais §1.5). */
  curto?: boolean;
  /** Texto curto de formato, abaixo do campo. */
  dica?: string;
}
interface GrupoFicha {
  id: string;
  titulo: string;
  campos: DefCampo[];
}

const M = FORMATO_FICHA.max;

/** Os cartões do formulário, na ordem da tela (lado a lado no computador, um embaixo do outro no celular). */
export const GRUPOS_FICHA: GrupoFicha[] = [
  {
    id: 'identificacao',
    titulo: 'Identificação',
    campos: [
      { campo: 'razao_social', rotulo: 'Razão social', tipo: 'texto', max: M.razao },
      { campo: 'nome_fantasia', rotulo: 'Nome fantasia', tipo: 'texto', max: M.razao },
      { campo: 'ie', curto: true, rotulo: 'Inscrição estadual', tipo: 'texto', max: 14, dica: 'Só números ou ISENTO.' },
    ],
  },
  {
    id: 'endereco',
    titulo: 'Endereço',
    campos: [
      { campo: 'logradouro', rotulo: 'Logradouro', tipo: 'texto', max: M.logradouro },
      { campo: 'numero', curto: true, rotulo: 'Número', tipo: 'texto', max: M.numero },
      { campo: 'complemento', curto: true, rotulo: 'Complemento', tipo: 'texto', max: M.complemento },
      { campo: 'bairro', rotulo: 'Bairro', tipo: 'texto', max: M.bairro },
      { campo: 'cep', curto: true, rotulo: 'CEP', tipo: 'texto', max: 9, dica: '8 números.' },
      { campo: 'municipio_ibge', curto: true, rotulo: 'Código IBGE do município', tipo: 'texto', max: 7, dica: '7 números.' },
      { campo: 'uf', curto: true, rotulo: 'UF', tipo: 'texto', max: 2 },
    ],
  },
  {
    id: 'situacao',
    titulo: 'Situação na Receita',
    campos: [
      { campo: 'situacao_cadastral', curto: true, rotulo: 'Situação cadastral', tipo: 'texto', max: M.situacao },
      { campo: 'situacao_cadastral_data', curto: true, rotulo: 'Data da situação', tipo: 'data' },
      { campo: 'data_abertura', curto: true, rotulo: 'Abertura', tipo: 'data' },
      { campo: 'porte', rotulo: 'Porte', tipo: 'texto', max: M.porte },
      { campo: 'natureza_juridica', rotulo: 'Natureza jurídica', tipo: 'texto', max: M.natureza },
      { campo: 'regime_receita', rotulo: 'Regime', tipo: 'regime' },
    ],
  },
  {
    id: 'atividades',
    titulo: 'Atividades e contato',
    campos: [
      { campo: 'cnae_principal', rotulo: 'CNAE principal', tipo: 'texto', max: 9, dica: '7 números.' },
      { campo: 'cnae_secundarios', rotulo: 'CNAE secundários', tipo: 'lista', dica: 'Um por linha.' },
      { campo: 'email', rotulo: 'E-mail', tipo: 'email', max: 254 },
      { campo: 'telefone', rotulo: 'Telefone', tipo: 'telefone', max: 16, dica: 'DDD e número.' },
    ],
  },
];

export const ROTULO_CAMPO: Record<CampoFicha, string> = Object.fromEntries(GRUPOS_FICHA.flatMap((g) => g.campos.map((c) => [c.campo, c.rotulo]))) as Record<CampoFicha, string>;

export const OPCOES_REGIME: { valor: RegimeFicha | ''; rotulo: string }[] = [
  { valor: '', rotulo: 'Não informado' },
  { valor: 'mei', rotulo: 'MEI' },
  { valor: 'simples', rotulo: 'Simples Nacional' },
  { valor: 'normal', rotulo: 'Regime normal' },
];

const t = (v: string | null | undefined) => v ?? '';

/**
 * Formulário a partir da ficha salva (ou da prévia). E-mail e telefone começam vazios: o salvo só existe mascarado, e
 * vazio quer dizer "não muda" (o contrato: ausente = mantém). A razão social vem da ficha; sem ela, a da empresa.
 */
export function formDaFicha(f: FichaReceitaPlanaMascarada | null, razaoEmpresa: string | null): FormFicha {
  return {
    razao_social: t(f?.razao_social ?? razaoEmpresa),
    nome_fantasia: t(f?.nome_fantasia),
    ie: t(f?.ie),
    logradouro: t(f?.logradouro),
    numero: t(f?.numero),
    complemento: t(f?.complemento),
    bairro: t(f?.bairro),
    cep: t(f?.cep),
    municipio_ibge: t(f?.municipio_ibge),
    uf: t(f?.uf),
    situacao_cadastral: t(f?.situacao_cadastral),
    situacao_cadastral_data: t(f?.situacao_cadastral_data),
    data_abertura: t(f?.data_abertura),
    natureza_juridica: t(f?.natureza_juridica),
    porte: t(f?.porte),
    regime_receita: t(f?.regime_receita),
    cnae_principal: t(f?.cnae_principal),
    cnae_secundarios: (f?.cnae_secundarios ?? []).join('\n'),
    email: '',
    telefone: '',
  };
}

/**
 * "Atualizar pela Receita" (RN-CORE-16): a prévia preenche o formulário e nada é gravado. A IE (a Receita não traz) e o
 * e-mail e o telefone digitados ficam como estão; a razão social sem valor na prévia também.
 */
export function formComPrevia(atual: FormFicha, previa: FichaReceitaPlanaMascarada): FormFicha {
  const daPrevia = formDaFicha(previa, atual.razao_social || null);
  return { ...daPrevia, ie: atual.ie, email: atual.email, telefone: atual.telefone };
}

/** Os campos que mudaram entre dois formulários (para o "Salvar" ficar ativo e para marcar o que a prévia trouxe). */
export const camposMudados = (a: FormFicha, b: FormFicha): CampoFicha[] => CAMPOS_FICHA.filter((c) => a[c].trim() !== b[c].trim());

const nulo = (v: string): string | null => (v.trim() === '' ? null : v.trim());
const digitos = (v: string): string | null => nulo(v.replace(/\D/g, ''));

/** Entrada do Salvar no formato do contrato (antes da validação). Máscaras saem; vazio vira nulo; contato vazio fica ausente. */
export function entradaDoForm(f: FormFicha, origem: 'manual' | 'receita', consultadoEm?: string): Record<string, unknown> {
  return {
    razao_social: f.razao_social.trim(),
    nome_fantasia: nulo(f.nome_fantasia),
    ie: nulo(f.ie)?.toUpperCase() ?? null,
    logradouro: nulo(f.logradouro),
    numero: nulo(f.numero),
    complemento: nulo(f.complemento),
    bairro: nulo(f.bairro),
    cep: digitos(f.cep),
    municipio_ibge: digitos(f.municipio_ibge),
    uf: nulo(f.uf)?.toUpperCase() ?? null,
    situacao_cadastral: nulo(f.situacao_cadastral),
    situacao_cadastral_data: nulo(f.situacao_cadastral_data),
    data_abertura: nulo(f.data_abertura),
    natureza_juridica: nulo(f.natureza_juridica),
    porte: nulo(f.porte),
    regime_receita: nulo(f.regime_receita),
    cnae_principal: digitos(f.cnae_principal),
    cnae_secundarios: [...new Set(f.cnae_secundarios.split(/[\n,;]+/).map((c) => c.replace(/\D/g, '')).filter((c) => c !== ''))],
    ...(nulo(f.email) ? { email: f.email.trim().toLowerCase() } : {}),
    ...(digitos(f.telefone) ? { telefone: digitos(f.telefone) } : {}),
    origem,
    ...(origem === 'receita' && consultadoEm ? { consultado_em: consultadoEm } : {}),
  };
}

/** Texto do erro de cada campo (o formato que o contrato exige, sem repetir o valor digitado). */
const ERRO_CAMPO: Partial<Record<CampoFicha, string>> = {
  razao_social: `Informe a razão social (de 2 a ${M.razao} caracteres).`,
  ie: 'Use só números ou ISENTO (até 14).',
  cep: 'O CEP tem 8 números.',
  municipio_ibge: 'O código IBGE tem 7 números.',
  uf: 'Use a sigla da UF, com 2 letras.',
  situacao_cadastral_data: 'Data inválida.',
  data_abertura: 'Data inválida.',
  cnae_principal: 'O CNAE tem 7 números.',
  cnae_secundarios: 'Cada CNAE tem 7 números.',
  email: 'E-mail inválido.',
  telefone: 'Use DDD e número (10 ou 11 números).',
};
const erroDoCampo = (c: string): string => ERRO_CAMPO[c as CampoFicha] ?? 'Texto acima do limite.';

type ValidacaoFicha = { ok: true; edicao: EdicaoFicha } | { ok: false; campos: Partial<Record<CampoFicha, string>> };

/** Valida o formulário com o contrato do core (`EdicaoFicha`); o erro fica junto de cada campo. A API revalida. */
export function validarFicha(f: FormFicha, origem: 'manual' | 'receita', consultadoEm?: string): ValidacaoFicha {
  const r = EdicaoFicha.safeParse(entradaDoForm(f, origem, consultadoEm));
  if (r.success) return { ok: true, edicao: r.data };
  const campos: Partial<Record<CampoFicha, string>> = {};
  for (const i of r.error.issues) {
    const c = String(i.path[0] ?? '');
    if ((CAMPOS_FICHA as readonly string[]).includes(c) && !campos[c as CampoFicha]) campos[c as CampoFicha] = erroDoCampo(c);
  }
  return { ok: false, campos };
}

/** Os nomes de campo que a API devolve (nunca valores) em texto da tela: "Razão social, CEP". */
export const nomesDosCampos = (campos: readonly string[]): string => campos.map((c) => ROTULO_CAMPO[c as CampoFicha] ?? c).join(', ');

/** Retorno do Salvar e da prévia em texto curto. */
export const textoSalvo = (campos: readonly string[]): string => (campos.length === 0 ? 'Nada mudou: a ficha já estava assim.' : `Ficha salva. Mudou: ${nomesDosCampos(campos)}.`);
/** Os campos que vieram diferentes já ficam marcados na tela: o texto não repete a lista (RD-2335). */
export const textoPrevia = (diferentes: readonly string[]): string =>
  diferentes.length === 0 ? 'A Receita trouxe os mesmos dados da ficha salva.' : 'A Receita trouxe dados diferentes. Confira e clique em Salvar.';
