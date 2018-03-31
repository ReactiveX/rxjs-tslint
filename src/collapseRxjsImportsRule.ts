// Original author Bowen Ni
// Modifications mgechev.

import * as Lint from 'tslint';
import * as tsutils from 'tsutils';
import * as ts from 'typescript';

const FAILURE_STRING = 'duplicate RxJS import';
/**
 * A rule to combine the duplicate imports of rxjs.
 */
export class Rule extends Lint.Rules.AbstractRule {
  static metadata: Lint.IRuleMetadata = {
    ruleName: 'collapse-rxjs-imports',
    description:
      `In RxJS v6.0 most imports are just ` +
      `"import {...} from 'rxjs';". This TSLint rule collapses the ` +
      `duplicate imports of rxjs into one import statement.`,
    rationale: '',
    options: null,
    optionsDescription: '',
    type: 'style',
    typescriptOnly: true
  };
  apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
    return this.applyWithFunction(sourceFile, walk);
  }
}

interface RxJSImport {
  namedImports: string;
  importStatements: ts.ImportDeclaration[];
}

const RXJS_IMPORTS = 'rxjs';

function walk(ctx: Lint.WalkContext<void>) {
  const allRxjsImports = new Map<string, RxJSImport>();
  // Collect all imports from RxJS
  for (const statement of ctx.sourceFile.statements) {
    if (!tsutils.isImportDeclaration(statement)) {
      continue;
    }
    if (!statement.importClause) {
      continue;
    }
    if (!statement.importClause.namedBindings) {
      continue;
    }
    if (!tsutils.isNamedImports(statement.importClause.namedBindings)) {
      continue;
    }
    if (!tsutils.isLiteralExpression(statement.moduleSpecifier)) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (!moduleSpecifier.startsWith(RXJS_IMPORTS)) {
      continue;
    }
    const existingImport = allRxjsImports.get(moduleSpecifier);
    // namedBindings is a named import. e.g. {foo as bar, baz}
    // Strip the braces.
    const namedImports = statement.importClause.namedBindings.getText(ctx.sourceFile).slice(1, -1);
    if (!existingImport) {
      allRxjsImports.set(moduleSpecifier, {
        namedImports,
        importStatements: [statement]
      });
    } else {
      // Collect all named imports and collapse them into one.
      existingImport.namedImports += `, ${namedImports}`;
      existingImport.importStatements.push(statement);
    }
  }
  // For every import path if there are more than one import statement collapse
  // them.
  const entries = allRxjsImports.entries();
  while (true) {
    let current = entries.next();
    if (current.done) {
      break;
    }
    const [path, imports] = current.value;
    if (imports.importStatements.length === 1) {
      continue;
    }
    const fixes: Lint.Replacement[] = [
      Lint.Replacement.replaceNode(
        imports.importStatements[0].importClause!.namedBindings!,
        `{${imports.namedImports}}`
      )
    ];
    for (const duplicateImport of imports.importStatements.slice(1)) {
      // Only remove trailing comments for the removed import statements because
      // those comments are mostly likely comments (which should not be needed in
      // the first place). Keep leading comments because that probably contains
      // something meaningful.
      let end = duplicateImport.end;
      tsutils.forEachComment(
        duplicateImport,
        (fullText: string, comment: ts.CommentRange) => {
          end = end < comment.end ? comment.end : end;
        },
        ctx.sourceFile
      );
      fixes.push(Lint.Replacement.deleteFromTo(duplicateImport.getFullStart(), end));
    }
    ctx.addFailureAtNode(imports.importStatements[0], FAILURE_STRING, fixes);
  }
}
