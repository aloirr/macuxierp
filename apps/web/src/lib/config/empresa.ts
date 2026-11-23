import { formatarDataHora, formatarDocumento, type EmpresaPlataforma } from '@macuxierp/platform-sdk';

const AUSENTE = '—';
const ou = (v: string | null | undefined) => (v && v.trim() ? v : AUSENTE);

export interface LinhaDado {
  rotulo: string;
  valor: string;
}

/** As linhas do bloco "Dados da empresa" (só leitura). Campo ausente ou null vira "—". CNPJ com máscara (numérico ou alfanumérico). */
export function dadosDaEmpresa(e: EmpresaPlataforma): LinhaDado[] {
  const lugar = e.cidade && e.uf ? `${e.cidade}/${e.uf}` : e.cidade || e.uf || null;
  return [
    { rotulo: 'Razão social', valor: ou(e.razao_social) },
    { rotulo: 'CNPJ', valor: e.cnpj ? formatarDocumento(e.cnpj) : AUSENTE },
    { rotulo: 'Cidade/UF', valor: ou(lugar) },
    { rotulo: 'Criada em', valor: formatarDataHora(e.created_at, e.fuso) },
  ];
}
