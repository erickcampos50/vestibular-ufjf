# Plano de implementação — Portal de Matrícula CDARA (React + antd)

> Objetivo: recriar `www2.ufjf.br/cdara/graduacao/matricula-graduacao/` com foco na
> **convocação de candidatos**, transformando tabelas HTML/PDF em uma experiência
> pesquisável, filtrável e compartilhável.
>
> O mapeamento das fontes de dados está em [`mapeamento-endpoints.md`](./mapeamento-endpoints.md).

---

## 1. Problemas da experiência atual

| # | Problema | Impacto |
|---|---|---|
| 1 | Convocação só existe em **PDF**; o candidato precisa abrir e rolar dezenas de páginas para achar o próprio nome | altíssimo |
| 2 | Lista de espera exige **navegar curso por curso** (`?page=esperacandidatos&…`), sem busca global | alto |
| 3 | Tabelas sem ordenação útil, sem filtro por campus/turno/grupo e com `onclick` inline (sem link real, sem abrir em nova aba, sem copiar URL) | alto |
| 4 | Situação do candidato só como texto livre (`CONVOCADO PELO EDITAL PUBLICADO EM 24/07/2026`) | médio |
| 5 | Página de editais é uma lista cronológica reversa de 78 PDFs em `/cronograma-e-resultados-grupos-de-cotas/` | médio |
| 6 | Datas/prazos espalhados entre PDF, link de pré-matrícula e página de orientações | alto |
| 7 | Sem versão mobile utilizável (tabela `table-responsive` com 5 colunas e CPF) | médio |
| 8 | Sem URL canônica por curso/grupo → impossível compartilhar "meu curso" | médio |

**Proposta de valor:** uma tela onde o candidato digita **CPF (mesmo mascarado) ou nome**
e vê: classificação, nota, curso/grupo, se foi convocado e em qual edital, com prazo de
confirmação e link de pré-matrícula.

---

## 2. Arquitetura

```
┌──────────────────────────────────────────────────────────────┐
│  Ingestão (Node, cron a cada 30 min em época de edital)      │
│                                                              │
│  sitemap/discovery → lista de espera (HTML) → candidatos      │
│  hubs de editais → PDFs → pdfplumber → convocações            │
│                        ↓                                     │
│              validação + normalização + hash                  │
└──────────────────────────────────────────────────────────────┘
                         ↓
              PostgreSQL / SQLite (snapshot)
                         ↓
┌──────────────────────────────────────────────────────────────┐
│  BFF (Fastify / Hono / Next route handlers)                  │
│  /api/edicoes  /api/cursos  /api/candidatos  /api/editais    │
│  /api/busca?q=  /api/calendario   (cache 5–15 min)           │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│  Front: React 18 + TypeScript + Vite + antd 5                │
│  TanStack Query · React Router · dayjs                       │
└──────────────────────────────────────────────────────────────┘
```

**Por que BFF e não SPA chamando o WordPress:** o endpoint legado é `no-store`, devolve
~70 KB de HTML por curso/grupo e não tem CORS pensado para terceiros. Centralizar a coleta
permite cache, busca por CPF em uma única consulta e proteção contra mudança de layout.

### Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Build | Vite + React 18 + TS | rápido, simples de publicar estático |
| UI | **antd 5** + `@ant-design/icons` | pedido do projeto; `Table` com sorter/filters/paginação resolve 80% |
| Estado servidor | TanStack Query | cache, retry, estados de erro/carregamento |
| Rotas | React Router 6 | URLs compartilháveis por edição/curso/grupo |
| Datas | dayjs + `locale('pt-br')` | leve, integra com antd |
| Backend | Fastify (ou Next.js route handlers) | leve, ótimo para ETL + cache |
| Banco | SQLite em dev → Postgres em prod | volumes pequenos (< 100k linhas/edição) |
| Parsing | `cheerio` (HTML) + `pdfplumber` via worker Python | PDFs têm texto extraível |
| Deploy | container único (BFF + estático) atrás do proxy da UFJF | simplicidade institucional |

---

## 3. Modelo de dados

