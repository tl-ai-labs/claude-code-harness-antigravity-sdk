# Fix PrismaService compilation error

## Problem
The file `src/modules/kudos/prisma.service.ts` has a compilation error:

```
src/modules/kudos/prisma.service.ts(11,14): error TS2345: Argument of type '"beforeExit"' is not assignable to parameter of type 'never'.
```

This is caused by the `enableShutdownHooks` method which uses `this.$on('beforeExit', ...)` — this API is not compatible with the installed Prisma version (v5.22.0).

## Fix needed
Remove the `enableShutdownHooks` method entirely and the `INestApplication` import. The file should only contain:
- The `@Injectable()` decorator
- The class extending `PrismaClient` implementing `OnModuleInit`
- The `onModuleInit` method that calls `this.$connect()`

Read the current file first, then fix it. Do NOT create any new files or modify any other files.
