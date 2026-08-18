export type Confidence = 'verified' | 'confirmed' | 'provisional';

export interface SourceReference {
  kind: 'repository' | 'documentation' | 'decision' | 'verification';
  ref: string;
}

export interface ArticleMetadata {
  id: string;
  title: string;
  summary: string;
  section: string;
  category: string;
  order: number;
  tags: string[];
  status: 'current';
  updated: string;
  confidence: Confidence;
  projects: string[];
  sources: SourceReference[];
}

export interface Heading {
  depth: number;
  text: string;
  slug: string;
}

export interface ArticleDocument {
  schema: 1;
  metadata: ArticleMetadata;
  headings: Heading[];
  body: string;
}

export interface CatalogSection {
  id: string;
  title: string;
  description: string;
  order: number;
  categories: CatalogCategory[];
}

export interface CatalogCategory {
  id: string;
  title: string;
  description: string;
  order: number;
  articles: ArticleMetadata[];
}

export interface Catalog {
  schema: 1;
  generatedAt: string;
  articleCount: number;
  sections: CatalogSection[];
  projects: CatalogProject[];
}

export interface CatalogProject {
  id: string;
  title: string;
  description: string;
  order: number;
  articleCount: number;
  sections: CatalogSection[];
}

export interface SearchEntry {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  section: string;
  category: string;
  confidence: Confidence;
  updated: string;
  projects: string[];
  text: string;
}

export interface SearchIndex {
  schema: 1;
  generatedAt: string;
  entries: SearchEntry[];
}
