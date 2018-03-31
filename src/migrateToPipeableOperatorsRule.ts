// Original author Bowen Ni
// Modifications mgechev.

import * as Lint from 'tslint';
import * as tsutils from 'tsutils';
import * as ts from 'typescript';
/**
 * A typed TSLint rule that inspects observable chains using patched RxJs
 * operators and turns them into a pipeable operator chain.
 */
export class Rule extends Lint.Rules.TypedRule {
  static metadata: Lint.IRuleMetadata = {
    ruleName: 'migrate-to-pipeable-operators',
    description: `Pipeable operators offer a new way of composing observable chains and
        they have advantages for both application developers and library
        authors.`,
    rationale: 'go/pipeable-operators',
    optionsDescription: '',
    options: null,
    typescriptOnly: true,
    type: 'functionality'
  };
  static FAILURE_STRING = 'Prefer pipeable operators. See go/pipeable-operators';
  applyWithProgram(sourceFile: ts.SourceFile, program: ts.Program): Lint.RuleFailure[] {
    return this.applyWithFunction(sourceFile, ctx => this.walk(ctx, program));
  }
  private walk(ctx: Lint.WalkContext<void>, program: ts.Program) {
    this.removePatchedOperatorImports(ctx);
    const sourceFile = ctx.sourceFile;
    const typeChecker = program.getTypeChecker();
    const insertionStart = computeInsertionIndexForImports(sourceFile);
    let rxjsOperatorImports = findImportedRxjsOperators(sourceFile);
    /**
     * Creates a lint failure with suggested replacements if an observable chain
     * of patched operators is found.
     *
     * <p>The expression
     * <pre>const subs = foo.do(console.log)
     *                      .map( x =>2*x)
     *                      .do(console.log)
     *                      .switchMap( y => z)
     *                      .subscribe(fn);
     * </pre>
     *
     * should produce a failure at the underlined section below:
     * <pre>const subs = foo.do(console.log)
     *                      ----------------
     *                      .map( x =>2*x)
     *                      --------------
     *                      .do(console.log)
     *                      ----------------
     *                      .switchMap( y => z)
     *                      -------------------
     *                      .subscribe(fn);
     * </pre>
     * and suggest replacements that would produce text like
     * <pre>const subs = foo.pipe(
     *                          tap(console.log),
     *                          map( x =>2*x),
     *                          tap(console.log),
     *                          switchMap( y => z),
     *                      )
     *                      .subscribe(fn);
     * </pre>
     */
    function checkPatchableOperatorUsage(node: ts.Node): void {
      // Navigate up the expression tree until a call expression with an rxjs
      // operator is found.
      // If the parent expression is also an rxjs operator call expression,
      // continue.
      // If not, then verify that the parent is indeed an observable.
      // files the node with the expression 'foo'.
      // Using the example above, the traversal would stop at 'foo'.
      if (!isRxjsInstanceOperatorCallExpression(node, typeChecker)) {
        return ts.forEachChild(node, checkPatchableOperatorUsage);
      }
      const immediateParent = (node as ts.CallExpression).expression as ts.PropertyAccessExpression;
      // Get the preceeding expression (specific child node) to which the
      // current node was chained to. If node represents text like
      // foo.do(console.log).map( x =>2*x), then preceedingNode would have the
      // text foo.do(console.log).
      const preceedingNode = immediateParent.expression;
      // If the preceeding node is also an RxJS call then continue traversal.
      if (isRxjsInstanceOperatorCallExpression(preceedingNode, typeChecker)) {
        return ts.forEachChild(node, checkPatchableOperatorUsage);
      }
      // Some Rxjs operators have same names as array operators, and could be
      // chained array operators that return an observable instead. These nodes
      // should be skipped.
      // eg.functionReturningArray().reduce(functionProducingObservable)
      // or arrayObject.reduce(functionProducingObservable)
      if (tsutils.isCallExpression(preceedingNode) || tsutils.isNewExpression(preceedingNode)) {
        if (!returnsObservable(preceedingNode, typeChecker)) {
          return ts.forEachChild(node, checkPatchableOperatorUsage);
        }
      } else if (!isObservable(typeChecker.getTypeAtLocation(preceedingNode), typeChecker)) {
        return ts.forEachChild(node, checkPatchableOperatorUsage);
      }
      const failureStart = immediateParent.getStart(sourceFile) + immediateParent.getText(sourceFile).lastIndexOf('.');
      const lastNode = findLastObservableExpression(preceedingNode, typeChecker);
      const failureEnd = lastNode.getEnd();
      const pipeReplacement = Lint.Replacement.appendText(preceedingNode.getEnd(), '.pipe(');
      const operatorsToImport = new Set<string>();
      const operatorReplacements = replaceWithPipeableOperators(preceedingNode, lastNode, operatorsToImport);
      const operatorsToAdd = subtractSets(operatorsToImport, rxjsOperatorImports);
      const importReplacements = createImportReplacements(operatorsToAdd, insertionStart);
      rxjsOperatorImports = concatSets(rxjsOperatorImports, operatorsToAdd);
      const allReplacements = [pipeReplacement, ...operatorReplacements, ...importReplacements];
      ctx.addFailure(failureStart, failureEnd, Rule.FAILURE_STRING, allReplacements);
      return ts.forEachChild(node, checkPatchableOperatorUsage);
    }
    return ts.forEachChild(ctx.sourceFile, checkPatchableOperatorUsage);
  }
  /**
   * Generates replacements to remove imports for patched operators.
   */
  private removePatchedOperatorImports(ctx: Lint.WalkContext<void>): void {
    const sourceFile = ctx.sourceFile;
    for (const importStatement of sourceFile.statements.filter(tsutils.isImportDeclaration)) {
      const moduleSpecifier = importStatement.moduleSpecifier.getText();
      if (!moduleSpecifier.startsWith(`'rxjs/operator/`) && !moduleSpecifier.startsWith(`'rxjs/add/operator/`)) {
        continue;
      }
      const importStatementStart = importStatement.getStart(sourceFile);
      const importStatementEnd = importStatement.getEnd();
      ctx.addFailure(
        importStatementStart,
        importStatementEnd,
        Rule.FAILURE_STRING,
        Lint.Replacement.deleteFromTo(importStatementStart, importStatementEnd)
      );
    }
  }
}
/**
 * Returns true if the {@link type} is an Observable or one of its sub-classes.
 */
