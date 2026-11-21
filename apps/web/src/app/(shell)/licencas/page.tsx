import type { Metadata } from 'next';
import { MANIFESTOS } from '@/lib/manifestos';
import { NOMES_MODULOS } from '@/lib/nomes-modulos';
import { contexto } from '@/lib/sessao';

export const metadata: Metadata = { title: 'Licenças' };

/** Somente leitura (D12): a licença muda pelo operador da Macuxi, com auditoria. */
export default async function Licencas() {
  const { eu } = await contexto();
  const ativos = new Set(eu.modulos.map((m) => m.id));
  return (
    <>
      <h1>Licenças</h1>
      <p className="apoio">Para contratar ou alterar módulos, fale com a Macuxi.</p>
      <table>
        <caption className="pular">Módulos e situação da licença</caption>
        <thead><tr><th scope="col">Módulo</th><th scope="col">Descrição</th><th scope="col">Situação</th></tr></thead>
        <tbody>
          {MANIFESTOS.map((m) => {
            const ativo = ativos.has(m.id);
            return (
              <tr key={m.id}>
                <th scope="row">{NOMES_MODULOS[m.id]}</th>
                <td>{m.descricao}</td>
                <td><span className={`selo ${ativo ? 'selo-ativo' : 'selo-inativo'}`}>{ativo ? 'Licenciado' : 'Não contratado'}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
