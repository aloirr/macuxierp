/**
 * T-0125: ficha da página Empresa do BKO (RF-CORE-01), em dados, na grade de 12 colunas (regra 11). O bloco "Ambiente fiscal" mora
 * dentro dela e o título da página é o do item de menu. O shell renderiza; a API revalida. Sem botão de produção (RN-CORE-08).
 */
import type { AmbienteFiscal, Empresa } from '../contracts';
import { formatarCnpj, quadroEmpresaFiscal } from './empresa-fiscal';

export interface CampoFicha {
  nome: 'razao_social' | 'nome_fantasia' | 'cnpj' | 'ie' | 'fuso';
  rotulo: string;
  /** Largura na grade de 12 colunas; o campo curto (IE) fica em 1 a 2. */
  colunas: 1 | 2 | 3 | 4;
  valor: string;
  /** Dado só de leitura vira texto, não caixa de campo (o CNPJ amarra o A1 e não muda por aqui). */
  somenteLeitura: boolean;
}

export interface BlocoFicha {
  id: 'dados' | 'ambiente-fiscal';
  titulo: string;
  campos: readonly CampoFicha[];
}

export function fichaEmpresa(empresa: Empresa, ambientes: readonly Pick<AmbienteFiscal, 'filial_id' | 'ambiente'>[], nomesFiliais: Readonly<Record<string, string>> = {}) {
  const quadro = quadroEmpresaFiscal(empresa, ambientes as AmbienteFiscal[], nomesFiliais);
  // Uma linha só: 4 + 3 + 2 + 1 + 2 = 12 colunas.
  const dados: BlocoFicha = {
    id: 'dados',
    titulo: 'Dados da empresa',
    campos: [
      { nome: 'razao_social', rotulo: 'Razão social', colunas: 4, valor: empresa.razao_social, somenteLeitura: false },
      { nome: 'nome_fantasia', rotulo: 'Nome fantasia', colunas: 3, valor: empresa.nome_fantasia ?? '', somenteLeitura: false },
      { nome: 'cnpj', rotulo: 'CNPJ', colunas: 2, valor: formatarCnpj(empresa.cnpj), somenteLeitura: true },
      { nome: 'ie', rotulo: 'IE', colunas: 1, valor: empresa.ie ?? '', somenteLeitura: false },
      { nome: 'fuso', rotulo: 'Fuso horário', colunas: 2, valor: empresa.fuso, somenteLeitura: false },
    ],
  };
  return {
    titulo: 'Empresa' as const,
    blocos: [dados, { id: 'ambiente-fiscal', titulo: 'Ambiente fiscal', campos: [] }] as readonly BlocoFicha[],
    ambiente: { filiais: quadro.filiais, texto_homologacao: quadro.texto_homologacao },
  };
}
