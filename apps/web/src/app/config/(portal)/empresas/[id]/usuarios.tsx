'use client';
import { type AcaoUsuario, type UsuarioConfig } from '@macuxierp/core/contracts';
import { AVISO_USUARIO } from '@/lib/usuarios-textos';
import { PERFIS } from '@macuxierp/platform-sdk';
import { Chip, Dialogo, DialogoMotivo, MenuAcoes, ResultadoAcao, TabelaDensa, useResultado, type ColunaTabela } from '@macuxierp/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { criarUsuarioAcao, editarUsuarioAcao, excluirUsuarioAcao, inativarUsuarioAcao, reativarUsuarioAcao, redefinirSenhaUsuarioAcao } from '@/lib/acoes-cliente';
import { ChavesIdempotencia } from '@/lib/config/chaves';
import { etiquetaUltimoAdmin, filtrarUsuarios, itensDoMenuUsuario, rotuloPerfil, seloDoUsuario, textoUltimoAcesso } from '@/lib/config/usuarios';
import { resultadoErro, resultadoSucesso } from '@/lib/resultado-acao';

/**
 * Bloco Usuários da aba Empresa (v0.3.29, Config v4, MC-0212; RN-CORE-01 e RN-CORE-17). A tela não recalcula regra: o "Ações ▾" de
 * cada linha é `acoes[]` da API (Excluir por último, em vermelho) e a etiqueta "último administrador" vem de `ultimo_admin_ativo`.
 * Depois de cada ação a lista é relida no servidor (`router.refresh`), porque uma ação muda as `acoes` das outras linhas. A senha
 * provisória fica só no estado deste componente, é mostrada uma vez e some ao fechar: nunca em URL, armazenamento ou log.
 */
type Formulario = { tipo: 'criar' } | { tipo: 'editar'; usuario: UsuarioConfig };
type Confirmacao = { acao: Exclude<AcaoUsuario, 'editar'>; usuario: UsuarioConfig };
type SenhaMostrada = { nome: string; senha: string };

const TEXTOS_CONFIRMACAO: Readonly<Record<Confirmacao['acao'], { titulo: (n: string) => string; aviso: string; botao: string; fechar: string; sucesso?: string; destrutivo?: boolean }>> = {
  redefinir_senha: { titulo: (n) => `Redefinir a senha de ${n}?`, aviso: 'A senha atual deixa de valer.', botao: 'Redefinir senha', fechar: 'Cancelar' },
  inativar: { titulo: (n) => `Inativar ${n}?`, aviso: AVISO_USUARIO.inativar, botao: 'Inativar', fechar: 'Cancelar', sucesso: 'Usuário inativado.' },
  reativar: { titulo: (n) => `Reativar ${n}?`, aviso: AVISO_USUARIO.reativar, botao: 'Reativar', fechar: 'Cancelar', sucesso: 'Usuário reativado.' },
  excluir: { titulo: (n) => `Excluir ${n}?`, aviso: AVISO_USUARIO.excluir, botao: 'Excluir', fechar: 'Manter usuário', sucesso: 'Usuário excluído.', destrutivo: true },
};