```sql
-- Edição de um processo seletivo (ex.: SiSU 2026/1)
create table edicao (
  id            text primary key,          -- 'sisu-2026-1'
  processo      text not null,             -- PISM | PISM_MUSICA | SISU | SISU_MAIS | VAGAS_OCIOSAS | EAD | PARFOR | LIBRAS
  ano           int  not null,
  semestre      int,                       -- null quando o processo não separa semestre
  fonte_url     text not null,             -- página da lista de espera
  sincronizado_em timestamptz,
  hash_conteudo text
);

-- Curso (código SIGA, ex. '01ABI')
create table curso (
  codigo   text primary key,
  nome     text not null,
  turno    text,
  campus   text
);

-- Grupo de vagas POR EDIÇÃO (idTipoIngresso muda a cada ano!)
create table grupo_vaga (
  id            serial primary key,
  edicao_id     text references edicao(id),
  id_externo    text not null,             -- '326', '75', ...
  rotulo        text not null,             -- 'SISU MAIS - GRUPO A', 'PISM Grupo C'
  unique (edicao_id, id_externo)
);

-- Uma linha da tabela de cursos (curso × turno × grupo × campus)
create table lista_curso (
  id           serial primary key,
  edicao_id    text references edicao(id),
  curso_codigo text references curso(codigo),
  turno        text,
  campus       text,
  grupo_id     int references grupo_vaga(id),
  total_candidatos int,
  url_detalhe  text not null,              -- URL legada com ?page=esperacandidatos&...
  unique (edicao_id, curso_codigo, grupo_id, turno, campus)
);

-- Candidato na lista de espera
create table candidato_lista (
  id            bigserial primary key,
  lista_curso_id int references lista_curso(id),
  classificacao int,
  nome          text not null,             -- preservar caixa original
  nome_busca    text not null,             -- normalizado (sem acento, lower)
  cpf_mascarado text,
  cpf_busca     text,                      -- só dígitos visíveis
  pontos        numeric(6,2),
  situacao_texto text,                     -- 'EM ESPERA' | 'CONVOCADO PELO EDITAL PUBLICADO EM ...'
  convocado     boolean default false,
  convocado_em  date,
  edital_id     bigint references edital(id)
);

-- Edital (convocaç./reclassificaç./resultado)
create table edital (
  id           bigserial primary key,
  edicao_id    text references edicao(id),
  tipo         text,                       -- CONVOCACAO | RECLASSIFICACAO | COMPLEMENTAR | RESULTADO
  numero       int,                        -- 7 (do "7º Edital")
  titulo       text,
  publicado_em date,
  url_pdf      text unique,
  hash_pdf     text,
  confirmacao_inicio timestamptz,
  confirmacao_fim    timestamptz,
  documentos_inicio  date,
  documentos_fim     date,
  link_pre_matricula text,                 -- siga.ufjf.br/.../formPreMatriculaP1/{id}/
  total_candidatos   int
);

-- Item de convocação extraído do PDF
create table convocacao_item (
  id        bigserial primary key,
  edital_id bigint references edital(id),
  curso_codigo text,
  turno     text,
  campus    text,
  grupo     text,                          -- 'PISM Grupo C'
  ordem     int,
  cpf_mascarado text,
  nome      text,
  origem_vagas_ociosas boolean default false
);
```

Índices essenciais: `candidato_lista (nome_busca)`, `candidato_lista (cpf_busca)`,
`convocacao_item (cpf_mascarado)`, `edital (edicao_id, publicado_em desc)`.

---

## 4. Pipeline de ingestão

### 4.1 Etapas

1. **Descoberta** — `/page-sitemap.xml` (o `/wp/v2/pages` está quebrado no site: devolve HTML).
   Regex de "é página de lista": presença de `id="tblCursosEspera"` no HTML.
2. **Índice** — parse da `tblCursosEspera` (curso, turno, grupo, campus, `onclick`).
   Guarda `ano`, `curso`, `idTipoIngresso`, `semestre` e a URL-base.
3. **Detalhe** — `GET` concorrente (limite 5) em cada `url_detalhe`; parse da
   `tblEsperaCandidatos`. Extrai `convocado_em` de `SITUAÇÃO`.
