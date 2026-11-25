'use client';
import type { CampoContato, FichaReceitaPlanaMascarada } from '@macuxierp/core/contracts';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { RevelarMascarado } from '@/components/revelar-mascarado';
import { ChavesIdempotencia } from '@/lib/config/chaves';
import { AUSENTE } from '@/lib/config/empresa';
import { linhasDaFicha, origemDaConsulta } from '@/lib/config/ficha';
import { atualizarReceitaAcao, revelarContatoAcao } from '../acoes-ficha';

interface Props {
  empresaId: string;
  ficha: FichaReceitaPlanaMascarada | null;
  fuso: string;
  /** Empresa encerrada não consulta a Receita. */
  editavel: boolean;
}

/** Texto de um CNAE secundário: ponto único para virar "codigo · descricao" quando o contrato trouxer {codigo, descricao}. */
function textoCnae(c: string): string {
  return c;
}

/** E-mail ou telefone: mascarado (pelo banco) até o "Revelar". */
function Contato({ empresaId, campo, rotulo, mascarado }: { empresaId: string; campo: CampoContato; rotulo: string; mascarado: string | null }) {
  return (
    <div>
      <dt className="apoio">{rotulo}</dt>
      <dd>{mascarado ? <RevelarMascarado rotulo={rotulo.toLowerCase()} mascarado={mascarado} revelar={() => revelarContatoAcao(empresaId, campo).then((r) => (r.ok ? { ok: true as const, valor: r.valor.valor } : r))} /> : AUSENTE}</dd>
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
  const consulta = ficha ? origemDaConsulta(ficha, fuso) : null;
  return (
    <section className="bloco" aria-labelledby="h-ficha">
      <h2 id="h-ficha">Ficha da Receita</h2>
      <div className="cabecalho-ficha">
        {consulta && <p className="apoio">{consulta}</p>}
        <button className="mx-botao-secundario" type="button" disabled={pendente || !editavel} onClick={atualizar}>
          {pendente ? 'Consultando a Receita…' : 'Atualizar pela Receita'}
        </button>
      </div>
      {mensagem && (
        <p className={mensagem.ok ? 'apoio' : 'erro'} role={mensagem.ok ? 'status' : 'alert'}>
          {mensagem.texto}
        </p>
      )}
      {ficha ? (
        <>
          <dl className="dados-empresa">
            {linhasDaFicha(ficha).map((l) => (
              <div key={l.rotulo}>
                <dt className="apoio">{l.rotulo}</dt>
                <dd>{l.valor}</dd>
              </div>
            ))}
            <Contato empresaId={empresaId} campo="email" rotulo="E-mail" mascarado={ficha.email_mascarado} />
            <Contato empresaId={empresaId} campo="telefone" rotulo="Telefone" mascarado={ficha.telefone_mascarado} />
          </dl>
          {ficha.cnae_secundarios && ficha.cnae_secundarios.length > 0 && (
            <>
              <h3>CNAE secundários</h3>
              <ul className="lista-cnae">
                {ficha.cnae_secundarios.map((c) => (
                  <li key={c}>{textoCnae(c)}</li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="apoio">Ainda não consultada. Use Atualizar pela Receita.</p>
      )}
    </section>
  );
}
