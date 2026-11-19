import { gunzipSync, strFromU8 } from 'fflate';

export interface Candidato {
  /** id da edição (ex.: `pism-2026`) */
  e: string;
  /** curso */
  c: string;
  /** turno */
  t: string;
  /** campus */
  ca: string;
  /** grupo de cota / modalidade */
  g: string;
  /** URL oficial da lista específica de curso e grupo */
  url?: string;
  /** classificação na lista */
  cl: number | null;
  /** nome */
  n: string;
  /** pontuação */
  p: number | null;
  /** 1 = convocado */
  cv: 0 | 1;
  /** situação publicada na origem */
  s?: string;
  /** data do edital que convocou (YYYY-MM-DD) */
  sd: string | null;
}

export interface Edicao {
  id: string;
  processo: string;
  rotulo: string;
  ano: number | null;
  listaUrl: string;
}

export interface Snapshot {
  geradoEm: string;
  fonte: string;
  edicoes: Edicao[];
  total: number;
  candidatos: Candidato[];
}

/** Remove acentos, colapsa espaços e passa para minúsculas. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

let cache: Promise<Snapshot> | null = null;

/** Carrega o snapshot uma única vez por sessão. */
export function carregarSnapshot(): Promise<Snapshot> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/candidatos.json.gz`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`Falha ao carregar os dados (HTTP ${res.status}).`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      // Alguns servidores informam Content-Encoding: gzip e o navegador já descompacta.
      const conteudo = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
      const dados: unknown = JSON.parse(strFromU8(conteudo));
      if (!dados || typeof dados !== 'object' || !Array.isArray((dados as Snapshot).candidatos)) {
        throw new Error('O arquivo de dados é inválido.');
      }
      return dados as Snapshot;
    })
    .catch((erro) => {
      cache = null;
      throw erro;
    });
  return cache;
}