4. **Editais** — parse dos hubs (h3 → ul → li) para `titulo`, `url_pdf`, `link_pre_matricula`
   e datas no texto do `<li>`.
5. **PDFs** — download + `pdfplumber`; aplica o contrato da seção 5.3 do mapeamento;
   grava `edital` + `convocacao_item`.
6. **Correlação** — casa `convocacao_item` ↔ `candidato_lista` por
   `(cpf_mascarado, curso, grupo)` para preencher `edital_id`.
7. **Publicação** — só troca o snapshot ativo se as validações passarem.

### 4.2 Validação (falha → mantém snapshot anterior + alerta)

- linhas de curso ≥ 90 % do snapshot anterior;
- toda `lista_curso` retornou ≥ 1 candidato (ou registra "lista vazia legítima");
- `classificacao` estritamente crescente dentro de cada lista;
- `pontos` não crescente quando a lista está ordenada por classificação;
- soma de `convocacao_item` por edital ≈ `total_candidatos` do rodapé do PDF;
- `hash` do HTML/PDF igual ao anterior → não regrava nem notifica.

### 4.3 Operação

| Frequência | Tarefa |
|---|---|
| 30 min (07h–23h, dias de edital) | detalhes das edições ativas |
| 6 h | hubs de editais (detecta PDF novo) |
| diário 03h | PDFs novos + reconciliação completa |
| semanal | varredura de sitemap (páginas/edições novas) |

Guardar sempre `fonte_url` e `hash` — é o que permite dizer ao usuário
"consulte também o edital oficial" com integridade.

---

## 5. Mapa de rotas e telas

| Rota | Tela | Fonte |
|---|---|---|
| `/` | Home: busca rápida + próximos prazos + atalhos por processo | agregados |
| `/buscar?q=…` | Resultado da busca por CPF/nome (todas as edições) | `candidato_lista` |
| `/convocacoes` | Lista de editais (filtros processo/ano/semestre/tipo) | `edital` |
| `/convocacoes/:id` | Detalhe do edital: prazos + tabela de convocados por curso/grupo | `convocacao_item` |
| `/lista-de-espera` | Escolha de edição + tabela de cursos (busca/filtros) | `lista_curso` |
| `/lista-de-espera/:edicao/:cursoId/:grupoId` | Candidatos do curso/grupo | `candidato_lista` |
| `/cronograma` | Calendário consolidado de confirmação/envio de documentos | `edital` |
| `/bancas` | Convocações de heteroidentificação (JF / GV) | `edital` + PDFs |
| `/documentos` | Orientações, passo a passo, FAQ | páginas WP |
| `/sobre` | O que é o portal, fonte dos dados, aviso de não-oficialidade | — |

### 5.1 Tela “Buscar meu nome” (carro-chefe)

