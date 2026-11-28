import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { ROTULO_SITUACAO_LICENCA, situacaoDaLicenca } from '@macuxierp/core/web';
import { Licenca } from '@macuxierp/core/contracts';
import { getValidado } from '@/lib/api';
import { MANIFESTOS } from '@/lib/manifestos';
import { NOMES_MODULOS } from '@/lib/nomes-modulos';
import { COOKIE_ACESSO, contexto } from '@/lib/sessao';

export const metadata: Metadata = { title: 'Licenças' };

/**
 * Mesmo vocabulário e mesma regra da lista do core (RN-CORE-02):
 * a situação sai de `GET /v1/core/licencas` (traz a vencida). Quem não tem `core.licenca.ver` ou com a API fora cai no `eu.modulos`, que traz só as
 * vigentes: o que falta aparece como Inativa.
 */
async function situacoes(): Promise<Map<string, 'ativa' | 'inativa' | 'vencida'> | null> {
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  if (!acesso) return null;
  try {
    const r = await getValidado('/v1/core/licencas', z.object({ itens: z.array(Licenca) }), acesso, 'licencas', true);
    const agora = new Date();
    return new Map(r.itens.map((l) => [l.modulo, situacaoDaLicenca(l, agora)]));
  } catch {
    return null;
  }
}

/** Somente leitura (D12): a licença muda pelo operador da Macuxi, com auditoria. A situação vem de `situacoes()` (RN-CORE-02). */
export default async function Licencas() {
  const { eu } = await contexto();
  const ativos = new Set(eu.modulos.map((m) => m.id));
  const lidas = await situacoes();
  return (
    <>
      <h1>Licenças</h1>
      <p className="apoio">Para contratar ou alterar módulos, fale com a Macuxi.</p>
      <table>
        <caption className="pular">Módulos e situação da licença</caption>
        <thead><tr><th scope="col">Módulo</th><th scope="col">Descrição</th><th scope="col">Situação</th></tr></thead>
        <tbody>
          {MANIFESTOS.map((m) => {
            const sit = lidas?.get(m.id) ?? (ativos.has(m.id) ? 'ativa' : 'inativa');
            const ativo = sit === 'ativa';
            return (
              <tr key={m.id}>
                <th scope="row">{NOMES_MODULOS[m.id]}</th>
                <td>{m.descricao}</td>
                <td><span className={`selo ${ativo ? 'selo-ativo' : 'selo-inativo'}`}>{ROTULO_SITUACAO_LICENCA[sit]}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
