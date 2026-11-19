import { useEffect, useMemo, useState } from 'react';
import { Alert, Empty, Input, Segmented, Skeleton } from 'antd';
import { ArrowRightOutlined, SearchOutlined, ExportOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  carregarSnapshot,
  normalizar,
  type Candidato,
  type Edicao,
  type Snapshot,
} from './lib/dados';
import './App.css';

const MIN_LETRAS = 3;
const LIMITE_EXIBICAO = 60;

const OPCOES_EDICAO = [
  { label: 'Todas', value: 'todas' },
  { label: 'PISM', value: 'pism-2026' },
  { label: 'SiSU', value: 'sisu-2026' },
  { label: 'SiSU Mais', value: 'sisu-mais-2026' },
];

const fmtPontos = (valor: number) =>
  valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtData = (iso: string | null) => (iso ? dayjs(iso).format('DD/MM/YYYY') : null);

const plural = (n: number, singular: string, plural_: string) =>
  `${n.toLocaleString('pt-BR')} ${n === 1 ? singular : plural_}`;

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [consulta, setConsulta] = useState('');
  const [edicao, setEdicao] = useState('todas');

  useEffect(() => {
    let vivo = true;
    carregarSnapshot()
      .then((dados) => {
        if (vivo) setSnapshot(dados);
      })
      .catch((e: unknown) => {
        if (vivo) setErro(e instanceof Error ? e.message : 'Não foi possível carregar os dados.');
      });
    return () => {
      vivo = false;
    };
  }, []);

  /** Índice com o nome já normalizado — calculado uma vez por carga. */
  const indice = useMemo(
    () => (snapshot ? snapshot.candidatos.map((c) => ({ c, nome: normalizar(c.n) })) : []),
    [snapshot],
  );

  const edicoes = useMemo(
    () => new Map<string, Edicao>((snapshot?.edicoes ?? []).map((e) => [e.id, e])),
    [snapshot],
  );

  const termo = normalizar(consulta);
  const buscou = termo.length >= MIN_LETRAS;
  const tokens = useMemo(() => (buscou ? termo.split(' ') : []), [buscou, termo]);

  const resultados = useMemo(() => {
    if (!buscou) return [];

    const achados = indice
      .filter(
        ({ c, nome }) =>
          (edicao === 'todas' || c.e === edicao) && tokens.every((t) => nome.includes(t)),
      )
      .map(({ c }) => c);

    const ordemEdicao = new Map((snapshot?.edicoes ?? []).map((e, i) => [e.id, i]));

    return achados.sort(
      (a, b) =>
        (ordemEdicao.get(a.e) ?? 0) - (ordemEdicao.get(b.e) ?? 0) ||
        b.cv - a.cv ||
        a.c.localeCompare(b.c, 'pt-BR') ||
        a.g.localeCompare(b.g, 'pt-BR') ||
        (a.cl ?? 0) - (b.cl ?? 0),
    );
  }, [buscou, edicao, indice, snapshot, tokens]);

  const visiveis = resultados.slice(0, LIMITE_EXIBICAO);

  /** Agrupa o que será exibido por edição, preservando a ordenação. */
  const grupos = useMemo(() => {
    const mapa = new Map<string, Candidato[]>();
    for (const candidato of visiveis) {
      const lista = mapa.get(candidato.e);
      if (lista) lista.push(candidato);
      else mapa.set(candidato.e, [candidato]);
    }
    return [...mapa.entries()];
  }, [visiveis]);

  return (
    <div className="pagina">
      <header className="topo">
        <div className="marca">
          <span className="marca-selo">UFJF</span>
          <span className="marca-texto">
            <strong>Consulta de candidatos</strong>
            <small>CDARA · listas de espera</small>
          </span>
        </div>
        <a
          className="link-fonte"
          href={snapshot?.fonte ?? 'https://www2.ufjf.br/cdara/graduacao/matricula-graduacao/'}
          target="_blank"
          rel="noreferrer"
        >
          Fonte oficial <ArrowRightOutlined />
        </a>
      </header>

      <main className="conteudo">
        <section className="abertura">
          <p className="olho">Consulta das listas de espera</p>
          <p className="ano-destaque">Ano de ingresso <strong>2026</strong></p>
          <h1>
            Onde você está
            <br />
            na lista?
          </h1>
          <p className="sub">
            Digite seu nome para consultar sua classificação e situação nas listas de espera da
            UFJF para os processos seletivos de <strong>2026</strong>.
          </p>

          <Input
            className="campo"
            size="large"
            prefix={<SearchOutlined className="campo-icone" />}
            placeholder="Digite seu nome completo"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            allowClear
            autoFocus
            aria-label="Nome do candidato"
          />

          <div className="filtros">
            <Segmented
              options={OPCOES_EDICAO}
              value={edicao}
              onChange={(valor) => setEdicao(String(valor))}
            />
            {snapshot && (
              <span className="contagem-base">{plural(snapshot.total, 'registro', 'registros')}</span>
            )}
          </div>
        </section>

        <section className="painel" aria-live="polite">
          {erro && (
            <Alert
              type="error"
              showIcon
              message="Não foi possível carregar a base"
              description={erro}
            />
          )}

          {!snapshot && !erro && (
            <div className="carregando">
              <Skeleton active paragraph={{ rows: 4 }} title={false} />
              <Skeleton active paragraph={{ rows: 4 }} title={false} />
            </div>
          )}

          {snapshot && !buscou && (
            <div className="convite">
              <p>
                A busca cobre <strong>{plural(snapshot.total, 'registro', 'registros')}</strong> das
                edições PISM 2026, SiSU 2026 e SiSU Mais 2026.
              </p>
              <p>
                Digite ao menos {MIN_LETRAS} letras do nome. Acentos não importam: <em>jose</em>{' '}
                encontra <em>José</em>.
              </p>
            </div>
          )}

          {snapshot && buscou && resultados.length === 0 && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span>
                  Nenhum candidato encontrado para <strong>“{consulta.trim()}”</strong>.
                  <br />
                  Confira a grafia ou tente apenas parte do nome.
                </span>
              }
            />
          )}

          {resultados.length > 0 && (
            <>
              <div className="resumo">
                <span>
                  <strong>{plural(resultados.length, 'registro', 'registros')} em 2026</strong> para{' '}
                  <strong>“{consulta.trim()}”</strong>
                </span>
                {resultados.length > LIMITE_EXIBICAO && (
                  <span className="resumo-aviso">
                    exibindo os primeiros {LIMITE_EXIBICAO} — refine a busca
                  </span>
                )}
              </div>

              {grupos.map(([id, lista]) => {
                const info = edicoes.get(id);
                return (
                  <section className="grupo" key={id}>
                    <header className="grupo-topo">
                      <h2>{info?.rotulo ?? id}</h2>
                      <span className="grupo-contagem">
                        {plural(lista.length, 'registro', 'registros')}
                      </span>
                      {info && (
                        <a href={info.listaUrl} target="_blank" rel="noreferrer">
                          lista oficial ↗
                        </a>
                      )}
                    </header>

                    <div className="itens">
                      {lista.map((c) => {
                        const data = fmtData(c.sd);
                        const emEspera = c.s?.trim().toUpperCase() === 'EM ESPERA' || (!c.s && !c.cv);
                        const situacao = c.cv ? 'Convocado' : emEspera ? 'Em espera' : c.s || 'Situação não informada';
                        const fonte = c.url || info?.listaUrl;
                        return (
                          <a className="item" href={fonte} target="_blank" rel="noreferrer"
                            key={`${c.e}|${c.c}|${c.t}|${c.ca}|${c.g}|${c.cl}|${c.n}`}>
                            <div className="item-lado">
                              <span className={`situacao ${c.cv ? 'situacao-convocado' : emEspera ? 'situacao-espera' : 'situacao-outra'}`}>
                                {situacao}
                              </span>
                              {c.cv && data && <span className="item-data">Edital de {data}</span>}
                            </div>
                            <div className="item-corpo">
                              <h3 className="item-nome">{c.n}</h3>
                              <p className="item-edicao">{info?.rotulo ?? id}</p>
                              <p className="item-curso">
                                {c.c} <span>·</span> {c.t} <span>·</span> {c.ca}
                              </p>
                              <div className="item-meta">
                                <span>{c.g}</span>
                                {c.cl != null && <span>{c.cl}º na lista</span>}
                                {c.p != null && <span>{fmtPontos(c.p)} pontos</span>}
                              </div>
                            </div>
                            <div className="item-fonte">
                              {c.url ? 'Consultar esta lista na fonte oficial' : 'Consultar a lista oficial da edição'} <ExportOutlined />
                              <span className="sr-only"> (abre em nova aba)</span>
                            </div>
                          </a>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </>
          )}
        </section>
      </main>

      <footer className="rodape">
        <p>
          Dados públicos extraídos de{' '}
          <a href="https://www2.ufjf.br/cdara/" target="_blank" rel="noreferrer">
            www2.ufjf.br/cdara
          </a>
          {snapshot && <> em {dayjs(snapshot.geradoEm).format('DD/MM/YYYY [às] HH:mm')}</>}.
        </p>
        <p>
          Consulta apenas informativa — nenhum CPF é exibido. A pré-matrícula é feita no SIGA.
        </p>
      </footer>
    </div>
  );
}

export default App;
