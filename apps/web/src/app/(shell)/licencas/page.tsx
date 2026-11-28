import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { ROTULO_SITUACAO_LICENCA, TEXTO_SEM_PRAZO, situacaoDaLicenca, tomDaLicenca } from '@macuxierp/core/web';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { Selo } from '@/components/descritor/ui-cliente';
import { tomAmarelo } from '@/lib/usuarios-textos';
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
async function situacoes(): Promise<Map<string, { sit: 'ativa' | 'inativa' | 'vencida'; ate: string | null }> | null> {
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  if (!acesso) return null;
  try {
    const r = await getValidado('/v1/core/licencas', z.object({ itens: z.array(Licenca) }), acesso, 'licencas', true);
    const agora = new Date();
    return new Map(r.itens.map((l) => [l.modulo, { sit: situacaoDaLicenca(l, agora), ate: l.valido_ate }]));
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
        <thead><tr><th scope="col">Módulo</th><th scope="col">Situação</th><th scope="col">Válido até</th></tr></thead>
        <tbody>
          {MANIFESTOS.map((m) => {
            const l = lidas?.get(m.id);
            const sit = l?.sit ?? (ativos.has(m.id) ? 'ativa' : 'inativa');
            return (
              <tr key={m.id}>
                <th scope="row">{NOMES_MODULOS[m.id]}</th>
                <td><Selo selo={{ texto: ROTULO_SITUACAO_LICENCA[sit], tom: tomAmarelo(tomDaLicenca(sit)) }} /></td>
                <td>{l ? (l.ate ? formatarDataHora(l.ate, eu.empresa.fuso) : TEXTO_SEM_PRAZO) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
