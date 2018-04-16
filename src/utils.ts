import * as ts from 'typescript';
import * as tsutils from 'tsutils';

export function subtractSets<T>(source: Set<T>, target: Set<T>): Set<T> {
  return new Set([...Array.from(source.values())].filter(x => !target.has(x)));
}

export function concatSets<T>(set1: Set<T>, set2: Set<T>): Set<T> {
  return new Set([...Array.from(set1.values()), ...Array.from(set2.values())]);
}

export function isObservable(type: ts.Type, tc: ts.TypeChecker): boolean {
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

export function returnsObservable(node: ts.CallLikeExpression, tc: ts.TypeChecker) {
  const signature = tc.getResolvedSignature(node);
  if (signature === undefined) {
    return false;
  }
  const returnType = tc.getReturnTypeOfSignature(signature);
  return isObservable(returnType, tc);
}

export function computeInsertionIndexForImports(sourceFile: ts.SourceFile): number {
  const comments = ts.getLeadingCommentRanges(sourceFile.getFullText(), 0) || [];
  if (comments.length > 0) {
    const commentEnd = comments[0].end;
    if (sourceFile.text.substring(commentEnd, commentEnd + 2) === '\n\n') {
      return commentEnd + 2;
    }
  }
  return sourceFile.getFullStart();
}
