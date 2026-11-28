import type { MatrizDePerfis } from '@/lib/telas/core';
import { rotuloDaAcao, type fichaEmpresa, type quadroEmpresaFiscal } from '@macuxierp/core/web';
import { Selo } from '@/components/descritor/ui-cliente';

/**
 * Quadros só de leitura do core: perfis e permissões (T-0087) e empresa e ambiente fiscal (T-0088). Servidor, sem estado: recebem o que
 * o adaptador montou (`lib/telas/core.ts`). O ambiente fiscal NÃO tem botão de troca: produção só pela rota da T-0030 (RN-CORE-08).
 */

export function VistaPerfis({ matriz }: { matriz: MatrizDePerfis }) {
  return (
    <section aria-label="Permissões por perfil">
      <div className="tabela-rolavel">
        <table className="matriz-perfis">
          <thead>
            <tr>
              <th scope="col">Permissão</th>
              {matriz.perfis.map((p) => <th key={p.perfil} scope="col">{p.rotulo}</th>)}
            </tr>
          </thead>
          {matriz.grupos.map((g) => (
            <tbody key={g.modulo}>
              <tr className="matriz-grupo"><th scope="colgroup" colSpan={matriz.perfis.length + 1}>{g.rotulo}</th></tr>
              {g.linhas.map((l) => (
                <tr key={l.acao}>
                  <th scope="row" title={l.acao}>{rotuloDaAcao(l.acao)}</th>
                  {l.por_perfil.map((pode, i) => (
                    <td key={matriz.perfis[i]?.perfil ?? i}>{pode ? <span>Sim</span> : <span aria-label="Não">—</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

export function VistaAmbienteFiscal({ quadro }: { quadro: Pick<ReturnType<typeof quadroEmpresaFiscal>, 'filiais' | 'texto_homologacao'> }) {
  return (
    <section aria-label="Empresa e ambiente fiscal">
      {quadro.filiais.length === 0 ? (
        <p className="apoio">Nenhuma filial configurada.</p>
      ) : (
        <div className="tabela-rolavel">
          <table>
            <thead><tr><th scope="col">Filial</th><th scope="col">Ambiente</th></tr></thead>
            <tbody>
              {quadro.filiais.map((f) => (
                <tr key={f.filial_id}>
                  <th scope="row">{f.filial}</th>
                  <td><Selo selo={{ texto: f.rotulo, tom: f.ambiente === 'producao' ? 'ok' : 'aviso' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {quadro.texto_homologacao && <p className="apoio" data-texto-homologacao>{quadro.texto_homologacao}</p>}
    </section>
  );
}

/**
 * Empresa (T-0125, RF-CORE-01): a ficha do core em 12 colunas, com o Ambiente fiscal como bloco da mesma página (regra 11). Dado só de leitura
 * vira texto, não caixa de campo. Sem botão de produção (RN-CORE-08).
 */
export function VistaEmpresa({ ficha }: { ficha: ReturnType<typeof fichaEmpresa> }) {
  return (
    <div className="formulario">
      {ficha.blocos.map((b) => (
        <section key={b.id} className="cartao-ficha bloco-leitura" aria-labelledby={`h-empresa-${b.id}`}>
          <h2 id={`h-empresa-${b.id}`} className="titulo-cartao">{b.titulo}</h2>
          {b.id === 'dados' ? (
            <dl className="formulario">
              {b.campos.map((c) => (
                <div key={c.nome} className={`campo campo-col-${c.colunas}`}>
                  <dt>{c.rotulo}</dt>
                  <dd>{c.valor || '—'}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <VistaAmbienteFiscal quadro={ficha.ambiente} />
          )}
        </section>
      ))}
    </div>
  );
}
