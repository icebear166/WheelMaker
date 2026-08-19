export type ViewMode = 'topic' | 'project';

export type WikiRoute =
  | {kind: 'home'}
  | {kind: 'section'; view: 'topic'; sectionId: string}
  | {kind: 'category'; view: 'topic'; sectionId: string; categoryId: string}
  | {kind: 'project'; view: 'project'; projectId: string}
  | {kind: 'project-section'; view: 'project'; projectId: string; sectionId: string}
  | {kind: 'project-category'; view: 'project'; projectId: string; sectionId: string; categoryId: string}
  | {kind: 'article'; view: 'topic'; articleId: string}
  | {kind: 'article'; view: 'project'; projectId: string; articleId: string};

const segment = '[a-z0-9]+(?:-[a-z0-9]+)*';

export function parseWikiRoute(hash: string): WikiRoute {
  const projectArticle = new RegExp(`^#/projects/(${segment})/articles/(${segment})(?:#.*)?$`).exec(hash);
  if (projectArticle) {
    return {kind: 'article', view: 'project', projectId: projectArticle[1], articleId: projectArticle[2]};
  }

  const projectCategory = new RegExp(`^#/projects/(${segment})/categories/(${segment})/(${segment})$`).exec(hash);
  if (projectCategory) {
    return {
      kind: 'project-category',
      view: 'project',
      projectId: projectCategory[1],
      sectionId: projectCategory[2],
      categoryId: projectCategory[3],
    };
  }

  const projectSection = new RegExp(`^#/projects/(${segment})/sections/(${segment})$`).exec(hash);
  if (projectSection) {
    return {
      kind: 'project-section',
      view: 'project',
      projectId: projectSection[1],
      sectionId: projectSection[2],
    };
  }

  const project = new RegExp(`^#/projects/(${segment})$`).exec(hash);
  if (project) return {kind: 'project', view: 'project', projectId: project[1]};

  const topicArticle = new RegExp(`^#/topics/articles/(${segment})(?:#.*)?$`).exec(hash);
  if (topicArticle) return {kind: 'article', view: 'topic', articleId: topicArticle[1]};

  const topicCategory = new RegExp(`^#/topics/categories/(${segment})/(${segment})$`).exec(hash);
  if (topicCategory) {
    return {kind: 'category', view: 'topic', sectionId: topicCategory[1], categoryId: topicCategory[2]};
  }

  const topicSection = new RegExp(`^#/topics/sections/(${segment})$`).exec(hash);
  if (topicSection) return {kind: 'section', view: 'topic', sectionId: topicSection[1]};

  const legacyArticle = new RegExp(`^#/articles/(${segment})(?:#.*)?$`).exec(hash);
  if (legacyArticle) return {kind: 'article', view: 'topic', articleId: legacyArticle[1]};

  const legacyCategory = new RegExp(`^#/categories/(${segment})/(${segment})$`).exec(hash);
  if (legacyCategory) {
    return {kind: 'category', view: 'topic', sectionId: legacyCategory[1], categoryId: legacyCategory[2]};
  }

  const legacySection = new RegExp(`^#/sections/(${segment})$`).exec(hash);
  if (legacySection) return {kind: 'section', view: 'topic', sectionId: legacySection[1]};

  return {kind: 'home'};
}

export function routeHash(route: Exclude<WikiRoute, {kind: 'home'}>) {
  if (route.kind === 'article') {
    return route.view === 'project'
      ? `#/projects/${route.projectId}/articles/${route.articleId}`
      : `#/topics/articles/${route.articleId}`;
  }
  if (route.kind === 'category') return `#/topics/categories/${route.sectionId}/${route.categoryId}`;
  if (route.kind === 'section') return `#/topics/sections/${route.sectionId}`;
  if (route.kind === 'project-category') {
    return `#/projects/${route.projectId}/categories/${route.sectionId}/${route.categoryId}`;
  }
  if (route.kind === 'project-section') return `#/projects/${route.projectId}/sections/${route.sectionId}`;
  return `#/projects/${route.projectId}`;
}

export function normalizeViewPreference(value: string | null): ViewMode {
  return value === 'project' ? 'project' : 'topic';
}

export function defaultRouteForView(
  view: ViewMode,
  defaultSectionId: string,
  defaultProjectId: string,
): Exclude<WikiRoute, {kind: 'home'}> {
  return view === 'project'
    ? {kind: 'project', view: 'project', projectId: defaultProjectId}
    : {kind: 'section', view: 'topic', sectionId: defaultSectionId};
}

export function switchRouteView(
  route: WikiRoute,
  view: ViewMode,
  options: {
    defaultSectionId: string;
    defaultProjectId: string;
    articleProjectIds: string[];
  },
): Exclude<WikiRoute, {kind: 'home'}> {
  if (route.kind !== 'home' && route.view === view) return route;
  if (route.kind === 'article') {
    if (view === 'topic') return {kind: 'article', view: 'topic', articleId: route.articleId};
    const projectId = options.articleProjectIds[0] || 'unassigned';
    return {kind: 'article', view: 'project', projectId, articleId: route.articleId};
  }
  return defaultRouteForView(view, options.defaultSectionId, options.defaultProjectId);
}
