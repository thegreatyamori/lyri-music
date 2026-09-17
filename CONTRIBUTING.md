# Contributing

## Read CONTEXT.md first

It carries the domain vocabulary and the architecture rules. Changes that fight
those rules need a reason, and the reason belongs in an ADR under `docs/adr/`.

## The one hard rule: no lyrics in the repository

This project must never contain song lyrics. Not in fixtures, not in tests, not
in a sample response, not in a screenshot. That single rule is what keeps this a
tool rather than a redistribution problem, and it is not negotiable.

Practically:

- **Tests use invented text.** Nonsense words are better than something plausible:
  they make a violation obvious in review. See `tests/lyrics.test.ts`.
- **Fixtures must stay small.** `pnpm check:no-lyrics` fails on any `.lrc`,
  `.lrcx` or `.ttml` file, and on anything over 4 KB under `tests/fixtures/`.
- **Screenshots must not show lyrics.** Capture an empty state, an instrumental,
  or run the panel against invented text.
- Do not work around the check. If it is in the way, the rule is being broken.

## Working on a provider

A provider is a module in `src/lib/providers/` implementing `LyricsProvider`:

- Return `null` for a miss. Never throw to report "not found".
- Honour the `AbortSignal` — losers of a lookup are cancelled.
- Do not import another provider, the lookup, or anything from `content/`.
- Set `enabledByDefault: false` if the service's access is unofficial.
- Add yourself to the registry in `src/lib/providers/index.ts`. That is the only
  edit outside your own module; if you find yourself editing the lookup, the
  registry is being used as control flow and that is a bug.

Use `fromLrc` / `fromPlainText` from `src/lib/domain/lyrics.ts` rather than
parsing timestamps yourself.

## Before opening a pull request

```
pnpm verify
```

That runs the no-lyrics check, the type checker, the tests, and both builds.

## Style

- Strict TypeScript is on, including `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. Handle the `undefined`, do not assert it away.
- Comments explain *why*. A comment restating the code is noise; a comment
  recording a provider quirk or a reason not to do the obvious thing is the
  point.
- Prefer `| null` over optional properties.

## Rights holders

If you are a rights holder and have a concern, open an issue. This project has
no lyrics to remove. If the concern is about a source being contacted, that
source can be disabled by default or deleted, and the change is small.
