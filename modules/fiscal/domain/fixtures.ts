import { ItemCalculo as ItemSchema, RegraTributaria as RegraSchema, type ItemCalculo, type RegraTributaria } from '../contracts';

let n = 0;
/** Fábrica de regras para teste: parse pelo schema aplica os defaults. */
export function regra(p: Partial<RegraTributaria> = {}): RegraTributaria {
  n += 1;
  return RegraSchema.parse({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    ncm_prefixo: null,
    uf_origem: null,
    uf_destino: null,
    tipo_cliente: null,
    crt: null,
    cfop: null,
    codigo: '00',
    aliquota_icms: 180000,
    // Sem default no contrato: a fábrica diz "não ajusta" de forma explícita; os testes de "não informado" passam null.
    ajustar_mva: false,
    // Regime normal exige PIS/COFINS (cumulativo: 0,65% e 3%); os testes de ICMS usam a linha única.
    cst_pis: '01',
    aliquota_pis: 6500,
    cst_cofins: '01',
    aliquota_cofins: 30000,
    fonte: { tipo: 'convenio', referencia: 'Convênio ICMS 142/2018' },
    versao: '2025.1',
    vigencia_inicio: '2024-01-01',
    vigencia_fim: null,
    ...p,
  });
}


/** Fábrica de itens para teste: parse pelo schema aplica os defaults. */
export function item(p: Record<string, unknown> = {}): ItemCalculo {
  return ItemSchema.parse({ id: 'i1', ncm: '22021000', cfop: '5102', quantidade: 1, valor_unitario_centavos: 100000, valor_bruto_centavos: 100000, origem: '0', ...p });
}