function isObservable(type: ts.Type, tc: ts.TypeChecker): boolean {
  if (tsutils.isTypeReference(type)) {
    type = type.target;
  }
  if (type.symbol !== undefined && type.symbol.name === 'Observable') {
    return true;
  }
  if (tsutils.isUnionOrIntersectionType(type)) {
    return type.types.some(t => isObservable(t, tc));
  }
  const bases = type.getBaseTypes();
  return bases !== undefined && bases.some(t => isObservable(t, tc));
}
/**
 * Returns true if the return type of the expression represented by the {@link
 * node} is an Observable or one of its subclasses.
 */
function returnsObservable(node: ts.CallLikeExpression, tc: ts.TypeChecker) {
  const signature = tc.getResolvedSignature(node);
  if (signature === undefined) {
    return false;
  }
  const returnType = tc.getReturnTypeOfSignature(signature);
  return isObservable(returnType, tc);
}
/**
 * Returns true if the identifier of the current expression is an RxJS instance
 * operator like map, switchMap etc.
 */
function isRxjsInstanceOperator(node: ts.PropertyAccessExpression) {
  return 'Observable' !== node.expression.getText() && RXJS_OPERATORS.has(node.name.getText());
}
/**
 * Returns true if {@link node} is a call expression containing an RxJs instance
 * operator and returns an observable. eg map(fn), switchMap(fn)
 */
