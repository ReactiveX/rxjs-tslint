import {
  assertSuccess,
  assertAnnotated,
  assertMultipleAnnotated,
  assertFailures,
  assertReplacements
} from './testHelper';
import { assert } from 'chai';
import { RuleFailure } from 'tslint';

describe('collapse-rxjs-imports', () => {
  it('should collapse imports', () => {
    const source = `
      import { foo } from 'rxjs';
      ~~~~~~~~~~~~~~~~~~~~~~~~~~~
      import { baz } from '@angular/core';
      import { bar } from 'rxjs';
      `;

    const err = assertMultipleAnnotated({
      ruleName: 'collapse-rxjs-imports',
      failures: [
        {
          msg: 'duplicate RxJS import',
          char: '~'
        }
      ],
      source
    });

    const before = `
      import { foo } from 'rxjs';
      import { baz } from '@angular/core';
      import { bar } from 'rxjs';
      `;
    const after = `
      import { foo ,  bar } from 'rxjs';
      import { baz } from '@angular/core';
      `;

    assertReplacements(err as RuleFailure[], before, after);
  });

  it('should collapse imports properly if there are following imports', () => {
    const source = `
      import { foo } from 'rxjs';
      ~~~~~~~~~~~~~~~~~~~~~~~~~~~
      import { baz } from '@angular/core';
      import { bar } from 'rxjs';
      import { qux } from '@angular/core';
      `;

    const err = assertMultipleAnnotated({
      ruleName: 'collapse-rxjs-imports',
      failures: [
        {
          msg: 'duplicate RxJS import',
          char: '~'
        }
      ],
      source
    });

    const before = `
      import { foo } from 'rxjs';
      import { baz } from '@angular/core';
      import { bar } from 'rxjs';
      import { qux } from '@angular/core';
      `;
    const after = `
      import { foo ,  bar } from 'rxjs';
      import { baz } from '@angular/core';
      import { qux } from '@angular/core';
      `;

    assertReplacements(err as RuleFailure[], before, after);
  });
});