export function BlocoUsuarios({ empresaId, itens, fuso, editavel = true }: { empresaId: string; itens: UsuarioConfig[] | null; fuso: string; editavel?: boolean }) {
  const router = useRouter();
  const [busca, setBusca] = useState('');
  const [formulario, setFormulario] = useState<Formulario | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [senha, setSenha] = useState<SenhaMostrada | null>(null);
  const [resultado, chaveResultado, mostrar, limpar] = useResultado();
  const [pendente, iniciar] = useTransition();
  const chaves = useRef(new ChavesIdempotencia());

  if (itens === null) {
    return (
      <section className="bloco bloco-usuarios" aria-labelledby="h-usuarios">
        <h2 id="h-usuarios">Usuários</h2>
        <p className="erro" role="alert">Não foi possível carregar os usuários.</p>
        <div className="barra-acoes"><button className="mx-botao-secundario" type="button" onClick={() => router.refresh()}>Recarregar</button></div>
      </section>
    );
  }

  const visiveis = filtrarUsuarios(itens, busca);
  const semAdmin = !itens.some((u) => u.perfil === 'administrador' && u.situacao !== 'inativo');

  const terminar = (sucesso: string) => {
    mostrar(resultadoSucesso(sucesso));
    router.refresh();
  };
  const falhou = (erro: string) => mostrar(resultadoErro(erro || 'Não foi possível concluir. Tente de novo.'));

  const executar = (c: Confirmacao) => {
    setConfirmacao(null);
    limpar();
    iniciar(async () => {
      const texto = TEXTOS_CONFIRMACAO[c.acao];
      if (c.acao === 'redefinir_senha') {
        const id = `senha:${c.usuario.id}`;
        const r = await redefinirSenhaUsuarioAcao(empresaId, c.usuario.id, chaves.current.de(id));
        chaves.current.aposResposta(id, r);
        if (!r.ok) return falhou(r.erro);
        // o diálogo da senha já diz que deu certo: sem o retorno "Senha redefinida." por baixo
        setSenha({ nome: r.valor.usuario.nome, senha: r.valor.senha_provisoria });
        return router.refresh();
      }
      const r = await (c.acao === 'inativar' ? inativarUsuarioAcao : c.acao === 'reativar' ? reativarUsuarioAcao : excluirUsuarioAcao)(empresaId, c.usuario.id);
      if (!r.ok) return falhou(r.erro);
      terminar(texto.sucesso ?? '');
    });
  };

  const colunas: ColunaTabela<UsuarioConfig>[] = [
    { id: 'nome', titulo: 'Nome', celula: (u) => <strong>{u.nome}</strong> },
    { id: 'email', titulo: 'E-mail', celula: (u) => u.email_mascarado },
    {
      id: 'perfil',
      titulo: 'Perfil',
      celula: (u) => (
        <>
          {rotuloPerfil(u.perfil)}
          {etiquetaUltimoAdmin(u) && <span className="etiqueta-ultimo-admin">{etiquetaUltimoAdmin(u)}</span>}
        </>
      ),
    },
    { id: 'situacao', titulo: 'Situação', tipo: 'status', celula: (u) => { const s = seloDoUsuario(u); return <Chip tom={s.tom}>{s.texto}</Chip>; } },
    { id: 'ultimo', titulo: 'Último acesso', tipo: 'data', celula: (u) => textoUltimoAcesso(u, fuso) },
    {
      id: 'acoes',
      titulo: '', // o botão da linha já diz "Ações de <nome>" ao leitor de tela
      celula: (u) => <MenuDoUsuario usuario={u} desabilitado={pendente || !editavel} aoAcionar={(chave) => (chave === 'editar' ? setFormulario({ tipo: 'editar', usuario: u }) : setConfirmacao({ acao: chave, usuario: u }))} />,
    },
  ];

  return (
    <section className="bloco bloco-largo bloco-usuarios" aria-labelledby="h-usuarios">
      <div className="cabecalho-bloco">
        <h2 id="h-usuarios">Usuários <span className="contagem">· {itens.length}</span></h2>
        <input type="search" className="busca-usuarios" aria-label="Buscar nome ou e-mail" placeholder="Buscar nome ou e-mail" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      <div className="tabela-rolavel com-sinal-rolagem legenda-so-leitor">
        <TabelaDensa colunas={colunas} linhas={visiveis} chaveLinha={(u) => u.id} textoVazio={itens.length === 0 ? 'Nenhum usuário. Adicione o primeiro administrador.' : 'Nenhum usuário encontrado.'} legenda="Usuários da empresa" />
      </div>
      <div className="barra-acoes">
        <button className="mx-botao-secundario" type="button" disabled={pendente || !editavel} onClick={() => { limpar(); setFormulario({ tipo: 'criar' }); }}>Adicionar usuário</button>
      </div>
      <ResultadoAcao resultado={resultado} chave={chaveResultado} />
      {formulario && (
        <FormularioUsuario
          empresaId={empresaId}
          formulario={formulario}
          primeiro={semAdmin && formulario.tipo === 'criar'}
          chaves={chaves.current}
          aoFechar={() => setFormulario(null)}
          aoSalvar={(sucesso, nova) => {
            setFormulario(null);
            if (nova) setSenha(nova);
            terminar(sucesso);
          }}
        />
      )}
      {confirmacao && (
        <DialogoMotivo
          titulo={TEXTOS_CONFIRMACAO[confirmacao.acao].titulo(confirmacao.usuario.nome)}
          aviso={TEXTOS_CONFIRMACAO[confirmacao.acao].aviso}
          semTexto
          rotuloConfirmar={TEXTOS_CONFIRMACAO[confirmacao.acao].botao}
          rotuloFechar={TEXTOS_CONFIRMACAO[confirmacao.acao].fechar}
          destrutivo={Boolean(TEXTOS_CONFIRMACAO[confirmacao.acao].destrutivo)}
          aoConfirmar={() => executar(confirmacao)}
          aoCancelar={() => setConfirmacao(null)}
        />
      )}
      {senha && <DialogoSenha nome={senha.nome} senha={senha.senha} aoFechar={() => setSenha(null)} />}
    </section>
  );
}