```
┌────────────────────────────────────────────────────────────┐
│  Matrícula UFJF · CDARA            [SiSU 2026 ▾]  [Ajuda]  │
├────────────────────────────────────────────────────────────┤
│  Consulte sua convocação                                   │
│  ┌──────────────────────────────────────┐ ┌──────────────┐ │
│  │ CPF ou nome                          │ │   Buscar     │ │
│  └──────────────────────────────────────┘ └──────────────┘ │
│  ℹ️ Digite os 3 primeiros e 2 últimos dígitos do CPF.      │
├────────────────────────────────────────────────────────────┤
│  3 resultados para "161.XXX.XXX-51"                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 🟢 CONVOCADO         ADMINISTRAÇÃO · GV · Grupo A    │  │
│  │    Classificação 1 · 600,56 pontos                   │  │
│  │    Convocado pelo 4º edital de reclassificação       │  │
│  │    Confirme até 04/09/2026 · Enviar docs 09–11/09    │  │
│  │    [Confirmar interesse]  [Ver edital (PDF)]         │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

Componentes antd: `Input.Search`, `Select`, `Alert`, `Card`, `Statistic`, `Tag`,
`Descriptions`, `Result`/`Empty`, `Skeleton`.

### 5.2 Tela “Convocações”

- `Segmented` → PISM · SiSU · SiSU Mais · Vagas Ociosas · EAD
- `Select` ano/semestre · `Input.Search` por nº do edital
- `Table` com colunas: `Edital` (nº + tipo), `Publicado em`, `Confirmação`, `Documentos`,
  `Convocados`, `Ações` (abrir PDF / ver lista)
- `expandable` → prévia dos 5 primeiros convocados do edital
- `Timeline` lateral com o histórico da edição

### 5.3 Tela “Lista de espera” — o coração da melhoria

Antes: tabela crua de 485 linhas, clique abre outra página, sem filtro.
Depois:

```
┌──────────────────────────────────────────────────────────────┐
│ Lista de espera · SiSU 2026          Atualizado 19/11 14:02  │
│ [Buscar curso…] [Campus ▾] [Turno ▾] [Grupo ▾]  [Limpar]     │
├──────────────────────────────────────────────────────────────┤
│ Curso ▾        Turno      Grupo        Campus     Candidatos  │
│ ABI - Biol.    Integral   Grupo A      JF         63  ›       │
│ ...                                                          │
├──────────────────────────────────────────────────────────────┤
│ 485 grupos · exibindo 1–20            ‹ 1 2 3 … 25 ›         │
└──────────────────────────────────────────────────────────────┘
```

Colunas antd Table:

| Coluna | `sorter` | `filters` | Observação |
|---|---|---|---|
| Curso | alfabético | — | `fixed: 'left'` |
| Turno | — | `INTEGRAL / NOTURNO` | `filterMultiple: false` |
| Grupo | alfabético | lista dos 8 grupos | `Tag` colorida |
| Campus | — | JF / GV | |
| Candidatos | numérico | — | `align: 'right'` |
| (ação) | — | — | `<Link>` real, não `onclick` |

Detalhe do curso (`/lista-de-espera/...`): `Descriptions` (curso, turno, campus, grupo),
`Table` de candidatos com:

| Coluna | Componente |
|---|---|
| Class. | `Typography.Text strong` |
| Nome | texto (busca destacada) |
| CPF | `Typography.Text type="secondary"` (mascarado) |
| Pontos | `Statistic` inline ou número `pt-BR` |
| Situação | `Tag` verde `Convocado` / cinza `Em espera` + `Tooltip` com o edital |
| Edital | `Button type="link"` para `/convocacoes/:id` |

Extras: `rowSelection` + botão “Exportar CSV” (respeitando filtros), `sticky` header,
`scroll={{ x: 'max-content' }}` no mobile, `virtual` para listas > 200 linhas.

---

## 6. Uso de antd — decisões concretas

### 6.1 Tema e provider

```tsx
import { ConfigProvider, App as AntApp, theme } from 'antd';
import ptBR from 'antd/locale/pt_BR';
import 'dayjs/locale/pt-br';

<ConfigProvider
  locale={ptBR}
  theme={{
    token: {
      colorPrimary: '#0f4c81',   // azul institucional (ajustar ao manual da UFJF)
      colorInfo:    '#0f4c81',
      borderRadius: 8,
      fontFamily: 'Inter, Roboto, system-ui, sans-serif',
      fontSize: 15,
    },
    components: {
      Table: { headerBg: '#f0f4f8', headerColor: '#1f2937', cellPaddingBlock: 10 },
      Layout: { headerBg: '#0f4c81', headerColor: '#fff' },
      Tag: { defaultBg: '#eef2f6' },
    },
  }}
>
  <AntApp>{/* router */}</AntApp>
