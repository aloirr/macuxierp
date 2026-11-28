'use client';
import type { CampoContato, FichaReceitaPlanaMascarada } from '@macuxierp/core/contracts';
import { RegiaoErros, ResultadoAcao, useResultado } from '@macuxierp/ui';
import { useRouter } from 'next/navigation';
import { Fragment, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RevelarMascarado } from '@/components/revelar-mascarado';
import { ChavesIdempotencia } from '@/lib/config/chaves';
import { resultadoErro, resultadoSucesso } from '@/lib/resultado-acao';
import { ERRO_CAMPOS } from '@/lib/textos';
import { TEXTO_FICHA_VAZIA, estadoDaFicha, origemDaConsulta, textoCnae, textosCnaeSecundarios } from '@/lib/config/ficha';
import {
  GRUPOS_FICHA, OPCOES_REGIME, camposMudados, formComPrevia, formDaFicha, textoPrevia, textoSalvo, validarFicha,
  type CampoFicha, type DefCampo, type FormFicha,
} from '@/lib/config/ficha-edicao';
import { previaReceitaAcao, revelarContatoAcao, salvarFichaAcao } from '@/lib/acoes-cliente';

interface Props {
  empresaId: string;
  ficha: FichaReceitaPlanaMascarada | null;
  /** Razão social da empresa: vale enquanto a ficha não a traz. */
  razaoEmpresa: string | null;
  /** "Manaus/AM" (cadastro ou ficha), sob o código IBGE; nulo, nada. */
  lugar?: string | null;
  fuso: string;
  /** Empresa encerrada não edita nem consulta a Receita. */
  editavel: boolean;
  /** O CNPJ (com a troca ou o motivo do bloqueio), no topo do cartão Identificação. */
  cnpj?: ReactNode;
  /** Rodapé da página (regra 12, RD-2370): quando existe, Salvar, Descartar, Atualizar, Trocar CNPJ e o estado vão para ele; sem ele ficam no rodapé do cartão. */
  rodapeAlvo?: HTMLElement | null;
  /** "Trocar CNPJ" (RD-2370): entra na barra da ficha, depois do Atualizar. */
  acaoCnpj?: ReactNode;
  /** Bloco que divide a grade da Ficha com os cartões (os Módulos, ao lado de Atividades e Contato). */
  lateral?: ReactNode;
}

type Erros = Partial<Record<CampoFicha, string>>;
type Origem = { tipo: 'manual' } | { tipo: 'receita'; consultadoEm: string };

/** E-mail e telefone: o salvo só aparece mascarado (com o "Mostrar"); o campo vazio mantém o salvo (RD-2373: sem placeholder que explique). */
function SalvoMascarado({ empresaId, campo, mascarado }: { empresaId: string; campo: CampoContato; mascarado: string }) {
  return (
    <span className="dica-campo dica-salvo">
      Salvo: <RevelarMascarado rotulo={campo === 'email' ? 'e-mail' : 'telefone'} mascarado={mascarado} revelar={() => revelarContatoAcao(empresaId, campo).then((r) => (r.ok ? { ok: true as const, valor: r.valor.valor } : r))} />
    </span>
  );
}

function Campo({ def, valor, erro, daReceita, desabilitado, aoMudar, extra }: { def: DefCampo; valor: string; erro?: string; daReceita: boolean; desabilitado: boolean; aoMudar: (v: string) => void; extra?: ReactNode }) {
  const id = `ficha-${def.campo}`;
  const comum = { id, name: def.campo, value: valor, disabled: desabilitado, 'aria-invalid': erro ? true : undefined, 'aria-describedby': erro ? `${id}-erro` : undefined } as const;
  return (
    <div className={`campo${def.curto ? ' campo-curto' : ''}${def.medio ? ' campo-medio' : ''}${def.largo ? ' campo-largo' : ''}${daReceita ? ' veio-da-receita' : ''}`}>
      <label htmlFor={id} className="rotulo-campo">{def.rotulo}</label>
      {def.tipo === 'regime' ? (
        <select {...comum} onChange={(e) => aoMudar(e.target.value)}>
          {OPCOES_REGIME.map((o) => (
            <option key={o.valor} value={o.valor}>{o.rotulo}</option>
          ))}
        </select>
      ) : def.tipo === 'lista' ? (
        <textarea {...comum} rows={3} onChange={(e) => aoMudar(e.target.value)} />
      ) : (
        <input
          {...comum}
          type={def.tipo === 'email' ? 'email' : def.tipo === 'telefone' ? 'tel' : 'text'}
          inputMode={def.tipo === 'data' ? 'numeric' : undefined}
          maxLength={def.tipo === 'data' ? 10 : def.max}
          placeholder={def.tipo === 'data' ? 'dd/mm/aaaa' : undefined}
          autoComplete="off"
          onChange={(e) => aoMudar(e.target.value)}
        />
      )}
      {daReceita && <span className="marca-receita">Veio da Receita</span>}
      {extra ?? (!erro && def.dica && <span className="dica-campo">{def.dica}</span>)}
      {erro && <span id={`${id}-erro`} className="erro-campo">{erro}</span>}
    </div>
  );
}