/** "Ações ▾" da linha: exatamente `acoes[]` da API, na ordem dela; só o Excluir vai depois do separador, em vermelho. Sem ações, nada. */
export function MenuDoUsuario({ usuario, desabilitado = false, aoAcionar, abertoInicial = false }: { usuario: UsuarioConfig; desabilitado?: boolean; aoAcionar: (acao: AcaoUsuario) => void; abertoInicial?: boolean }) {
  const acoes = itensDoMenuUsuario(usuario).map((i) => ({ chave: i.chave, rotulo: i.rotulo, perigo: i.perigo, desabilitado, aoAcionar: () => aoAcionar(i.chave) }));
  return acoes.length > 0 ? <MenuAcoes rotuloLinha={usuario.nome} acoes={acoes} abertoInicial={abertoInicial} /> : null;
}

/** Senha provisória: aparece uma vez e some ao fechar. Sem armazenamento, sem URL, sem log. */
export function DialogoSenha({ nome, senha, aoFechar }: { nome: string; senha: string; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(senha);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };
  return (
    <Dialogo
      titulo="Senha provisória"
      aoFechar={aoFechar}
      aviso="Esta senha não volta a aparecer. Entregue à pessoa por canal seguro."
      rodape={
        <div className="barra-acoes">
          <button className="mx-botao-secundario" type="button" onClick={copiar}>Copiar</button>
          <button className="mx-botao" type="button" onClick={aoFechar}>Já entreguei</button>
        </div>
      }
    >
      <p>Usuário: <strong>{nome}</strong></p>
      <code className="senha-provisoria" data-testid="senha-provisoria">{senha}</code>
      <p role="status" className="apoio">{copiado ? 'Copiado' : ''}</p>
    </Dialogo>
  );
}

function FormularioUsuario({ empresaId, formulario, primeiro, chaves, aoFechar, aoSalvar }: {
  empresaId: string;
  formulario: Formulario;
  primeiro: boolean;
  chaves: ChavesIdempotencia;
  aoFechar: () => void;
  aoSalvar: (sucesso: string, senha?: SenhaMostrada) => void;
}) {
  const edicao = formulario.tipo === 'editar' ? formulario.usuario : null;
  const [nome, setNome] = useState(edicao?.nome ?? '');
  const [email, setEmail] = useState('');
  const [perfil, setPerfil] = useState<string>(edicao?.perfil ?? (primeiro ? 'administrador' : 'leitura'));
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [erro, setErro] = useState('');
  const [pendente, iniciar] = useTransition();

  const enviar = () =>
    iniciar(async () => {
      setErro('');
      setCampos({});
      if (edicao) {
        const mudou = { ...(nome.trim() !== edicao.nome ? { nome } : {}), ...(perfil !== edicao.perfil ? { perfil } : {}) };
        if (Object.keys(mudou).length === 0) return setErro('Nada foi alterado.');
        const r = await editarUsuarioAcao(empresaId, edicao.id, mudou);
        if (r.ok) return aoSalvar('Usuário salvo.');
        setCampos(r.campos);
        return setErro(r.erro);
      }
      const r = await criarUsuarioAcao(empresaId, { nome, email, perfil }, chaves.de('criar'));
      chaves.aposResposta('criar', r);
      if (r.ok) return aoSalvar('Usuário criado.', { nome: r.valor.usuario.nome, senha: r.valor.senha_provisoria });
      setCampos(r.campos);
      setErro(r.erro);
    });

  return (
    <Dialogo
      titulo={edicao ? `Editar ${edicao.nome}` : 'Adicionar usuário'}
      aoFechar={aoFechar}
      rodape={
        <div className="barra-acoes">
          <button className="mx-botao" type="submit" form="form-usuario" disabled={pendente}>{pendente ? 'Salvando…' : edicao ? 'Salvar' : 'Criar'}</button>
          <button className="mx-botao-secundario" type="button" onClick={aoFechar}>Cancelar</button>
        </div>
      }
    >
      <form id="form-usuario" className="formulario" noValidate onSubmit={(e) => { e.preventDefault(); enviar(); }}>
        <label className="campo">
          <span>Nome</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} autoComplete="off" aria-invalid={campos.nome ? true : undefined} />
          {campos.nome && <span className="erro-campo">{campos.nome}</span>}
        </label>
        {!edicao && (
          <label className="campo">
            <span>E-mail</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" aria-invalid={campos.email ? true : undefined} />
            {campos.email && <span className="erro-campo">{campos.email}</span>}
          </label>
        )}
        <label className="campo">
          <span>Perfil</span>
          <select value={perfil} onChange={(e) => setPerfil(e.target.value)} aria-invalid={campos.perfil ? true : undefined}>
            {PERFIS.map((p) => <option key={p} value={p}>{rotuloPerfil(p)}</option>)}
          </select>
          {campos.perfil && <span className="erro-campo">{campos.perfil}</span>}
        </label>
        {/* o texto que já está sob o campo (ex.: e-mail em uso, ADR 0021) não se repete na caixa */}
        {erro && !Object.values(campos).includes(erro) && <p className="erro" role="alert">{erro}</p>}
      </form>
    </Dialogo>
  );
}
