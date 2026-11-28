'use client';
import type { FichaReceitaPlanaMascarada, SituacaoTrocaCnpj, UsuarioConfig } from '@macuxierp/core/contracts';
import type { EmpresaPlataforma, ModuloId } from '@macuxierp/platform-sdk';
import { DialogoMotivo, FaixaPendencias, RegiaoErros, ResultadoAcao, useResultado } from '@macuxierp/ui';
import { useState, useTransition } from 'react';
import { lugarDaEmpresa } from '@/lib/config/empresa';
import { resultadoErro, resultadoSucesso } from '@/lib/resultado-acao';
import { validarMotivo } from '@/lib/config/formularios';
import { alternar, ativosDe, dependentesLigados, linhasModulos, mudancasDe, nomeModulo, pendenciasDe, type Dependencia } from '@/lib/config/modulos';
import { alterarModulosAcao, situacaoAcao } from '@/lib/acoes-cliente';
import { FichaReceita } from './ficha-receita';
import { CampoCnpj, TrocaCnpj } from './troca-cnpj';
import { BlocoUsuarios } from './usuarios';

export interface ChavesPainel {
  situacao: string;
}

interface Comum {
  empresa: EmpresaPlataforma;
  aoErro: (tem: boolean) => void;
}
/**
 * Aba Empresa (Config v4, regras 11 e 12): a Ficha da Receita é a grade de 12 colunas (Identificação e Endereço na largura toda; Atividades, Contato
 * e Módulos lado a lado; Na Receita), como a simulação aprovada; os Usuários ocupam a largura toda abaixo; no celular, um embaixo do outro. O rodapé da página é uma
 * barra fixa (RD-2368, RD-2370): à esquerda Salvar, Descartar, Atualizar, Trocar CNPJ e o estado da Ficha; à direita, em vermelho, Suspender (sem bloco "Situação").
 */
export function PainelEmpresa({ empresa, deps, chaves, ficha = null, cnpj = null, usuarios = null }: { empresa: EmpresaPlataforma; deps: Dependencia[]; chaves: ChavesPainel; ficha?: FichaReceitaPlanaMascarada | null; cnpj?: SituacaoTrocaCnpj | null; usuarios?: UsuarioConfig[] | null }) {
  const [temErro, setTemErro] = useState(false);
  const [rodape, setRodape] = useState<HTMLElement | null>(null);
  return (
    <>
      <RegiaoErros temErro={temErro} />
      <div className="grade-empresa">
        <FichaReceita
          empresaId={empresa.id}
          ficha={ficha}
          razaoEmpresa={empresa.razao_social ?? null}
          lugar={lugarDaEmpresa(empresa, ficha)}
          fuso={empresa.fuso}
          editavel={empresa.situacao !== 'encerrado'}
          cnpj={<CampoCnpj empresa={empresa} situacao={cnpj} />}
          acaoCnpj={<TrocaCnpj empresa={empresa} situacao={cnpj} />}
          rodapeAlvo={rodape}
          lateral={<div className="cartao-ficha cartao-3"><BlocoModulos empresa={empresa} deps={deps} aoErro={setTemErro} /></div>}
        />
        <BlocoUsuarios empresaId={empresa.id} itens={usuarios} fuso={empresa.fuso} editavel={empresa.situacao !== 'encerrado'} />
      </div>
      <div className="rodape-pagina">
        <div ref={setRodape} className="rodape-alvo" />
        <SuspenderEmpresa empresa={empresa} chave={chaves.situacao} aoErro={setTemErro} />
      </div>
    </>
  );
}

