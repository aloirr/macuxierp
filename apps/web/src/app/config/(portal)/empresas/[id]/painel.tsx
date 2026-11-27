'use client';
import type { FichaReceitaPlanaMascarada, SituacaoTrocaCnpj } from '@macuxierp/core/contracts';
import type { EmpresaPlataforma, ModuloId } from '@macuxierp/platform-sdk';
import { DialogoMotivo, FaixaPendencias, RegiaoErros, ResultadoAcao, useResultado } from '@macuxierp/ui';
import { useEffect, useRef, useState, useTransition } from 'react';
import { lugarDaEmpresa } from '@/lib/config/empresa';
import type { Resultado } from '@/lib/config/executar';
import { resultadoErro, resultadoSucesso } from '@/lib/resultado-acao';
import { validarMotivo } from '@/lib/config/formularios';
import { alternar, ativosDe, dependentesLigados, linhasModulos, mudancasDe, nomeModulo, pendenciasDe, type Dependencia } from '@/lib/config/modulos';
import { RevelarMascarado } from '@/components/revelar-mascarado';
import { alterarModulosAcao, criarAdminAcao, mostrarEmailAcao, redefinirSenhaAcao, situacaoAcao } from '../acoes';
import { FichaReceita } from './ficha-receita';
import { CampoCnpj } from './troca-cnpj';

export interface ChavesPainel {
  admin: string;
  senha: string;
  situacao: string;
}

interface Comum {
  empresa: EmpresaPlataforma;
  aoErro: (tem: boolean) => void;
}
/**
 * Aba Empresa (docs/design/telas-horizontais, R-20261127-110345): grade de blocos na largura toda. A Ficha da Receita (com o
 * CNPJ) é o bloco largo, e Módulos, 1º administrador e Situação ficam ao lado; no celular, um embaixo do outro, nessa ordem.
 */
export function PainelEmpresa({ empresa, deps, chaves, ficha = null, cnpj = null }: { empresa: EmpresaPlataforma; deps: Dependencia[]; chaves: ChavesPainel; ficha?: FichaReceitaPlanaMascarada | null; cnpj?: SituacaoTrocaCnpj | null }) {
  const [temErro, setTemErro] = useState(false);
  const [mudou, setMudou] = useState(false);
  return (
    <>
      <RegiaoErros temErro={temErro} />
      <div className="grade-blocos grade-empresa">
        <FichaReceita
          empresaId={empresa.id}
          ficha={ficha}
          razaoEmpresa={empresa.razao_social ?? null}
          lugar={lugarDaEmpresa(empresa, ficha)}
          fuso={empresa.fuso}
          editavel={empresa.situacao !== 'encerrado'}
          cnpj={<CampoCnpj empresa={empresa} situacao={cnpj} />}
        />
        <div className="blocos-laterais">
          <BlocoModulos empresa={empresa} deps={deps} aoErro={setTemErro} aoMudar={setMudou} />
          <BlocoAdmin empresa={empresa} chaves={chaves} aoErro={setTemErro} principal={!mudou} />
          <BlocoSituacao empresa={empresa} chave={chaves.situacao} aoErro={setTemErro} />
        </div>
      </div>
    </>
  );
}

function EmailAdmin({ empresaId, mascarado }: { empresaId: string; mascarado: string }) {
  const revelar = async () => {
    const r = await mostrarEmailAcao(empresaId);
    return r.ok ? { ok: true as const, valor: r.valor.email } : r;
  };
  return (
    <p className="email-admin">
      E-mail: <RevelarMascarado rotulo="e-mail" mascarado={mascarado} revelar={revelar} />
    </p>
  );
}

