import * as Lint from 'tslint';
import * as tsutils from 'tsutils';
import * as ts from 'typescript';
import { subtractSets, concatSets, isObservable, returnsObservable, computeInsertionIndexForImports } from './utils';

/**
 * A typed TSLint rule that inspects observable
 * static methods and turns them into function calls.
 */
export class Rule extends Lint.Rules.TypedRule {
  static metadata: Lint.IRuleMetadata = {
    ruleName: 'rxjs-no-static-observable-methods',
    description: 'Updates the static methods of the Observable class.',
    optionsDescription: '',
    options: null,
    typescriptOnly: true,
    type: 'functionality'
  };
  static IMPORT_FAILURE_STRING = 'prefer operator imports with no side-effects';
  static OBSERVABLE_FAILURE_STRING = 'prefer function calls';

  applyWithProgram(sourceFile: ts.SourceFile, program: ts.Program): Lint.RuleFailure[] {
    const failure = this.applyWithFunction(sourceFile, ctx => this.walk(ctx, program));
    return failure;
  }
  private walk(ctx: Lint.WalkContext<void>, program: ts.Program) {
    this.removePatchedOperatorImports(ctx);
    const sourceFile = ctx.sourceFile;
    const typeChecker = program.getTypeChecker();
    const insertionStart = computeInsertionIndexForImports(sourceFile);
    let rxjsOperatorImports = new Set<OperatorWithAlias>(
      Array.from(findImportedRxjsOperators(sourceFile)).map(o => OPERATOR_WITH_ALIAS_MAP[o])
    );

    function checkPatchableOperatorUsage(node: ts.Node) {
      if (!isRxjsStaticOperatorCallExpression(node, typeChecker)) {
        return ts.forEachChild(node, checkPatchableOperatorUsage);
      }

      const callExpr = node as ts.CallExpression;
      if (!tsutils.isPropertyAccessExpression(callExpr.expression)) {
        return ts.forEachChild(node, checkPatchableOperatorUsage);
      }

      const propAccess = callExpr.expression as ts.PropertyAccessExpression;
      const name = propAccess.name.getText(sourceFile);
      const operatorName = OPERATOR_RENAMES[name] || name;
      const start = propAccess.getStart(sourceFile);
      const end = propAccess.getEnd();
      const operatorsToImport = new Set<OperatorWithAlias>([OPERATOR_WITH_ALIAS_MAP[operatorName]]);
      const operatorsToAdd = subtractSets(operatorsToImport, rxjsOperatorImports);
      const imports = createImportReplacements(operatorsToAdd, insertionStart);
      rxjsOperatorImports = concatSets(rxjsOperatorImports, operatorsToAdd);
      ctx.addFailure(
        start,
        end,
        Rule.OBSERVABLE_FAILURE_STRING,
        [Lint.Replacement.replaceFromTo(start, end, operatorAlias(operatorName))].concat(imports)
      );
      return ts.forEachChild(node, checkPatchableOperatorUsage);
    }

    return ts.forEachChild(ctx.sourceFile, checkPatchableOperatorUsage);
  }

  private removePatchedOperatorImports(ctx: Lint.WalkContext<void>): void {
    const sourceFile = ctx.sourceFile;
    for (const importStatement of sourceFile.statements.filter(tsutils.isImportDeclaration)) {
      const moduleSpecifier = importStatement.moduleSpecifier.getText();
      if (!moduleSpecifier.startsWith(`'rxjs/add/observable/`)) {
        continue;
      }
      const importStatementStart = importStatement.getStart(sourceFile);
      const importStatementEnd = importStatement.getEnd();
      ctx.addFailure(
        importStatementStart,
        importStatementEnd,
        Rule.IMPORT_FAILURE_STRING,
        Lint.Replacement.deleteFromTo(importStatementStart, importStatementEnd)
      );
    }
  }
}

function isRxjsStaticOperator(node: ts.PropertyAccessExpression) {
  return 'Observable' === node.expression.getText() && RXJS_OPERATORS.has(node.name.getText());
}

function isRxjsStaticOperatorCallExpression(node: ts.Node, typeChecker: ts.TypeChecker) {
  // Expression is of the form fn()
  if (!tsutils.isCallExpression(node)) {
    return false;
  }
  // Expression is of the form foo.fn
  if (!tsutils.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  // fn is one of RxJs instance operators
  if (!isRxjsStaticOperator(node.expression)) {
    return false;
  }
  // fn(): k. Checks if k is an observable. Required to distinguish between
  // array operators with same name as RxJs operators.
  if (!returnsObservable(node, typeChecker)) {
    return false;
  }
  return true;
}

function findImportedRxjsOperators(sourceFile: ts.SourceFile): Set<string> {
  return new Set<string>(
    sourceFile.statements.filter(tsutils.isImportDeclaration).reduce((current, decl) => {
      if (!decl.importClause) {
        return current;
      }
      if (!decl.moduleSpecifier.getText().startsWith(`'rxjs'`)) {
        return current;
      }
      if (!decl.importClause.namedBindings) {
        return current;
      }
      const bindings = decl.importClause.namedBindings;
      if (ts.isNamedImports(bindings)) {
        return [
          ...current,
          ...(Array.from(bindings.elements) || []).map(element => {
            return element.name.getText();
          })
        ];
      }
      return current;
    }, [])
  );
}

function operatorAlias(operator: string) {
  return 'observable' + operator[0].toUpperCase() + operator.substring(1, operator.length);
}

function createImportReplacements(operatorsToAdd: Set<OperatorWithAlias>, startIndex: number): Lint.Replacement[] {
  return [...Array.from(operatorsToAdd.values())].map(tuple =>
    Lint.Replacement.appendText(startIndex, `\nimport {${tuple.operator} as ${tuple.alias}} from 'rxjs';\n`)
  );
}

/*
 * https://github.com/ReactiveX/rxjs/tree/master/compat/add/observable
 */
const RXJS_OPERATORS = new Set([
  'bindCallback',
  'bindNodeCallback',
  'combineLatest',
  'concat',
  'defer',
  'empty',
  'forkJoin',
  'from',
  'fromEvent',
  'fromEventPattern',
  'fromPromise',
  'generate',
  'if',
  'interval',
  'merge',
  'never',
  'of',
  'onErrorResumeNext',
  'pairs',
  'rase',
  'range',
  'throw',
  'timer',
  'using',
  'zip'
]);

// Not handling NEVER and EMPTY
const OPERATOR_RENAMES: { [key: string]: string } = {
  throw: 'throwError',
  if: 'iif',
  fromPromise: 'from'
};

type OperatorWithAlias = { operator: string; alias: string };
type OperatorWithAliasMap = { [key: string]: OperatorWithAlias };

const OPERATOR_WITH_ALIAS_MAP: OperatorWithAliasMap = Array.from(RXJS_OPERATORS).reduce((a, o) => {
  const operatorName = OPERATOR_RENAMES[o] || o;
  a[operatorName] = {
    operator: operatorName,
    alias: operatorAlias(operatorName)
  };
  return a;
}, {});