/**
 * Ficha da Receita editável (T-0101; v0.3.24, RN-CORE-16), bloco largo da aba Empresa. "Atualizar" (pela Receita) só preenche o
 * formulário; "Salvar", na barra do rodapé, grava com auditoria (só nomes de campo). Só o superadmin chega aqui (todo o
 * /config é dele). A API revalida tudo.
 */
export function FichaReceita({ empresaId, ficha, razaoEmpresa, lugar = null, fuso, editavel, cnpj, rodapeAlvo = null, acaoCnpj = null, lateral = null }: Props) {
  const router = useRouter();
  const idForm = useId();
  const [salvo, setSalvo] = useState<FormFicha>(() => formDaFicha(ficha, razaoEmpresa));
  const [form, setForm] = useState<FormFicha>(salvo);
  const [origem, setOrigem] = useState<Origem>({ tipo: 'manual' });
  const [daReceita, setDaReceita] = useState<Set<CampoFicha>>(new Set());
  /** De onde vêm as descrições dos CNAE: a ficha salva ou a prévia da Receita. */
  const [descrita, setDescrita] = useState<FichaReceitaPlanaMascarada | null>(ficha);
  const [erros, setErros] = useState<Erros>({});
  const [acao, setAcao] = useState<'previa' | 'salvar' | null>(null);
  const [pendente, iniciar] = useTransition();
  // 36 A: um retorno por botão, logo abaixo dele
  const [rPrevia, kPrevia, mostrarPrevia, limparPrevia] = useResultado();
  const [rSalvar, kSalvar, mostrarSalvar, limparSalvar] = useResultado();
  const chaves = useRef(new ChavesIdempotencia());
  const consulta = ficha ? origemDaConsulta(ficha, fuso) : null;
  const estado = estadoDaFicha(ficha);
  const mudados = camposMudados(salvo, form);
  const bloqueado = pendente || !editavel;

  const mudar = (c: CampoFicha, v: string) => {
    setForm((f) => ({ ...f, [c]: v }));
    setOrigem({ tipo: 'manual' });
    setDaReceita((s) => (s.has(c) ? new Set([...s].filter((x) => x !== c)) : s));
    if (erros[c])
      setErros((e) => {
        const n = { ...e };
        delete n[c];
        return n;
      });
  };

  const atualizar = () =>
    iniciar(async () => {
      setAcao('previa');
      limparSalvar();
      const r = await previaReceitaAcao(empresaId, chaves.current.de('receita'));
      chaves.current.aposResposta('receita', r);
      if (r.ok) {
        const novo = formComPrevia(form, r.valor.previa);
        setForm(novo);
        setDaReceita(new Set(camposMudados(form, novo)));
        setDescrita(r.valor.previa);
        setOrigem({ tipo: 'receita', consultadoEm: r.valor.consultado_em });
        setErros({});
        mostrarPrevia(resultadoSucesso(textoPrevia(r.valor.diferentes)));
      } else mostrarPrevia(resultadoErro(r.erro));
      setAcao(null);
    });

  const salvar = () => {
    const consultadoEm = origem.tipo === 'receita' ? origem.consultadoEm : undefined;
    limparPrevia();
    const v = validarFicha(form, origem.tipo, consultadoEm);
    if (!v.ok) {
      setErros(v.campos);
      mostrarSalvar(resultadoErro(ERRO_CAMPOS));
      return;
    }
    iniciar(async () => {
      setAcao('salvar');
      const r = await salvarFichaAcao(empresaId, form, origem.tipo, consultadoEm, chaves.current.de('salvar'));
      chaves.current.aposResposta('salvar', r);
      if (r.ok) {
        const limpo = { ...form, email: '', telefone: '' };
        setSalvo(limpo);
        setForm(limpo);
        setDaReceita(new Set());
        setOrigem({ tipo: 'manual' });
        setErros({});
        mostrarSalvar(resultadoSucesso(textoSalvo(r.valor.campos_alterados)));
        router.refresh();
      } else {
        setErros(r.campos as Erros);
        mostrarSalvar(resultadoErro(r.erro || ERRO_CAMPOS));
      }
      setAcao(null);
    });
  };

  const descartar = () => {
    setForm(salvo);
    setDescrita(ficha);
    setDaReceita(new Set());
    setOrigem({ tipo: 'manual' });
    setErros({});
    limparPrevia();
    limparSalvar();
  };

  /** A descrição oficial do CNAE (CNAE 2.3) aparece enquanto o código é o que veio da ficha ou da prévia. */
  const descricaoCnae = (c: CampoFicha): ReactNode => {
    if (!descrita) return undefined;
    if (c === 'cnae_principal' && descrita.cnae_principal && descrita.cnae_principal_descricao && form.cnae_principal.trim() === descrita.cnae_principal)
      return <span className="dica-campo">{textoCnae(descrita.cnae_principal, descrita.cnae_principal_descricao)}</span>;
    const secundarios = c === 'cnae_secundarios' && form.cnae_secundarios.trim() === (descrita.cnae_secundarios ?? []).join('\n') ? textosCnaeSecundarios(descrita) : [];
    if (secundarios.length === 0) return undefined;
    return (
      <ul className="dica-campo lista-cnae" aria-label="CNAE secundários com a descrição">
        {secundarios.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    );
  };
  const extra = (c: CampoFicha): ReactNode => {
    if (c === 'email' || c === 'telefone') {
      const mascarado = c === 'email' ? ficha?.email_mascarado : ficha?.telefone_mascarado;
      return mascarado ? <SalvoMascarado empresaId={empresaId} campo={c} mascarado={mascarado} /> : undefined;
    }
    if (c === 'municipio_ibge' && lugar) return <span className="dica-campo">{lugar}</span>;
    return descricaoCnae(c);
  };

  const barra = (
    <>
      <button className={mudados.length > 0 ? 'mx-botao' : 'mx-botao-secundario'} type="submit" form={idForm} disabled={bloqueado || mudados.length === 0}>
        {acao === 'salvar' ? 'Salvando…' : 'Salvar'}
      </button>
      {mudados.length > 0 && (
        <button className="mx-botao-secundario" type="button" disabled={bloqueado} onClick={descartar}>Descartar</button>
      )}
      <button className="mx-botao-secundario" type="button" disabled={bloqueado} onClick={atualizar}>
        {acao === 'previa' ? 'Consultando a Receita…' : 'Atualizar'}
      </button>
      {acaoCnpj}
      <span className="rodape-estado apoio" role="status">
        {mudados.length === 0 ? 'Nenhuma alteração pendente' : mudados.length === 1 ? '1 campo alterado' : `${mudados.length} campos alterados`}
      </span>
    </>
  );

  return (
    <section className="bloco bloco-largo ficha-editavel" aria-labelledby="h-ficha">
      <RegiaoErros temErro={Object.keys(erros).length > 0} />
      <div className="cabecalho-ficha">
        <h2 id="h-ficha">Ficha da Receita</h2>
        <p className="apoio">{consulta ?? (estado === 'com_dados' ? '' : TEXTO_FICHA_VAZIA[estado])}</p>
      </div>
      <ResultadoAcao resultado={rPrevia} chave={kPrevia} />
      <form
        id={idForm}
        noValidate
        aria-labelledby="h-ficha"
        onSubmit={(e) => {
          e.preventDefault();
          if (mudados.length > 0) salvar();
        }}
      >
        <div className="formulario">
          {GRUPOS_FICHA.map((g) => (
            <Fragment key={g.id}>
              <fieldset className={`formulario cartao-ficha cartao-${g.colunas}`} aria-labelledby={`h-ficha-${g.id}`}>
                <h3 id={`h-ficha-${g.id}`} className="titulo-cartao">{g.titulo}</h3>
                {g.campos.map((d) => (
                  <Fragment key={d.campo}>
                    <Campo def={d} valor={form[d.campo]} erro={erros[d.campo]} daReceita={daReceita.has(d.campo)} desabilitado={bloqueado} aoMudar={(v) => mudar(d.campo, v)} extra={extra(d.campo)} />
                    {/* o CNPJ logo depois do nome fantasia, na mesma linha (simulação aprovada) */}
                    {d.campo === 'nome_fantasia' && cnpj}
                  </Fragment>
                ))}
              </fieldset>
              {/* os Módulos ficam ao lado de Atividades e Contato, na mesma linha da grade */}
              {g.id === 'contato' && lateral}
            </Fragment>
          ))}
        </div>
        {rodapeAlvo ? createPortal(barra, rodapeAlvo) : <div className="barra-acoes rodape-cartao">{barra}</div>}
        <ResultadoAcao resultado={rSalvar} chave={kSalvar} />
      </form>
    </section>
  );
}