function BlocoModulos({ empresa, deps, aoErro, aoMudar }: Comum & { deps: Dependencia[]; aoMudar: (m: boolean) => void }) {
  const [marcados, setMarcados] = useState<Set<ModuloId>>(() => ativosDe(empresa.modulos));
  const [desligar, setDesligar] = useState<{ modulo: ModuloId; dependentes: ModuloId[] } | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [resultado, chaveResultado, mostrar, limpar] = useResultado(); // 36 A: abaixo do "Salvar módulos"
  const [pendente, iniciar] = useTransition();
  const mudancas = mudancasDe(empresa.modulos, marcados);
  const editavel = empresa.situacao !== 'encerrado';

  useEffect(() => aoMudar(mudancas.length > 0), [mudancas.length, aoMudar]);

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
      <button className={mudancas.length > 0 ? 'mx-botao' : 'mx-botao-secundario'} type="button" disabled={mudancas.length === 0 || pendente || !editavel} onClick={salvar}>
        {pendente ? 'Salvando…' : 'Salvar módulos'}
      </button>
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

const rotuloAdmin = (a: NonNullable<EmpresaPlataforma['primeiro_admin']>) => (a.bloqueado ? 'Bloqueado' : a.ativo ? 'Ativo' : 'Inativo');

function BlocoAdmin({ empresa, chaves, aoErro, principal }: Comum & { chaves: ChavesPainel; principal: boolean }) {
  const [senha, setSenha] = useState<string | null>(null); // só na memória desta tela: nunca em URL, armazenamento ou log
  const [copiado, setCopiado] = useState(false);
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('Administrador');
  const [chaveCriar, setChaveCriar] = useState(chaves.admin);
  const [chaveSenha, setChaveSenha] = useState(chaves.senha);
  const [confirmar, setConfirmar] = useState(false);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [retorno, chaveRetorno, mostrar, limpar] = useResultado(); // 36 A: abaixo de Criar administrador / Redefinir senha
  const [pendente, iniciar] = useTransition();
  const painel = useRef<HTMLDivElement>(null);
  const botaoRedefinir = useRef<HTMLButtonElement>(null);
  const admin = empresa.primeiro_admin;
  const editavel = empresa.situacao !== 'encerrado';

  useEffect(() => {
    if (senha) painel.current?.focus();
  }, [senha]);

  const aplicarRetorno = (r: Resultado<{ senha: string }>, renovar: (k: string) => void) => {
    if (r.ok) {
      limpar();
      setCampos({});
      setCopiado(false);
      setSenha(r.valor.senha);
      renovar(crypto.randomUUID());
    } else {
      mostrar(resultadoErro(r.erro));
      setCampos(r.campos);
      if (r.chaveNova) renovar(crypto.randomUUID());
    }
    aoErro(!r.ok);
  };
  const criar = () =>
    iniciar(async () => aplicarRetorno(await criarAdminAcao(empresa.id, { email, nome }, chaveCriar), setChaveCriar));
  const redefinir = () => {
    setConfirmar(false);
    iniciar(async () => aplicarRetorno(await redefinirSenhaAcao(empresa.id, chaveSenha), setChaveSenha));
  };
  const copiar = async () => {
    if (!senha) return;
    try {
      await navigator.clipboard.writeText(senha);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <section className="bloco" aria-labelledby="h-admin">
      <h2 id="h-admin">1º administrador</h2>
      {admin ? (
        <>
          {admin.email_mascarado && <EmailAdmin empresaId={empresa.id} mascarado={admin.email_mascarado} />}
          <p>Situação: <strong>{rotuloAdmin(admin)}</strong></p>
          <button ref={botaoRedefinir} className="mx-botao-secundario" type="button" disabled={pendente || !editavel} onClick={() => setConfirmar(true)}>Redefinir senha</button>
          <ResultadoAcao resultado={retorno} chave={chaveRetorno} />
        </>
      ) : (
        <form
          className="formulario formulario-estreito"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            criar();
          }}
        >
          <label className="campo">
            <span>E-mail</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" aria-invalid={campos.email ? true : undefined} aria-describedby="erro-email" />
            {campos.email && <span id="erro-email" className="erro-campo">{campos.email}</span>}
          </label>
          <label className="campo">
            <span>Nome</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} autoComplete="off" aria-invalid={campos.nome ? true : undefined} aria-describedby="erro-nome-admin" />
            {campos.nome && <span id="erro-nome-admin" className="erro-campo">{campos.nome}</span>}
          </label>
          <button className={principal ? 'mx-botao' : 'mx-botao-secundario'} type="submit" disabled={pendente || !editavel}>{pendente ? 'Criando…' : 'Criar administrador'}</button>
          <ResultadoAcao resultado={retorno} chave={chaveRetorno} />
        </form>
      )}
      {senha && (
        <div ref={painel} tabIndex={-1} className="painel-senha" role="group" aria-label="Senha provisória">
          <code className="senha-provisoria">{senha}</code>
          <div className="barra-acoes">
            <button className="mx-botao-secundario" type="button" onClick={copiar}>Copiar</button>
            <button className="mx-botao-secundario" type="button" onClick={() => { setSenha(null); setCopiado(false); }}>Já entreguei</button>
          </div>
          <p role="status" className="apoio">{copiado ? 'Copiado' : ''}</p>
          <p className="faixa-aviso">Esta senha não volta a aparecer. Entregue ao administrador por canal seguro.</p>
        </div>
      )}
      {confirmar && (
        <DialogoMotivo
          titulo="Redefinir a senha do administrador?"
          aviso="A senha atual deixa de valer, e ele precisa entrar de novo com a senha nova."
          semTexto
          rotuloConfirmar="Redefinir"
          rotuloFechar="Cancelar"
          aoConfirmar={redefinir}
          aoCancelar={() => setConfirmar(false)}
        />
      )}
    </section>
  );
}

const AVISO_DADO_PESSOAL = 'Não escreva dado pessoal no motivo.';

function BlocoSituacao({ empresa, chave, aoErro }: Comum & { chave: string }) {
  const [aberto, setAberto] = useState(false);
  const [chaveAtual, setChave] = useState(chave);
  const [resultado, chaveResultado, mostrar, limpar] = useResultado(); // 36 A: abaixo de Suspender/Reativar
  const [pendente, iniciar] = useTransition();
  const suspender = empresa.situacao === 'ativo';
  if (empresa.situacao === 'encerrado') {
    return (
      <section className="bloco" aria-labelledby="h-situacao">
        <h2 id="h-situacao">Situação</h2>
        <p>Empresa encerrada.</p>
      </section>
    );
  }
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
  const nome = empresa.nome;
  return (
    <section className="bloco" aria-labelledby="h-situacao">
      <h2 id="h-situacao">Situação</h2>
      <button className="mx-botao-secundario" type="button" disabled={pendente} onClick={() => setAberto(true)}>{suspender ? 'Suspender empresa' : 'Reativar empresa'}</button>
      <ResultadoAcao resultado={resultado} chave={chaveResultado} />
      {aberto && (
        <DialogoMotivo
          titulo={`${suspender ? 'Suspender' : 'Reativar'} ${nome}?`}
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
    </section>
  );
}
