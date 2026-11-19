# Portal de Matrícula CDARA/UFJF

Recriação da área de matrícula da CDARA (`www2.ufjf.br/cdara/graduacao/matricula-graduacao/`)
com foco na **convocação de candidatos**, usando **React + Ant Design**.

Projeto com **protótipo funcional** da consulta por nome.

## Protótipo

Página minimalista de consulta: o candidato digita o nome e vê a classificação e a situação
nas listas de espera de **PISM 2026**, **SiSU 2026** e **SiSU Mais 2026**.

```bash
npm ci --prefix web # instala as dependências
npm run dados   # extrai as listas do CDARA (~75 s) e gera o snapshot do front
npm run dev     # http://localhost:5173
npm run build   # build de produção em web/dist
```

| Caminho | Conteúdo |
|---|---|
| `scripts/scrape-cdara.mjs` | extrator das listas de espera (773 requisições, concorrência 6) |
| `scripts/preparar-dados.mjs` | gera a versão do snapshot consumida pelo front (sem CPF) |
| `data/candidatos.json` | snapshot bruto (32.826 registros, ~13 MB) |
| `web/` | React 19 + Vite + Ant Design 6 |
| `web/public/data/candidatos.json.gz` | snapshot público compactado, incluindo os links às listas oficiais |

O front **não consulta a UFJF em tempo de busca**: ele carrega o snapshot e filtra em
memória (busca sem acentos, por tokens do nome). A atualização dos dados é um job.
Os snapshots não são versionados por conterem dados pessoais: execute `npm run dados`
após clonar o repositório para gerar os arquivos locais.

## Publicação no GitHub Pages

1. Envie o repositório ao GitHub e, em **Settings → Pages → Build and deployment**,
   selecione **GitHub Actions** como fonte. Para repositórios privados, confira a
   disponibilidade do Pages no plano da organização.
2. O workflow `.github/workflows/pages.yml` é executado em pushes para `main` ou
   `master`, diariamente às **09:00 UTC** (06:00 no horário de Brasília, UTC-3),
   ou manualmente em **Actions → Publicar no GitHub Pages → Run workflow**.
   Ele instala as dependências, extrai as listas, gera o arquivo gzip e publica o build.
   O rodapé mostra o horário de conclusão da extração publicada, no fuso de Brasília.
   O agendamento usa a branch padrão do repositório e pode sofrer atrasos no GitHub;
   em repositórios públicos, o GitHub pode desativá-lo após 60 dias sem atividade.
3. A URL típica é `https://<usuario>.github.io/<repositorio>/`. Para repositórios
   `<usuario>.github.io`, o site fica na raiz. O caminho dos assets é configurado
   automaticamente pelo workflow. Para testar outro caminho localmente, defina a
   variável `BASE_PATH` antes de executar `npm run build` (ex.: `/repositorio/`).

Cada execução da publicação consulta aproximadamente 774 listas na UFJF. A extração
falha se houver erros, evitando publicar uma base parcialmente coletada; a publicação
anterior permanece disponível. O arquivo gzip é público e pode ser baixado e
descompactado por qualquer visitante: ele inclui nomes, notas, classificações e
situações, mesmo sem CPF. Antes de publicar, avalie a finalidade, necessidade,
retenção e demais requisitos de proteção de dados com a UFJF. `noindex` não impede
acesso ao arquivo nem substitui controle de acesso. GitHub Pages é estático e não
oferece autenticação de acesso aos dados.

## Resumo do que foi descoberto

- O site é WordPress 4.9.7 com o plugin proprietário **`integracao-siga`**, que renderiza
  **views Twig** a partir do SIGA (Sistema Integrado de Gestão Acadêmica, framework
  Manager 1.0) e injeta o HTML no conteúdo das páginas. Não há API pública de convocações.
- As views são selecionadas por `?page=<view>`: `esperacandidatos` (lista de espera),
  `cursos`, `curriculos-ativos`, `grade-curricular`, `plano-de-ensino`, `disciplinas`,
  `plano-departamental` e `turma`. Só `esperacandidatos` interessa à matrícula.
- O plugin também roda em `www2.ufjf.br/cat` e `www2.ufjf.br/energia`; a whitelist de views
  é por página.
- `idTipoIngresso` **muda a cada edição** — deve sempre ser lido da página, nunca hardcoded.
- As **convocações oficiais são PDFs** com texto extraível (curso → grupo → candidatos + prazos).

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/mapeamento-endpoints.md](docs/mapeamento-endpoints.md) | Levantamento das fontes de dados: a integração SIGA (plugin `integracao-siga`, views Twig), WordPress REST, endpoint legado `?page=esperacandidatos`, tabelas HTML, PDFs de edital, links de pré-matrícula no SIGA |
| [docs/plano-implementacao.md](docs/plano-implementacao.md) | Arquitetura, modelo de dados, pipeline de ingestão, rotas, uso de antd, LGPD, roadmap e critérios de aceite |

## Próximo passo sugerido

- Validar o protótipo com dados de uma edição que tenha convocações recentes.
- Trocar o snapshot JSON por Postgres + BFF quando a busca precisar de paginação
  server-side e de mais de uma edição histórica.
- Implementar a detecção de edital novo (polling dos hubs a cada 5–10 min) para disparar
  a re-sincronização.
