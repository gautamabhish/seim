import { ReactComponent, ConsistencyCheck, FrontendRouteConfig } from './types';
import { createHash } from 'crypto';

export class ReactConsistencyChecker {
  public check(existing: ReactComponent, updated: ReactComponent): ConsistencyCheck {
    const issues: ConsistencyCheck['issues'] = [];
    
    if (existing.code.includes('export default') && !updated.code.includes('export default')) {
      issues.push({
        type: 'breaking_export',
        description: 'Default export was removed',
        severity: 'error'
      });
    }

    const extractProps = (code: string, name: string): string => {
      const regex = new RegExp(`(?:interface|type)\\s+${name}Props(?:\\s*<[^>]+>)?(?:\\s*extends\\s+[^{=]+)?(?:\\s*=\\s*[^;{\\n]+)?\\s*([;{])`);
      const match = code.match(regex);
      if (!match) return '';
      if (match[1] === ';') {
        const lineMatch = code.match(new RegExp(`type\\s+${name}Props[^;\\n]+`));
        return lineMatch ? lineMatch[0] : '';
      }
      const startIndex = match.index! + match[0].length - 1;
      let depth = 0;
      let body = '';
      for (let i = startIndex; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') {
          depth--;
          if (depth === 0) {
            body = code.slice(startIndex + 1, i);
            break;
          }
        }
      }
      return body;
    };

    const oldProps = extractProps(existing.code, existing.name);
    const newProps = extractProps(updated.code, updated.name);

    if (existing.code.includes(`${existing.name}Props`) && !updated.code.includes(`${updated.name}Props`)) {
       issues.push({
         type: 'missing_prop',
         description: `Props interface ${existing.name}Props was removed`,
         severity: 'error'
       });
    }

    return {
      passed: issues.every(i => i.severity !== 'error'),
      issues
    };
  }

  public checkRouteConflict(newPath: string, existingRoutes: FrontendRouteConfig[]): ConsistencyCheck {
    const issues: ConsistencyCheck['issues'] = [];
    if (existingRoutes.some(r => r.path === newPath)) {
      issues.push({
        type: 'route_conflict',
        description: `Route path ${newPath} already exists`,
        severity: 'error'
      });
    }
    return {
      passed: issues.length === 0,
      issues
    };
  }

  public validateStructure(code: string, componentName: string): ConsistencyCheck {
    const issues: ConsistencyCheck['issues'] = [];
    
    if (!code.includes('export default') && !code.includes(`export const ${componentName}`) && !code.includes(`export function ${componentName}`)) {
      issues.push({
        type: 'breaking_export',
        description: `Component ${componentName} is not exported`,
        severity: 'error'
      });
    }

    if (!code.includes('return (') && !code.includes('return <')) {
      issues.push({
        type: 'type_change',
        description: 'Component does not seem to return JSX',
        severity: 'error'
      });
    }

    if (code.includes('dangerouslySetInnerHTML')) {
      issues.push({
        type: 'type_change',
        description: 'Component uses dangerouslySetInnerHTML',
        severity: 'warning'
      });
    }

    if (code.includes('eval(') || code.includes('document.write(')) {
      issues.push({
        type: 'type_change',
        description: 'Component uses unsafe DOM operations',
        severity: 'error'
      });
    }

    return {
      passed: issues.every(i => i.severity !== 'error'),
      issues
    };
  }

  public computeHash(code: string): string {
    const propMatch = code.match(/(?:interface|type)\s+\w+Props\s*=?\s*{[^}]*}/);
    let surface = '';
    if (propMatch) {
      surface += propMatch[0];
    }
    const exportMatch = code.match(/export\s+(?:default\s+)?(?:function|const|class)\s+\w+/);
    if (exportMatch) {
      surface += exportMatch[0];
    }
    return createHash('sha256').update(surface || code).digest('hex');
  }
}