function isRxjsInstanceOperatorCallExpression(node: ts.Node, typeChecker: ts.TypeChecker) {
  // Expression is of the form fn()
  if (!tsutils.isCallExpression(node)) {
    return false;
  }
  // Expression is of the form foo.fn
  if (!tsutils.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  // fn is one of RxJs instance operators
  if (!isRxjsInstanceOperator(node.expression)) {
    return false;
  }
  // fn(): k. Checks if k is an observable. Required to distinguish between
  // array operators with same name as RxJs operators.
  if (!returnsObservable(node, typeChecker)) {
    return false;
  }
  return true;
}
/**
 * Finds all pipeable operators that are imported in the {@link sourceFile}.
 *
 * <p> Searches for import statements of the type
 * <code> import {map} from 'rxjs/operators/map;</code>
 *  and collects the named bindings.
 */
function findImportedRxjsOperators(sourceFile: ts.SourceFile): Set<string> {
  return new Set<string>(
    sourceFile.statements.filter(tsutils.isImportDeclaration).reduce((current, decl) => {
      if (!decl.importClause) {
        return current;
      }
      if (!decl.moduleSpecifier.getText().startsWith(`'rxjs/operators`)) {
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
/**
 * Returns the index to be used for inserting import statements potentially
 * after a leading file overview comment (separated from the file with \n\n).
 */
function computeInsertionIndexForImports(sourceFile: ts.SourceFile): number {
  const comments = ts.getLeadingCommentRanges(sourceFile.getFullText(), 0) || [];
  if (comments.length > 0) {
    const commentEnd = comments[0].end;
    if (sourceFile.text.substring(commentEnd, commentEnd + 2) === '\n\n') {
      return commentEnd + 2;
    }
  }
  return sourceFile.getFullStart();
}
/**
 * Generates an array of {@link Lint.Replacement} representing import statements
 * for the {@link operatorsToAdd}.
 *
 * @param operatorsToAdd Set of Rxjs operators that need to be imported
 * @param startIndex Position where the {@link Lint.Replacement} can be inserted
 */
function createImportReplacements(operatorsToAdd: Set<string>, startIndex: number): Lint.Replacement[] {
  return [...Array.from(operatorsToAdd.values())].map(operator =>
    Lint.Replacement.appendText(startIndex, `\nimport {${operator}} from 'rxjs/operators/${operator}';\n`)
  );
}
/**
 * Returns a new Set that contains elements present in the {@link source} but
 * not present in {@link target}
 */
function subtractSets<T>(source: Set<T>, target: Set<T>): Set<T> {
  return new Set([...Array.from(source.values())].filter(x => !target.has(x)));
}
/**
 * Returns a new Set that contains union of the two input sets.
 */
function concatSets<T>(set1: Set<T>, set2: Set<T>): Set<T> {
  return new Set([...Array.from(set1.values()), ...Array.from(set2.values())]);
}
/**
 * Returns the last chained RxJS call expression by walking up the AST.
 *
 * <p> For an expression like foo.map(Fn).switchMap(Fn) - the function starts
 * with node = foo. node.parent - represents the property expression foo.map and
 * node.parent.parent represents the call expression foo.map().
 *
 */
function findLastObservableExpression(node: ts.Node, typeChecker: ts.TypeChecker): ts.Node {
  let currentNode = node;
  while (isAncestorRxjsOperatorCall(currentNode, typeChecker)) {
    currentNode = currentNode.parent!.parent!;
  }
  return currentNode;
}
/**
 * Returns true if the grandfather of the {@link node} is a call expression of
 * an RxJs instance operator.
 */
function isAncestorRxjsOperatorCall(node: ts.Node, typeChecker: ts.TypeChecker): boolean {
  // If this is the only operator in the chain.
  if (!node.parent) {
    return false;
  }
  // Do not overstep the boundary of an arrow function.
  if (ts.isArrowFunction(node.parent)) {
    return false;
  }
  if (!node.parent.parent) {
    return false;
  }
  return isRxjsInstanceOperatorCallExpression(node.parent.parent, typeChecker);
}
/**
 * Recursively generates {@link Lint.Replacement} to convert a chained rxjs call
 * expression to an expression using pipeable rxjs operators.
 *
 * @param currentNode The node in the chained expression being processed
 * @param lastNode The last node of the chained expression
 * @param operatorsToImport Collects the operators encountered in the expression
 * so far
 * @param notStart Whether the {@link currentNode} is the first expression in
 * the chain.
 */
function replaceWithPipeableOperators(
  currentNode: ts.Node,
  lastNode: ts.Node,
  operatorsToImport: Set<string>,
  notStart = false
): Lint.Replacement[] {
  // Reached the root of the expression, nothing to replace.
  if (!currentNode.parent || !currentNode.parent.parent) {
    return [];
  }
  // For an arbitrary expression like
  // foo.do(console.log).map( x =>2*x).do(console.log).switchMap( y => z);
  // if currentNode is foo.do(console.log),
  // immediateParent = foo.do(console.log).map
  const immediateParent = currentNode.parent;
  const immediateParentText = immediateParent.getText();
  const identifierStart = immediateParentText.lastIndexOf('.');
  const identifierText = immediateParentText.slice(identifierStart + 1);
  const pipeableOperator = PIPEABLE_OPERATOR_MAPPING[identifierText] || identifierText;
  operatorsToImport.add(pipeableOperator);
  // Generates a replacement that would replace .map with map using absolute
  // position of the text to be replaced.
  const operatorReplacement = Lint.Replacement.replaceFromTo(
    immediateParent.getEnd() - identifierText.length - 1,
    immediateParent.getEnd(),
    pipeableOperator
  );
  // parentNode = foo.do(console.log).map( x =>2*x)
  const parentNode = currentNode.parent.parent;
  const moreReplacements =
    parentNode === lastNode
      ? [Lint.Replacement.appendText(parentNode.getEnd(), notStart ? ',)' : ')')]
      : replaceWithPipeableOperators(parentNode, lastNode, operatorsToImport, true);
  // Generates a replacement for adding a ',' after the call expression
  const separatorReplacements = notStart ? [Lint.Replacement.appendText(currentNode.getEnd(), ',')] : [];
  return [operatorReplacement, ...separatorReplacements, ...moreReplacements];
}
/**
 * Set of all instance operators, including those renamed as part of lettable
 * operator migration. Source:(RxJS v5)
 * https://github.com/ReactiveX/rxjs/tree/stable/src/operators
 */
const RXJS_OPERATORS = new Set([
  'audit',
  'auditTime',
  'buffer',
  'bufferCount',
  'bufferTime',
  'bufferToggle',
  'bufferWhen',
  'catchError',
  'combineAll',
  'combineLatest',
  'concat',
  'concatAll',
  'concatMap',
  'concatMapTo',
  'count',
  'debounce',
  'debounceTime',
  'defaultIfEmpty',
  'delay',
  'delayWhen',
  'dematerialize',
  'distinct',
  'distinctUntilChanged',
  'distinctUntilKeyChanged',
  'elementAt',
  'every',
  'exhaust',
  'exhaustMap',
  'expand',
  'filter',
  'finalize',
  'find',
  'findIndex',
  'first',
  'groupBy',
  'ignoreElements',
  'isEmpty',
  'last',
  'map',
  'mapTo',
  'materialize',
  'max',
  'merge',
  'mergeAll',
  'mergeMap',
  'mergeMapTo',
  'mergeScan',
  'min',
  'multicast',
  'observeOn',
  'onErrorResumeNext',
  'pairwise',
  'partition',
  'pluck',
  'publish',
  'publishBehavior',
  'publishLast',
  'publishReplay',
  'race',
  'reduce',
  'refCount',
  'repeat',
  'repeatWhen',
  'retry',
  'retryWhen',
  'sample',
  'sampleTime',
  'scan',
  'sequenceEqual',
  'share',
  'shareReplay',
  'single',
  'skip',
  'skipLast',
  'skipUntil',
  'skipWhile',
  'startWith',
  'subscribeOn',
  'switchAll',
  'switchMap',
  'switchMapTo',
  'take',
  'takeLast',
  'takeUntil',
  'takeWhile',
  'tap',
  'throttle',
  'throttleTime',
  'timeInterval',
  'timeout',
  'timeoutWith',
  'timestamp',
  'toArray',
  'window',
  'windowCount',
  'windowTime',
  'windowToggle',
  'windowWhen',
  'withLatestFrom',
  'zip',
  'zipAll',
  'do',
  'catch',
  'flatMap',
  'flatMapTo',
  'finally',
  'switch'
]);
/**
 * Represents the mapping for pipeable version of some operators whose name has
 * changed due to conflict with JavaScript keyword restrictions.
 */
const PIPEABLE_OPERATOR_MAPPING: { [key: string]: string } = {
  do: 'tap',
  catch: 'catchError',
  flatMap: 'mergeMap',
  flatMapTo: 'mergeMapTo',
  finally: 'finalize',
  switch: 'switchAll'
};
