import { ROTULO_BANDEIRA } from '@macuxierp/faturamento/web';
import type { CartaoDaBandeira } from '@/lib/telas/bandeira';
import { AcoesDetalhe } from '@/components/descritor/acoes-detalhe';
import { Selo } from '@/components/descritor/ui-cliente';

/**
 * Bandeira "faturamento real com NF-e simulada" por filial (T-0088). Um cartão por filial: situação, ambiente e, só para o administrador,
 * o botão Ligar ou Desligar (confirmação antes). Sem botão para os outros perfis. Não troca o ambiente fiscal: a nota segue em homologação.
 */
export function VistaBandeira({ cartoes, rota, rotaDaPagina }: { cartoes: readonly CartaoDaBandeira[]; rota: string; rotaDaPagina: string }) {
  return (
    <section aria-label={ROTULO_BANDEIRA}>
      {cartoes.length === 0 ? (
        <p className="apoio">Nenhuma filial cadastrada.</p>
      ) : (
        <ul className="cartoes-bandeira">
          {cartoes.map((c) => (
            <li key={c.filial_id} className="cartao-bandeira" data-filial={c.filial_id}>
              <h2>{c.nome}</h2>
              {c.indisponivel ? (
                <p className="erro" role="alert">{c.indisponivel}</p>
              ) : (
                <p className="selos">{c.selo && <Selo selo={c.selo} />}{c.ambiente && <Selo selo={c.ambiente} />}</p>
              )}
              {c.acao && <div className="bandeira-acoes"><AcoesDetalhe acoes={[c.acao]} rota={rota} rotaDaPagina={rotaDaPagina} compacta menu comPrincipal rotuloLinha={c.nome} /></div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