</ConfigProvider>
```

- `ConfigProvider.locale = ptBR` resolve paginação, "sem dados", datas.
- `App` (antd 5) fornece `message`/`notification`/`modal` com contexto de tema.
- Modo escuro/alto contraste: `theme.darkAlgorithm` + botão herdado da barra gov.br
  (o site atual tem "Alto Contraste" — manter paridade de acessibilidade).

### 6.2 Componentes por função

| Função | antd |
|---|---|
| Casca | `Layout`, `Layout.Header/Content/Footer`, `Menu`, `Breadcrumb`, `Drawer` (menu mobile) |
| Filtros | `Input.Search`, `Select`, `Segmented`, `DatePicker.RangePicker`, `Space`, `Flex` |
| Dados | `Table` (+`sorter`, `filters`, `pagination`, `sticky`, `virtual`, `expandable`), `Descriptions`, `List` |
| Status | `Tag`, `Badge`, `Alert`, `Result`, `Empty`, `Progress` |
| Detalhe | `Card`, `Statistic`, `Typography`, `Tooltip`, `Modal`, `Drawer` |
| Prazos | `Timeline`, `Steps`, `Calendar` (opcional), `Countdown` interno (`Statistic.Countdown`) |
| Conteúdo | `Collapse` (FAQ), `Tabs`, `Anchor` (sumário do edital), `Image`/`Button` para PDF |
| Feedback | `Skeleton`, `Spin`, `App.useApp().message`, `notification` |
| Acessibilidade | `Flex`, `Grid`, `Typography.Title` com hierarquia correta |

### 6.3 Padrões a evitar

- ❌ `Table` sem `rowKey` estável (use `lista_curso.id`).
- ❌ filtro/ordenação no cliente para 485 linhas sem `pagination` — use `pagination`
  server-side (`total`, `current`, `pageSize`) já no BFF.
- ❌ `onclick="window.location"` → use `<Link>` / `navigate()` + `href` real.
- ❌ formatar número com `toFixed` → `Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 })`.
- ❌ ordenar `pontos` como string → `sorter: (a,b) => a.pontos - b.pontos` com `numeric`.

### 6.4 Contrato do BFF (exemplos)

```http
GET /api/edicoes?processo=sisu
→ [{ id, processo, ano, semestre, sincronizadoEm, totalCursos, totalCandidatos }]

GET /api/listas?edicao=sisu-2026-1&q=medicina&campus=JF&turno=INTEGRAL&grupo=70&page=1&pageSize=20
→ { total, items: [{ id, curso, turno, campus, grupo, rotuloGrupo, totalCandidatos }] }

GET /api/listas/:id/candidatos?page=1&pageSize=50&situacao=convocado
→ { total, items: [{ classificacao, nome, cpfMascarado, pontos, situacao, convocadoEm, editalId }] }

GET /api/busca?q=161.XXX.XXX-51
→ { items: [{ edicao, processo, curso, turno, campus, grupo, classificacao, pontos,
              situacao, edital: { id, numero, tipo, publicadoEm, confirmacaoFim, documentosFim, linkPreMatricula } }] }