function BlocoModulos({ empresa, deps, aoErro }: Comum & { deps: Dependencia[] }) {
  const [marcados, setMarcados] = useState<Set<ModuloId>>(() => ativosDe(empresa.modulos));
  const [desligar, setDesligar] = useState<{ modulo: ModuloId; dependentes: ModuloId[] } | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [resultado, chaveResultado, mostrar, limpar] = useResultado(); // 36 A: abaixo do "Salvar módulos"
  const [pendente, iniciar] = useTransition();
  const mudancas = mudancasDe(empresa.modulos, marcados);
  const editavel = empresa.situacao !== 'encerrado';

  const aplicar = (m: ModuloId, ligar: boolean) => {
    limpar();
    setMarcados((atual) => alternar(m, ligar, atual, deps));
  };
  const marcar = (m: ModuloId, ligar: boolean) => {
    const dependentes = ligar ? [] : dependentesLigados(m, marcados, deps);
    if (dependentes.length > 0) setDesligar({ modulo: m, dependentes });
    else aplicar(m, ligar);
  };
  const salvar = () =>
    iniciar(async () => {
      const r = await alterarModulosAcao(empresa.id, mudancas);
      setCampos(r.ok ? {} : r.campos);
      aoErro(!r.ok);
      // erro que a faixa de pendências já explica não se repete aqui
      if (r.ok) mostrar(resultadoSucesso('Módulos salvos.'));
      else if (pendenciasDe(r.campos, marcados, deps).length === 0) mostrar(resultadoErro(r.erro));
      else limpar();
    });
  const pendencias = pendenciasDe(campos, marcados, deps);

  return (
    <section className="bloco" aria-labelledby="h-modulos">
      <h2 id="h-modulos">Módulos</h2>
      <FaixaPendencias itens={pendencias} />
      <ul className="lista-modulos">
        {linhasModulos(marcados, deps).map((l) => (
          <li key={l.modulo}>
            <label>
              <input type="checkbox" className="mx-checkbox" checked={l.marcado} disabled={l.desabilitado || !editavel || pendente} onChange={(e) => marcar(l.modulo, e.target.checked)} />
              {nomeModulo(l.modulo)}
            </label>
            {l.motivo && <span className="apoio"> {l.motivo}</span>}
          </li>
        ))}
      </ul>
      <div className="barra-acoes">
        <button className={mudancas.length > 0 ? 'mx-botao' : 'mx-botao-secundario'} type="button" disabled={mudancas.length === 0 || pendente || !editavel} onClick={salvar}>
          {pendente ? 'Salvando…' : 'Salvar módulos'}
        </button>
      </div>
      <ResultadoAcao resultado={resultado} chave={chaveResultado} />
      {desligar && (
        <DialogoMotivo
          titulo={`Desligar ${nomeModulo(desligar.modulo)}?`}
          aviso={`Também serão desligados: ${desligar.dependentes.map(nomeModulo).join(', ')}.`}
          semTexto
          rotuloConfirmar="Desligar"
          rotuloFechar="Manter ligado"
          destrutivo
          aoConfirmar={() => {
            aplicar(desligar.modulo, false);
            setDesligar(null);
          }}
          aoCancelar={() => setDesligar(null)}
        />
      )}
    </section>
  );
}

const AVISO_DADO_PESSOAL = 'Não escreva dado pessoal no motivo.';

/**
 * "Suspender" / "Reativar" no rodapé da página (Config v4, regra 12; RD-2367, RD-2368): à direita da barra, em vermelho quando suspende,
 * separado dos botões da Ficha. Pede motivo (sem dado pessoal) e confirma; o retorno aparece logo acima da barra.
 */
function SuspenderEmpresa({ empresa, chave, aoErro }: Comum & { chave: string }) {
  const [aberto, setAberto] = useState(false);
  const [chaveAtual, setChave] = useState(chave);
  const [resultado, chaveResultado, mostrar, limpar] = useResultado();
  const [pendente, iniciar] = useTransition();
  const suspender = empresa.situacao === 'ativo';
  if (empresa.situacao === 'encerrado') return null; // o selo do título já diz "Encerrado"
  const confirmar = (motivo: string) => {
    setAberto(false);
    iniciar(async () => {
      const r = await situacaoAcao(empresa.id, suspender ? 'suspenso' : 'ativo', motivo, chaveAtual);
      const texto = r.ok ? '' : r.erro || r.campos.motivo || '';
      if (texto) mostrar(resultadoErro(texto));
      else limpar();
      aoErro(!r.ok);
      if (r.ok || r.chaveNova) setChave(crypto.randomUUID());
    });
  };
  return (
    <>
      <button className={suspender ? 'mx-botao-destrutivo rodape-suspender' : 'mx-botao-secundario rodape-suspender'} type="button" disabled={pendente} onClick={() => setAberto(true)}>{suspender ? 'Suspender' : 'Reativar'}</button>
      {(resultado || aberto) && (
        <div className="rodape-retorno">
          <ResultadoAcao resultado={resultado} chave={chaveResultado} />
          {aberto && (
            <DialogoMotivo
              titulo={`${suspender ? 'Suspender' : 'Reativar'} ${empresa.nome}?`}
              textoObrigatorio
              rotuloTexto="Motivo"
              aviso={suspender ? `Os usuários da empresa deixam de entrar. ${AVISO_DADO_PESSOAL}` : AVISO_DADO_PESSOAL}
              validar={(r) => validarMotivo(r.texto)}
              rotuloConfirmar={suspender ? 'Suspender' : 'Reativar'}
              rotuloFechar={suspender ? 'Manter ativa' : 'Cancelar'}
              destrutivo={suspender}
              aoConfirmar={(r) => confirmar(r.texto.trim())}
              aoCancelar={() => setAberto(false)}
            />
          )}
        </div>
      )}
    </>
  );
}
