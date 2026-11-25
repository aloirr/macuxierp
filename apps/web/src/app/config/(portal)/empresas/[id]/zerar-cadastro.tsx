'use client';
import { AVISO_ZERAR_INATIVA_FDV, CODIGO_ZERAGEM_BLOQUEADA, FRASE_ZERAR_DADOS, type CadastroZerarPortal, type EntidadeEnvioFdv, type ZeragemPlataformaResposta } from '@macuxierp/platform-sdk';
import { useState } from 'react';
import { ConfirmarComFrase } from '@/components/confirmar-com-frase';
import { AVISO_ZERAR, AVISO_LIMITE_FDV, TEXTO_ANTES_DE_ZERAR, bloqueiosDeTextos, pedirPreviaZerar, pedirZerar, textoLevaJunto, textoSemChave, textosAnulados, textosBloqueios, textosMantidos } from '@/lib/config/cargas';
import { cadastroDoZerar, textoInativacaoFdv, textoZerarJuntos } from '@/lib/config/operacao-fdv';
import { ListaMantidos, usePreviaZerar } from './previa-zerar';

/**
 * "Zerar" por cadastro na aba Integração (T-0086, emenda da RN-CAD-10, R-20261124-170915-alexandre): apaga os registros do
 * cadastro no ERP e inativa os mesmos no FDV. Pede a frase "autorizo zerar os dados" e mostra o aviso do FDV antes de confirmar.
 * Um cadastro só (`CADASTRO_ZERAR_POR_ENTIDADE_FDV`). Só o lote em andamento bloqueia. Passa pelos route handlers de
 * `/config/empresas/:id/cargas/zerar`.
 */

/** Faixa de aviso do zerar: registros que foram ao FDV sem código de origem; some quando não há nenhum. */
export function AvisoSemChave({ semChave }: { semChave: number }) {
  return semChave > 0 ? <p className="faixa-aviso" role="status">{textoSemChave(semChave)}</p> : null;
}

/** Uma linha por motivo, só quando há conteúdo: "Leva junto", "Mantidos" (com o detalhe), anulados e bloqueios. Pura sobre a prévia. */
export function ResumoPrevia({ previa, escolhidos }: { previa: ZeragemPlataformaResposta; escolhidos: readonly CadastroZerarPortal[] }) {
  const junto = textoLevaJunto(previa.efetivos, escolhidos);
  const mantidos = textosMantidos(previa.mantidos);
  const anulados = textosAnulados(previa.anulados);
  return (
    <div className="previa-zerar" aria-live="polite">
      {junto && <p>{junto}</p>}
      {mantidos && <ListaMantidos total={mantidos.total} detalhes={mantidos.detalhes} />}
      {anulados.length > 0 && <ul className="lista-simples">{anulados.map((t) => <li key={t}>{t}</li>)}</ul>}
      <AvisoSemChave semChave={previa.sem_chave} />
    </div>
  );
}

export function ZerarCadastro({ empresaId, entidade, rotulo, aoFechar, aoZerar, previaInicial = null }: {
  empresaId: string;
  entidade: EntidadeEnvioFdv;
  rotulo: string;
  aoFechar: () => void;
  aoZerar: (mantidos: number) => void;
  previaInicial?: ZeragemPlataformaResposta | null;
}) {
  const cadastro = cadastroDoZerar(entidade);
  const [bloqueiosApi, setBloqueiosApi] = useState<string[]>([]);
  const { previa, carregando, erroPrevia, recontar } = usePreviaZerar(
    (sinal) => pedirPreviaZerar(empresaId, [cadastro], fetch, sinal), [empresaId, cadastro], previaInicial, () => setBloqueiosApi([]),
  );

  const bloqueios = [...new Set([...(previa ? textosBloqueios(previa.bloqueios) : []), ...(bloqueiosApi.length > 0 ? textosBloqueios(bloqueiosDeTextos(bloqueiosApi)) : [])])];
  const juntos = textoZerarJuntos(entidade);
  const inativa = textoInativacaoFdv(previa?.inativacao_fdv);

  return (
    <ConfirmarComFrase
      titulo={`Zerar ${rotulo}?`}
      frase={FRASE_ZERAR_DADOS}
      rotulo="Zerar"
      rotuloEnviando="Zerando…"
      idEnvio={`zerar:${entidade}`}
      podeEnviar={!!previa && !carregando && bloqueios.length === 0}
      enviar={(chave, frase) => pedirZerar(empresaId, [cadastro], frase, chave)}
      aoSucesso={aoZerar}
      aoFalha={(r) => {
        if (r.codigo === CODIGO_ZERAGEM_BLOQUEADA) { setBloqueiosApi(r.bloqueios ?? []); return r.erro; }
        if (r.codigo === 'dados_mudaram') recontar();
        return undefined;
      }}
      aoFechar={aoFechar}
      aviso={<><span>{AVISO_ZERAR}</span><br /><span data-testid="aviso-fdv">{AVISO_ZERAR_INATIVA_FDV}</span></>}
      tomAviso="erro"
      bloqueio={bloqueios.length > 0 ? <ul className="faixa-erro lista-simples sem-margem" role="alert" aria-label="Zerar bloqueado">{bloqueios.map((t) => <li key={t}>{t}</li>)}</ul> : undefined}
    >
      <p className="sem-margem">{TEXTO_ANTES_DE_ZERAR}</p>
      {juntos && <p className="sem-margem">{juntos}</p>}
      {erroPrevia && <p className="erro" role="alert">{erroPrevia}</p>}
      {previa && (
        <>
          <ResumoPrevia previa={previa} escolhidos={[cadastro]} />
          {inativa && <p className="sem-margem" data-testid="inativacao-fdv">{inativa}</p>}
          <p className="faixa-aviso sem-margem" role="status" data-testid="aviso-30-fdv">{AVISO_LIMITE_FDV}</p>
        </>
      )}
    </ConfirmarComFrase>
  );
}
