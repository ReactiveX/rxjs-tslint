# RxJS Migrations

TSLint rules for migration to the latest version of RxJS.

## Rules

This repository provides the following rules:

|            Rule Name            | Configuration |                       Description                       |
| :-----------------------------: | :-----------: | :-----------------------------------------------------: |
|     `collapse-rxjs-imports`     |     none      | Collapses multiple imports from `rxjs` to a single one. |
| `migrate-to-pipeable-operators` |     none      |      Migrates side-effect operators to pipeables.       |
|      `update-rxjs-imports`      |     none      |         Updates RxJS 5.x.x imports to RxJS 6.0          |

## Usage with Angular CLI

1.  Build the project:

```bash
git clone https://github.com/mgechev/rxjs-migrate
cd rxjs-migrate && npm i
npm run build
```

2.  In your project's directory, create a file called `migrate-rxjs.tslint.json` with the following content:

```json
{
  "rulesDirectory": ["path/to/the/compiled/rules"],
  "rules": {
    "update-rxjs-imports": true,
    "migrate-to-pipeable-operators": true,
    "collapse-rxjs-imports": true
  }
}
```

3.  Run tslint:

```bash
./node_modules/.bin/tslint -c migrate-rxjs.tslint.json --project src/tsconfig.app.json --fix
```

4.  Enjoy! 😎

### Notes

* Once you run all the migrations check the diff and make sure that everything looks as expected. If you see any issues, open an issue at https://github.com/angular/angular-cli.
* Although the migration will format your source code, it's likely that that the style is not consistent with the rest of your project. To make sure that everything is properly following your project's style guide, use a formatter such as prettier or clang-format.

## License

MIT
