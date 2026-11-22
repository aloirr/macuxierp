/**
 * Validações do conteúdo da nota ANTES da reserva do número (nenhum número é queimado). São regras de domínio; o emissor
 * (`@macuxierp/nfe-emissor`) ainda valida o que é do leiaute do XML e confere os valores. A conferência do vNF contra o `v_nf` do fiscal
 * continua em `montarNota`. Os itens (CFOP, ICMS, PIS/COFINS, IBS/CBS/IS) são validados em `itemParaEmissao`.
 */
import type { ConteudoNota } from './tipos-nota';
import { calcularTotais } from './nota';
import { violacao, type Violacao } from './violacao';

export function validarNotaParaEmissao(c: ConteudoNota): Violacao[] {
  const v: Violacao[] = [];
  // Município sem nome (xMun obrigatório).
  for (const [quem, e] of [['emitente', c.emitente.endereco], ['destinatario', c.destinatario.endereco]] as const) {
    if (!e.municipio_nome?.trim()) v.push(violacao('RF-FAT-01', `${quem}.endereco.municipio_nome`, `Município do ${quem} sem nome (xMun): corrija o cadastro antes de emitir.`));
  }
  // NT 2024.001: CRT 1 (Simples) e 4 (MEI) usam CSOSN; o MEI não destaca crédito de ICMS (CSOSN 101 e 201).
  const crt = c.emitente.crt;
  for (const i of c.itens) {
    const campo = `itens.${i.sequencia}.icms`;
    const csosn = i.calculo.resultado.icms.csosn;
    if ((crt === 1 || crt === 4) && !csosn) v.push(violacao('RF-FAT-01', campo, `Emitente CRT ${crt} (Simples/MEI) usa CSOSN no ICMS, não CST (NT 2024.001).`));
    if (crt === 4 && (csosn === '101' || csosn === '201')) {
      v.push(violacao('RF-FAT-01', campo, `MEI (CRT 4) não destaca crédito: CSOSN ${csosn} não é permitido (NT 2024.001); use 102, 103, 202, 203, 300 ou 400.`));
    }
  }
  const vNF = calcularTotais(c.itens).vNF;
  const somaPag = c.pagamentos.reduce((a, p) => a + p.valor_centavos, 0);
  if (somaPag !== vNF) v.push(violacao('RF-FAT-01', 'pagamentos', `Soma dos vPag (${somaPag}) difere do vNF (${vNF}).`));
  if (c.cobranca && c.cobranca.parcelas.reduce((a, p) => a + p.valor_centavos, 0) !== c.cobranca.vLiq) {
    v.push(violacao('RF-FAT-01', 'cobranca', 'Soma das parcelas (dup) difere do valor líquido da fatura.'));
  }
  return v;
}
