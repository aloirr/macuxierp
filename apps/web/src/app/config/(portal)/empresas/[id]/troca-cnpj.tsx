'use client';
import { MENSAGENS_BLOQUEIO_CNPJ, type SituacaoTrocaCnpj } from '@macuxierp/core/contracts';
import { formatarDocumento, type EmpresaPlataforma } from '@macuxierp/platform-sdk';
import { Dialogo, ResultadoAcao, useResultado } from '@macuxierp/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { AUSENTE } from '@/lib/config/empresa';
import { resultadoErro, resultadoSucesso } from '@/lib/resultado-acao';
import { trocarCnpjAcao } from '@/lib/acoes-cliente';

/** Sem a situação (leitura falhou), a troca fica fechada (falha fechada), com o texto do core para "não foi possível verificar". */
const CNPJ_SEM_SITUACAO: SituacaoTrocaCnpj = { permitida: false, motivo: 'consulta_indisponivel', mensagem: MENSAGENS_BLOQUEIO_CNPJ.consulta_indisponivel };

/**
 * CNPJ no topo da Ficha da Receita (docs/design/telas-horizontais §3): rótulo em destaque e o valor com máscara, como texto. O botão
 * "Trocar CNPJ" vai para a barra do rodapé da ficha (RD-2370, `TrocaCnpj`); quando a troca está fechada, o motivo fica aqui, junto do CNPJ.
 */
export function CampoCnpj({ empresa, situacao }: { empresa: EmpresaPlataforma; situacao: SituacaoTrocaCnpj | null }) {
  const s = situacao ?? CNPJ_SEM_SITUACAO;
  return (
    <div className="campo campo-curto campo-cnpj">
      <span className="rotulo-campo" id="rotulo-cnpj">CNPJ</span>
      <p className="valor-cnpj" aria-labelledby="rotulo-cnpj">{empresa.cnpj ? formatarDocumento(empresa.cnpj) : AUSENTE}</p>
      {trocaAberta(empresa) && !s.permitida && <p className="apoio motivo-bloqueio" role="note">{s.mensagem}.</p>}
    </div>
  );
}

const trocaAberta = (e: EmpresaPlataforma) => Boolean(e.cnpj) && e.situacao !== 'encerrado';

/**
 * CNPJ editável só pelo superadmin (todo o /config é dele) e bloqueado com NF-e autorizada em produção (RN-CORE-16). A API
 * diz antes se pode (`situacao`) e revalida na troca; o motivo do bloqueio é o texto do core, junto do CNPJ (`CampoCnpj`). Sem a situação,
 * a troca fica fechada. O botão e o retorno ficam na barra do rodapé da ficha (RD-2370).
 */
export function TrocaCnpj({ empresa, situacao: lida }: { empresa: EmpresaPlataforma; situacao: SituacaoTrocaCnpj | null }) {
  const situacao = lida ?? CNPJ_SEM_SITUACAO;
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState('');
  const [erroCampo, setErroCampo] = useState('');
  const [chave, setChave] = useState(() => crypto.randomUUID());
  const [resultado, chaveResultado, mostrar, limpar] = useResultado();
  const [pendente, iniciar] = useTransition();
  if (!trocaAberta(empresa) || !situacao.permitida) return null;
  const fechar = () => {
    setAberto(false);
    setValor('');
    setErroCampo('');
  };
  const confirmar = () =>
    iniciar(async () => {
      const r = await trocarCnpjAcao(empresa.id, valor, chave);
      if (r.ok || r.chaveNova) setChave(crypto.randomUUID());
      if (r.ok) {
        fechar();
        mostrar(resultadoSucesso('CNPJ trocado.'));
        router.refresh();
      } else if (r.campos.cnpj_novo) setErroCampo(r.campos.cnpj_novo);
      else {
        fechar();
        mostrar(resultadoErro(r.erro));
      }
    });
  return (
    <>
      <button className="mx-botao-secundario" type="button" disabled={pendente} onClick={() => { limpar(); setAberto(true); }}>Trocar CNPJ</button>
      {resultado && <div className="rodape-retorno"><ResultadoAcao resultado={resultado} chave={chaveResultado} /></div>}
      {aberto && (
        <Dialogo
          titulo={`Trocar o CNPJ de ${empresa.nome}?`}
          aoFechar={fechar}
          aviso="Os cadastros e o Macuxi FDV passam a usar o CNPJ novo."
          rodape={
            <>
              <button type="button" className="mx-botao-secundario" onClick={fechar}>Cancelar</button>
              <button type="button" className="mx-botao" disabled={pendente || valor.trim() === ''} onClick={confirmar}>{pendente ? 'Trocando…' : 'Trocar CNPJ'}</button>
            </>
          }
        >
          <label className="campo">
            <span>CNPJ novo</span>
            <input value={valor} onChange={(e) => { setValor(e.target.value); setErroCampo(''); }} onKeyDown={(e) => {
              // o diálogo fica dentro do formulário da ficha: o Enter confirma a troca, nunca envia a ficha
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (valor.trim() !== '' && !pendente) confirmar();
            }} inputMode="numeric" maxLength={18} autoComplete="off" aria-invalid={erroCampo ? true : undefined} aria-describedby="erro-cnpj-novo" />
            {erroCampo && <span id="erro-cnpj-novo" className="erro-campo">{erroCampo}</span>}
          </label>
        </Dialogo>
      )}
    </>
  );
}
