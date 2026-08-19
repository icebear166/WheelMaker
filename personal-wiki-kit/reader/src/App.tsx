import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {MarkdownRenderer} from './MarkdownRenderer';
import {
  defaultRouteForView,
  normalizeViewPreference,
  parseWikiRoute,
  routeHash,
  switchRouteView,
  type ViewMode,
  type WikiRoute,
} from './routes';
import type {
  ArticleDocument,
  ArticleMetadata,
  Catalog,
  CatalogCategory,
  CatalogProject,
  CatalogSection,
  SearchEntry,
  SearchIndex,
} from './types';

const viewPreferenceKey = 'knowledge-registry-view';

const confidenceLabels = {
  verified: '已验证',
  confirmed: '已确认',
  provisional: '临时结论',
} as const;

export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [route, setRoute] = useState<WikiRoute>(() => parseWikiRoute(location.hash));
  const [article, setArticle] = useState<ArticleDocument | null>(null);
  const [articleError, setArticleError] = useState('');
  const [query, setQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState<SearchIndex | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchJSON<Catalog>('/data/catalog.json')
      .then((value) => {
        setCatalog(value);
        if (parseWikiRoute(location.hash).kind === 'home' && value.sections[0]) {
          navigateTo(defaultRouteForView(
            readViewPreference(),
            value.sections[0].id,
            value.projects[0]?.id || 'unassigned',
          ), true);
        }
      })
      .catch((error) => setCatalogError(error.message));
  }, []);

  useEffect(() => {
    const onRoute = () => setRoute(parseWikiRoute(location.hash));
    window.addEventListener('hashchange', onRoute);
    return () => window.removeEventListener('hashchange', onRoute);
  }, []);

  useEffect(() => {
    if (route.kind !== 'home') writeViewPreference(route.view);
  }, [route]);

  useEffect(() => {
    setNavOpen(false);
    if (route.kind !== 'article') {
      setArticle(null);
      setArticleError('');
      return;
    }
    let active = true;
    setArticle(null);
    setArticleError('');
    void fetchJSON<ArticleDocument>(`/data/articles/${encodeURIComponent(route.articleId)}.json`)
      .then((value) => {
        if (active) {
          setArticle(value);
          document.title = `${value.metadata.title} · Knowledge Registry`;
          window.scrollTo({top: 0});
        }
      })
      .catch((error) => active && setArticleError(error.message));
    return () => {
      active = false;
    };
  }, [route]);

  useEffect(() => {
    if (!query.trim() || searchIndex) return;
    void fetchJSON<SearchIndex>('/data/search.json').then(setSearchIndex).catch(() => {});
  }, [query, searchIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '/' && !isEditable(event.target)) {
        event.preventDefault();
        setNavOpen(true);
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') {
        if (document.activeElement === searchRef.current) {
          setQuery('');
          searchRef.current?.blur();
        }
        setNavOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const allArticles = useMemo(() => (
    catalog?.sections.flatMap((section) => section.categories.flatMap((category) => category.articles)) || []
  ), [catalog]);
  const routeMetadata = route.kind === 'article'
    ? allArticles.find((item) => item.id === route.articleId)
    : undefined;
  const viewMode: ViewMode = route.kind === 'home' ? readViewPreference() : route.view;
  const activeProjectId = route.kind !== 'home' && route.view === 'project'
    ? route.projectId
    : undefined;
  const activeProject = catalog?.projects.find((project) => project.id === activeProjectId);
  const activeSectionId = route.kind === 'section' || route.kind === 'category'
    ? route.sectionId
    : route.kind === 'project-section' || route.kind === 'project-category'
      ? route.sectionId
    : (article?.metadata.section || routeMetadata?.section);
  const activeCategoryId = route.kind === 'category'
    ? route.categoryId
    : route.kind === 'project-category'
      ? route.categoryId
    : (article?.metadata.category || routeMetadata?.category);
  const visibleSections = viewMode === 'project' ? activeProject?.sections : catalog?.sections;
  const activeSection = visibleSections?.find((section) => section.id === activeSectionId);
  const activeCategory = activeSection?.categories.find((category) => category.id === activeCategoryId);
  const searchResults = useMemo(() => rankSearch(searchIndex?.entries || [], query), [query, searchIndex]);
  const searching = Boolean(query.trim());
  const showContext = !searching && Boolean(article);

  const navigate = useCallback((nextRoute: Exclude<WikiRoute, {kind: 'home'}>) => {
    setQuery('');
    navigateTo(nextRoute, false);
  }, []);
  const navigateArticle = useCallback((id: string) => {
    const metadata = allArticles.find((item) => item.id === id);
    if (viewMode === 'topic') {
      navigate({kind: 'article', view: 'topic', articleId: id});
      return;
    }
    const currentProjectMatches = activeProjectId === 'unassigned'
      ? metadata?.projects.length === 0
      : Boolean(activeProjectId && metadata?.projects.includes(activeProjectId));
    const projectId = currentProjectMatches && activeProjectId
      ? activeProjectId
      : (metadata?.projects[0] || 'unassigned');
    navigate({kind: 'article', view: 'project', projectId, articleId: id});
  }, [activeProjectId, allArticles, navigate, viewMode]);
  const changeView = useCallback((nextView: ViewMode) => {
    if (!catalog?.sections[0] || !catalog.projects[0]) return;
    const metadata = article?.metadata || routeMetadata;
    navigate(switchRouteView(route, nextView, {
      defaultSectionId: catalog.sections[0].id,
      defaultProjectId: catalog.projects[0].id,
      articleProjectIds: metadata?.projects || [],
    }));
  }, [article?.metadata, catalog, navigate, route, routeMetadata]);

  useEffect(() => {
    if (!catalog || route.kind === 'article') return;
    if (searching) document.title = `搜索知识 · Knowledge Registry`;
    else if (activeCategory) document.title = `${activeCategory.title} · Knowledge Registry`;
    else if (activeSection) document.title = `${activeSection.title} · Knowledge Registry`;
    else if (activeProject) document.title = `${activeProject.title} · Knowledge Registry`;
  }, [activeCategory, activeProject, activeSection, catalog, route.kind, searching]);

  if (catalogError) return <FatalState title="知识目录无法读取" detail={catalogError} />;
  if (!catalog) return <LoadingState />;

  return (
    <div className="wiki-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">KR</span>
          <div>
            <strong>Knowledge Registry</strong>
            <span>{catalog.articleCount} 条当前知识</span>
          </div>
        </div>
        <button
          type="button"
          className="directory-toggle"
          aria-expanded={navOpen}
          aria-controls="knowledge-directory"
          onClick={() => setNavOpen((value) => !value)}
        >
          {navOpen ? '关闭目录' : '打开目录'}
        </button>
        <div className="topbar-navigation">
          <ViewSwitch view={viewMode} onChange={changeView} />
          <KnowledgePath
            view={viewMode}
            searching={searching}
            project={activeProject}
            section={activeSection}
            category={activeCategory}
            article={article?.metadata || routeMetadata}
          />
        </div>
        <form method="post" action="/logout" className="logout-form">
          <button type="submit">退出</button>
        </form>
      </header>

      <div className={`workspace-grid${showContext ? ' with-context' : ''}`}>
        <aside
          id="knowledge-directory"
          className={`directory-pane${navOpen ? ' open' : ''}`}
          aria-label="知识目录"
        >
          <div className="search-box">
            <label htmlFor="knowledge-search">搜索知识</label>
            <div>
              <span aria-hidden="true">⌕</span>
              <input
                ref={searchRef}
                id="knowledge-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="标题、标签或正文"
                autoComplete="off"
              />
              {query ? (
                <button type="button" className="clear-search" onClick={() => setQuery('')} aria-label="清空搜索">×</button>
              ) : <kbd>/</kbd>}
            </div>
          </div>
          {viewMode === 'topic' ? (
            <TopicDirectory
              sections={catalog.sections}
              activeSectionId={activeSection?.id}
              activeCategoryId={activeCategory?.id}
              onNavigate={navigate}
            />
          ) : (
            <ProjectDirectory
              projects={catalog.projects}
              activeProjectId={activeProject?.id}
              onNavigate={navigate}
            />
          )}
          <div className="catalog-footnote">
            <span>目录构建于</span>
            <time dateTime={catalog.generatedAt}>{formatDate(catalog.generatedAt)}</time>
          </div>
        </aside>

        <main className="reader-pane">
          {searching ? (
            <SearchResults
              results={searchResults}
              loading={!searchIndex}
              catalog={catalog}
              onNavigate={navigateArticle}
            />
          ) : articleError ? (
            <FatalState title="知识条目无法读取" detail={articleError} />
          ) : route.kind === 'article' ? (
            article
              ? <ArticleView article={article} onNavigate={navigateArticle} />
              : <div className="article-loading">正在打开知识条目…</div>
          ) : route.kind === 'category' && activeSection && activeCategory ? (
            <CategoryView section={activeSection} category={activeCategory} onNavigate={navigateArticle} />
          ) : activeSection ? (
            route.kind === 'project-category' && activeProject && activeCategory ? (
              <CategoryView
                section={activeSection}
                category={activeCategory}
                eyebrow={`${activeProject.title} / ${activeSection.title}`}
                onNavigate={navigateArticle}
              />
            ) : route.kind === 'project-section' && activeProject ? (
              <ProjectSectionView project={activeProject} section={activeSection} onNavigate={navigate} />
            ) : (
              <SectionView section={activeSection} onNavigate={navigate} />
            )
          ) : route.kind === 'project' && activeProject ? (
            <ProjectView project={activeProject} onNavigate={navigate} />
          ) : (
            <FatalState title="目录位置不存在" detail="从左侧选择一个知识目录继续浏览。" />
          )}
        </main>

        {showContext && article && (
          <aside className="context-pane" aria-label="条目上下文">
            <ArticleContext article={article} projects={catalog.projects} />
          </aside>
        )}
      </div>
    </div>
  );
}

function ViewSwitch({view, onChange}: {view: ViewMode; onChange: (view: ViewMode) => void}) {
  return (
    <div className="view-switch" aria-label="知识分类方式">
      <button
        type="button"
        className={view === 'topic' ? 'active' : ''}
        aria-pressed={view === 'topic'}
        onClick={() => onChange('topic')}
      >知识类型</button>
      <button
        type="button"
        className={view === 'project' ? 'active' : ''}
        aria-pressed={view === 'project'}
        onClick={() => onChange('project')}
      >项目</button>
    </div>
  );
}

function KnowledgePath({view, searching, project, section, category, article}: {
  view: ViewMode;
  searching: boolean;
  project?: CatalogProject;
  section?: CatalogSection;
  category?: CatalogCategory;
  article?: ArticleMetadata;
}) {
  return (
    <div className="knowledge-path" aria-label="知识路径">
      <span>知识库</span>
      <i aria-hidden="true">/</i>
      {searching ? <b>搜索结果</b> : (
        <>
          {view === 'project' && project && <><span>{project.title}</span><i aria-hidden="true">/</i></>}
          <span>{section?.title || '目录'}</span>
          {category && <><i aria-hidden="true">/</i><span>{category.title}</span></>}
          {article && <><i aria-hidden="true">/</i><b>{article.title}</b></>}
        </>
      )}
    </div>
  );
}

function TopicDirectory({sections, activeSectionId, activeCategoryId, onNavigate}: {
  sections: CatalogSection[];
  activeSectionId?: string;
  activeCategoryId?: string;
  onNavigate: (route: Exclude<WikiRoute, {kind: 'home'}>) => void;
}) {
  return (
    <nav className="topic-tree">
      {sections.map((section) => {
        const active = section.id === activeSectionId;
        const articleCount = section.categories.reduce((total, category) => total + category.articles.length, 0);
        return (
          <section key={section.id} className={`topic-group${active ? ' active' : ''}`}>
            <button
              type="button"
              className="section-link"
              aria-expanded={active}
              onClick={() => onNavigate({kind: 'section', view: 'topic', sectionId: section.id})}
            >
              <span>{section.title}</span>
              <small>{articleCount}</small>
            </button>
            {active && (
              <ul>
                {section.categories.map((category) => (
                  <li key={category.id}>
                    <button
                      type="button"
                      className={`category-link${category.id === activeCategoryId ? ' active' : ''}`}
                      aria-current={category.id === activeCategoryId ? 'page' : undefined}
                      onClick={() => onNavigate({
                        kind: 'category',
                        view: 'topic',
                        sectionId: section.id,
                        categoryId: category.id,
                      })}
                    >
                      <span>{category.title}</span>
                      <small>{category.articles.length}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </nav>
  );
}

function ProjectDirectory({projects, activeProjectId, onNavigate}: {
  projects: CatalogProject[];
  activeProjectId?: string;
  onNavigate: (route: Exclude<WikiRoute, {kind: 'home'}>) => void;
}) {
  return (
    <nav className="project-tree" aria-label="项目目录">
      {projects.map((project) => (
        <button
          type="button"
          key={project.id}
          className={`project-link${project.id === activeProjectId ? ' active' : ''}`}
          aria-current={project.id === activeProjectId ? 'page' : undefined}
          onClick={() => onNavigate({kind: 'project', view: 'project', projectId: project.id})}
        >
          <span>
            <strong>{project.title}</strong>
            <small>{project.sections.length} 个知识类型</small>
          </span>
          <b>{project.articleCount}</b>
        </button>
      ))}
    </nav>
  );
}

function SectionView({section, onNavigate}: {
  section: CatalogSection;
  onNavigate: (route: Exclude<WikiRoute, {kind: 'home'}>) => void;
}) {
  const articleCount = section.categories.reduce((total, category) => total + category.articles.length, 0);
  return (
    <div className="directory-view">
      <DirectoryHeader
        eyebrow="知识领域"
        title={section.title}
        description={section.description}
        meta={`${section.categories.length} 个分类 · ${articleCount} 篇文章`}
      />
      <div className="category-grid">
        {section.categories.map((category) => (
          <button
              type="button"
              key={category.id}
              className="category-card"
              onClick={() => onNavigate({kind: 'category', view: 'topic', sectionId: section.id, categoryId: category.id})}
          >
            <span className="category-card-spine" aria-hidden="true" />
            <span className="category-card-copy">
              <span className="category-card-label">{category.articles.length} 篇文章</span>
              <strong>{category.title}</strong>
              <span>{category.description}</span>
            </span>
            <span className="card-arrow" aria-hidden="true">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ProjectView({project, onNavigate}: {
  project: CatalogProject;
  onNavigate: (route: Exclude<WikiRoute, {kind: 'home'}>) => void;
}) {
  return (
    <div className="directory-view">
      <DirectoryHeader
        eyebrow="项目知识库"
        title={project.title}
        description={project.description}
        meta={`${project.sections.length} 个知识类型 · ${project.articleCount} 篇文章`}
      />
      <div className="category-grid">
        {project.sections.map((section) => {
          const articleCount = section.categories.reduce((total, category) => total + category.articles.length, 0);
          return (
            <button
              type="button"
              key={section.id}
              className="category-card project-section-card"
              onClick={() => onNavigate({
                kind: 'project-section',
                view: 'project',
                projectId: project.id,
                sectionId: section.id,
              })}
            >
              <span className="category-card-spine" aria-hidden="true" />
              <span className="category-card-copy">
                <span className="category-card-label">{articleCount} 篇文章</span>
                <strong>{section.title}</strong>
                <span>{section.description}</span>
              </span>
              <span className="card-arrow" aria-hidden="true">→</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProjectSectionView({project, section, onNavigate}: {
  project: CatalogProject;
  section: CatalogSection;
  onNavigate: (route: Exclude<WikiRoute, {kind: 'home'}>) => void;
}) {
  const articleCount = section.categories.reduce((total, category) => total + category.articles.length, 0);
  return (
    <div className="directory-view">
      <DirectoryHeader
        eyebrow={project.title}
        title={section.title}
        description={section.description}
        meta={`${section.categories.length} 个分类 · ${articleCount} 篇文章`}
      />
      <div className="category-grid">
        {section.categories.map((category) => (
          <button
            type="button"
            key={category.id}
            className="category-card"
            onClick={() => onNavigate({
              kind: 'project-category',
              view: 'project',
              projectId: project.id,
              sectionId: section.id,
              categoryId: category.id,
            })}
          >
            <span className="category-card-spine" aria-hidden="true" />
            <span className="category-card-copy">
              <span className="category-card-label">{category.articles.length} 篇文章</span>
              <strong>{category.title}</strong>
              <span>{category.description}</span>
            </span>
            <span className="card-arrow" aria-hidden="true">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CategoryView({section, category, eyebrow, onNavigate}: {
  section: CatalogSection;
  category: CatalogCategory;
  eyebrow?: string;
  onNavigate: (id: string) => void;
}) {
  return (
    <div className="directory-view">
      <DirectoryHeader
        eyebrow={eyebrow || section.title}
        title={category.title}
        description={category.description}
        meta={`${category.articles.length} 篇当前文章`}
      />
      {category.articles.length > 0 ? (
        <div className="article-card-grid">
          {category.articles.map((item) => <ArticleCard key={item.id} article={item} onNavigate={onNavigate} />)}
        </div>
      ) : (
        <EmptyDirectory title="这个分类还没有文章" detail="后续确认的新知识会直接归入这里。" />
      )}
    </div>
  );
}

function DirectoryHeader({eyebrow, title, description, meta}: {
  eyebrow: string;
  title: string;
  description: string;
  meta: string;
}) {
  return (
    <header className="directory-header">
      <span>{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
      <small>{meta}</small>
    </header>
  );
}

function ArticleCard({article, onNavigate, context}: {
  article: ArticleMetadata;
  onNavigate: (id: string) => void;
  context?: string;
}) {
  return (
    <button type="button" className="article-card" onClick={() => onNavigate(article.id)}>
      <span className="article-card-topline">
        <span className={`confidence-text confidence-${article.confidence}`}>{confidenceLabels[article.confidence]}</span>
        <time dateTime={article.updated}>{formatDate(article.updated)}</time>
      </span>
      {context && <span className="article-card-context">{context}</span>}
      <strong>{article.title}</strong>
      <span className="article-card-summary">{article.summary}</span>
      <span className="article-card-tags">{article.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</span>
    </button>
  );
}

function SearchResults({results, loading, catalog, onNavigate}: {
  results: SearchEntry[];
  loading: boolean;
  catalog: Catalog;
  onNavigate: (id: string) => void;
}) {
  return (
    <div className="directory-view search-view" aria-live="polite">
      <DirectoryHeader
        eyebrow="全库检索"
        title="搜索结果"
        description="结果按标题、标签、摘要和正文的匹配程度排序。"
        meta={loading ? '正在载入搜索索引…' : `${results.length} 个匹配结果`}
      />
      {!loading && results.length > 0 ? (
        <div className="article-card-grid">
          {results.map((result) => {
            const section = catalog.sections.find((item) => item.id === result.section);
            const category = section?.categories.find((item) => item.id === result.category);
            const article: ArticleMetadata = {
              ...result,
              order: 0,
              status: 'current',
              sources: [],
            };
            return (
              <ArticleCard
                key={result.id}
                article={article}
                context={[section?.title, category?.title].filter(Boolean).join(' / ')}
                onNavigate={onNavigate}
              />
            );
          })}
        </div>
      ) : !loading ? (
        <EmptyDirectory title="没有找到可靠条目" detail="换一个更短的关键词，或尝试文章中的技术名词。" />
      ) : null}
    </div>
  );
}

function EmptyDirectory({title, detail}: {title: string; detail: string}) {
  return <div className="empty-directory"><strong>{title}</strong><p>{detail}</p></div>;
}

function ArticleView({article, onNavigate}: {article: ArticleDocument; onNavigate: (id: string) => void}) {
  return (
    <article className="article-document">
      <header className="article-header">
        <div className="article-state-line">
          <span className={`confidence confidence-${article.metadata.confidence}`}>
            {confidenceLabels[article.metadata.confidence]}
          </span>
          <span>当前版本</span>
          <time dateTime={article.metadata.updated}>更新于 {article.metadata.updated}</time>
        </div>
        <h1>{article.metadata.title}</h1>
        <p>{article.metadata.summary}</p>
        <div className="tag-row">
          {article.metadata.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      </header>
      <MarkdownRenderer body={article.body} headings={article.headings} onNavigate={onNavigate} />
      <footer className="article-footer">
        <span>此页面仅显示当前可靠版本。</span>
        <span>历史变更保存在 Git 中。</span>
      </footer>
    </article>
  );
}

function ArticleContext({article, projects}: {article: ArticleDocument; projects: CatalogProject[]}) {
  const projectTitles = new Map(projects.map((project) => [project.id, project.title]));
  return (
    <div className="context-stack">
      <section>
        <h2>本页目录</h2>
        <nav className="outline-nav">
          {article.headings.map((heading) => (
            <a key={heading.slug} className={`depth-${heading.depth}`} href={`#${heading.slug}`} onClick={(event) => {
              event.preventDefault();
              document.getElementById(heading.slug)?.scrollIntoView({behavior: 'smooth', block: 'start'});
            }}>{heading.text}</a>
          ))}
        </nav>
      </section>
      {article.metadata.projects.length > 0 && (
        <section>
          <h2>关联项目</h2>
          <div className="project-list">
            {article.metadata.projects.map((projectId) => (
              <span key={projectId}>{projectTitles.get(projectId) || projectId}</span>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2>依据</h2>
        <ol className="source-list">
          {article.metadata.sources.map((source, index) => (
            <li key={`${source.kind}-${index}`}>
              <span>{source.kind}</span>
              <p>{source.ref}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function LoadingState() {
  return <div className="full-state"><span className="state-mark">KR</span><p>正在读取知识目录…</p></div>;
}

function FatalState({title, detail}: {title: string; detail: string}) {
  return <div className="fatal-state"><strong>{title}</strong><p>{detail}</p></div>;
}

function navigateTo(route: Exclude<WikiRoute, {kind: 'home'}>, replace: boolean) {
  const hash = routeHash(route);
  if (replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (location.hash !== hash) {
    location.hash = hash;
  }
}

function rankSearch(entries: SearchEntry[], rawQuery: string) {
  const terms = rawQuery.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return entries
    .map((entry) => {
      const title = entry.title.toLocaleLowerCase('zh-CN');
      const tags = entry.tags.join(' ').toLocaleLowerCase('zh-CN');
      const summary = entry.summary.toLocaleLowerCase('zh-CN');
      const text = entry.text.toLocaleLowerCase('zh-CN');
      if (!terms.every((term) => `${title} ${tags} ${summary} ${text}`.includes(term))) return null;
      const score = terms.reduce((total, term) => total
        + (title.includes(term) ? 100 : 0)
        + (tags.includes(term) ? 60 : 0)
        + (summary.includes(term) ? 30 : 0)
        + (text.includes(term) ? 10 : 0), 0);
      return {entry, score};
    })
    .filter((value): value is {entry: SearchEntry; score: number} => Boolean(value))
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
    .map((value) => value.entry);
}

function fetchJSON<T>(url: string): Promise<T> {
  return fetch(url, {credentials: 'same-origin', cache: 'no-store'}).then(async (response) => {
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json() as Promise<T>;
  });
}

function isEditable(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function readViewPreference(): ViewMode {
  try {
    return normalizeViewPreference(localStorage.getItem(viewPreferenceKey));
  } catch {
    return 'topic';
  }
}

function writeViewPreference(view: ViewMode) {
  try {
    localStorage.setItem(viewPreferenceKey, view);
  } catch {
    // The route remains the source of truth when storage is unavailable.
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(value));
}
