export function detectCodeLanguage(path: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  const ext = match ? match[1].toLowerCase() : '';
  switch (ext) {
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'tsx';
    case 'js':
    case 'cjs':
    case 'mjs':
      return 'javascript';
    case 'jsx':
      return 'jsx';
    case 'json':
      return 'json';
    case 'go':
      return 'go';
    case 'c':
      return 'c';
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'h':
    case 'hh':
    case 'hpp':
      return 'cpp';
    case 'rs':
      return 'rust';
    case 'lua':
      return 'lua';
    case 'hlsl':
    case 'fx':
    case 'fxh':
      return 'hlsl';
    case 'glsl':
    case 'vert':
    case 'frag':
    case 'geom':
    case 'comp':
      return 'glsl';
    case 'sh':
    case 'bash':
      return 'shellscript';
    case 'ps1':
    case 'psm1':
      return 'powershell';
    case 'py':
      return 'python';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'diff':
    case 'patch':
      return 'diff';
    case 'html':
      return 'markup';
    default:
      return 'clike';
  }
}
