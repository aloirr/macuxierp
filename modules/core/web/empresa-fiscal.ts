/**
 * T-0088: quadro "Empresa e ambiente fiscal" da tela `ambiente` do BKO, SÓ EXIBIÇÃO. Monta o que a tela mostra a partir
 * das respostas da API (`GET /empresa` e `GET /ambientes-fiscais`). A troca para produção NÃO tem ação aqui: continua só
 * pela rota da T-0030, com a frase "aprovo produção fiscal <empresa>" (RN-CORE-08, ADR 0006).
 */
import type { AmbienteFiscal, Empresa } from '../contracts';
import { TEXTO_AMBIENTE_HOMOLOGACAO } from './paginas';

interface LinhaAmbienteFiscal {
  filial_id: string;
  /** Nome da filial, quando o BKO o conhece (vem do cadastros); sem o nome, a tela mostra o id curto. */
  filial: string;
  ambiente: AmbienteFiscal['ambiente'];
  rotulo: 'Homologação' | 'Produção';
}

interface QuadroEmpresaFiscal {
  empresa: { razao_social: string; nome_fantasia: string | null; cnpj: string; ie: string | null; fuso: string };
  filiais: LinhaAmbienteFiscal[];
  /** Só quando há filial em homologação: de onde se pede produção. A tela não tem botão para isso. */
  texto_homologacao: string | null;
}

/** 00.000.000/0000-00 a partir dos 14 dígitos; qualquer outra coisa volta como veio. */
export function formatarCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : cnpj;
}

export function quadroEmpresaFiscal(empresa: Empresa, ambientes: readonly AmbienteFiscal[], nomesFiliais: Readonly<Record<string, string>> = {}): QuadroEmpresaFiscal {
  const filiais = ambientes
    .map<LinhaAmbienteFiscal>((a) => ({
      filial_id: a.filial_id,
      filial: nomesFiliais[a.filial_id] ?? a.filial_id.slice(0, 8),
      ambiente: a.ambiente,
      rotulo: a.ambiente === 'producao' ? 'Produção' : 'Homologação',
    }))
    .sort((x, y) => x.filial.localeCompare(y.filial, 'pt-BR'));
  return {
    empresa: { razao_social: empresa.razao_social, nome_fantasia: empresa.nome_fantasia, cnpj: formatarCnpj(empresa.cnpj), ie: empresa.ie, fuso: empresa.fuso },
    filiais,
    texto_homologacao: filiais.some((f) => f.ambiente === 'homologacao') ? TEXTO_AMBIENTE_HOMOLOGACAO : null,
  };
}