GET /api/editais?edicao=sisu-mais-2026-2&tipo=reclassificacao
→ { total, items: [{ id, numero, tipo, publicadoEm, urlPdf, confirmacaoFim, documentosFim, totalCandidatos }] }
```

Todos com `Cache-Control: public, max-age=300, stale-while-revalidate=3600` e
`ETag` derivado do snapshot.

---

## 7. Acessibilidade, SEO e conteúdo

- **A11y (WCAG 2.1 AA):** contraste ≥ 4.5:1, foco visível, `Table` com `<caption>` via
  `title`/`aria-label`, `aria-live` para resultado da busca, alvos ≥ 44 px.
- Manter a **barra gov.br** e o link “Alto Contraste” (o site atual já os tem).
- **SEO:** cada edição/curso/grupo com URL estável + `meta description` gerada
  ("Lista de espera SiSU 2026 — Administração, GV, Grupo A — 63 candidatos").
  Para SPA, considerar pré-render (`vite-plugin-ssg`) das rotas de edital.
- **Conteúdo sensível:** aviso fixo “Portal não oficial; a fonte é o edital publicado pela
  CDARA” com link para o PDF original em toda tela que exiba dado derivado.
- Glossário curto: Grupo A–J, PISM, SiSU Mais, vagas ociosas, `***`, pré-matrícula.

---

## 8. LGPD e segurança

- Os dados já são **públicos e mascarados na origem** (`161.XXX.XXX-51`): manter exatamente
  o mesmo mascaramento, sem tentar reconstruir CPF.
- **Não** indexar CPF por buscadores: `robots: noindex` na rota `/buscar` e nos detalhes
  quando houver query de CPF; `noindex` também no `sitemap.xml` do portal.
- Busca exige **≥ 6 caracteres** (nome ou padrão de CPF) e é **rate-limited** (10 req/min/IP).
- Não logar `q` em texto claro; logar apenas hash para métricas.
- `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`.
- Painel admin (se existir) atrás de SSO institucional; toda edição manual auditada.
- Guardar `fonte_url` de cada registro — rastreabilidade e correção.

---

## 9. Roadmap por fases

### Fase 0 — Fundação (2–3 dias)
- [ ] `npm create vite@latest` + TS + ESLint/Prettier
- [ ] instalar `antd`, `@ant-design/icons`, `dayjs`, `react-router-dom`, `@tanstack/react-query`
- [ ] `ConfigProvider` (ptBR + tema), `Layout` com header/footer institucional
- [ ] rotas vazias + `Breadcrumb` + página 404 (`Result status="404"`)
- [ ] deploy de preview

### Fase 1 — Ingestão (4–6 dias)
- [ ] `scripts/scrape.ts`: sitemap → páginas de lista → índice → detalhes (concorrência 5)
- [ ] parser HTML com `cheerio` (contrato da seção 4 do mapeamento)
- [ ] parser de PDF (`pdfplumber`) com os regex da seção 5.3
- [ ] schema do banco + migrations
- [ ] validações + `hash` + relatório de execução
- [ ] fixtures reais (um HTML de cada tipo + 3 PDFs) em `tests/fixtures/`
- [ ] testes de parsing com snapshots

### Fase 2 — Convocações (4–5 dias)
- [ ] `GET /api/editais`, `/api/editais/:id`
- [ ] `/convocacoes` (Table + filtros + Segmented)
- [ ] `/convocacoes/:id` (Descriptions de prazos + Table de convocados + link PDF)
- [ ] `Timeline` do histórico da edição
- [ ] alerta de prazo (`Alert` com dias restantes)

### Fase 3 — Lista de espera (4–5 dias)
- [ ] `GET /api/listas` paginado/filtrado no servidor
- [ ] `/lista-de-espera` (Table com sorter/filters)
- [ ] `/lista-de-espera/:edicao/:cursoId/:grupoId` (candidatos + export CSV)
- [ ] navegação por URL real (copiar/abrir em nova aba)

### Fase 4 — Busca (3–4 dias)
- [ ] `GET /api/busca` com `nome_busca` (sem acento) e `cpf_busca`
- [ ] `/buscar` com `Input.Search`, debounce 400 ms, `noindex`
- [ ] card de resultado com status, edital, prazos e link de pré-matrícula
- [ ] estados vazio/erro/rate-limit

### Fase 5 — Complementos (3–4 dias)
- [ ] `/cronograma` consolidado (`Timeline`/`Calendar`)
- [ ] `/bancas`, `/documentos` (Collapse), `/sobre`
- [ ] atalhos na home + destaques "o que está aberto agora"

### Fase 6 — Qualidade (contínuo)
- [ ] Lighthouse ≥ 95 (a11y/perf) e axe sem violações críticas
- [ ] testes e2e (Playwright) dos 5 fluxos principais
- [ ] monitoramento do scraper (alerta no primeiro sinal de layout novo)
- [ ] runbook de edital (checklist para abertura de nova edição)

**Estimativa total:** ~5 semanas de 1 dev full-stack, ou ~3 semanas com 2 devs
(frente dados / frente UI em paralelo após a Fase 0).

---

## 10. Riscos e mitigação

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Layout do plugin SIGA mudar sem aviso | média | alto | parser com fixtures + validação por contagem + alerta; snapshot anterior permanece no ar |
| `idTipoIngresso` mudar (já muda todo ano) | alta | alto | sempre ler da página da edição; jamais hardcode |
| PDF em imagem (sem texto) em alguma edição | baixa | médio | detectar `extract_text()` vazio → marcar edital como "somente PDF" e exibir link |
| Bloqueio/rate-limit no servidor da UFJF | baixa | alto | concorrência 4–6, `If-Modified-Since`, cache agressivo, user-agent identificável |
| Dado publicado com erro pela CDARA | média | médio | exibir sempre link para a fonte oficial + data de sincronização |
| Reclamação LGPD | baixa | alto | manter mascaramento idêntico ao original, `noindex`, rate-limit, sem histórico de buscas |
| Volume de candidatos (20–40 mil/edição) | certa | baixo | paginação server-side, índices, `Table` virtual |

### 10.1 Viabilidade — evidências coletadas

Verificação feita em 19/11/2026 sobre as páginas-alvo:

| Item verificado | Resultado | Leitura |
|---|---|---|
| PDFs de edital/convocação | **124 distintos** nos hubs; amostra de 9 → **9/9 com texto extraível** (1 tutorial é parcialmente imagético, mas tem texto) | parsing viável; não é um acervo digitalizado |
| `iframe` / `embed` / `object` nas páginas-chave | **0** | conteúdo é texto + links + PDF |
| Calendário Google renderizado | **0 containers**; o plugin de calendário só enfileira CSS/JS global | nada essencial preso em widget externo |
| Imagens de conteúdo nas páginas-chave | **0** | nenhum dado só em imagem |
| Tabelas de dados | HTML semântico gerado pelo plugin (`tbl*`), Bootstrap + DataTables | reproduzível em antd `Table` |
| Páginas no sitemap | **504**, das quais **361** em `/graduacao/matricula-graduacao/` (maioria histórico 2011–2025) | recriar tudo é desnecessário; foco na edição vigente + arquivo |
| Endpoint de lista de espera | público, sem auth, sem CORS, `no-store`, sem filtro/paginação | exige ETL; ok para BFF |

**O que não é recriável (limite duro):** as ações transacionais — confirmar interesse na
vaga, enviar documentação, efetivar matrícula — acontecem **dentro do SIGA**
(`formPreMatriculaP1/{id}`) e não têm API pública. O portal informa, orienta e linka; não
substitui o sistema.

**O que depende de decisão institucional:** publicar uma réplica com a marca da UFJF. Se o
portal for público, precisa ou de autorização da instituição, ou de posicionamento explícito
de "não oficial" + uso de identidade visual própria + link para a fonte em toda tela.

---

## 11. Critérios de aceite (MVP)

1. Dado um CPF mascarado de qualquer edição 2026, a busca retorna o candidato em < 1 s.
2. A lista de espera de uma edição é navegável por **curso, campus, turno e grupo** sem
   recarregar a página e com **URL compartilhável**.
3. Todo edital publicado no site oficial aparece em `/convocacoes` em até **30 min**,
   com prazos extraídos e link para o PDF.
4. A tabela de convocados de um edital é exibida em HTML (não PDF) e bate 100 % com o
   `Total de candidatos` do rodapé do PDF.
5. Funciona em 360 px de largura sem scroll horizontal da página.
6. axe-core: 0 violações críticas; contraste AA.
7. Nenhum dado além do que já é público na origem; `/buscar` fora de índices de busca.

---

## 12. Estrutura de pastas sugerida

```
.
├─ docs/
│  ├─ mapeamento-endpoints.md
│  └─ plano-implementacao.md
├─ scripts/
│  ├─ scrape-cdara.mjs          # ETL HTML (protótipo executável)
│  └─ parse-editais.py          # ETL PDF (pdfplumber)
├─ server/
│  ├─ src/db/schema.sql
│  ├─ src/routes/*.ts
│  └─ src/jobs/sync.ts
└─ web/
   ├─ src/app/ConfigProvider.tsx
   ├─ src/app/router.tsx
   ├─ src/components/{CandidatoTable,CursoTable,EditalCard,PrazoAlert}
   ├─ src/pages/{Home,Busca,Convocacoes,ConvocacaoDetalhe,ListaEspera,ListaDetalhe,Cronograma,Bancas,Documentos,Sobre}
   └─ src/api/client.ts
```
