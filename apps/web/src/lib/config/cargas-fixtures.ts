// Dados fictícios dos testes da aba Cargas (só testes importam este arquivo).
import { CADASTROS_CARGA_PORTAL, type SituacaoCargasPlataforma, type CadastroCargaPortal, type LinhaSituacaoCarga, type SituacaoCarga } from '@macuxierp/platform-sdk';

export const EMP = '11111111-1111-4111-8111-111111111111';
const ORDEM = CADASTROS_CARGA_PORTAL.map((c) => c.cadastro);

/** Monta a resposta da API como o plugin monta: depende_de (deprecated) sempre null e liberado sempre true (o Zod do SDK confere). */
export function situacoes(dados: Partial<Record<CadastroCargaPortal, { situacao: SituacaoCarga; erros?: number; quantidade?: number }>>): SituacaoCargasPlataforma {
  const sit = Object.fromEntries(ORDEM.map((c) => [c, dados[c]?.situacao ?? 'nao_carregado'])) as Record<CadastroCargaPortal, SituacaoCarga>;
  const cadastros: LinhaSituacaoCarga[] = CADASTROS_CARGA_PORTAL.map((def) => {
    const d = dados[def.cadastro];
    return {
      numero: def.numero, cadastro: def.cadastro, situacao: sit[def.cadastro], erros: d?.erros ?? 0, opcional: def.opcional, depende_de: null, liberado: true,
      ultima_carga: d && d.situacao !== 'nao_carregado' ? { em: '2026-11-23T18:39:00.000Z', quantidade: d.quantidade ?? 44 } : null,
    };
  });
  // Sem parse: o SDK atual ainda confere depende_de/liberado pelas dependências; a nova lista não as tem. A tela não usa os dois campos.
  return { empresa_id: EMP, modulo_licenciado: true, cadastros } as SituacaoCargasPlataforma;
}
export const conferencia = (extra: Record<string, unknown> = {}) => ({
  cadastro: 'produto', modo: 'adicionar', prontas: 44, com_erro: 1, linhas_omitidas: 0,
  linhas: [{ linha: 21, motivo: 'O NCM 4202.22.10 exige CEST: preencha a coluna cest.', acao: 'Preencha a coluna cest.' }], ...extra,
});

