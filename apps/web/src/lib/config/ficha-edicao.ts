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
  /** Largura na grade de 12 (.formulario): curto = 2, médio = 4, largo = 12 e, sem nenhum, 6 (regra 11). */
  curto?: boolean;
  medio?: boolean;
  largo?: boolean;
  /** Texto curto de formato, abaixo do campo. */
  dica?: string;
}
interface GrupoFicha {
  id: string;
  titulo: string;
  /** Colunas que o cartão ocupa na grade de 12 da Ficha (a partir de 1101 px; abaixo disso, a linha toda). */
  colunas: 3 | 4 | 5 | 12;
  campos: DefCampo[];
}

const M = FORMATO_FICHA.max;

/**
 * Os cartões do formulário, na ordem da tela (Config v4: grade de 12, como a simulação aprovada 445e459; o CNPJ entra depois do nome fantasia).
 * RD-2373: sem as dicas de quantidade (o limite de caracteres e o erro sob o campo já dizem); a data mostra o formato no placeholder.
 */
export const GRUPOS_FICHA: GrupoFicha[] = [
  {
    id: 'identificacao',
    colunas: 12,
    titulo: 'Identificação',
    campos: [
      { campo: 'razao_social', medio: true, rotulo: 'Razão social', tipo: 'texto', max: M.razao },
      { campo: 'nome_fantasia', medio: true, rotulo: 'Nome fantasia', tipo: 'texto', max: M.razao },
      { campo: 'ie', curto: true, rotulo: 'Inscrição estadual', tipo: 'texto', max: 14, dica: 'Só números ou ISENTO.' },
    ],
  },
  {
    id: 'endereco',
    colunas: 12,
    titulo: 'Endereço',
    campos: [
      { campo: 'cep', curto: true, rotulo: 'CEP', tipo: 'texto', max: 9 },
      { campo: 'logradouro', medio: true, rotulo: 'Logradouro', tipo: 'texto', max: M.logradouro },
      { campo: 'numero', curto: true, rotulo: 'Número', tipo: 'texto', max: M.numero },
      { campo: 'complemento', medio: true, rotulo: 'Complemento', tipo: 'texto', max: M.complemento },
      { campo: 'bairro', medio: true, rotulo: 'Bairro', tipo: 'texto', max: M.bairro },
      { campo: 'municipio_ibge', curto: true, rotulo: 'Código IBGE do município', tipo: 'texto', max: 7 },
      { campo: 'uf', curto: true, rotulo: 'UF', tipo: 'texto', max: 2 },
    ],
  },
  {
    id: 'atividades',
    colunas: 5,
    titulo: 'Atividades (CNAE)',
    campos: [
      { campo: 'cnae_principal', medio: true, rotulo: 'CNAE principal', tipo: 'texto', max: 9 },
      { campo: 'cnae_secundarios', largo: true, rotulo: 'CNAE secundários', tipo: 'lista', dica: 'Um por linha.' },
    ],
  },
  {
    id: 'contato',
    colunas: 4,
    titulo: 'Contato',
    campos: [
      { campo: 'email', largo: true, rotulo: 'E-mail', tipo: 'email', max: 254 },
      { campo: 'telefone', largo: true, rotulo: 'Telefone', tipo: 'telefone', max: 16, dica: 'DDD e número.' },
    ],
  },
  {
    id: 'situacao',
    colunas: 12,
    titulo: 'Na Receita',
    campos: [
      { campo: 'situacao_cadastral', medio: true, rotulo: 'Situação cadastral', tipo: 'texto', max: M.situacao },
      { campo: 'situacao_cadastral_data', curto: true, rotulo: 'Data da situação', tipo: 'data' },
      { campo: 'data_abertura', curto: true, rotulo: 'Abertura', tipo: 'data' },
      { campo: 'natureza_juridica', medio: true, rotulo: 'Natureza jurídica', tipo: 'texto', max: M.natureza },
      { campo: 'porte', medio: true, rotulo: 'Porte', tipo: 'texto', max: M.porte },
      { campo: 'regime_receita', medio: true, rotulo: 'Regime', tipo: 'regime' },
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
 * Data civil na tela sempre em dd/mm/aaaa, sem depender do idioma do navegador (o input date do Chromium em en-US mostra
 * mm/dd): AAAA-MM-DD → DD/MM/AAAA; fora do formato, como veio.
 */
export const dataNaTela = (v: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : t(v);
};

/** DD/MM/AAAA (ou D/M/AAAA) → AAAA-MM-DD; vazio vira nulo; fora do formato segue como veio, e o contrato recusa. */
export const dataDoForm = (v: string): string | null => {
  const s = v.trim();
  if (s === '') return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return s;
  const iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  // dia que não existe (31/02, 45/13) segue como veio, para o contrato recusar
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso) ? iso : s;
};

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
    situacao_cadastral_data: dataNaTela(f?.situacao_cadastral_data),
    data_abertura: dataNaTela(f?.data_abertura),
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
    situacao_cadastral_data: dataDoForm(f.situacao_cadastral_data),
    data_abertura: dataDoForm(f.data_abertura),
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
  situacao_cadastral_data: 'Data inválida. Use dd/mm/aaaa.',
  data_abertura: 'Data inválida. Use dd/mm/aaaa.',
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
