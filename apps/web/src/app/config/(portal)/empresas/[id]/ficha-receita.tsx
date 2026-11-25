'use client';
import type { CampoContato, FichaReceitaMascarada } from '@macuxierp/core/contracts';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { ChavesIdempotencia } from '@/lib/config/chaves';
import { AUSENTE } from '@/lib/config/empresa';
import { CAMPOS_CONTATO, cnaeEmTexto, linhasDaFicha, origemDaConsulta } from '@/lib/config/ficha';
import { atualizarReceitaAcao, revelarContatoAcao } from '../acoes-ficha';

interface Props {
  empresaId: string;
  ficha: FichaReceitaMascarada | null;
  fuso: string;
  /** Empresa encerrada não consulta a Receita. */
  editavel: boolean;
}

/** E-mail ou telefone: mascarado até o "Revelar"; o valor revelado fica só no estado desta tela (nunca em URL, armazenamento ou log). */
function Contato({ empresaId, campo, rotulo, mascarado }: { empresaId: string; campo: CampoContato; rotulo: string; mascarado: string | null }) {
  const [valor, setValor] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [pendente, iniciar] = useTransition();
  const alternar = () => {
    if (valor !== null) return setValor(null);
    setErro('');
    iniciar(async () => {
      const r = await revelarContatoAcao(empresaId, campo);
      if (r.ok) setValor(r.valor.valor ?? AUSENTE);
      else setErro(r.erro);
    });
  };
  return (
    <div>
      <dt className="apoio">{rotulo}</dt>
      <dd>
        <span className="contato-valor">{valor ?? mascarado ?? AUSENTE}</span>
        {mascarado && (
          <>
            {' '}
            <button className="mx-botao-secundario" type="button" disabled={pendente} aria-pressed={valor !== null} aria-label={`${valor !== null ? 'Ocultar' : 'Revelar'} ${rotulo.toLowerCase()}`} onClick={alternar}>
              {pendente ? 'Carregando…' : valor !== null ? 'Ocultar' : 'Revelar'}
            </button>
          </>
        )}
        {erro && <span className="erro" role="alert"> {erro}</span>}
      </dd>
    </div>
  );
}

/** Bloco "Ficha da Receita" da aba Empresa (T-0101). Só o superadmin chega aqui (todo o /config é do superadmin). */
export function FichaReceita({ empresaId, ficha, fuso, editavel }: Props) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);
  const chaves = useRef(new ChavesIdempotencia());
  /** Uma Idempotency-Key por tentativa; só renova depois de resposta definitiva (repetição de rede reaproveita). */
  const atualizar = () =>
    iniciar(async () => {
      const r = await atualizarReceitaAcao(empresaId, chaves.current.de('receita'));
      chaves.current.aposResposta('receita', r);
      setMensagem(r.ok ? { ok: true, texto: r.valor.campos_alterados.length > 0 ? 'Ficha atualizada pela Receita.' : 'Consulta feita: a ficha já estava em dia.' } : { ok: false, texto: r.erro });
      if (r.ok) router.refresh();
    });
  return (
    <section className="bloco" aria-labelledby="h-ficha">
      <h2 id="h-ficha">Ficha da Receita</h2>
      {ficha ? (
        <>
          <p className="apoio">{origemDaConsulta(ficha, fuso)}</p>
          <dl className="dados-empresa">
            {linhasDaFicha(ficha).map((l) => (
              <div key={l.rotulo}>
                <dt className="apoio">{l.rotulo}</dt>
                <dd>{l.valor}</dd>
              </div>
            ))}
            {CAMPOS_CONTATO.map((c) => (
              <Contato key={c.campo} empresaId={empresaId} campo={c.campo} rotulo={c.rotulo} mascarado={c.campo === 'email' ? ficha.email_mascarado : ficha.telefone_mascarado} />
            ))}
          </dl>
          {ficha.cnae_secundarios.length > 0 && (
            <>
              <h3>CNAE secundários</h3>
              <ul className="lista-cnae">
                {ficha.cnae_secundarios.map((c) => (
                  <li key={c.codigo}>{cnaeEmTexto(c)}</li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="apoio">Sem ficha da Receita ainda ({AUSENTE}). Use "Atualizar pela Receita" para buscar.</p>
      )}
      <button className="mx-botao-secundario" type="button" disabled={pendente || !editavel} onClick={atualizar}>
        {pendente ? 'Consultando a Receita…' : 'Atualizar pela Receita'}
      </button>
      {mensagem && (
        <p className={mensagem.ok ? 'apoio' : 'erro'} role={mensagem.ok ? 'status' : 'alert'}>
          {mensagem.texto}
        </p>
      )}
    </section>
  );
}
