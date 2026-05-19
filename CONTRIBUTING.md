# Contributing

Thanks for your interest in NoteTaker. This project is licensed under the [Apache License 2.0](LICENSE).

## Development setup

```bash
pnpm install
pnpm sidecar:build         # macOS only
pnpm models:download       # downloads required STT models (~580 MB)
pnpm dev
```

See [README.md](README.md) for full requirements and platform notes.

## Pull requests

1. Open an issue or comment on an existing one before large changes.
2. Fork the repo and create a feature branch.
3. Keep changes focused — one logical change per PR.
4. Run `pnpm typecheck` and `pnpm build` before submitting.
5. Update documentation if behavior or setup steps change.

## Developer Certificate of Origin

By contributing, you agree that your contributions are made under the Apache License 2.0 and that you have the right to submit them.

Sign your commits using the `Signed-off-by` trailer:

```bash
git commit -s -m "Your commit message"
```

This certifies the [Developer Certificate of Origin](https://developercertificate.org/):

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.

Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## Code style

- Match existing patterns in the file you are editing.
- TypeScript strict mode is enabled — avoid `any` unless necessary.
- Prefer small, readable changes over large refactors mixed with feature work.
